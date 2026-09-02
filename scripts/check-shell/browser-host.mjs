// The browser's own host: what it answers for a published site, over a stand-in module.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { POLICY, sitePage } from '../web-page.mjs';
import {
  check,
  checkSettled,
  noopPost,
  pageMarkup,
  record,
  root,
  runShell,
  settle,
  source,
  standInState,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- the browser's own host -------------------------------------------------
  //
  // The app and a published site are one front end with two hosts under it, and `web/preview/host.js` is the browser's half — shipped to every site the export writes, and reachable nowhere else outside a browser.
  //
  // It runs here in the same fake page the fragments do, over a stand-in module rather than the real one: no wasm, no network, no browser. That stand-in carries a real linear memory and speaks the length-prefixed byte protocol, so the host's own copy of that protocol is proved as well as its arms — the copy `scripts/web-module.mjs` exists to stop drifting from.

  /** A stand-in for the browser module: a real `WebAssembly.Memory`, a bump allocator over it, and the length-prefixed answers the host reads. */
  function standInModule() {
    const memory = new WebAssembly.Memory({ initial: 4 });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const asked = [];
    let glossary = '';
    // Zero is the host's "nothing came back", so nothing is ever handed out at it.
    let next = 8;

    const alloc = (length) => {
      const at = next;
      next += length + ((8 - (length % 8)) % 8);
      if (next > memory.buffer.byteLength) throw new Error('the stand-in module ran out of memory');
      return at;
    };
    const takeBytes = (pointer, length) => new Uint8Array(memory.buffer, pointer, length).slice();
    const take = (pointer, length) => decoder.decode(takeBytes(pointer, length));
    const give = (text) => {
      const bytes = encoder.encode(text);
      const at = alloc(4 + bytes.length);
      new DataView(memory.buffer).setUint32(at, bytes.length, true);
      new Uint8Array(memory.buffer).set(bytes, at + 4);
      return at;
    };

    return {
      asked,
      exports: {
        memory,
        leaf_alloc: (length) => alloc(length),
        leaf_free: () => {},
        leaf_set_glossary: (pointer, length) => {
          glossary = take(pointer, length);
        },
        leaf_set_image_base: (pointer, length) => {
          asked.push({ call: 'setImageBase', base: take(pointer, length) });
        },
        // Bytes, and no text arm beside it on purpose: a document reaches the module as the file's own bytes, because a Word, Excel, PowerPoint or OpenDocument file is a zip and a decode of one is not the document. A host that went back to handing a string across finds no arm here.
        leaf_document_script_bytes: (bodyPointer, bodyLength, pathPointer, pathLength) => {
          const path = take(pathPointer, pathLength);
          const bytes = takeBytes(bodyPointer, bodyLength);
          asked.push({ call: 'documentScript', path, bytes, source: decoder.decode(bytes) });
          return give(`window.leafSetState(${JSON.stringify(standInState(path))});`);
        },
        leaf_glossary_script: (pointer, length) => {
          const href = take(pointer, length);
          asked.push({ call: 'glossaryScript', href, glossary });
          return give(`window.__leafGlossary = ${JSON.stringify({ href, glossary })};`);
        },
      },
    };
  }

  /** The served listing a boot reads unless a check hands over its own: shallowest first, the way the export writes it. `notes` has no page of its own, which is the fallback case. */
  const SERVED_DOCUMENTS = [{ path: 'README.md' }, { path: 'notes/one.md' }, { path: 'notes/two.md' }];

  /** The host, in a page that has what the published one has. The export writes the pending-command stub, not the host, so it is installed here exactly as the export writes it — a check without it is not testing the page a reader is served. */
  async function bootWebHost({ pending = [], documents = SERVED_DOCUMENTS, name = '', kept = {}, read = null } = {}) {
    const module_ = standInModule();
    const extras = {
      // The published page's own queue: the front end sends its first commands before any module script can have run, and the host drains them.
      __leafPending: [...pending],
      fetch: async (url) => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8), url }),
      WebAssembly: {
        Memory: WebAssembly.Memory,
        instantiate: async () => ({ instance: { exports: module_.exports } }),
      },
    };
    const context = runShell(source, extras);
    context.window.ipc = { postMessage: noopPost };

    // The browser's own store, and the file the published page reads it back with — run here the way the page runs it, above the host, because the host seeds itself out of what it finds there.
    const store = new Map(Object.entries(kept));
    context.window.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    };
    // The line the module's own boot script writes: the state the page starts from, with neither list in it.
    context.window.__leafInitialState = { recent: [], favorites: [], tabs: [], active: null, document: null };
    new vm.Script(readFileSync(join(root, 'web/preview/settings.js'), 'utf8'), { filename: 'settings.js' }).runInContext(context);

    // Everything the host hands the page, recorded on the way through. The pane and the strip still run the page's own call, so a payload the front end cannot take fails here. The state call is recorded and not run: it renders a whole document, and nothing is rendered on this page for it to render into — what is being proved is that the host reached the page by the call it reads a document in by.
    const seen = { state: [], favorites: [], folder: [], pager: [], fragment: [], place: [] };
    const watch = (name, into, through) => {
      const was = context.window[name];
      context.window[name] = (payload) => {
        into.push(payload);
        if (through && typeof was === 'function') was(payload);
      };
    };
    watch('leafSetState', seen.state, false);
    watch('leafSetFavorites', seen.favorites, true);
    watch('leafSetLibraryFolder', seen.folder, true);
    watch('leafSetPager', seen.pager, true);
    // The two the history work rides on. Recorded and not run, for the same reason the state call is: nothing is rendered on this page to scroll.
    watch('leafScrollToFragment', seen.fragment, false);
    watch('leafRestoreScrollAnchor', seen.place, false);

    const host = readFileSync(join(root, 'web/preview/host.js'), 'utf8');
    // The host is an ES module with three exports and no imports, so it evaluates as a script once the export keyword is off. Nothing else about it is touched.
    new vm.Script(host.replace(/^export /gm, '') + '\nglobalThis.__startLeaftext = startLeaftext;\nglobalThis.__COMMANDS = COMMANDS;\nglobalThis.__answers = answers;\nglobalThis.__LATER = LATER;\nglobalThis.__landingPath = landingPath;', {
      filename: 'host.js',
    }).runInContext(context);

    const leaf = await context.__startLeaftext({
      documents,
      name,
      read: read || (async (path) => new TextEncoder().encode(`# ${path}\n\nWords.\n`)),
    });
    return {
      context,
      leaf,
      seen,
      asked: module_.asked,
      address: context.__address,
      // What the browser would still be holding after a reload.
      stored: () => JSON.parse(store.get('leaftext.settings') || '{}'),
      send: (message) => context.window.ipc.postMessage(JSON.stringify(message)),
    };
  }

  checkSettled('the browser host hands a document across as the file it read, byte for byte', async () => {
    // A package: an archive mark, some words, and a byte no UTF-8 decoder can carry. An exported site reading this as text would hand the module replacement characters where that byte sits, and the reader would meet a parse error under the file's own name.
    const word = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode('Quarterly report'), 0xff]);
    const { leaf, asked } = await bootWebHost({
      documents: [{ path: 'README.md' }, { path: 'report.docx' }],
      read: async () => word,
    });
    await leaf.openDocument('report.docx');

    const opened = asked.find((one) => one.call === 'documentScript' && one.path === 'report.docx');
    if (!opened) throw new Error('opening a Word file never reached the module');
    if (opened.bytes.length !== word.length || opened.bytes.some((byte, at) => byte !== word[at])) {
      throw new Error(`the module was handed ${opened.bytes.length} bytes that are not the ${word.length} the host read, so something decoded the file on the way`);
    }
  });

  checkSettled('the browser host opens a document, fills the pane and fills the strip', async () => {
    const { leaf, seen, asked } = await bootWebHost();
    await leaf.openDocument('notes/one.md');

    const opened = asked.find((one) => one.call === 'documentScript' && one.path === 'notes/one.md');
    if (!opened) throw new Error('opening a document never reached the module');
    if (!opened.source.includes('notes/one.md')) throw new Error('the module was handed the wrong source');
    if (!seen.state.some((one) => one.document && one.document.path === 'notes/one.md')) {
      throw new Error(`the document never reached the page as a state call: ${JSON.stringify(seen.state.map((one) => one.document && one.document.path))}`);
    }
    // The pane follows the document, the way it does in the app.
    const folder = seen.folder[seen.folder.length - 1];
    if (!folder || folder.path !== 'notes') throw new Error(`the pane was pointed at ${JSON.stringify(folder && folder.path)} instead of the document's own folder`);
    if (!folder.entries.some((entry) => entry.path === 'notes/two.md')) throw new Error('the pane listing left out a document in that folder');
    // A waiting state is a promise: the strip is drawn empty and this is what fills it.
    const pager = seen.pager[seen.pager.length - 1];
    if (!pager || !pager.html.includes('docs-pager-next')) throw new Error(`the Previous/Next strip came back empty: ${JSON.stringify(pager)}`);
    // A site serves only documents the app reads, so its count is always none — sent all the same, so the pane never has to ask who is talking.
    if (folder.skippedFiles !== 0) throw new Error(`a site handed the pane ${JSON.stringify(folder.skippedFiles)} as the files it skipped`);
  });

  // A site's front door. The listing is ordered shallowest first and then by name, so a root GLOSSARY.md beats the README beside it — which is how a published site came to open on whatever sorted first rather than on the page its author would call its front.
  checkSettled('a site opens its own front page, and the leaf comes back to it', async () => {
    // The same landing, opened the way the published boot opens it: the rule, handed to openAddress as the fallback.
    const land = async (documents) => {
      const booted = await bootWebHost({ documents });
      await booted.leaf.openAddress(booted.context.__landingPath(documents));
      const opened = booted.asked.filter((one) => one.call === 'documentScript');
      return Object.assign(booted, { landed: opened.length ? opened[opened.length - 1].path : null });
    };
    const at = (booted) => {
      const opened = booted.asked.filter((one) => one.call === 'documentScript');
      return opened.length ? opened[opened.length - 1].path : null;
    };

    const readme = await land([{ path: 'GLOSSARY.md' }, { path: 'README.md' }, { path: 'index.md' }, { path: 'notes/one.md' }]);
    if (readme.landed !== 'README.md') throw new Error(`a site with a README at the top of it opened ${JSON.stringify(readme.landed)}`);

    const index = await land([{ path: 'GLOSSARY.md' }, { path: 'index.html.md' }, { path: 'notes/one.md' }]);
    if (index.landed !== 'index.html.md') throw new Error(`a site with an index and no README opened ${JSON.stringify(index.landed)}`);

    // Neither name at the top: the first document the listing serves, which is the order the Previous/Next strip walks.
    const neither = await land([{ path: 'GLOSSARY.md' }, { path: 'notes/README.md' }]);
    if (neither.landed !== 'GLOSSARY.md') throw new Error(`a site with neither name at its top opened ${JSON.stringify(neither.landed)}`);

    // The spelling is the author's, so the test is not.
    const lower = await land([{ path: 'aaa.md' }, { path: 'readme.md' }]);
    if (lower.landed !== 'readme.md') throw new Error(`a lower-case readme did not land: ${JSON.stringify(lower.landed)}`);

    // A document named in the bar is the reader asking for that one; the landing is only ever the fallback.
    const documents = [{ path: 'README.md' }, { path: 'notes/one.md' }, { path: 'notes/two.md' }];
    const asked_ = await bootWebHost({ documents });
    asked_.context.__address.history.replaceState(null, '', '#notes/two.md');
    await asked_.leaf.openAddress(asked_.context.__landingPath(documents));
    if (at(asked_) !== 'notes/two.md') throw new Error(`an address naming a document opened ${JSON.stringify(at(asked_))}`);

    // The leaf: the same function's answer, so the way back cannot disagree with the way in.
    asked_.send({ command: 'goHome' });
    await settle();
    if (at(asked_) !== 'README.md') throw new Error(`the leaf went to ${JSON.stringify(at(asked_))} instead of the site's front page`);
  });

  /** The published boot itself, run the way the page runs it: its own file, its one import answered by the host already evaluated in this context, and every fetch answered by the check. A module's body runs inside a call, which is what the wrapper is for — the file has a top-level await and a script may not. */
  async function runSiteBoot(answer) {
    const module_ = standInModule();
    const context = runShell(source, {
      __leafPending: [],
      fetch: async (url) => answer(String(url)),
      WebAssembly: {
        Memory: WebAssembly.Memory,
        instantiate: async () => ({ instance: { exports: module_.exports } }),
      },
    });
    context.window.ipc = { postMessage: noopPost };
    // Recorded rather than run, the way the host boot beside this one does it: the state call renders a whole document, and nothing is rendered on this page for it to render into.
    const state = [];
    context.window.leafSetState = (payload) => state.push(payload);
    const host = readFileSync(join(root, 'web/preview/host.js'), 'utf8');
    new vm.Script(host.replace(/^export /gm, ''), { filename: 'host.js' }).runInContext(context);
    const boot = readFileSync(join(root, 'web/preview/boot.js'), 'utf8');
    await new vm.Script(`(async () => {\n${boot.replace(/^import .*$/gm, '')}\n})()`, { filename: 'boot.js' }).runInContext(context);
    return { context, state, asked: module_.asked };
  }

  /** Every file a healthy site is served, answered from one listing. */
  const servedFiles = (documents) => async (url) => {
    if (url.endsWith('.wasm')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(8), url };
    if (url === 'documents.json') return { ok: true, json: async () => ({ name: 'site', documents }), url };
    // A document is served as bytes, the way a static host serves one and the way the boot reads it: the six packaged formats are zips, so text is not a shape they have.
    if (url.startsWith('source/')) {
      const bytes = new TextEncoder().encode(`# ${url}\n\nWords.\n`);
      return { ok: true, text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.buffer, url };
    }
    return { ok: false, status: 404, url };
  };

  // A site opened straight off a folder on the disk fetches nothing at all, and a publish that went out short fetches most of it. Neither may kill the boot silently and leave the reader at the empty start screen, reading it as a site with no documents in it.
  checkSettled('a file that did not arrive is named on the page instead of killing the boot quietly', async () => {
    const documents = [{ path: 'README.md' }, { path: 'notes/one.md' }];

    const healthy = await runSiteBoot(servedFiles(documents));
    const drawn = String(healthy.context.document.getElementById('app').innerHTML || '');
    if (drawn.includes('did not arrive')) throw new Error(`a site whose files all arrived said one had not: ${drawn.slice(0, 400)}`);
    // And it landed on the site's own front page, which is the whole boot walked end to end.
    const landed = healthy.state[healthy.state.length - 1];
    if (!landed || !landed.document || landed.document.path !== 'README.md') {
      throw new Error(`the published boot landed on ${JSON.stringify(landed && landed.document && landed.document.path)}`);
    }

    // The listing itself, which is what a folder opened off the disk fails at first.
    const noListing = await runSiteBoot(async () => {
      throw new TypeError('Failed to fetch');
    });
    const said = String(noListing.context.document.getElementById('app').innerHTML || '');
    if (!said.includes('did not arrive')) throw new Error(`a site with no listing said nothing: ${said.slice(0, 300)}`);
    if (!said.includes('documents.json')) throw new Error(`the message did not name the file that did not arrive: ${said.slice(0, 300)}`);

    // One document short: published, listed, and not in the folder.
    const served = servedFiles(documents);
    const shortOne = await runSiteBoot(async (url) => (url === 'source/README.md' ? { ok: false, status: 404, url } : served(url)));
    const missing = String(shortOne.context.document.getElementById('app').innerHTML || '');
    if (!missing.includes('source/README.md')) throw new Error(`a missing document was not named: ${missing.slice(0, 300)}`);
  });

  // A published site's page sits at the top and its documents sit under `source/`, so a picture beside a document is only reachable through that folder. Told rather than guessed: the module resolves the address, and without this call it resolves it against the top of the site and every picture comes back as the broken mark.
  checkSettled('the published boot tells the module where its pictures are served from', async () => {
    const booted = await runSiteBoot(servedFiles([{ path: 'README.md' }, { path: 'notes/one.md' }]));
    const told = booted.asked.filter((one) => one.call === 'setImageBase');
    if (!told.length) throw new Error('the boot never told the module where the documents are served from, so every picture asks the top of the site');
    if (told[0].base !== 'source') throw new Error(`the boot handed over ${JSON.stringify(told[0].base)} instead of the folder it fetches every document from`);
    // Before the first document is rendered, or the page it lands on asks the wrong address for its pictures.
    const rendered = booted.asked.findIndex((one) => one.call === 'documentScript');
    if (rendered !== -1 && booted.asked.indexOf(told[0]) > rendered) {
      throw new Error('the first document was rendered before the module was told, so its pictures were resolved against the top of the site');
    }
  });

  checkSettled('the browser host opens a link inside the site as a document and one outside it in a tab', async () => {
    const { leaf, send, asked, context } = await bootWebHost();
    await leaf.openDocument('notes/one.md');
    const opened = () => asked.filter((one) => one.call === 'documentScript').map((one) => one.path);

    send({ command: 'openLink', href: 'two.md' });
    await settle();
    if (!opened().includes('notes/two.md')) throw new Error(`a link beside the document opened ${JSON.stringify(opened())}`);

    const before = opened().length;
    const tabs = () => context.__opened || [];
    send({ command: 'openLink', href: 'https://example.com/notes/two.md' });
    await settle();
    if (opened().length !== before) throw new Error('a link off the site was followed as if it were a document here');
    // The page is already a browser, so a link it has no document for is followed rather than swallowed into the console.
    if (!tabs().some((one) => one.url === 'https://example.com/notes/two.md')) {
      throw new Error(`a link off the site opened ${JSON.stringify(tabs())}`);
    }

    // A file beside the document that the site does not serve as a document — a saved page, a PDF, a picture — resolved against the document being read rather than against the front door.
    send({ command: 'openLink', href: '../designs/v3-00-map.html' });
    await settle();
    if (!tabs().some((one) => one.url === 'https://leaf.test/designs/v3-00-map.html')) {
      throw new Error(`a link to a file beside the document opened ${JSON.stringify(tabs())}`);
    }

    // A folder link is that folder's own page, which is how the app reads one too. The resolver answers with the document and the heading the link named, so the document is read off the pair.
    const up = leaf.resolveFrom('notes/one.md', '../README.md');
    if (!up || up.path !== 'README.md') throw new Error(`a link up to the top of the site resolved to ${JSON.stringify(up)}`);
    if (up.anchor !== '') throw new Error(`a link naming no heading came back carrying ${JSON.stringify(up.anchor)}`);
  });

  // The site published today is folders of folders, and its contents pages link down through them — so this is the shape of link a reader meets most, and the one an href resolved against the front door sends nowhere.
  checkSettled('a link written inside a folder opens the document beside it, not the one at the top of the site', async () => {
    const { leaf, send, asked } = await bootWebHost({
      documents: [
        { path: 'README.md' },
        // The same name at the top of the site: the wrong-but-listed match a resolved href opens instead.
        { path: 'volume-3/README.md' },
        { path: 'docs/collection-1/README.md' },
        { path: 'docs/collection-1/volume-3/README.md' },
        { path: 'docs/other/note.md' },
      ],
    });
    await leaf.openAddress('README.md');
    const at = () => {
      const opened = asked.filter((one) => one.call === 'documentScript');
      return opened.length ? opened[opened.length - 1].path : null;
    };

    send({ command: 'openLink', href: 'docs/collection-1/README.md' });
    await settle();
    if (at() !== 'docs/collection-1/README.md') throw new Error(`a link off the front page opened ${at()}`);

    send({ command: 'openLink', href: 'volume-3/README.md' });
    await settle();
    if (at() !== 'docs/collection-1/volume-3/README.md') throw new Error(`a link written two folders down opened ${at()}`);

    // Up two folders and across, from the document that is two folders down.
    send({ command: 'openLink', href: '../../other/note.md' });
    await settle();
    if (at() !== 'docs/other/note.md') throw new Error(`a link written up and across opened ${at()}`);
  });

  // What a written href carries that the address's path had already dropped, and what it does not carry that the path already had.
  checkSettled('a written href keeps its heading off the file name, comes back from its encoding, and leaves a whole path alone', async () => {
    const { leaf, send, asked } = await bootWebHost({
      documents: [{ path: 'README.md' }, { path: 'notes/one.md' }, { path: 'notes/two.md' }, { path: 'notes/My File.md' }],
    });
    await leaf.openDocument('notes/one.md');
    const at = () => {
      const opened = asked.filter((one) => one.call === 'documentScript');
      return opened.length ? opened[opened.length - 1].path : null;
    };

    // The cut is at the first `#`, so the heading is not read as part of the file name.
    send({ command: 'openLink', href: 'two.md#how-it-ranks' });
    await settle();
    if (at() !== 'notes/two.md') throw new Error(`a link naming a heading opened ${at()}`);

    send({ command: 'openLink', href: 'one.md?v=2' });
    await settle();
    if (at() !== 'notes/one.md') throw new Error(`a link carrying a query opened ${at()}`);

    // Nothing decodes a relative href on the way here, and the served listing holds names as they are.
    send({ command: 'openLink', href: 'My%20File.md' });
    await settle();
    if (at() !== 'notes/My File.md') throw new Error(`a hand-encoded name opened ${at()}`);

    // The Previous/Next strip writes whole paths from the top of the site rather than relative ones, and this is the fallback that carries them.
    send({ command: 'openLink', href: 'notes/two.md' });
    await settle();
    if (at() !== 'notes/two.md') throw new Error(`a Previous/Next link read from inside a folder opened ${at()}`);

    // Still refused, because a link out of the site is written with its own scheme.
    const before = at();
    send({ command: 'openLink', href: 'https://example.com/notes/two.md#top' });
    await settle();
    if (at() !== before) throw new Error(`a link off the site opened ${at()}`);
  });

  // A great many of a site's cross-references name a heading, and the heading must not be thrown away one line before the document opens — thrown away, the reader arrives at the top of a document long enough to have headings worth linking. Both shapes a click arrives in are here: the address the browser worked out, where the heading would otherwise go the way of the path, and the href as written, which is what a diagram's box sends.
  checkSettled('a link naming a heading in another document lands on that heading rather than the top of the page', async () => {
    const { leaf, send, seen, asked, address } = await bootWebHost();
    await leaf.openAddress('notes/one.md');
    const at = () => {
      const opened = asked.filter((one) => one.call === 'documentScript');
      return opened.length ? opened[opened.length - 1].path : null;
    };
    const scrolledTo = () => seen.fragment[seen.fragment.length - 1];

    // An href written with the site's own origin: the address's path never carries a fragment, so this is where the heading was lost.
    send({ command: 'openLink', href: 'https://leaf.test/notes/two.md#how-it-ranks' });
    await settle();
    if (at() !== 'notes/two.md') throw new Error(`a link naming a heading opened ${at()}`);
    if (scrolledTo() !== 'how-it-ranks') throw new Error(`the heading never reached the page's own scroll: ${JSON.stringify(seen.fragment)}`);
    if (address.location.hash !== '#notes/two.md#how-it-ranks') throw new Error(`landing on a heading wrote the address as ${address.location.hash}`);

    // The href as written, which is the shape a link inside a diagram sends.
    send({ command: 'openLink', href: '../README.md#the-top' });
    await settle();
    if (at() !== 'README.md') throw new Error(`a written href naming a heading opened ${at()}`);
    if (scrolledTo() !== 'the-top') throw new Error(`a written href's heading never reached the page's own scroll: ${JSON.stringify(seen.fragment)}`);
    if (address.location.hash !== '#README.md#the-top') throw new Error(`a written href's heading wrote the address as ${address.location.hash}`);

    // The browser's own Back walks out of the landing, because it is an entry of its own.
    if (!address.history.back()) throw new Error('Back out of a heading landing went nowhere');
    await settle();
    if (address.location.hash !== '#notes/two.md#how-it-ranks') throw new Error(`Back landed on ${address.location.hash}`);
  });

  checkSettled('a link naming no heading opens the same document, and a folder link carrying one still finds the folder’s page', async () => {
    const { leaf, send, seen, asked, address } = await bootWebHost({
      documents: [{ path: 'README.md' }, { path: 'notes/one.md' }, { path: 'notes/two.md' }, { path: 'guide/README.md' }],
    });
    await leaf.openAddress('notes/one.md');
    const at = () => {
      const opened = asked.filter((one) => one.call === 'documentScript');
      return opened.length ? opened[opened.length - 1].path : null;
    };

    send({ command: 'openLink', href: 'two.md' });
    await settle();
    if (at() !== 'notes/two.md') throw new Error(`a link naming no heading opened ${at()}`);
    if (address.location.hash !== '#notes/two.md') throw new Error(`a link naming no heading wrote the address as ${address.location.hash}`);
    const scrolls = seen.fragment.length;

    send({ command: 'openLink', href: 'https://leaf.test/README.md' });
    await settle();
    if (at() !== 'README.md') throw new Error(`an address naming no heading opened ${at()}`);
    if (seen.fragment.length !== scrolls) throw new Error('a link naming no heading was still scrolled somewhere');

    // The cut is above every fallback below it, so a folder link carrying a heading finds the folder's own page and lands on the heading.
    send({ command: 'openLink', href: '../guide#what-it-is' });
    await settle();
    if (at() !== 'guide/README.md') throw new Error(`a folder link carrying a heading opened ${at()}`);
    if (address.location.hash !== '#guide/README.md#what-it-is') throw new Error(`a folder link carrying a heading wrote the address as ${address.location.hash}`);
  });

  // The encoding decision, held where it would otherwise come apart. A browser writes a hash percent-encoded whatever it was handed, and the host compares the address it wrote against the one the page is at as strings — so a heading decoded on the way in disagrees with itself and the same landing is added twice, which the browser's own Back looks dead on.
  checkSettled('a heading with a space in it leaves one address entry rather than two', async () => {
    const { leaf, send, seen, address } = await bootWebHost();
    await leaf.openAddress('notes/one.md');

    send({ command: 'openLink', href: 'two.md#how%20it%20ranks' });
    await settle();
    const entries = address.urls().length;
    if (address.location.hash !== '#notes/two.md#how%20it%20ranks') throw new Error(`a heading with a space wrote the address as ${address.location.hash}`);
    // Handed to the page exactly as the link had it; the page's own scroll tries it both ways.
    if (seen.fragment[seen.fragment.length - 1] !== 'how%20it%20ranks') throw new Error(`the heading was decoded on the way to the page: ${JSON.stringify(seen.fragment)}`);

    send({ command: 'openLink', href: 'two.md#how%20it%20ranks' });
    await settle();
    if (address.urls().length !== entries) throw new Error(`the same landing was added twice, leaving ${address.urls().length} entries rather than ${entries}`);
  });

  checkSettled('the commands sent while the host was still loading are drained, not dropped', async () => {
    // What the export's stub keeps: the front end's first commands, sent before any module script can have run. Losing them loses the first paint.
    const { seen } = await bootWebHost({
      pending: [JSON.stringify({ command: 'getFolder', path: 'notes' })],
    });
    if (!seen.folder.some((one) => one.path === 'notes')) {
      throw new Error(`a command sent while the host was loading was dropped: ${JSON.stringify(seen.folder.map((one) => one.path))}`);
    }
  });

  checkSettled('a command the browser host has no arm for is refused where something can see it', async () => {
    const { leaf, send, context } = await bootWebHost();
    send({ command: 'search', query: 'anything' });
    const [refusal] = leaf.refused;
    if (!refusal) throw new Error('an unanswered command was swallowed — nothing but a console line said so');
    if (refusal.command !== 'search' || refusal.kind !== context.__LATER) throw new Error(`the refusal does not say what kind it is: ${JSON.stringify(refusal)}`);
    if (!refusal.reason.includes('web-app-commands')) throw new Error(`the refusal does not name the ticket that owns it: ${refusal.reason}`);

    // The arms and the table agree about which commands are answered, which is what a page hiding its dead controls will ask.
    const answered = Object.keys(context.__COMMANDS).filter((name) => context.__answers(name));
    record.webAnswered = answered.length;
    const expected = [
      'openRecent',
      // The mark, kept in the browser's own store the way the reader's other choices are.
      'toggleFavorite',
      'checkFavorites',
      'moveFavorite',
      // The leaf, which on a site is the way back to its own front page.
      'goHome',
      'openLink',
      'openGlossary',
      // The choices a site keeps, each written by the one command that owns it.
      'setSpeedReaderEnabled',
      'setCodeIntelEnabled',
      'setReadingUnlocked',
      'setCodeUnlocked',
      'setThemeFamily',
      'setThemeMode',
      'setThemeRandomBag',
      'setLibraryState',
      'setLibraryLayout',
      'getFolder',
      'loadPager',
      // The page as it stands, through the browser's own print — the same call wry makes on Windows, over the same print rules.
      'exportPdf',
    ];
    if (answered.join(',') !== expected.join(',')) {
      throw new Error(`the table says these are answered: ${answered.join(',')}`);
    }
    for (const name of answered) {
      send({ command: name, path: 'README.md', href: 'README.md' });
    }
    await settle();
    if (leaf.refused.length !== 1) throw new Error(`an arm the table calls answered was refused: ${JSON.stringify(leaf.refused)}`);
    // Export PDF is the one arm above whose whole job is a call out to the browser, so an arm that quietly did nothing would pass the sweep. The page's own print is what a site has instead of a print panel the host opens.
    if (!context.window.__printed) throw new Error('the site host answered exportPdf and never reached the browser print it is written as');
  });

  checkSettled('the page can ask exactly what the published-site host answers', async () => {
    const { context } = await bootWebHost();
    if (context.window.__leafHostAnswers !== context.__answers) throw new Error("the page's answer did not come from the host's command table");
    if (!context.window.__leafHostAnswers('toggleFavorite')) throw new Error('the page was told the published-site host does not mark pages');
    if (context.window.__leafHostAnswers('open') || context.window.__leafHostAnswers('search')) {
      throw new Error('the page was told the published-site host answers a command it refuses or has not built yet');
    }
  });

  checkSettled("the browser's own Back walks the site and lands on the paragraph the reader left", async () => {
    const { leaf, send, seen, address } = await bootWebHost();
    const opened = () => seen.state.map((one) => one.document && one.document.path);
    const at = () => opened()[opened().length - 1];

    // Arriving is not a step the reader took, so the entry they arrived on is replaced rather than added to.
    await leaf.openAddress('README.md');
    if (address.urls().length !== 1) throw new Error(`landing on the site left ${address.urls().length} entries instead of the one the reader arrived on`);

    const walk = [
      { href: 'notes/one.md', place: { section: 'readme-top', block: 3, offsetY: 12 } },
      { href: 'two.md', place: { section: 'one-middle', block: 1, offsetY: 4 } },
      { href: '#deep-heading', place: { section: 'two-middle', block: 2, offsetY: 8 } },
    ];
    for (const step of walk) {
      send({ command: 'openLink', href: step.href, scroll_anchor: step.place });
      await settle();
    }
    if (address.urls().length !== 4) throw new Error(`three steps through the site left ${address.urls().length} entries, so the browser's own Back has nowhere to go`);
    if (address.location.hash !== '#notes/two.md#deep-heading') throw new Error(`a heading jump wrote the address as ${address.location.hash}`);

    // Walking back: each entry says which document, and where the reader was when they left it.
    const back = () => {
      const moved = address.history.back();
      return moved;
    };
    if (!back()) throw new Error('the first Back went nowhere');
    await settle();
    if (address.location.hash !== '#notes/two.md') throw new Error(`Back out of a heading jump landed on ${address.location.hash}`);
    if ((seen.place[seen.place.length - 1] || {}).section !== 'two-middle') throw new Error(`Back landed at the top rather than the paragraph: ${JSON.stringify(seen.place[seen.place.length - 1])}`);

    if (!back()) throw new Error('the second Back went nowhere');
    await settle();
    if (at() !== 'notes/one.md') throw new Error(`the second Back opened ${at()}`);
    if ((seen.place[seen.place.length - 1] || {}).section !== 'one-middle') throw new Error('the second Back lost the place the reader left');

    if (!back()) throw new Error('the third Back went nowhere');
    await settle();
    if (at() !== 'README.md') throw new Error(`the third Back opened ${at()} rather than the document the reader landed on`);
    if ((seen.place[seen.place.length - 1] || {}).section !== 'readme-top') throw new Error('the third Back lost the place the reader left');

    // The fourth is the arrival itself: nothing behind it, and nothing that walks off the site.
    const documents = opened().length;
    if (back()) throw new Error('a fourth Back walked off the site instead of stopping at the arrival');
    await settle();
    if (opened().length !== documents) throw new Error('a Back with nothing behind it still opened a document');
  });

  checkSettled('a link to a heading inside the document reaches the page rather than the document resolver', async () => {
    const { leaf, send, seen, asked, address } = await bootWebHost();
    await leaf.openAddress('notes/one.md');
    const renders = () => asked.filter((one) => one.call === 'documentScript').length;
    const before = renders();

    send({ command: 'openLink', href: '#a-heading', scroll_anchor: { section: 'one-top', block: 0, offsetY: 0 } });
    await settle();
    if (!seen.fragment.includes('a-heading')) throw new Error(`a heading link never reached the page's own scroll: ${JSON.stringify(seen.fragment)}`);
    // A bare fragment put through the document resolver matches nothing and becomes a console line, so it must never reach it.
    if (renders() !== before) throw new Error('a heading link was put through the document resolver and opened something');
    if (address.location.hash !== '#notes/one.md#a-heading') throw new Error(`a heading jump wrote the address as ${address.location.hash}`);
  });

  /** The choices a published site keeps, and the command that owns each. Ten keys across nine commands: the pane's two travel together. */
  const KEPT_CHOICES = [
    [{ command: 'setSpeedReaderEnabled', enabled: true }, { speedReaderEnabled: true }],
    [{ command: 'setCodeIntelEnabled', enabled: true }, { codeIntelEnabled: true }],
    [{ command: 'setReadingUnlocked', enabled: true }, { readingUnlocked: true }],
    [{ command: 'setCodeUnlocked', enabled: true }, { codeUnlocked: true }],
    [{ command: 'setThemeFamily', family: 'amaranth' }, { themeFamily: 'amaranth' }],
    [{ command: 'setThemeMode', mode: 'dark' }, { themeMode: 'dark' }],
    [{ command: 'setThemeRandomBag', used: ['fern', 'github'] }, { themeRandomUsed: ['fern', 'github'] }],
    [{ command: 'setLibraryState', projectPath: 'notes' }, { libraryProjectPath: 'notes' }],
    [{ command: 'setLibraryLayout', closed: true, width: 320 }, { libraryClosed: true, libraryWidth: 320 }],
  ];

  check('a site puts every choice a reader kept back on the page, and a storage that refuses leaves the defaults', () => {
    const defaults = {
      speedReaderEnabled: false,
      codeIntelEnabled: false,
      readingUnlocked: false,
      codeUnlocked: false,
      themeFamily: 'fern',
      themeMode: 'system',
      themeRandomUsed: [],
      libraryProjectPath: '',
      libraryClosed: false,
      libraryWidth: 280,
      // Nothing a site sends, so nothing the store carries: it has to come through untouched.
      updateLastChecked: 0,
    };
    /** The store the site reads back, run the way the page runs it: a classic script, above everything, over the defaults the page was handed. */
    const restore = (localStorage) => {
      const sandbox = { __leafSettings: Object.assign({}, defaults), localStorage, JSON, Object, Array };
      sandbox.window = sandbox;
      const context = vm.createContext(sandbox);
      new vm.Script(readFileSync(join(root, 'web/preview/settings.js'), 'utf8'), { filename: 'settings.js' }).runInContext(context);
      return sandbox;
    };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    const kept = Object.assign({}, ...KEPT_CHOICES.map(([, keys]) => keys));
    const back = restore({ getItem: () => JSON.stringify(kept), setItem() {} });
    for (const [key, value] of Object.entries(kept)) {
      if (!same(back.__leafSettings[key], value)) {
        throw new Error(`${key} came back as ${JSON.stringify(back.__leafSettings[key])} rather than ${JSON.stringify(value)}`);
      }
    }
    if (back.__leafSettings.updateLastChecked !== 0) throw new Error('a default the store says nothing about was lost');

    // A store that refuses every touch — a browser with it turned off, or a page inside a frame that cannot reach it. The site reads on defaults rather than failing to boot, and a save is swallowed rather than thrown.
    const refused = restore({
      getItem() {
        throw new Error('storage is not available');
      },
      setItem() {
        throw new Error('storage is not available');
      },
    });
    for (const [key, value] of Object.entries(defaults)) {
      if (!same(refused.__leafSettings[key], value)) throw new Error(`a refused store lost the default for ${key}`);
    }
    refused.__leafSaveSettings({ themeMode: 'dark' });
    if (refused.__leafSettings.themeMode !== 'dark') throw new Error('a choice made against a refused store did not even hold for this reading');

    // A store holding something this version cannot read is the same case as no store at all.
    const junk = restore({ getItem: () => '["not an object"]', setItem() {} });
    if (junk.__leafSettings.themeFamily !== 'fern') throw new Error('a store holding the wrong shape overwrote the defaults');
  });

  checkSettled('each choice a site keeps is written by the one command that owns it', async () => {
    const { context, send } = await bootWebHost();
    const writes = [];
    context.window.__leafSaveSettings = (changed) => writes.push(changed);
    for (const [message, expected] of KEPT_CHOICES) {
      writes.length = 0;
      send(message);
      await settle();
      if (writes.length !== 1) throw new Error(`${message.command} wrote the store ${writes.length} times`);
      if (JSON.stringify(writes[0]) !== JSON.stringify(expected)) {
        throw new Error(`${message.command} wrote ${JSON.stringify(writes[0])} rather than ${JSON.stringify(expected)}`);
      }
    }
  });

  // The marks are the one kept thing that is state rather than a setting, so they come back over the state the page was handed rather than over its settings — and three commands share the one key, because they are three edits of one list.
  checkSettled('a site keeps the marks a reader made, and says which of them has left the export', async () => {
    const documents = [{ path: 'README.md' }, { path: 'notes/one.md' }, { path: 'notes/two.md' }];
    const held = {
      'leaftext.settings': JSON.stringify({
        favorites: [
          { vaultId: null, path: 'notes/two.md', kind: 'document' },
          { vaultId: null, path: 'gone.md', kind: 'document' },
        ],
      }),
    };
    const { context, leaf, send, stored } = await bootWebHost({ documents, kept: held });

    // Back over the state the page starts from, before the first render, the way a kept theme comes back over its settings.
    const landed = (context.window.__leafInitialState || {}).favorites || [];
    if (landed.map((one) => one.path).join(',') !== 'notes/two.md,gone.md') {
      throw new Error(`the kept marks did not reach the page's boot state: ${JSON.stringify(landed)}`);
    }
    await leaf.openAddress('README.md');
    if (!context.isFavoritePath('notes/two.md')) throw new Error('opening the first document cleared the mark the browser restored');

    send({ command: 'openRecent', path: 'notes/one.md' });
    await settle();
    if (!context.isFavoritePath('notes/two.md')) throw new Error('opening another document cleared the marks the browser restored');

    const marks = () => (stored().favorites || []).map((one) => one.path).join(',');

    send({ command: 'toggleFavorite', path: 'README.md', kind: 'document' });
    await settle();
    if (marks() !== 'notes/two.md,gone.md,README.md') throw new Error(`a mark made was kept as ${marks()}`);

    // Paths rather than places: the row before it is the one the reader dropped it above.
    send({ command: 'moveFavorite', path: 'README.md', before: 'gone.md' });
    await settle();
    if (marks() !== 'notes/two.md,README.md,gone.md') throw new Error(`a reordered mark was kept as ${marks()}`);

    // No row named: last.
    send({ command: 'moveFavorite', path: 'notes/two.md', before: null });
    await settle();
    if (marks() !== 'README.md,gone.md,notes/two.md') throw new Error(`a mark dropped at the foot was kept as ${marks()}`);

    // A mark whose document left the export, reported the way the desktop reports a moved file.
    const answers_ = [];
    context.window.leafSetFavoritesMissing = (answer) => answers_.push(answer);
    send({ command: 'checkFavorites' });
    await settle();
    const answer = answers_[answers_.length - 1];
    if (!answer || answer.paths.join(',') !== 'gone.md') throw new Error(`the missing marks came back as ${JSON.stringify(answer)}`);

    send({ command: 'toggleFavorite', path: 'README.md', kind: 'document' });
    await settle();
    if (marks() !== 'gone.md,notes/two.md') throw new Error(`a mark taken off was kept as ${marks()}`);
  });

  check("a published page fills its settings global above the page's own theme bootstrap, so a restored theme reaches the first paint", () => {
    // The bootstrap's own source stands in, so what is being read is where the tag sits rather than what is inside it.
    const page = sitePage(pageMarkup().replace('{{THEME_BOOTSTRAP_SCRIPT}}', 'window.__leafThemeResolved=1;'), 'window.__leafSettings={};');
    const order = [
      // The queue first: the theme bootstrap posts its random-theme draw, and without the stub already standing that message is lost.
      'window.__leafPending',
      'window.__leafSettings={}',
      'window.__leafSite',
      'assets/settings.js',
      // Only then the paint.
      'window.__leafThemeResolved',
      // The app's own front-end, and the host's loader under it. The seam rather than a filled tag, because this page is built from the template with only the bootstrap stood in.
      '{{FRONT_END}}',
      'assets/boot.js',
    ];
    let at = -1;
    for (const mark of order) {
      const found = page.indexOf(mark);
      if (found === -1) throw new Error(`the published page is missing ${mark}`);
      if (found < at) throw new Error(`${mark} landed above something that has to come before it`);
      at = found;
    }
    if (!page.includes(`content="${POLICY}"`)) throw new Error("the published page kept the desktop's own content policy");
    // A page that stopped leading with its own bootstrap is refused rather than injected into the wrong place.
    let refused = null;
    try {
      sitePage('<head><script src="elsewhere.js"></script></head><body></body>', 'x');
    } catch (error) {
      refused = error;
    }
    if (!refused) throw new Error('a page with no theme bootstrap to inject above was shaped anyway');
  });

  checkSettled("the trail's first word is the site's own name, and the desktop's word is untouched", async () => {
    const site = await bootWebHost({ name: 'Emptyguru' });
    await site.leaf.openAddress('README.md');
    const payload = site.seen.folder[site.seen.folder.length - 1];
    if (!payload || payload.rootName !== 'Emptyguru') {
      throw new Error(`the pane was handed ${JSON.stringify(payload && payload.rootName)} as the name of its root`);
    }
    if (site.context.libraryRootLabel() !== 'Emptyguru') throw new Error(`a site's trail starts with ${site.context.libraryRootLabel()}`);
    // And it reaches the trail itself, not only the label the trail asks.
    if (site.context.crumbSegments([]).map((one) => one.name).join(',') !== 'Emptyguru') {
      throw new Error('the name never reached the crumbs the trail is drawn from');
    }

    // A host that sends none — every desktop launch — keeps the word the app has always used.
    const plain = await bootWebHost();
    await plain.leaf.openAddress('README.md');
    if (plain.context.libraryRootLabel() !== 'Library') throw new Error(`the desktop's trail now starts with ${plain.context.libraryRootLabel()}`);

    // A vault still wins: on the desktop the root is the vault you are standing in.
    plain.context.leafSetVaults({ vaults: [{ id: 4, name: 'Notes' }], active: 4 });
    if (plain.context.libraryRootLabel() !== 'Notes') throw new Error('a vault stopped naming the root it is standing in');
  });

  checkSettled('a link to a folder opens its own page, or its first document when it has none', async () => {
    // `notes` is listed with two before one, so the fallback proves it follows the listing's own order rather than sorting a fresh one — that order is the Previous/Next strip's, and the two must not disagree.
    const { leaf, send, asked } = await bootWebHost({
      documents: [
        { path: 'README.md' },
        { path: 'guide/README.md' },
        { path: 'guide/deep.md' },
        { path: 'notes/two.md' },
        { path: 'notes/one.md' },
      ],
    });
    await leaf.openAddress('README.md');
    const at = () => {
      const opened = asked.filter((one) => one.call === 'documentScript');
      return opened.length ? opened[opened.length - 1].path : null;
    };

    send({ command: 'openLink', href: 'guide' });
    await settle();
    if (at() !== 'guide/README.md') throw new Error(`a folder with a page of its own opened ${at()}`);

    send({ command: 'openLink', href: '../notes' });
    await settle();
    if (at() !== 'notes/two.md') throw new Error(`a folder with no page of its own opened ${at()} rather than the first document listed under it`);

    // A folder that is not one still reports nothing rather than opening a neighbor whose name it is the start of.
    const before = at();
    send({ command: 'openLink', href: '../note' });
    await settle();
    if (at() !== before) throw new Error(`a link to nothing opened ${at()}`);
  });

  checkSettled('the browser host raises the glossary out of the text it was handed', async () => {
    const { leaf, send, asked } = await bootWebHost();
    leaf.core.setGlossary('## Vault\n\nA folder you named.\n');
    send({ command: 'openGlossary', href: 'glossary:vault' });
    await settle();
    const raised = asked.find((one) => one.call === 'glossaryScript');
    if (!raised) throw new Error('the glossary command never reached the module');
    if (raised.href !== 'glossary:vault') throw new Error(`the term was lost on the way: ${raised.href}`);
    if (!raised.glossary.includes('A folder you named.')) throw new Error('the glossary text never crossed into the module');
  });
}
