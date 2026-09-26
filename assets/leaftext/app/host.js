// A host for the app's own front end, in a browser.
//
// The page is the desktop's page and the script is the desktop's script, unchanged. What differs is who answers them: the desktop has a window, a disk and an event loop behind `window.ipc`; here there is a module, files beside the page, and this.
//
// So this is the browser's half of the same bargain the renderer already makes: it answers what a static site can answer — open a document, follow a link, walk Previous/Next, raise the glossary — and refuses out loud the rest, which is how a control that does nothing is found rather than shipped quietly.

// Beside the rest of the front end, which is beside the page for a folder export and another site's address for a site that carries none of its own. Read off the page rather than off this file's own address, because the check boots this file as a plain script, where a module's address has no spelling.
const MODULE = 'leaftext.wasm';

/** Where the front end is served from, as the page was written to say. */
export function assetBase() {
  const base = typeof window === 'undefined' ? '' : window.__leafAssetBase;
  return typeof base === 'string' && base ? base : 'assets/';
}

async function load(url, fetchWith = fetch) {
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

  return {
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
    graph: (documents, seed, scope) => JSON.parse(withStrings(api.leaf_graph, JSON.stringify(documents), seed, scope) || 'null'),
    // Whether this page mints a book's pictures itself. A module older than the page has no such export, and its books keep their data addresses.
    setMintsPictures: (mints) => {
      if (typeof api.leaf_set_mints_pictures === 'function') api.leaf_set_mints_pictures(mints ? 1 : 0);
    },
    // One picture out of the kept book, as its media type and bytes, or nothing where the module refused it.
    bookPicture: (member) => {
      if (typeof api.leaf_book_picture !== 'function') return null;
      const [at, length] = write(member);
      const answer = api.leaf_book_picture(at, length);
      api.leaf_free(at, length);
      if (!answer) return null;
      const size = new DataView(api.memory.buffer).getUint32(answer, true);
      const whole = new Uint8Array(api.memory.buffer, answer + 4, size);
      const split = whole.indexOf(0);
      const picture = split < 0 ? null : { type: decoder.decode(whole.subarray(0, split)), bytes: whole.slice(split + 1) };
      api.leaf_free(answer, 4 + size);
      return picture;
    },
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
    setImageSizes: (sizes) => {
      if (typeof api.leaf_set_image_sizes !== 'function') return;
      const [at, length] = write(JSON.stringify(sizes || {}));
      api.leaf_set_image_sizes(at, length);
      api.leaf_free(at, length);
    },
    render: (source, path) => JSON.parse(withStrings(api.leaf_render, source, path) || 'null'),
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
    // The note a `[[wiki]]` link names and its heading's anchor, read by the renderer's own grammar. A module older than the page has none, and the link then names nothing.
    wikiLink: (inner) => (typeof api.leaf_wiki_link === 'function' ? JSON.parse(withStrings(api.leaf_wiki_link, inner) || 'null') : null),
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
  newFile: [REFUSED, 'nothing here writes to a disk'],
  newFolder: [REFUSED, 'nothing here writes to a disk'],
  renameFile: [REFUSED, 'nothing here writes to a disk'],
  deleteFile: [REFUSED, 'nothing here writes to a disk'],
  undoDelete: [REFUSED, 'nothing here writes to a disk'],
  showProperties: [REFUSED, 'there is no file on this machine to describe'],
  revealImage: [REFUSED, 'there is no file manager to show it in'],
  copyImagePath: [REFUSED, 'a picture on a served page has no path on this machine'],
  showImageProperties: [REFUSED, 'there is no file on this machine to describe'],
  copyImage: [REFUSED, 'nothing here reaches a clipboard, and a browser page that could would need a gesture the app never sends one through'],
  closeTab: [LATER, 'web-app-commands'],
  switchTab: [LATER, 'web-app-commands'],
  moveTab: [LATER, 'web-app-commands'],
  openBeside: [LATER, 'web-app-commands'],
  openBesidePath: [LATER, 'web-app-commands'],
  closeBeside: [LATER, 'web-app-commands'],
  openSourceBeside: [LATER, 'web-app-commands'],
  setSplitLayout: [LATER, 'web-app-commands'],
  goHome: [ANSWERED],
  openLink: [ANSWERED],
  openExternal: [REFUSED, 'the browser follows a link out of the site itself'],
  openGlossary: [ANSWERED],
  openNotices: [REFUSED, 'the link that sends it sits on the start screen, which a site never draws — the leaf goes to the front page of the site instead — and no module a site or an export is served carries the licenses document: the notices ride beside it as licenses.md'],
  revealLink: [REFUSED, 'there is no file manager to show it in'],
  copyLinkPath: [REFUSED, 'a served document has no path on this machine'],
  documentLength: [ANSWERED],
  previewLink: [ANSWERED],
  goBack: [REFUSED, 'the browser draws its own Back one row above, so a site draws no pair of its own and never sends this'],
  goForward: [REFUSED, 'the browser draws its own Forward one row above, so a site draws no pair of its own and never sends this'],
  refreshDocument: [ANSWERED],
  setSpeedReaderEnabled: [ANSWERED],
  setCodeIntelEnabled: [ANSWERED],
  reportReading: [REFUSED, 'the reading record is a file on the reader’s own disk, and a site keeps no record — the page reports reading reached only where the host handed it one, so nothing sends this'],
  groveAdmin: [REFUSED, 'a site keeps no reading record, so there is nothing for admin mode to reset or unlock — the Grove never stands and nothing sends this'],
  claimGroveLevel: [REFUSED, 'a site keeps no reading record, so the Grove pool never fills and its bar never becomes the hold — the Grove never stands and nothing sends this'],
  searchLanded: [REFUSED, 'a site keeps no reading record, so a search that found something has nothing to grow — the find bar still says it, the way the page says every word whatever is under it'],
  readGrowthLog: [REFUSED, 'a site keeps no reading record, so no gain was ever kept with its time and the list would be empty forever — the Grove never stands and nothing sends this'],
  resolveProgressDay: [REFUSED, 'a site keeps no reading record, so it has no recorded day to settle — the Grove never stands and nothing sends this'],
  buyUnlock: [REFUSED, 'a site keeps no reading record, so there are no seeds to spend and nowhere a purchase could live — the Grove never stands and nothing sends this'],
  setUnlock: [REFUSED, 'a site keeps no reading record, so nothing is owned to switch — the Grove never stands and nothing sends this'],
  setProgressEnabled: [REFUSED, 'the reading record is a file on the reader’s own disk, and a site serves documents to strangers with no account — a per-browser record would be a different feature, so the Grove pill never stands and nothing sends this'],
  setReadingUnlocked: [ANSWERED],
  setCodeUnlocked: [REFUSED, 'nothing a reader types into the source reaches anywhere on a site, so its padlock is not drawn and nothing sends this'],
  setThemeFamily: [ANSWERED],
  setThemeMode: [ANSWERED],
  setThemeRandomBag: [ANSWERED],
  setHintState: [REFUSED, 'a first-run bubble is a once-per-install promise, and a reader landing on a page of a site has installed nothing — so a site draws none and nothing counts a launch'],
  frontEndReady: [REFUSED, 'it releases the files a native launch was asked for, and a browser tab is opened at an address rather than launched with a file list. The local day it carries seeds the growth that launch counts, and a browser tab counts none. The word is still sent, because the page says it once whatever is under it and never waits for the answer'],
  startupReady: [REFUSED, 'a browser tab has no native Leaftext window to grow out of the small one a launch puts up, and no startup card in the page to take off. The word is still sent, because the page says it once whatever is under it and never waits for the answer'],
  windowDrag: [REFUSED, 'a browser tab has no window frame to drag'],
  windowMinimize: [REFUSED, 'a browser tab has no window to minimize'],
  windowActive: [REFUSED, 'a browser has no native window'],
  windowToggleMaximize: [REFUSED, 'a browser tab has no window to maximize'],
  windowToggleFullscreen: [REFUSED, 'a browser tab has no window to fill, and the reader puts their own browser into full screen'],
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
  setVaultGitAutoSync: [REFUSED, 'a site has no vault registry'],
  ignoreVaultRepos: [REFUSED, 'a site is a folder on somebody else’s host with no disk under it and no git to ignore anything'],
  setGitIdentity: [REFUSED, 'it writes who git commits as into the git settings on a machine, and a site is a folder on somebody else’s host with no machine and no git under it'],
  refreshVault: [REFUSED, 'a site is one folder already published, and nothing here can reach the source it came from'],
  signInVault: [REFUSED, 'a site has no window to open a browser sign-in from, no port to be answered on and nowhere to keep a token'],
  signOutVault: [REFUSED, 'there is no signed-in account on a site, so there is nothing to sign out of'],
  setLibraryLayout: [ANSWERED],
  createVault: [REFUSED, 'a vault is a folder picked on a disk'],
  createDropboxVault: [REFUSED, 'a published site has no credential store or callback listener for Dropbox'],
  createGoogleDriveVault: [REFUSED, 'a published site has no credential store or callback listener for Google Drive'],
  createMicrosoftVault: [REFUSED, 'a published site has no credential store or callback listener for Microsoft Graph'],
  createBoxVault: [REFUSED, 'a published site has no credential store or callback listener for Box'],
  createWebDavVault: [REFUSED, 'a published site has no credential store to keep a WebDAV password in'],
  createS3Vault: [REFUSED, 'a published site has no credential store to keep an S3 secret key in'],
  getCloudFolders: [REFUSED, 'nothing here can look for a sync folder on this machine'],
  cloneVault: [REFUSED, 'cloning a repository needs a disk and a process'],
  setActiveVault: [REFUSED, 'a site is one folder, so there is nothing to switch between'],
  renameVault: [REFUSED, 'a site is one folder, so there is no vault row to relabel'],
  changeVaultFolder: [REFUSED, 'it reopens the folder picker, which a static site has not got'],
  removeVault: [REFUSED, 'a site is one folder, so there is no vault row to forget'],
  getFolder: [ANSWERED],
  revealInLibrary: [LATER, 'web-app-commands'],
  getGraph: [ANSWERED],
  setGraphScope: [ANSWERED],
  setCalendarField: [REFUSED, 'a site draws no calendar square'],
  search: [LATER, 'web-app-commands'],
  calendarRange: [REFUSED, 'it counts a vault’s documents by the dates their files were written, and a site is published pages with no vault and no file dates behind them — so the calendar square never stands and nothing sends this'],
  loadPager: [ANSWERED],
  packagedPicture: [ANSWERED],
  enterCodeView: [ANSWERED],
  exitCodeView: [ANSWERED],
  spliceSource: [LATER, 'web-app-commands'],
  updateSource: [LATER, 'web-app-commands'],
  saveDocument: [ANSWERED],
  codeCompleteNotes: [LATER, 'web-app-commands'],
  codeCompleteHeadings: [LATER, 'web-app-commands'],
  codeHoverNote: [LATER, 'web-app-commands'],
  codeLint: [LATER, 'web-app-commands'],
  tableModel: [LATER, 'rdb-web'],
  toggleTask: [ANSWERED],
  editBlock: [ANSWERED],
  resendDocumentSource: [REFUSED, 'This host always sends the whole document source.'],
  editBlocks: [ANSWERED],
  setField: [ANSWERED],
  setListField: [ANSWERED],
  renameField: [ANSWERED],
  prepareTagRename: [REFUSED, 'a published site cannot rewrite files in a vault'],
  renameTag: [REFUSED, 'a published site cannot rewrite files in a vault'],
  moveBlock: [ANSWERED],
  pickImage: [REFUSED, 'picking an image is a file dialog over a disk'],
  pickDiagramPath: [LATER, 'web-export'],
  exportDiagram: [LATER, 'web-export'],
  printDiagramPdf: [LATER, 'web-export'],
  pickPicturePath: [LATER, 'web-export'],
  exportPicture: [LATER, 'web-export'],
  printPicturePdf: [LATER, 'web-export'],
  exportPdf: [ANSWERED], // Optional slide page height is applied by the shared paper hold.
  exportPageHtml: [LATER, 'web-export'],
  undoEdit: [ANSWERED],
  redoEdit: [ANSWERED],
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
  // Words the publish drew into the page stay: the reader can still read them, so the failure is said under them rather than over them.
  const baked = app.querySelector('.baked-page');
  if (baked) {
    const said = document.createElement('p');
    said.className = 'empty-subtitle';
    said.setAttribute('role', 'status');
    said.textContent = `${file || 'One of its files'} could not be read${reason ? ` — ${reason}` : ''}, so the page above is as it was published and nothing on it answers.`;
    app.appendChild(said);
    return;
  }
  app.className = 'reader-shell empty';
  app.innerHTML = `
    <section class="empty-state">
      <h1>A file this site needs did not arrive</h1>
      <p class="empty-subtitle">${text(file || 'One of its files')} could not be read${reason ? ` — ${text(reason)}` : ''}.</p>
      <p class="empty-description">The pages here fetch each other, which a browser only allows over a server. Opened straight from a folder on this machine, none of them arrives; published, this one is not in the folder.</p>
    </section>`;
}

/** Point the page's canonical address and its Markdown alternate at the document on screen, so a crawler or a reader copying the address from the head is handed the page they are on rather than the one they arrived at. Only the two lines a page already carries are moved; a page without them gains none. */
export function repointHead(path, anchor = '') {
  if (typeof document === 'undefined' || !path) return;
  const head = document.head;
  if (!head) return;
  const canonical = head.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute('href', new URL(`#${path}${anchor ? `#${anchor}` : ''}`, location.href).href);
  const markdown = head.querySelector('link[rel="alternate"][type="text/markdown"]');
  if (markdown) markdown.setAttribute('href', path);
}

export async function startLeaftext({ documents, name = '', read, imageSizes = {}, frontPage = null, fetch: fetchWith = fetch }) {
  // Before the module loads, because the front end asks this as it draws and a control it asked about too early is one drawn on a guess.
  window.__leafHostAnswers = answers;
  // The one document a site lays out as its front page, which the page asks about as it draws, locked or unlocked. Every other path is drawn as the app draws it. A layout that throws keeps the last page it drew with nothing on it to type on, so a visitor mid-edit in the source view is not thrown onto the plain README; one that has never drawn is drawn plain.
  if (frontPage && frontPage.path && typeof frontPage.layout === 'function') {
    let moving = null;
    let lastLaid = null;
    let failing = false;
    window.leafSiteLayout = (path, html) => {
      if (path !== frontPage.path) return null;
      let laid;
      try {
        laid = frontPage.layout(html);
        failing = false;
      } catch (error) {
        const why = (error && error.message) || String(error);
        if (lastLaid === null) {
          console.warn(`${path} is drawn plain: ${why}`);
          return null;
        }
        // Said once per run of failures rather than at every redraw while the source is being mended.
        if (!failing && typeof window.leafShowError === 'function') window.leafShowError(`The front page could not be laid out: ${why}`);
        failing = true;
        // The marks name blocks of a source that has moved on, so none may stay to type on.
        laid = lastLaid.replace(/\sdata-leaf-proof="[^"]*"/g, '');
      }
      if (!failing) lastLaid = laid;
      // Once the page has drawn what this answers, which it does before it hands control back: every redraw puts a fresh page in, so the cards rise and the clips play on whichever page is standing. The reading column's alone — the rail's copy keeps the posters. What the standing page's motion reached is read before that page is written over, and only while it is still the page on screen, so a visitor who went elsewhere and came back sees the rise again.
      if (typeof frontPage.motion === 'function') {
        const held = moving && moving.root && moving.root.isConnected && typeof moving.hold === 'function' ? moving.hold() : null;
        queueMicrotask(() => {
          const laidOut = document.querySelector('.document-body.front-layout:not(.document-minimap-preview)');
          if (!laidOut) return;
          if (moving) moving.stop();
          moving = frontPage.motion(laidOut, held);
        });
      }
      return laid;
    };
    // Asked before the page proves which of the document's blocks the layout may keep for typing, so every other document is drawn without that walk.
    window.leafSiteLayout.laysOut = (path) => path === frontPage.path;
    // Asked when a paragraph on the landing is drawn again alone: the layout class it keeps, or null where its new words would be laid out somewhere else and the whole page is drawn again.
    window.leafSiteLayout.paragraphPlace = (path, classes, html) => (path === frontPage.path && typeof frontPage.paragraphPlace === 'function' ? frontPage.paragraphPlace(classes, html) : null);
  }
  const core = await load(assetBase() + MODULE, fetchWith);
  core.setImageSizes(imageSizes);
  core.setMintsPictures(true);
  // Every picture address this page made out of the open book, let go together when another document opens: revoking one as it scrolls away would leave nothing to decode it from when the reader scrolls back.
  const minted = [];
  const known = new Set(documents.map((entry) => entry.path));
  let open = null;
  // Keep the drawn bytes for the source view and return without another fetch.
  let held = null;
  let buffer = 0;
  let cardPath = '';
  let cardAnswer = null;

  // Match the desktop's folder walk over the site's listing.
  const glossaryIn = new Map();
  let firstGlossary = '';
  for (const entry of documents) {
    if (!/(^|\/)glossary\.md$/i.test(entry.path)) continue;
    const folder = folderOf(entry.path);
    if (!glossaryIn.has(folder)) glossaryIn.set(folder, entry.path);
    if (!firstGlossary) firstGlossary = entry.path;
  }
  // Reopening a project's glossary needs no second fetch.
  const glossaryWords = new Map();
  // A failed read stays retryable on the next open.
  let glossary = '';

  function folderOf(path) {
    return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  }

  /** Use the nearest glossary, or the first listed for pages above every glossary. */
  function glossaryFor(path) {
    for (let folder = folderOf(path); ; folder = folderOf(folder)) {
      const found = glossaryIn.get(folder);
      if (found) return found;
      if (!folder) return firstGlossary;
    }
  }

  function glossaryText(path) {
    if (!path) return Promise.resolve('');
    if (!glossaryWords.has(path)) {
      glossaryWords.set(path, read(path).then((bytes) => new TextDecoder().decode(bytes)).catch((error) => {
        glossaryWords.delete(path);
        console.warn('the glossary could not be read', path, error);
        return null;
      }));
    }
    return glossaryWords.get(path);
  }

  function cardTarget(href) {
    if (/^glossary:/i.test(String(href || ''))) return glossary && known.has(glossary) ? glossary : '';
    return resolveFrom(open || '', href)?.path || '';
  }

  function cardFor(path) {
    if (!path) return Promise.resolve(null);
    if (path !== cardPath || !cardAnswer) {
      cardPath = path;
      cardAnswer = read(path).then((bytes) => core.linkPreview(bytes, path)).catch((error) => {
        console.warn('the card could not read', path, error);
        return null;
      });
    }
    return cardAnswer;
  }

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

  /** The document a `[[wiki]]` link names: a file name before any alias, in the listing's order, matched trimmed and case-folded the way the desktop matches one. */
  function wikiNote(name) {
    const key = String(name || '').trim().toLowerCase();
    const label = (path) => path.split('/').pop().replace(/\.[^.]*$/, '').trim().toLowerCase();
    const named = documents.find((entry) => label(entry.path) === key);
    if (named) return named.path;
    const aliased = documents.find((entry) => Array.isArray(entry.aliases) && entry.aliases.some((alias) => String(alias).trim().toLowerCase() === key));
    return aliased ? aliased.path : '';
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

  /** Draw a document out of its bytes: the page, the marks and the Previous/Next strip. Opening one and leaving its source both come through here; neither the address nor the pane is touched. */
  function drawDocument(path, bytes, { keepPlace = false } = {}) {
    for (const address of minted.splice(0)) URL.revokeObjectURL(address);
    run('window.leafForgetMintedPictures && window.leafForgetMintedPictures();');
    const script = buffer && held?.path === path ? core.bufferDocumentScript(buffer) : core.documentScript(bytes, path);
    // An edit's redraw goes through the page's reload, as the desktop's does, so the reader stays where they were rather than landing at the top.
    run(keepPlace && script ? script.replace(/^window\.leafSetState\(/,'window.leafReloadDocument(') : script);
    run(`window.leafSetFavorites(${JSON.stringify(favorites)});`);
    run(`window.leafSetPager && window.leafSetPager(${JSON.stringify({ path, html: pagerHtml(path) })});`);
  }

  function closeBuffer() {
    if (buffer) core.bufferClose(buffer);
    buffer = 0;
  }

  function openBuffer() {
    if (!buffer && held?.path === open) buffer = core.bufferOpen(held.bytes, held.path);
    return buffer;
  }

  function redrawBuffer() {
    if (buffer && held?.path === open) drawDocument(open, held.bytes, { keepPlace: true });
  }

  function applyEdit(edit) {
    if (!openBuffer()) return null;
    const state = core.bufferEdit(buffer, edit);
    if (state?.changed) {
      // A paragraph drawn alone leaves the rest of the page standing, so a press already landing on the next paragraph still finds it there.
      if (state.swap) run(state.swap);
      else if (state.resync) run(state.resync);
      else redrawBuffer();
    }
    return state;
  }

  function answerEdit(token, took) {
    if (typeof token === 'number') run(`window.leafEditAnswered(${token}, ${!!took}, null);`);
  }

  async function openDocument(path, { anchor = '', place = null, address = true } = {}) {
    if (!known.has(path)) return;
    open = path;
    closeBuffer();
    const chosen = glossaryFor(path);
    const [source, words] = await Promise.all([read(path), glossaryText(chosen)]);
    held = { path, bytes: source };
    // Set the glossary beside the render so the last page drawn holds its own terms.
    if (chosen !== glossary) {
      core.setGlossary(words || '');
      glossary = words == null ? null : chosen;
    }
    drawDocument(path, source);
    // The pane follows the document, the way it does in the app.
    showFolder(path.includes('/') ? path.split('/').slice(0, -1).join('/') : '');
    if (address) writeAddress(path, anchor);
    repointHead(path, anchor);
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
    // Answered and kept for this visit alone: the padlock is the page's own, and the next visit starts locked.
    setReadingUnlocked: () => {},
    // The page asks for this where a paragraph drawn alone could not be placed; the document it holds is drawn again where the reader is.
    refreshDocument: () => { if (held?.path === open) drawDocument(open, held.bytes, { keepPlace: true }); },
    editBlock: (command) => {
      const edit = { edit: 'block', start: command.start, end: command.end, text: command.text, undo: !command.autosave && !command.continuing, cell: command.cell, paragraph: !!command.paragraph, held: !!command.held };
      if (command.live) {
        if (openBuffer()) {
          const state = core.bufferEdit(buffer, edit);
          if (state) run(`window.leafBlocksResynced(${JSON.stringify(state)});`);
        }
      } else {
        const state = applyEdit(edit);
        // Typing pauses already put the words in, so the commit that ends a run usually changes nothing and only owes the page its styled paragraph back.
        if (state && !state.changed) { if (state.swap) run(state.swap); else redrawBuffer(); }
      }
      answerEdit(command.token, !!buffer);
    },
    editBlocks: (command) => applyEdit({ edit: 'blocks', blocks: command.blocks, continuing: !!command.continuing }),
    toggleTask: (command) => answerEdit(command.token, !!applyEdit({ edit: 'task', index: command.index })?.changed),
    setField: (command) => applyEdit(command.value == null ? { edit: 'field', key: command.key, remove: true } : { edit: 'field', key: command.key, set: command.value }),
    setListField: (command) => applyEdit({ edit: 'field', key: command.key, items: command.items || [] }),
    renameField: (command) => applyEdit({ edit: 'field', key: command.key, rename: command.to }),
    moveBlock: (command) => applyEdit({ edit: 'move', ranges: command.ranges || [], from: command.from, to: command.to }),
    undoEdit: () => applyEdit({ edit: 'undo' }),
    redoEdit: () => applyEdit({ edit: 'redo' }),
    getGraph: ({ scope }) => {
      let answer;
      try {
        if (documents.some((entry) => !entry.links || typeof entry.links !== 'object')) {
          throw new Error('The map needs this site published again.');
        }
        answer = core.graph(documents, open || '', String(scope || 'small'));
        if (!answer || !Array.isArray(answer.nodes) || !Array.isArray(answer.edges)) {
          throw new Error('The map could not be read.');
        }
      } catch (error) {
        answer = { error: { message: (error && error.message) || 'The map could not be read.' } };
      }
      run(`window.leafSetGraph(${JSON.stringify(answer)});`);
    },
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
      // A `[[wiki]]` link names a note rather than an address, so it is found in the listing — and one naming nothing is said, never handed to the browser as an address.
      if (/^leaf-wiki:/i.test(href)) {
        let inner = '';
        try {
          inner = decodeURIComponent(href.slice('leaf-wiki:'.length));
        } catch {
          inner = '';
        }
        const wiki = inner ? core.wikiLink(inner) : null;
        const path = wiki ? wikiNote(wiki.name) : '';
        if (!path) {
          if (typeof window.leafShowError === 'function') window.leafShowError(`there is no note called ${wiki ? wiki.name : inner}`);
          return undefined;
        }
        stampPlace(command);
        return openDocument(path, { anchor: wiki.anchor || '' });
      }
      const target = resolveFrom(open || '', href);
      if (!target) {
        // The site has no document there, and this page is already a browser — so the browser follows it, resolved against the open document the way the desktop resolves one against the note's folder. Resolved with the browser's own reader rather than by re-walking the join above, because an address off this origin is dropped before that join ever builds a path.
        let away = '';
        try {
          away = new URL(href, new URL(open || '', location.href)).href;
        } catch {
          away = '';
        }
        if (away) window.open(away, '_blank', 'noopener');
        else console.info('no document at', href);
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
    previewLink: async ({ href, token }) => {
      const answer = await cardFor(cardTarget(href));
      run(`window.leafLinkPreview(${JSON.stringify(token)}, ${JSON.stringify(answer?.html || '')});`);
    },
    documentLength: async ({ href, token }) => {
      const answer = await cardFor(cardTarget(href));
      run(`window.leafDocumentLength(${JSON.stringify(token)}, ${JSON.stringify(answer?.count ?? -1)}, ${JSON.stringify(answer?.unit || 'line')});`);
    },
    // The buffer supplies the source or the refusal for a book with no single source.
    enterCodeView: () => {
      if (!held || held.path !== open) return;
      openBuffer();
      const state = buffer ? core.bufferCodeView(buffer) : null;
      if (state && state.refusedScript) run(state.refusedScript);
      else if (state) run(`window.leafShowCodeView(${JSON.stringify(state)});`);
      else {
        // Return to the page when the buffer cannot open.
        console.warn('the module could not open', held.path, 'as a source');
        drawDocument(held.path, held.bytes);
      }
    },
    // The source is read-only, so the page still standing beneath it can return.
    exitCodeView: ({ renderKey }) => {
      if (!held || held.path !== open) return;
      const script = typeof renderKey === 'string' ? core.codeReturnScript(held.path, renderKey, buffer) : null;
      if (script) {
        run(script);
        run(`window.leafSetFavorites(${JSON.stringify(favorites)});`);
      } else drawDocument(held.path, held.bytes);
    },
    // The browser's own print, which is the only route a page has: a site cannot open a save dialog or write a file, so the panel is what asks where the PDF goes here. The desktop writes the file itself and shows no panel at all. The page a browser prints is prepared by the same `@media print` block, which keys on the classes a site draws its documents through, so the sheets carry the whole document in its theme either way.
    exportPdf: () => window.print(),
    // A site has no disk to write to, so Save hands the edited file to the reader as a download under its own name.
    saveDocument: () => {
      if (!open || !openBuffer()) return;
      let address = null;
      let failed = null;
      try {
        const bytes = core.bufferEncoded(buffer);
        if (!bytes) throw new Error('the edited document could not be encoded');
        address = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
        const link = document.createElement('a');
        link.href = address;
        link.download = open.split('/').pop();
        document.body.appendChild(link);
        try { link.click(); } finally { link.remove(); }
      } catch (error) {
        failed = String((error && error.message) || error || 'the download failed');
      } finally {
        if (address) setTimeout(() => URL.revokeObjectURL(address), 0);
      }
      run(core.bufferSaveScript(buffer, !failed, failed || ''));
    },
    loadPager: ({ path }) => run(`window.leafSetPager(${JSON.stringify({ path, html: pagerHtml(path) })});`),
    // A book picture near the reader, made into an address in this page's own window out of the book the module kept. A member the module refused gets none, and its tag keeps the size it was drawn at.
    packagedPicture: ({ member }) => {
      const picture = core.bookPicture(String(member || ''));
      if (!picture) return;
      const address = URL.createObjectURL(new Blob([picture.bytes], { type: picture.type }));
      minted.push(address);
      run(`window.leafPictureMinted(${JSON.stringify(String(member))}, ${JSON.stringify(address)});`);
    },
  };

  // Every choice a site can keep, and the key each command owns. The desktop writes these into a file its host owns; a browser keeps its own store, and `assets/settings.js` is what reads it back over the defaults before the first paint. Written out one command at a time so a key belongs to exactly one of them and nothing writes a neighbor.
  const KEPT = {
    setGraphScope: (command) => ({ graphScope: String(command.scope || 'small') }),
    setSpeedReaderEnabled: (command) => ({ speedReaderEnabled: !!command.enabled }),
    setCodeIntelEnabled: (command) => ({ codeIntelEnabled: !!command.enabled }),
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

  // What this host can write the page out as. A browser has no save window and no disk, so its one row is the browser's own print — which is what `exportPdf` reaches here. Said out loud rather than left empty, because the page draws this list as a menu on a Mac and an unnamed row would offer a reader something nothing behind it can make.
  window.__leafPageExports = [{ id: 'pdf', label: 'PDF' }];
  window.ipc = { postMessage: handle };
  // Whatever the front end sent while this was still loading.
  for (const message of window.__leafPending || []) handle(message);
  window.__leafPending = [];

  return { core, openDocument, openAddress, showFolder, resolveFrom, known, refused };
}
