// The state more than one fragment touches, grouped by its owner. First in the load order because it has to be: the fragments are one script, and theme.js runs renderState() as it loads — before code-view.js, whose state that reads.
//
// Only shared state belongs here. What one fragment reads goes in that fragment.

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

// ---- the code view and saving (code-view.js) -------------------------------

const saveButton = document.getElementById('saveButton');
const undoButton = document.getElementById('undoButton');
// Whether each document has a reading-view edit to undo. Set optimistically when an edit is sent, then overwritten by the host's authoritative answer in leafBlocksResynced and cleared on save. The host owns the undo stack, so the button can never linger after undoing all the way back or saving a baseline.
const undoableByPath = new Map();
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
// Where each view was when the toggle left it, and where the toggle put it. Every position the toggle re-derives rounds back to a block or line start, so a round trip loses a little and repeated toggling walks up the document; a view that hasn't moved since it landed gets its exact pixel back instead. One document at a time, dropped when the file or its text changes.
let viewHandoff = null;

// ---- reading-view editing (reading-edits.js) -------------------------------

// The source buffer stays authoritative in Rust; the reading view anchors each edit to a source byte range and asks the host to splice it. These hold what the frontend needs between renders.
let currentDocumentFormat = 'markdown';
let currentDocumentSource = '';
// Where the caret should land after the next render, carrying it across the re-render a structural edit (Enter/Backspace) triggers so typing flows on. `srcStart` names the block by its post-splice source offset, `textOffset` the position inside it; `insertBelow` opens a fresh empty paragraph after it.
let pendingCaret = null;
// A reader anchor the next leafReloadDocument should restore instead of its own top-visible capture. Set when committing a source-edited block (e.g. an image) whose own height swings across the re-render: it points at the stable block ABOVE the edit, so the reader holds its place rather than snapping to the top.
let pendingEditAnchor = null;

// ---- the last delete, and whether it can be taken back ---------------------

// The file the last delete could put back, or null. Set only by the host saying the delete happened, so nothing offers to undo one that never went through. Three fragments read it: the toast that carries the Undo button, the Ctrl+Z handler in code-view.js, and the toast's own end, which clears it — the offer lasts exactly as long as the message does.
let undoableDelete = null;
