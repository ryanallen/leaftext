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
    setImageBase: (base) => {
      const [at, length] = write(base || '');
      api.leaf_set_image_base(at, length);
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
  toggleFavorite: [ANSWERED],
  checkFavorites: [ANSWERED],
  repointFavorite: [REFUSED, 'it reopens the file picker, which a static site has not got'],
  moveFavorite: [ANSWERED],
  renameFile: [REFUSED, 'nothing here writes to a disk'],
  deleteFile: [REFUSED, 'nothing here writes to a disk'],
  undoDelete: [REFUSED, 'nothing here writes to a disk'],
  showProperties: [REFUSED, 'there is no file on this machine to describe'],
  closeTab: [LATER, 'web-app-commands'],
  switchTab: [LATER, 'web-app-commands'],
  moveTab: [LATER, 'web-app-commands'],
  goHome: [ANSWERED],
  openLink: [ANSWERED],
  openExternal: [REFUSED, 'the browser follows a link out of the site itself'],
  openGlossary: [ANSWERED],
  revealLink: [REFUSED, 'there is no file manager to show it in'],
  copyLinkPath: [REFUSED, 'a served document has no path on this machine'],
  countLines: [LATER, 'web-app-commands'],
  previewLink: [LATER, 'web-app-commands'],
  goBack: [REFUSED, 'the browser draws its own Back one row above, so a site draws no pair of its own and never sends this'],
  goForward: [REFUSED, 'the browser draws its own Forward one row above, so a site draws no pair of its own and never sends this'],
  setSpeedReaderEnabled: [ANSWERED],
  setCodeIntelEnabled: [ANSWERED],
  setReadingUnlocked: [ANSWERED],
  setCodeUnlocked: [ANSWERED],
  setThemeFamily: [ANSWERED],
  setThemeMode: [ANSWERED],
  setThemeRandomBag: [ANSWERED],
  setHintState: [REFUSED, 'a first-run bubble is a once-per-install promise, and a reader landing on a page of a site has installed nothing — so a site draws none and nothing counts a launch'],
  windowDrag: [REFUSED, 'a browser tab has no window frame to drag'],
  windowMinimize: [REFUSED, 'a browser tab has no window to minimize'],
  windowToggleMaximize: [REFUSED, 'a browser tab has no window to maximize'],
  windowClose: [REFUSED, 'a browser tab is closed by the reader, not by the page'],
  saveSessionPlace: [REFUSED, 'a browser tab has no saved session to update'],
  windowResizeDrag: [REFUSED, 'a browser tab has no window frame to resize, and a page draws no shadow band to grab, so no phase of the drag is ever sent'],
  setWindowChrome: [REFUSED, 'there is no native title bar to paint'],
  setLibraryState: [ANSWERED],
  setGraphView: [REFUSED, 'it only says whether a change on disk has a map to redraw, and nothing here watches a disk'],
  getVaultGit: [REFUSED, 'a vault is a folder on a disk, and a site is one folder already'],
  getVaultStatus: [REFUSED, 'a vault is a folder on a disk, and a site is one folder already'],
  createVaultRepo: [REFUSED, 'making a repository needs a disk and a process'],
  linkVaultRemote: [REFUSED, 'a vault is a folder on a disk, and a site is one folder already'],
  syncVault: [REFUSED, 'pushing a repository needs a disk and a process'],
  setGitIdentity: [REFUSED, 'it writes who git commits as into the git settings on a machine, and a site is a folder on somebody else’s host with no machine and no git under it'],
  refreshVault: [REFUSED, 'a site is one folder already published, and nothing here can reach the source it came from'],
  signInVault: [REFUSED, 'a site has no window to open a browser sign-in from, no port to be answered on and nowhere to keep a token'],
  signOutVault: [REFUSED, 'there is no signed-in account on a site, so there is nothing to sign out of'],
  setLibraryLayout: [ANSWERED],
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
  setGraphScope: [LATER, 'web-app-commands'],
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
  pickDiagramPath: [LATER, 'web-export'],
  exportDiagram: [LATER, 'web-export'],
  printDiagramPdf: [LATER, 'web-export'],
  exportPdf: [ANSWERED],
  exportPageHtml: [LATER, 'web-export'],
  undoEdit: [LATER, 'web-app-commands'],
  redoEdit: [LATER, 'web-app-commands'],
  updateChecked: [REFUSED, 'a published site is already the version it serves'],
  updateDownload: [REFUSED, 'a published site is already the version it serves'],
  applyUpdate: [REFUSED, 'there is nothing installed here to replace'],
  logError: [REFUSED, 'the browser console already has it'],
};

