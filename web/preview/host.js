// A host for the app's own front end, in a browser.
//
// The page is the desktop's page and the script is the desktop's script, unchanged. What differs is who answers them: the desktop has a window, a disk and an event loop behind `window.ipc`; here there is a module, files beside the page, and this.
//
// So this is the browser's half of the same bargain the renderer already makes: it answers what a static site can answer — open a document, follow a link, walk Previous/Next, raise the glossary — and refuses out loud the rest, which is how a control that does nothing is found rather than shipped quietly.

// Beside the page, not at the top of a domain: a static site is often published under a folder.
const MODULE = 'assets/leaftext.wasm';

async function load(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`no renderer at ${url}`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
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
    boot: () => read(api.leaf_boot_script()),
    styles: () => read(api.leaf_styles()),
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

export async function startLeaftext({ documents, read }) {
  const core = await load(MODULE);
  const known = new Set(documents.map((entry) => entry.path));
  let open = null;

  // The reading order the Previous/Next strip walks: the listing as served, shallowest first.
  const order = documents.map((entry) => entry.path);

  /** Where a link written in one document points, resolved against the folder it sits in.
   *
   * The page resolves an href against the document's own address before it sends it, so most arrive absolute. One on this site names a document; one anywhere else is the web's, and this host does not follow it.
   */
  function resolveFrom(from, rawHref) {
    let href = rawHref;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      let address;
      try {
        address = new URL(href);
      } catch {
        return null;
      }
      if (address.origin !== location.origin) return null;
      href = decodeURIComponent(address.pathname.replace(/^\//, ''));
      // Already a whole path from the top of the site, so nothing to resolve it against.
      from = '';
    }
    const base = from.split('/').slice(0, -1);
    for (const part of href.split('/')) {
      if (part === '.' || part === '') continue;
      if (part === '..') base.pop();
      else base.push(part);
    }
    const path = base.join('/');
    if (known.has(path)) return path;
    // A link to a folder means that folder's own page, which is how the app reads one too.
    const asFolder = `${path.replace(/\/$/, '')}/README.md`;
    if (known.has(asFolder)) return asFolder;
    // The Previous/Next strip writes whole paths rather than relative ones, so an href that is already one is taken as it stands.
    const bare = href.replace(/^\.?\//, '');
    if (known.has(bare)) return bare;
    const bareFolder = `${bare.replace(/\/$/, '')}/README.md`;
    return known.has(bareFolder) ? bareFolder : null;
  }

  function label(path) {
    return path.split('/').pop().replace(/\.[^.]+$/, '');
  }

  /** The strip the desktop builds by walking a folder tree. Here the listing is the tree. */
  function pagerHtml(path) {
    const at = order.indexOf(path);
    if (at === -1) return '';
    const link = (to, side, kicker) =>
      to === undefined
        ? '<span></span>'
        : `<a class="docs-pager-${side}" href="${to}"><span class="docs-pager-label">${kicker}</span>${label(to)}</a>`;
    const previous = order[at - 1];
    const next = order[at + 1];
    if (previous === undefined && next === undefined) return '';
    return `<nav class="docs-pager" aria-label="Document navigation">${link(previous, 'prev', 'Previous')}${link(next, 'next', 'Next')}</nav>`;
  }

  /** One folder of the served listing, in the shape the pane draws: the folders in it, then the documents. */
  function folderListing(path) {
    const prefix = path ? `${path}/` : '';
    const folders = new Set();
    const files = [];
    for (const entry of documents) {
      if (!entry.path.startsWith(prefix)) continue;
      const rest = entry.path.slice(prefix.length);
      const cut = rest.indexOf('/');
      if (cut === -1) files.push({ name: rest, path: entry.path, kind: 'file', title: null, children: [] });
      else folders.add(rest.slice(0, cut));
    }
    const chain = [];
    let walked = '';
    for (const part of path ? path.split('/') : []) {
      walked = walked ? `${walked}/${part}` : part;
      chain.push({ name: part, path: walked });
    }
    return {
      path,
      chain,
      entries: [
        ...[...folders].sort().map((name) => ({
          name,
          path: prefix + name,
          kind: 'folder',
          title: null,
          children: [],
        })),
        ...files.sort((a, b) => a.name.localeCompare(b.name)),
      ],
    };
  }

  /** Run a line the host would have injected, the way the web view runs it. */
  function run(script) {
    if (script) new Function(script)();
  }

  function showFolder(path) {
    run(`window.leafSetLibraryFolder(${JSON.stringify(folderListing(path))});`);
  }

  async function openDocument(path) {
    if (!known.has(path)) return;
    open = path;
    const source = await read(path);
    run(core.documentScript(source, path));
    // The pane follows the document, the way it does in the app.
    showFolder(path.includes('/') ? path.split('/').slice(0, -1).join('/') : '');
    run(`window.leafSetPager && window.leafSetPager(${JSON.stringify({ path, html: pagerHtml(path) })});`);
    if (location.hash.slice(1) !== path) history.replaceState(null, '', `#${path}`);
  }

  // What the page sends the host. A command with no arm here is one this host cannot answer; the desktop's own event loop is where they all live.
  const commands = {
    openRecent: ({ path }) => openDocument(path),
    getFolder: ({ path }) => showFolder(path || ''),
    openLink: ({ href }) => {
      const target = resolveFrom(open || '', href);
      if (target) openDocument(target);
      else console.info('no document at', href);
    },
    openGlossary: ({ href }) => run(core.glossaryScript(href)),
    loadPager: ({ path }) => run(`window.leafSetPager(${JSON.stringify({ path, html: pagerHtml(path) })});`),
  };

  function handle(message) {
    let command;
    try {
      command = JSON.parse(message);
    } catch {
      return;
    }
    const arm = commands[command.command];
    if (arm) Promise.resolve(arm(command)).catch((error) => console.warn(command.command, error));
    else console.info('this host does not answer', command.command);
  }

  window.ipc = { postMessage: handle };
  // Whatever the front end sent while this was still loading.
  for (const message of window.__leafPending || []) handle(message);
  window.__leafPending = [];

  return { core, openDocument, showFolder, resolveFrom, known };
}
