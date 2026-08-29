// The state more than one fragment touches, grouped by its owner. It follows the error journal and leads every subject fragment, so each shared binding exists before anything reaches it.
//
// Only shared state belongs here. What one fragment reads goes in that fragment. Outside this file, a top-level mutable binding may be assigned only by the fragment that declares it.

// ---- the flowchart sheet ---------------------------------------------------

// The shape picker carries an add callback and its typed name between the picker and canvas.
let flowPickerAdd = null;
let flowPickerName = '';
// The canvas selection and drag are changed by its pointer and menu fragments.
let flowSelection = null;
let flowDrag = null;

// ---- settings and navigation ---------------------------------------------

let currentState = { recent: [], favorites: [], tabs: [], active: null, document: null };
let navigationState = { canGoBack: false, canGoForward: false };
// Kept between renders so a re-render redraws the same message rather than re-rolling it under the reader.
let homeMessage = null;

// ---- the library, views, and graph ----------------------------------------

// Vaults and pane state are written by the library and search fragments and read across the reader.
let leafVaults;
let activeVaultId;
let libraryProjectPath;
let libraryChain = [];
let librarySearchQuery = '';
let pendingSearchJump = null;
// The two editable views keep separate saved padlocks, while the graph is one window-wide view.
let readingUnlocked;
let codeUnlocked;
let graphViewOpen = false;
let graphExitPending = false;
let graphActivePath = null;
let graphFocusPending = false;

// ---- tabs, images, and reader position ------------------------------------

let tabDrag = null;
// A changed local picture gets a new URL without rebuilding the document.
let localImageEpoch = 0;
// Scroll anchoring is measured and spent across the updater, renderer, and minimap fragments.
let readerScrollAnchor = null;
let readerScrolling = false;
let resetReaderScrollOnNextRender = false;
let readerAnchorBlocks = null;

// ---- the box that means "the app" (dom.js, context-menu.js, glossary.js, hints.js, library.js, render-document.js, decorate.js, code-view.js, minimap.js, frontmatter-fields.js)

// Everything the page has lives inside this one element, and every floating thing the script makes is added to it rather than beside it. A `position: fixed` child is measured from this box and clipped to it (see .app-surface), so an overlay belongs to the app; `<body>` is the window, and the two stop being the same rectangle once the window's outer edge is a shadow the app draws. Falls back to `<body>` for a host that serves its own page without the wrapper.
const appSurface = document.getElementById('appSurface') || document.body;

// Where the app is, in the window's own coordinates. The one place that knows, because a pointer event and a getBoundingClientRect are the window's numbers while a fixed overlay's `left` is this box's — so anything placing one has to cross between them, and seven copies of that arithmetic is seven chances for one overlay to keep believing it owns the whole window.
function leafAppRect() {
  return appSurface.getBoundingClientRect();
}

// Put a box of this size at this window point, held inside the app with a margin. Returns the app's own coordinates, ready for `style.left` / `style.top`. A margin bigger than the room left is floored rather than allowed to push the box back off the other edge.
function leafClampToApp(x, y, width, height, margin) {
  const room = leafAppRect();
  const right = Math.max(margin, room.width - width - margin);
  const bottom = Math.max(margin, room.height - height - margin);
  return {
    left: Math.min(Math.max(x - room.left, margin), right),
    top: Math.min(Math.max(y - room.top, margin), bottom),
  };
}

// ---- the page color an export paints behind a picture (flow-export.js, image-sheet.js)

// What an export paints before it draws. Two fragments need it for opposite reasons: a diagram has no page to sit on at all, so a pale-ink theme on nothing is a file that looks blank, and a JPEG carries no transparency, so an unpainted canvas encodes as solid black and a logo with alpha comes out on a black rectangle. Either way the answer is the surface the reader was looking at.
function leafExportBackground() {
  const style = window.getComputedStyle(document.documentElement);
  return (style.getPropertyValue('--lt-surface') || '').trim() || '#ffffff';
}

// ---- the sections of the open document (decorate.js, library.js) ----------

// The open document's headings under its title, as plain rows: `{ level, text, id }` in document order, and empty for a document that is a title and no more. Written by the heading walk in decorate.js as a document renders, read by whatever draws them — which is two fragments, so neither one owns it.
let documentOutlineRows = [];
function setDocumentOutlineRows(rows) {
  documentOutlineRows = Array.isArray(rows) ? rows : [];
}
function readDocumentOutlineRows() {
  return documentOutlineRows;
}

// ---- what the pane's trail calls its root (library.js, speed-reader.js) ----

