// A host for the app's own front end, in a frame somebody else's product owns.
//
// The page is the desktop's page and the script is the desktop's script, unchanged. What differs is who answers them: the desktop has a window, a disk and an event loop behind `window.ipc`; a published site has files beside the page; here there is a document buffer in the module and a product on the other side of a frame.
//
// So this is the third half of the same bargain the renderer already makes. It answers what an embedded document can answer — every edit, undo, the glossary, the strip — hands the save to whoever mounted it, and refuses out loud the rest, which is how a control that does nothing is found rather than shipped quietly.
//
// **It loads nothing.** The module is handed to it already loaded, and the frame is mounted by the layer above. That is not tidiness: a host with an `import` in it cannot be booted the way the gate boots one, over a stand-in module with no browser anywhere, and a host nothing can boot offline is a host that ships unproven. It is also the honest split — loading a module and mounting a frame is the embed API's job, and answering the page is this file's.

// Three answers and no fourth, the same three the site's host carries. `ANSWERED` has an arm below. `REFUSED` says why an embedded document will never have one. `LATER` names the ticket that owns writing it.
export const ANSWERED = 'answered';
export const REFUSED = 'refused';
export const LATER = 'later';

// What this host does about every command the app's page can send.
//
// `IpcCommand` in `src/app/events.rs` is the app's one list of them, and `just check-web-commands` reads this table and the site's, failing on an arm with no row in either, on a row naming no arm, and on a command the front end sends that no host has. Two hosts and one front end: a command answered here while the other table still says nobody answers it leaves the gate telling the truth about half the app.
export const COMMANDS = {
  open: [REFUSED, 'a file dialog needs a disk to pick from, and the product chose this document before the frame was mounted'],
  openRecent: [REFUSED, 'an embed holds the one document it was handed, and which document that is belongs to the product'],
  newDocument: [REFUSED, 'a new document would have nowhere to be saved, since the save goes back to whoever mounted this'],
  pasteFile: [REFUSED, 'nothing here writes to a disk'],
  revealFile: [REFUSED, 'there is no file manager to show it in'],
  copyFile: [REFUSED, 'nothing here writes to a disk'],
  copyPath: [REFUSED, 'the name this document wears is whatever the product called it, and it names nothing on the machine reading it'],
  toggleFavorite: [REFUSED, 'a favorite is a row in a library, and an embed draws no library'],
  checkFavorites: [REFUSED, 'a favorite is a row in a library, and an embed draws no library'],
  repointFavorite: [REFUSED, 'it reopens the file picker, which an embed has not got'],
  moveFavorite: [REFUSED, 'a favorite is a row in a library, and an embed draws no library'],
  renameFile: [REFUSED, 'nothing here writes to a disk'],
  deleteFile: [REFUSED, 'nothing here writes to a disk'],
  undoDelete: [REFUSED, 'nothing here writes to a disk'],
  showProperties: [REFUSED, 'there is no file on this machine to describe'],
  closeTab: [REFUSED, 'an embed holds one document and draws no tab strip to close it from'],
  switchTab: [REFUSED, 'an embed holds one document and draws no tab strip to switch in'],
  moveTab: [REFUSED, 'an embed holds one document and draws no tab strip to reorder'],
  goHome: [REFUSED, 'the start screen is the app with nothing open, and an embed is one document inside a page that has its own home'],
  openLink: [ANSWERED],
  openExternal: [REFUSED, 'the browser follows a link out of the page itself'],
  openGlossary: [ANSWERED],
  revealLink: [REFUSED, 'there is no file manager to show it in'],
  copyLinkPath: [REFUSED, 'a link in an embedded document names nothing on the machine reading it'],
  countLines: [REFUSED, 'it counts the lines of a linked document, and an embed holds one document rather than the folder around it'],
  previewLink: [REFUSED, 'an embed holds one document rather than the linked-document collection this preview reads'],
  goBack: [REFUSED, 'an embed draws no history pair, and where a reader has been is for the product to remember'],
  goForward: [REFUSED, 'an embed draws no history pair, and where a reader has been is for the product to remember'],
  setSpeedReaderEnabled: [ANSWERED],
  setCodeIntelEnabled: [ANSWERED],
  setReadingUnlocked: [ANSWERED],
  setCodeUnlocked: [ANSWERED],
  setThemeFamily: [ANSWERED],
  setThemeMode: [ANSWERED],
  setThemeRandomBag: [ANSWERED],
  setHintState: [REFUSED, 'a first-run bubble is a once-per-install promise, and a reader meeting a document inside a product has installed nothing'],
  windowDrag: [REFUSED, 'a frame inside a page has no window frame to drag'],
  windowMinimize: [REFUSED, 'a frame inside a page has no window to minimize'],
  windowToggleMaximize: [REFUSED, 'a frame inside a page has no window to maximize'],
  windowClose: [REFUSED, 'the product closes the frame it mounted, and the page inside it never asks to go'],
  saveSessionPlace: [REFUSED, 'the product owns the mounted document and its saved session'],
  windowResizeDrag: [REFUSED, 'a frame inside a page has no window frame to resize, and an embed draws no shadow band to grab, so no phase of the drag is ever sent'],
  setWindowChrome: [REFUSED, 'there is no native title bar to paint, and the frame color belongs to the product'],
  setLibraryState: [REFUSED, 'it remembers which folder the pane was inside, and an embed draws no pane'],
  setGraphView: [REFUSED, 'it only says whether a change on disk has a map to redraw, and nothing here watches a disk'],
  getVaultGit: [REFUSED, 'a vault is a folder on a disk, and an embed holds one document'],
  getVaultStatus: [REFUSED, 'a vault is a folder on a disk, and an embed holds one document'],
  createVaultRepo: [REFUSED, 'making a repository needs a disk and a process'],
  linkVaultRemote: [REFUSED, 'a vault is a folder on a disk, and an embed holds one document'],
  syncVault: [REFUSED, 'pushing a repository needs a disk and a process'],
  setGitIdentity: [REFUSED, 'it writes who git commits as into the git settings on a machine, and an embed holds one document inside a page with no machine and no git under it'],
  refreshVault: [REFUSED, 'the product hands this document over and is the only thing that knows when it changed'],
  signInVault: [REFUSED, 'an embed has no window to open a browser sign-in from, no port to be answered on and nowhere to keep a token'],
  signOutVault: [REFUSED, 'there is no signed-in account behind an embed, so there is nothing to sign out of'],
  setLibraryLayout: [REFUSED, 'it remembers how wide the pane was left, and an embed draws no pane'],
  createVault: [REFUSED, 'a vault is a folder picked on a disk'],
  getCloudFolders: [REFUSED, 'nothing here can look for a sync folder on this machine'],
  cloneVault: [REFUSED, 'cloning a repository needs a disk and a process'],
  setActiveVault: [REFUSED, 'an embed holds one document, so there is nothing to switch between'],
  renameVault: [REFUSED, 'an embed draws no library, so there is no vault row to relabel'],
  changeVaultFolder: [REFUSED, 'it reopens the folder picker, which an embed has not got'],
  removeVault: [REFUSED, 'an embed draws no library, so there is no vault row to forget'],
  getFolder: [REFUSED, 'it fills the library pane, and an embed draws none'],
  revealInLibrary: [REFUSED, 'it points the library pane at a document, and an embed draws no pane'],
  getGraph: [REFUSED, 'the map is of how a folder of documents link to each other, and an embed holds one of them'],
  setGraphScope: [REFUSED, 'it remembers how big a map to draw, and an embed draws none'],
  search: [REFUSED, 'it searches the text of a whole vault, and an embed holds one document'],
  loadPager: [ANSWERED],
  enterCodeView: [LATER, 'leaftext-web-embed'],
  exitCodeView: [LATER, 'leaftext-web-embed'],
  spliceSource: [ANSWERED],
  updateSource: [ANSWERED],
  saveDocument: [ANSWERED],
  codeCompleteNotes: [REFUSED, 'the notes it completes to are the other documents in a vault, and an embed holds the one the product handed it'],
  codeCompleteHeadings: [REFUSED, 'it completes headings out of a named note, and an embed has no other note to name'],
  codeHoverNote: [REFUSED, 'it reads the opening lines of another note, and an embed holds one document'],
  codeLint: [REFUSED, 'it checks the links in a document against the files around it, and an embed has no files around it'],
  toggleTask: [ANSWERED],
  editBlock: [ANSWERED],
  setField: [ANSWERED],
  setListField: [ANSWERED],
  renameField: [ANSWERED],
  moveBlock: [ANSWERED],
  pickImage: [REFUSED, 'picking an image is a file dialog over a disk'],
  exportDiagram: [LATER, 'web-export'],
  undoEdit: [ANSWERED],
  redoEdit: [ANSWERED],
  updateChecked: [REFUSED, 'an embed is whatever version the product shipped'],
  updateDownload: [REFUSED, 'an embed is whatever version the product shipped'],
  applyUpdate: [REFUSED, 'there is nothing installed here to replace'],
  logError: [REFUSED, 'the browser console already has it'],
};

