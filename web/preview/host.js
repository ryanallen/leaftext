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

// What this host does about every command the app's page can send.
//
// `IpcCommand` in `src/app/events.rs` is the app's one list of them, and `just check-web-commands` fails on an arm there with no row here, on a row naming no arm, and on a command the front end sends that neither side has. So a command added to the app cannot reach a hand-back until somebody has written what a browser does about it — which is the whole reason this table is here rather than in a document beside it. It is read at runtime too: a page that means to hide the controls this host cannot answer asks `answers()`.
//
// Three answers and no fourth. `ANSWERED` has an arm below. `REFUSED` says why a static site will never have one. `LATER` names the ticket that owns writing it.
export const ANSWERED = 'answered';
export const REFUSED = 'refused';
export const LATER = 'later';

export const COMMANDS = {
  open: [REFUSED, 'a file dialog needs a disk to pick from'],
  openRecent: [ANSWERED],
  newDocument: [REFUSED, 'a new document would have nowhere to be saved'],
  pasteFile: [REFUSED, 'nothing here writes to a disk'],
  revealFile: [REFUSED, 'there is no file manager to show it in'],
  copyFile: [REFUSED, 'nothing here writes to a disk'],
  copyPath: [REFUSED, 'a served document has no path on this machine'],
  toggleFavorite: [LATER, 'web-site-shell'],
  checkFavorites: [LATER, 'web-site-shell'],
  repointFavorite: [REFUSED, 'it reopens the file picker, which a static site has not got'],
  moveFavorite: [LATER, 'web-site-shell'],
  renameFile: [REFUSED, 'nothing here writes to a disk'],
  deleteFile: [REFUSED, 'nothing here writes to a disk'],
  undoDelete: [REFUSED, 'nothing here writes to a disk'],
  showProperties: [REFUSED, 'there is no file on this machine to describe'],
  closeTab: [LATER, 'web-app-commands'],
  switchTab: [LATER, 'web-app-commands'],
  moveTab: [LATER, 'web-app-commands'],
  goHome: [LATER, 'web-site-shell'],
  openLink: [ANSWERED],
  openExternal: [REFUSED, 'the browser follows a link out of the site itself'],
  openGlossary: [ANSWERED],
  revealLink: [REFUSED, 'there is no file manager to show it in'],
  copyLinkPath: [REFUSED, 'a served document has no path on this machine'],
  countLines: [LATER, 'web-app-commands'],
  goBack: [LATER, 'web-polish'],
  goForward: [LATER, 'web-polish'],
  setSpeedReaderEnabled: [LATER, 'web-polish'],
  setCodeIntelEnabled: [LATER, 'web-polish'],
  setReadingUnlocked: [LATER, 'web-polish'],
  setCodeUnlocked: [LATER, 'web-polish'],
  setThemeFamily: [LATER, 'web-polish'],
  setThemeMode: [LATER, 'web-polish'],
  setThemeRandomBag: [LATER, 'web-polish'],
  setHintState: [LATER, 'web-polish'],
  windowDrag: [REFUSED, 'a browser tab has no window frame to drag'],
  windowMinimize: [REFUSED, 'a browser tab has no window to minimize'],
  windowToggleMaximize: [REFUSED, 'a browser tab has no window to maximize'],
  windowClose: [REFUSED, 'a browser tab is closed by the reader, not by the page'],
  windowResizeDrag: [REFUSED, 'a browser tab has no window frame to resize, and a page draws no shadow band to grab'],
  setWindowChrome: [REFUSED, 'there is no native title bar to paint'],
  setLibraryState: [LATER, 'web-polish'],
  setGraphView: [REFUSED, 'it only says whether a change on disk has a map to redraw, and nothing here watches a disk'],
  getVaultGit: [REFUSED, 'a vault is a folder on a disk, and a site is one folder already'],
  getVaultStatus: [REFUSED, 'a vault is a folder on a disk, and a site is one folder already'],
  createVaultRepo: [REFUSED, 'making a repository needs a disk and a process'],
  linkVaultRemote: [REFUSED, 'a vault is a folder on a disk, and a site is one folder already'],
  syncVault: [REFUSED, 'pushing a repository needs a disk and a process'],
  setLibraryLayout: [LATER, 'web-polish'],
  createVault: [REFUSED, 'a vault is a folder picked on a disk'],
  getCloudFolders: [REFUSED, 'nothing here can look for a sync folder on this machine'],
  cloneVault: [REFUSED, 'cloning a repository needs a disk and a process'],
  setActiveVault: [REFUSED, 'a site is one folder, so there is nothing to switch between'],
  renameVault: [REFUSED, 'a site is one folder, so there is no vault row to relabel'],
  changeVaultFolder: [REFUSED, 'it reopens the folder picker, which a static site has not got'],
  removeVault: [REFUSED, 'a site is one folder, so there is no vault row to forget'],
  getFolder: [ANSWERED],
  revealInLibrary: [LATER, 'web-app-commands'],
  getGraph: [LATER, 'web-app-commands'],
  setGraphScope: [LATER, 'web-polish'],
  search: [LATER, 'web-app-commands'],
  loadPager: [ANSWERED],
  enterCodeView: [LATER, 'web-app-commands'],
  exitCodeView: [LATER, 'web-app-commands'],
  spliceSource: [LATER, 'web-app-commands'],
  updateSource: [LATER, 'web-app-commands'],
  saveDocument: [LATER, 'web-app-commands'],
  codeCompleteNotes: [LATER, 'web-app-commands'],
  codeCompleteHeadings: [LATER, 'web-app-commands'],
  codeHoverNote: [LATER, 'web-app-commands'],
  codeLint: [LATER, 'web-app-commands'],
  toggleTask: [LATER, 'web-app-commands'],
  editBlock: [LATER, 'web-app-commands'],
  setField: [LATER, 'web-app-commands'],
  setListField: [LATER, 'web-app-commands'],
  renameField: [LATER, 'web-app-commands'],
  moveBlock: [LATER, 'web-app-commands'],
  pickImage: [REFUSED, 'picking an image is a file dialog over a disk'],
  exportDiagram: [LATER, 'web-export'],
  undoEdit: [LATER, 'web-app-commands'],
  updateChecked: [REFUSED, 'a published site is already the version it serves'],
  updateDownload: [REFUSED, 'a published site is already the version it serves'],
  applyUpdate: [REFUSED, 'there is nothing installed here to replace'],
  logError: [REFUSED, 'the browser console already has it'],
};