// The name the host gives the whole root. A published site sends its own, because a site is one folder and that folder has a name; the desktop sends none, where the leftmost crumb is the vault you are standing in or the word for the whole library. Written by the folder payload in library.js, read by libraryRootLabel() in speed-reader.js.
let libraryRootName = '';

// ---- the pane easing open or shut (library.js, overflow.js) ----------------

// The classes that stand on the body while the pane moves: the open's one overshooting leg, and the close's slam and its settle. Written once because two fragments spend them — library.js puts them up and takes them all down, and overflow.js holds the bar's left-zone measurement back while any is standing.
const LIBRARY_MOTION_CLASSES = ['is-library-opening', 'is-library-closing', 'is-library-settling'];
function libraryPaneIsMoving() {
  return LIBRARY_MOTION_CLASSES.some((name) => document.body.classList.contains(name));
}

// ---- the platform (context-menu.js, glossary.js) ---------------------------

// Which gesture belongs to which key: Ctrl+click is the right-click on a Mac, so the open-in-a-new-page modifier there is Cmd. Read by the menu and by the document-link handler that picks the modifier.
const isMacPlatform = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

// ---- what counts as a document (render-state.js, glossary.js, render-document.js)

// Every extension the app reads, injected at boot from the table in `src/format.rs` — never a copy kept here.
const DOCUMENT_EXTS = (window.__leafDocumentExts || ['md']).join('|');
/** A bare file name ending in a document extension. */
const DOCUMENT_NAME_RE = new RegExp(`\\.(${DOCUMENT_EXTS})$`, 'i');
/** An href pointing at a document, fragment or query allowed. */
const DOCUMENT_HREF_RE = new RegExp(`\\.(${DOCUMENT_EXTS})(?:[#?].*)?$`, 'i');
// Here rather than with the tabs: theme.js runs renderState() as it loads, and the home screen strips an extension off every row it draws — a const declared further down is in its dead zone at that point, so the first paint would throw.

// ---- the reader's render (render-state.js) ---------------------------------

// Above this many characters of view HTML, building the DOM (innerHTML plus the layout-forcing decoration passes) blocks this thread long enough that the spinner should be painted on screen before the work starts.
const READER_LOADING_HEAVY_HTML = 250000;
// Invalidates a deferred heavy render when a newer render supersedes it.
let readerRenderToken = 0;

// ---- the app bar's Export action (overflow.js, graph.js) -------------------

// The page as it stands, written to a PDF the host renders itself. overflow.js wires the press; graph.js is what knows whether there is a rendered page to write at all, so it is what shows and hides the button.
const exportPdfButton = document.getElementById('exportPdfButton');

// ---- the code view and saving (code-view.js) -------------------------------

const saveButton = document.getElementById('saveButton');
const undoButton = document.getElementById('undoButton');
const redoButton = document.getElementById('redoButton');
// Whether each document has a reading-view edit to undo. Set optimistically when an edit is sent, then overwritten by the host's authoritative answer in leafBlocksResynced and cleared on save. The host owns the undo stack, so the button can never linger after undoing all the way back or saving a baseline.
const undoableByPath = new Map();
// Whether each document has an undone edit waiting to be brought back. Only an undo creates one and the host is the only thing that knows, so this is never set ahead of an answer the way the undo map is. A fresh edit ends it, here as in the buffer.
const redoableByPath = new Map();
// Whether the reader is currently showing raw source instead of the rendered document. Reset by renderState(), set by leafShowCodeView().
let codeViewActive = false;
// Monaco backs the code view (see code-view.js): the editor instance, its content-change subscription, and the one-time bundle loader promise.
let monacoEditor = null;
let monacoChangeSub = null;
// The editor's layout-change subscription, which re-derives the bounded wrap column (see applyCodeViewWrapColumn) whenever the editor's width changes, and the column it last set — kept here so teardown disposes/resets them.
let monacoLayoutSub = null;
let codeViewWrapColumn = 0;
// Typing into a locked file. Monaco reports the refused keystroke rather than acting on it; the growl is what turns a dead editor into an explanation.
let monacoReadOnlySub = null;
// The `document.fonts` listener that re-fits that column when a face finishes loading. A font arriving changes no geometry, so no layout event announces it — see refitCodeViewToFont. Held here so teardown can unsubscribe: it outlives the editor otherwise, and would re-fit a disposed one.
let monacoFontsDoneHandler = null;
// Watches the minimap for Monaco moving its viewport box, so the box can be kept inside the rail — see clampMinimapSliderToRail. Held here so teardown disconnects it: an observer outlives the editor it was watching.
let monacoSliderObserver = null;
let monacoLoadPromise = null;
// The last editor value, mirrored so a save (and the debounced re-highlight) send the current buffer even if a keystroke is still within the debounce.
let codeViewText = '';
let sourceUpdateTimer = 0;
// Unsaved-edits state per document path, so the tab dot and Save button survive the tab bar being re-rendered. Absent / false means clean.
const dirtyByPath = new Map();