/** Whether this host answers a command, for a page that means to hide the controls it does not. */
export function answers(command) {
  return (COMMANDS[command] || [])[0] === ANSWERED;
}

/** A site's own front page: the README at the top of the export, else the index there, else whatever the listing serves first.
 *
 * Root-first rather than nearest-folder — a walk up from wherever the first document happens to sit lands a site with several sections silently inside one of them, and no other part of the app performs that walk. It extends the shipped rule that a link to a folder opens that folder's own page, and it makes the export contract one sentence: put a README at the top of the folder you export.
 *
 * The name is matched however it was spelled and whatever it was saved as, and no extension list appears here: the export writes only documents the app reads, so the listing is already the format table's answer.
 */
export function landingPath(documents) {
  const paths = (documents || []).map((entry) => entry && entry.path).filter(Boolean);
  const top = paths.filter((path) => !path.includes('/'));
  return top.find((path) => /^readme\./i.test(path)) || top.find((path) => /^index\./i.test(path)) || paths[0] || '';
}

/** Say that a file the page went looking for never arrived, and name it.
 *
 * A site is a folder of files that fetch each other, so one that does not come back kills the boot where nobody can see it — and the reader is left at the start screen, reading it as a site with nothing in it. The two ways it happens are a folder opened straight off the disk, where a page may fetch none of its neighbors, and a publish that went out short.
 *
 * Drawn with the start screen's own markup rather than markup of its own: the same section the page already styles, so this owes the stylesheet nothing.
 */
export function sayMissing(file, reason) {
  const app = typeof document === 'undefined' ? null : document.getElementById('app');
  if (!app) return;
  const text = (value) =>
    String(value == null ? '' : value).replace(/[&<>]/g, (one) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[one]);
  app.className = 'reader-shell empty';
  app.innerHTML = `
    <section class="empty-state">
      <h1>A file this site needs did not arrive</h1>
      <p class="empty-subtitle">${text(file || 'One of its files')} could not be read${reason ? ` — ${text(reason)}` : ''}.</p>
      <p class="empty-description">The pages here fetch each other, which a browser only allows over a server. Opened straight from a folder on this machine, none of them arrives; published, this one is not in the folder.</p>
    </section>`;
}