/** Whether this host answers a command, for a page that means to hide the controls it does not. */
export function answers(command) {
  return (COMMANDS[command] || [])[0] === ANSWERED;
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

  // Every command this host did not answer, in the order they arrived, so something other than a person watching a console can see one.
  const refused = [];

  function handle(message) {
    let command;
    try {
      command = JSON.parse(message);
    } catch {
      return;
    }
    const arm = commands[command.command];
    if (arm) {
      Promise.resolve(arm(command)).catch((error) => console.warn(command.command, error));
      return;
    }
    const [kind, why] = COMMANDS[command.command] || [];
    // The table says which of the three this is, so the line names the reason or the ticket rather than only the command.
    const reason =
      kind === REFUSED
        ? why
        : kind === LATER
          ? `not yet — ${why}`
          : kind === ANSWERED
            ? 'the table says this host answers it, and there is no arm'
            : 'no line in the command table';
    refused.push({ command: command.command, kind: kind || null, reason });
    console.info('this host does not answer', command.command, '—', reason);
  }

  window.ipc = { postMessage: handle };
  // Whatever the front end sent while this was still loading.
  for (const message of window.__leafPending || []) handle(message);
  window.__leafPending = [];

  return { core, openDocument, showFolder, resolveFrom, known, refused };
}