/** Whether this host answers a command, for a page that means to hide the controls it does not. */
export function answers(command) {
  return (COMMANDS[command] || [])[0] === ANSWERED;
}

/** Start Leaftext over one document, in the page the frame already loaded.
 *
 * `module` is the loaded browser module. `source` is the document, as bytes or as text. `path` is whatever the product calls it — the name is what the page shows and what comes back with the save, and it names nothing on the machine reading it. `save` is called with the document whenever it has to be written, and whatever it throws is what the page is told; leaving it out makes this a reader that can still be typed in and never persists. `glossary` is a glossary document text, if the product has one, so its terms auto-link the way they do on the desktop. `onEvent` hears everything the product might want to act on.
 */
export function startLeaftextEmbed({ module, source, path = 'document.md', save = null, glossary = '', onEvent = null }) {
  if (glossary) module.setGlossary(glossary);
  const held = module.buffer.open(source, path);
  if (!held) throw new Error('the module could not read that document');

  /** Run a line the host would have injected, the way the web view runs it. */
  const run = (script) => {
    if (script) new Function(script)();
  };
  const tell = (event) => {
    if (typeof onEvent === 'function') onEvent(event);
  };

  /** The document and its editing state, both, so a redrawn document never sits under stale Save and Undo buttons. */
  const redraw = () => {
    run(module.buffer.documentScript(held));
    tell({ kind: 'document', state: module.buffer.state(held) });
  };

  /** One edit against the buffer. A re-render only where the buffer actually moved: an edit that changed nothing must not redraw the document under the reader. */
  const apply = (edit) => {
    const state = module.buffer.edit(held, edit);
    if (state && state.changed) redraw();
    return state;
  };

  /** The document, to whoever mounted this. The only thing that ends a dirty buffer, since nothing here can write a file. */
  const write = async () => {
    if (typeof save !== 'function') {
      console.info('this host does not answer saveDocument — nothing was handed a save callback, so the document stays unsaved');
      return;
    }
    const state = module.buffer.state(held);
    let failed = null;
    try {
      // The text and the bytes both: a product holding a string takes the first, and one holding a file takes the second, which is spelled the way the document arrived.
      await save({ text: module.buffer.source(held), bytes: module.buffer.encoded(held), path: state.path, spelling: state.spelling });
    } catch (error) {
      failed = String((error && error.message) || error || 'the save failed');
    }
    // The buffer is marked clean by this call and not before it, so a refused save leaves the document dirty and the reason on screen rather than a Save button that has gone out.
    run(module.buffer.saveScript(held, !failed, failed || ''));
    tell({ kind: 'save', ok: !failed, error: failed, state: module.buffer.state(held) });
  };

  /** An edit that writes itself — a checkbox, or the reading view's own auto-saving path. The desktop writes these to disk without a Save press, so an embed hands them straight over rather than leaving a reader to press a button an embed does not draw. */
  const applyAndWrite = async (edit) => {
    if (apply(edit)?.changed) await write();
  };

  // What the page sends the host. A command with no arm here is one this host cannot answer.
  const commands = {
    saveDocument: () => write(),
    editBlock: (command) => {
      // `continuing` marks every splice of a typing run after its first, so one press of undo takes the whole run back however many times it paused. `live` means the reader is still typing in the block: the buffer moves and the document is left standing, because a redraw would take the words out from under the caret — the commit that ends the run is the one that redraws.
      const edit = { edit: 'block', start: command.start, end: command.end, text: command.text, undo: !command.autosave && !command.continuing, cell: command.cell };
      if (command.autosave) return applyAndWrite(edit);
      if (command.live) {
        tell({ kind: 'document', state: module.buffer.edit(held, edit) });
        return undefined;
      }
      return apply(edit);
    },
    toggleTask: (command) => applyAndWrite({ edit: 'task', index: command.index }),
    setField: (command) =>
      command.value === undefined || command.value === null
        ? apply({ edit: 'field', key: command.key, remove: true })
        : apply({ edit: 'field', key: command.key, set: command.value }),
    setListField: (command) => apply({ edit: 'field', key: command.key, items: command.items || [] }),
    renameField: (command) => apply({ edit: 'field', key: command.key, rename: command.to }),
    moveBlock: (command) => apply({ edit: 'move', ranges: command.ranges || [], from: command.from, to: command.to }),
    undoEdit: () => apply({ edit: 'undo' }),
    redoEdit: () => apply({ edit: 'redo' }),
    // The code view's typing. No re-render: the source view is what is on screen, and the reading view is redrawn when it comes back.
    spliceSource: (command) => {
      const state = module.buffer.edit(held, { edit: 'splice', start: command.start, removed: command.removed, inserted: command.inserted });
      // The page proves the two copies still agree off this number. Where they do not, rather than splice into a buffer nobody understands any more, the whole thing is asked for again.
      if (state && state.utf16Len !== command.length) run('window.leafResyncSource();');
      else tell({ kind: 'document', state });
    },
    updateSource: (command) => {
      const state = module.buffer.edit(held, { edit: 'text', text: String(command.text || '') });
      tell({ kind: 'document', state });
    },
    // A link is the product to follow: an embed holds one document, and where its links point is something only the thing that handed the document over can know. Answered rather than refused, because a link a reader clicks has to reach somebody.
    openLink: (command) => tell({ kind: 'link', href: String(command.href || ''), newPage: !!command.newPage }),
    openGlossary: (command) => run(module.glossaryScript(command.href)),
    // A waiting state is a promise. The page draws the Previous/Next strip empty and waits for this; an embed has no neighbors, so the answer is an empty strip rather than a skeleton that spins for ever.
    loadPager: (command) => run(`window.leafSetPager(${JSON.stringify({ path: command.path, html: '' })});`),
  };

  // Every choice the reader can make about the view, held for this reading and no longer. The desktop writes these into a file its host owns and a site keeps its own store; a product that means to remember one takes it off the event and keeps it where it keeps everything else about that reader.
  const KEPT = {
    setSpeedReaderEnabled: (command) => ({ speedReaderEnabled: !!command.enabled }),
    setCodeIntelEnabled: (command) => ({ codeIntelEnabled: !!command.enabled }),
    setReadingUnlocked: (command) => ({ readingUnlocked: !!command.enabled }),
    setCodeUnlocked: (command) => ({ codeUnlocked: !!command.enabled }),
    setThemeFamily: (command) => ({ themeFamily: String(command.family || '') }),
    setThemeMode: (command) => ({ themeMode: String(command.mode || '') }),
    setThemeRandomBag: (command) => ({ themeRandomUsed: Array.isArray(command.used) ? command.used : [] }),
  };
  const settings = {};
  for (const [name, keys] of Object.entries(KEPT)) {
    commands[name] = (command) => {
      Object.assign(settings, keys(command));
      tell({ kind: 'setting', settings: { ...settings } });
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

  redraw();

  return {
    /** The document as it now stands, for a product that keeps its own copy. */
    source: () => module.buffer.source(held),
    bytes: () => module.buffer.encoded(held),
    state: () => module.buffer.state(held),
    save: write,
    /** Let the document go. The frame around it is for the product to take down. */
    close: () => module.buffer.close(held),
    refused,
  };
}