// ---- carrying the reader's place across a view toggle ----------------------

// Scroll fraction captured when toggling between the reading and code views, so the destination view opens at the same relative position (top stays top, mid-document stays mid-document). Consumed (and cleared) by the next render.
let pendingViewScrollFraction = null;
// Byte offset of the block at the top of the reading viewport when the code view opens, so it lands on the line you were reading rather than a height fraction (rendered height and source length diverge). Consumed by the next renderCodeView.
let pendingCodeViewSrcOffset = null;
// The mirror for leaving the code view: byte offset of the top source line, consumed by the next reading render so it lands on that block. A fraction races the render here and drops the reader to the top of the document.
let pendingReadingSrcOffset = null;
// True when the source view was scrolled to the very top as the toggle fired, so the destination lands flush at the top instead of aligning the first block just below the edge (which read as an unwanted little scroll-down). Consumed by the next render in either direction.
let pendingViewAtTop = false;
// The document the four landings above were taken from. One gesture arms all four before the host is asked for anything, and four things can then abandon the entry without rendering — so the landings stand and the next document opened spends them. See dropViewLandingsFromAnotherDocument.
let pendingViewLandingPath = null;
// The document whose reading render ran while the reader was off screen. Under the map every box measures zero, so the landings above write nothing and clear themselves — the reader comes back at the top of a page they were half way down. Held here instead, and spent by the reveal. See runHeldReadingLanding.
let heldReadingLandingPath = null;
// Where each view was when the toggle left it, and where the toggle put it. Every position the toggle re-derives rounds back to a block or line start, so a round trip loses a little and repeated toggling walks up the document; a view that hasn't moved since it landed gets its exact pixel back instead. One document at a time, dropped when the file or its text changes.
let viewHandoff = null;

// ---- reading-view editing (reading-edits.js) -------------------------------

// The source buffer stays authoritative in Rust; the reading view anchors each edit to a source byte range and asks the host to splice it. These hold what the frontend needs between renders.
let currentDocumentFormat = 'markdown';
let currentDocumentSource = '';
// Which renderer inside the format drew this document, where the format has more than one: `'tei'` for a TEI file, null for everything else. The plus offers the elements that renderer draws, and the routing is the host's answer rather than a rule read off the source a second time here.
let currentDocumentDialect = null;
// Whether this document has anything the reading view can open: a block that proved a source range, or Markdown, whose empty note has no blocks and is exactly the page somebody unlocks to start typing in. reading-edits.js sets it as a document binds and graph.js reads it to decide whether the padlock belongs in the tray, because a padlock over a page nothing can be typed into answers a press with nothing.
let currentDocumentBindsAnything = true;
// Where the caret should land after the next render, carrying it across the re-render a structural edit (Enter/Backspace) triggers so typing flows on. `srcStart` names the block by its post-splice source offset, `textOffset` the position inside it; `insertBelow` opens a fresh empty paragraph after it.
let pendingCaret = null;
// A reader anchor the next leafReloadDocument should restore instead of its own top-visible capture. Set when committing a source-edited block (e.g. an image) whose own height swings across the re-render: it points at the stable block ABOVE the edit, so the reader holds its place rather than snapping to the top.
let pendingEditAnchor = null;

// ---- the host's answer to one edit (flow-canvas.js, dom.js, reading-blocks.js, reading-edits.js)

// An edit whose sender is holding something until the host's word travels under a number of its own, and the answer comes back on that number. Both sit here rather than with any one sender because four fragments touch them now: the flowchart sheet keeps a drawing on screen until it is answered, and both kinds of checkbox drew themselves ticked before the command left and put that tick back where the answer says the buffer is holding nothing.
let leafEditToken = 0;
// Who is waiting, by token — one each, dropped as it is answered. An answer to a token nobody is holding is ignored, the way the image picker's is.
const leafEditWaiting = new Map();

// ---- the last delete, and whether it can be taken back ---------------------

// The file the last delete could put back, or null. Set only by the host saying the delete happened, so nothing offers to undo one that never went through. Three fragments read it: the toast that carries the Undo button, the Ctrl+Z handler in code-view.js, and the toast's own end, which clears it — the offer lasts exactly as long as the message does.
let undoableDelete = null;