export async function startLeaftext({ documents, name = '', read }) {
  const core = await load(MODULE);
  const known = new Set(documents.map((entry) => entry.path));
  let open = null;

  // The marks the reader made, out of the store their theme and their pane width come out of. Held here as well as written, because a toggle and a reorder each read the list before writing it — which is why three commands share one key where every other kept choice owns its own.
  const favorites = Array.isArray((window.__leafSettings || {}).favorites)
    ? window.__leafSettings.favorites.filter((one) => one && one.path).map((one) => ({ vaultId: null, path: String(one.path), kind: one.kind || 'document' }))
    : [];
  function keepFavorites() {
    // Missing on a browser that refuses storage, which leaves the marks holding for this reading and no longer.
    if (typeof window.__leafSaveSettings === 'function') window.__leafSaveSettings({ favorites });
  }

  // The reading order the Previous/Next strip walks: the listing as served, shallowest first.
  const order = documents.map((entry) => entry.path);

  /** Where a link written in one document points, resolved against the folder it sits in — the document, and the heading inside it the link named.
   *
   * The page sends the href as its author wrote it, so a relative one is resolved here — against the document being read, which is the only thing that knows where it sits. One on this site names a document; one anywhere else is the web's, and this host does not follow it.
   */
  function resolveFrom(from, rawHref) {
    // A written href carries a heading and a query where the address's path does not. The cut is at the first `#`, which is the desktop's rule and the opposite of the address's cut at the last one. Above the address branch, because there the heading would go the way of the path.
    const written = String(rawHref);
    const at = written.indexOf('#');
    // Handed on exactly as the link had it: the address is built out of it and compared against the one the page is at as a string, so decoding first would add a second entry the moment a heading had a space in it.
    const anchor = at === -1 ? '' : written.slice(at + 1).split('?')[0];
    const found = (path) => (path ? { path, anchor } : null);
    let href = (at === -1 ? written : written.slice(0, at)).split('?')[0];
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
    } else {
      // The served listing holds names as they are, so a hand-encoded one has to come back to that before it can match.
      href = decodeAddressPart(href);
    }
    const base = from.split('/').slice(0, -1);
    for (const part of href.split('/')) {
      if (part === '.' || part === '') continue;
      if (part === '..') base.pop();
      else base.push(part);
    }
    const path = base.join('/');
    if (known.has(path)) return found(path);
    // A link to a folder means that folder's own page, which is how the app reads one too. With no page of its own it means the first document under it, rather than reporting nothing.
    const asFolder = folderTarget(path);
    if (asFolder) return found(asFolder);
    // The Previous/Next strip writes whole paths rather than relative ones, so an href that is already one is taken as it stands.
    const bare = href.replace(/^\.?\//, '');
    if (known.has(bare)) return found(bare);
    return found(folderTarget(bare));
  }

  /** What a link to a folder opens: its own page, or the first document the served listing has under it — in the order the listing carries, which is the order the Previous/Next strip walks, so the fallback and the strip cannot disagree. */
  function folderTarget(folder) {
    const trimmed = folder.replace(/\/+$/, '');
    if (!trimmed) return null;
    const own = `${trimmed}/README.md`;
    if (known.has(own)) return own;
    const prefix = `${trimmed}/`;
    return order.find((path) => path.startsWith(prefix)) || null;
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
      // What the trail calls the whole root. The desktop sends none and reads the vault it is standing in, or its own word.
      rootName: name,
      // A site serves only documents the app reads, so there is never anything here to skip — sent anyway so both hosts hand the pane one shape.
      skippedFiles: 0,
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

  // ---- the address is the history, because on a site it is the only one -----
  //
  // A static site has to keep its routing in the hash: a pushed path would 404 on a reload, and the result must stay a folder on a plain static host. So `#<path>` is the document and `#<path>#<anchor>` is a heading inside it, cut at the last `#`. Each open adds an entry rather than rewriting the one entry, which is what gives the browser's own Back somewhere to go — and the place the reader is leaving is stamped onto the entry they leave, so Back comes back to the paragraph rather than the top.

  /** The address a document, and a heading inside it, is read at. */
  function addressFor(path, anchor) {
    return `#${path}${anchor ? `#${anchor}` : ''}`;
  }

  function decodeAddressPart(text) {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  }

  /** Back out of one. The last `#` is the cut, so a path carrying one still names its document. */
  function addressParts(hash) {
    const raw = String(hash || '').replace(/^#/, '');
    const cut = raw.lastIndexOf('#');
    if (cut === -1) return { path: decodeAddressPart(raw), anchor: '' };
    return { path: decodeAddressPart(raw.slice(0, cut)), anchor: decodeAddressPart(raw.slice(cut + 1)) };
  }

  // The address this host has already acted on. One Back raises a traverse in some browsers and a hash change in others, and both are watched — this is what keeps the work to once.
  let atAddress = '';
  // Whether the address has been written yet. The document the reader arrived on replaces the entry they arrived on — it is not a step they took — and every open after it is added.
  let landed = false;

  function writeAddress(path, anchor) {
    const url = addressFor(path, anchor);
    const entry = { path, anchor: anchor || '', place: null };
    atAddress = url;
    // The same address twice is an entry the browser's own Back looks dead on.
    if (!landed || location.hash === url) {
      landed = true;
      history.replaceState(entry, '', url);
      return;
    }
    history.pushState(entry, '', url);
  }

  /** Where the reader is, stamped onto the entry they are leaving. A link click sends the page's own anchor; a row in the pane sends none, and the page answers for both. */
  function stampPlace(command) {
    if (!open) return;
    const sent = command && command.scroll_anchor;
    const state = !sent && typeof window.leafReaderState === 'function' ? window.leafReaderState() : null;
    const place = sent || (state && state.anchor);
    if (!place) return;
    const entry = history.state && typeof history.state === 'object' ? history.state : {};
    history.replaceState(Object.assign({}, entry, { place }), '', location.href);
  }

  /** Put the reader back where an entry says they were: the place they left it if it has one, else the heading it was opened at. */
  function restorePlace(anchor, place) {
    if (place && typeof window.leafRestoreScrollAnchor === 'function') {
      window.leafRestoreScrollAnchor(place);
      return;
    }
    if (anchor && typeof window.leafScrollToFragment === 'function') window.leafScrollToFragment(anchor);
  }

  /** A link to a heading in the document already open: the page scrolls to it, and the jump is a step the browser can walk back out of. */
  function jumpToHeading(anchor, command) {
    if (!open || !anchor) return;
    stampPlace(command);
    writeAddress(open, anchor);
    if (typeof window.leafScrollToFragment === 'function') window.leafScrollToFragment(anchor);
  }

  async function openDocument(path, { anchor = '', place = null, address = true } = {}) {
    if (!known.has(path)) return;
    open = path;
    const source = await read(path);
    run(core.documentScript(source, path));
    // The pane follows the document, the way it does in the app.
    showFolder(path.includes('/') ? path.split('/').slice(0, -1).join('/') : '');
    run(`window.leafSetPager && window.leafSetPager(${JSON.stringify({ path, html: pagerHtml(path) })});`);
    if (address) writeAddress(path, anchor);
    restorePlace(anchor, place);
  }

  /** The document the reader arrived on: whatever the address names, or the fallback. Its entry is replaced rather than added to. */
  async function openAddress(fallback) {
    const asked = addressParts(location.hash);
    const wanted = known.has(asked.path) ? asked : { path: fallback, anchor: '' };
    if (wanted.path) await openDocument(wanted.path, { anchor: wanted.anchor });
  }

  /** The address changed under the page — the browser's own Back or Forward, or one typed into the bar. The entry says which document, where in it, and where the reader was when they left it. */
  async function goToAddress() {
    if (location.hash === atAddress) return;
    atAddress = location.hash;
    const entry = history.state && typeof history.state === 'object' ? history.state : null;
    const asked = addressParts(location.hash);
    const path = (entry && entry.path) || asked.path;
    const anchor = (entry && entry.anchor) || asked.anchor;
    const place = entry && entry.place;
    if (!known.has(path)) return;
    if (path !== open) {
      await openDocument(path, { anchor, place, address: false });
      return;
    }
    restorePlace(anchor, place);
  }

  // Both, because one gesture raises different ones in different browsers: a traverse raises the first, a hash typed into the bar the second. Watched here rather than in the loader beside it — whatever writes the address reads it back.
  const walked = () => {
    goToAddress().catch((error) => console.warn('the address went nowhere', error));
  };
  addEventListener('popstate', walked);
  addEventListener('hashchange', walked);

  // What the page sends the host. A command with no arm here is one this host cannot answer; the desktop's own event loop is where they all live.
  const commands = {
    openRecent: (command) => {
      stampPlace(command);
      return openDocument(command.path);
    },
    getFolder: ({ path }) => showFolder(path || ''),
    openLink: (command) => {
      const href = String(command.href || '');
      // A heading inside the document already open is the page's own scroll, not a document to resolve. Put through the resolver it matched nothing and became a console line.
      if (href.startsWith('#')) {
        jumpToHeading(href.slice(1), command);
        return undefined;
      }
      const target = resolveFrom(open || '', href);
      if (!target) {
        console.info('no document at', href);
        return undefined;
      }
      stampPlace(command);
      // The heading rides the open that already takes one, so the address becomes `#<path>#<anchor>` and the browser's own Back walks out of it the way it walks out of a jump inside one document.
      return openDocument(target.path, { anchor: target.anchor });
    },
    // The leaf at the bar's left. On the desktop it goes to the start screen — a screen of recents and favorites a site has neither of — so here it goes to the site's own front page, out of the same function the first paint opened, which is why the two can never disagree.
    goHome: (command) => {
      stampPlace(command);
      return openDocument(landingPath(documents));
    },
    // The heart. The page has already flipped its own copy and is telling the host to remember it, so this is the remembering.
    toggleFavorite: (command) => {
      const path = String(command.path || '');
      if (!path) return;
      const at = favorites.findIndex((one) => one.path === path);
      if (at === -1) favorites.push({ vaultId: null, path, kind: command.kind || 'document' });
      else favorites.splice(at, 1);
      keepFavorites();
    },
    // Paths rather than places, because the list the reader dragged is grouped by vault and can still be drawing a row that has left the store. No `before` means last.
    moveFavorite: (command) => {
      const path = String(command.path || '');
      const at = favorites.findIndex((one) => one.path === path);
      if (at === -1) return;
      const [moved] = favorites.splice(at, 1);
      const before = command.before == null ? null : String(command.before);
      const to = before === null ? -1 : favorites.findIndex((one) => one.path === before);
      favorites.splice(to === -1 ? favorites.length : to, 0, moved);
      keepFavorites();
    },
    // Which marks have nothing behind them. The desktop asks the disk; a site asks the listing it was published with, so a mark whose document left the export is reported the way a moved file is.
    checkFavorites: () => {
      const paths = favorites.map((one) => one.path).filter((path) => !known.has(path));
      run(`window.leafSetFavoritesMissing && window.leafSetFavoritesMissing(${JSON.stringify({ paths, vaults: [] })});`);
    },
    openGlossary: ({ href }) => run(core.glossaryScript(href)),
    // The browser's own print, which is the only route a page has: a site cannot open a save dialog or write a file, so the panel is what asks where the PDF goes here. The desktop writes the file itself and shows no panel at all. The page a browser prints is prepared by the same `@media print` block, which keys on the classes a site draws its documents through, so the sheets carry the whole document in its theme either way.
    exportPdf: () => window.print(),
    loadPager: ({ path }) => run(`window.leafSetPager(${JSON.stringify({ path, html: pagerHtml(path) })});`),
  };

  // Every choice a site can keep, and the key each command owns. The desktop writes these into a file its host owns; a browser keeps its own store, and `assets/settings.js` is what reads it back over the defaults before the first paint. Written out one command at a time so a key belongs to exactly one of them and nothing writes a neighbor.
  const KEPT = {
    setSpeedReaderEnabled: (command) => ({ speedReaderEnabled: !!command.enabled }),
    setCodeIntelEnabled: (command) => ({ codeIntelEnabled: !!command.enabled }),
    setReadingUnlocked: (command) => ({ readingUnlocked: !!command.enabled }),
    setCodeUnlocked: (command) => ({ codeUnlocked: !!command.enabled }),
    setThemeFamily: (command) => ({ themeFamily: String(command.family || '') }),
    setThemeMode: (command) => ({ themeMode: String(command.mode || '') }),
    setThemeRandomBag: (command) => ({ themeRandomUsed: Array.isArray(command.used) ? command.used : [] }),
    setLibraryState: (command) => ({ libraryProjectPath: String(command.projectPath || '') }),
    // The pane's two travel together: which state it was left in, and how wide it was left.
    setLibraryLayout: (command) => ({ libraryClosed: !!command.closed, libraryWidth: Number(command.width) || 0 }),
  };
  for (const [name, keys] of Object.entries(KEPT)) {
    commands[name] = (command) => {
      // Missing on a browser that refuses storage, which leaves the choice holding for this reading and no longer.
      if (typeof window.__leafSaveSettings === 'function') window.__leafSaveSettings(keys(command));
    };
  }

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

  return { core, openDocument, openAddress, showFolder, resolveFrom, known, refused };
}
