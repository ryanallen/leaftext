const SPEED_READER_SKIP_SELECTOR = [
  'code',
  'pre',
  'kbd',
  'samp',
  'script',
  'style',
  'textarea',
  'input',
  'select',
  'button',
  'svg',
  'math',
  '.katex',
  '.mermaid',
  '.settings-menu',
  '.library-pane',
  '.tab-bar',
  '.app-bar',
  '.document-minimap',
  '.glossary-sheet',
  '.docs-pager',
  '[data-speed-reader-skip]',
  '.speed-reader-anchor',
].join(',');
const speedReaderSegmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;
function speedReaderGraphemes(text) {
  if (speedReaderSegmenter) {
    return Array.from(speedReaderSegmenter.segment(text), (part) => part.segment);
  }
  return Array.from(text);
}
function speedReaderHasCjk(text) {
  return /[\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(text);
}
function isSpeedReaderWord(word) {
  if (word.length < 2 || speedReaderHasCjk(word)) {
    return false;
  }
  return /^\p{L}+(?:['\u2019]\p{L}+)?$/u.test(word);
}
// An all-uppercase word (HTML, GFM, JSON) is an acronym read as a single unit,
// so it is bolded whole rather than split into a lead prefix and a dim tail.
function isSpeedReaderAcronym(word) {
  return /^\p{Lu}+$/u.test(word);
}
function leadAnchorPrefixLength(count) {
  if (count <= 1) return 0;
  if (count <= 3) return 1;
  if (count <= 5) return 2;
  if (count <= 8) return 3;
  if (count <= 12) return 4;
  return Math.min(6, Math.ceil(count * 0.35));
}
function appendSpeedReaderWord(fragment, word) {
  const chars = speedReaderGraphemes(word);
  const prefixLength = isSpeedReaderAcronym(word) ? chars.length : leadAnchorPrefixLength(chars.length);
  if (prefixLength === 0) {
    fragment.append(document.createTextNode(word));
    return;
  }
  const anchor = document.createElement('span');
  anchor.className = 'speed-reader-anchor';
  anchor.textContent = chars.slice(0, prefixLength).join('');
  fragment.append(anchor, document.createTextNode(chars.slice(prefixLength).join('')));
}
function appendSpeedReaderCandidate(fragment, token) {
  const parts = token.split(/(-)/);
  parts.forEach((part) => {
    if (!part) return;
    if (part === '-' || !isSpeedReaderWord(part)) {
      fragment.append(document.createTextNode(part));
      return;
    }
    appendSpeedReaderWord(fragment, part);
  });
}
function isSpeedReaderWordChar(char) {
  return Boolean(char && /[\p{L}\p{N}]/u.test(char));
}
// A token is code-like (no lead anchor) only when a digit is fused to it (page2)
// or a joiner glues it to a word char on its far side (file.md, a@b, x=y). A
// joiner against whitespace or sentence punctuation is ordinary prose.
const SPEED_READER_JOINER = /[:/\\._@#?=&%+~]/;
function speedReaderTouchesCode(text, start, end) {
  const before = text[start - 1];
  const after = text[end];
  if (/[0-9]/.test(before || '') || /[0-9]/.test(after || '')) return true;
  if (SPEED_READER_JOINER.test(before || '') && isSpeedReaderWordChar(text[start - 2])) return true;
  if (SPEED_READER_JOINER.test(after || '') && isSpeedReaderWordChar(text[end + 1])) return true;
  return false;
}
function speedReaderFragment(text) {
  const fragment = document.createDocumentFragment();
  const tokenPattern = /\p{L}+(?:['\u2019-]\p{L}+)*/gu;
  let cursor = 0;
  let changed = false;
  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index || 0;
    if (index > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, index)));
    }
    if (speedReaderTouchesCode(text, index, index + token.length)) {
      fragment.append(document.createTextNode(token));
      cursor = index + token.length;
      continue;
    }
    const before = fragment.childNodes.length;
    appendSpeedReaderCandidate(fragment, token);
    changed = changed || fragment.childNodes.length !== before + 1 || fragment.lastChild?.textContent !== token;
    cursor = index + token.length;
  }
  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)));
  }
  return changed ? fragment : null;
}
function shouldSkipSpeedReaderTextNode(node, root) {
  if (!node.nodeValue || !node.nodeValue.trim()) {
    return true;
  }
  if (!/\p{L}/u.test(node.nodeValue)) {
    return true;
  }
  const parent = node.parentElement;
  if (!parent || parent.closest(SPEED_READER_SKIP_SELECTOR)) {
    return true;
  }
  return !root.contains(parent);
}
function applySpeedReaderToDocument(root = app.querySelector('.document-body')) {
  if (!speedReaderEnabled || !root || root.dataset.speedReaderProcessed === 'true') {
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkipSpeedReaderTextNode(node, root) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node);
  }
  nodes.forEach((node) => {
    const fragment = speedReaderFragment(node.nodeValue || '');
    if (fragment) {
      node.replaceWith(fragment);
    }
  });
  root.dataset.speedReaderProcessed = 'true';
}
let speedReaderEnabled = LEAF_SETTINGS.speedReaderEnabled === true;
function setSpeedReaderEnabled(enabled) {
  speedReaderEnabled = Boolean(enabled);
  document.documentElement.dataset.speedReader = String(speedReaderEnabled);
  if (speedReaderEnabled) {
    applySpeedReaderToDocument();
  }
}
setSpeedReaderEnabled(speedReaderEnabled);
// Whether the page is showing the graph instead of the document. Not a pane mode
// and not per-tab: one flag, dropped the moment a document is opened, so there is
// never a question of which tab the map belonged to.
let graphViewOpen = false;
// Markdown files are badged with the app's own leaf mark. The host inlines the
// same glyph the header uses, so the row tints it via stroke/fill currentColor
// rather than shipping a fixed color.
const LEAF_FILE_ICON = `{{LEAF_ICON_SVG}}`;
// Sending a vault to GitHub. Inlined the same way the rest are.
const SYNC_ICON_SVG = `{{SYNC_ICON_SVG}}`;
// What the host last said about each vault's repository, by id. Kept so
// reopening the panel shows what it knew rather than blanking while git is
// asked again.
const vaultGitByVault = new Map();

// A vault's glyph, inlined from the same files the host stamps into the
// switcher's button, so the button and its menu can never drift apart. Open is
// the vault you are in; closed is one you are not.
const CLOUD_ICON_SVG = `{{CLOUD_ICON_SVG}}`;
const PACKAGE_OPEN_ICON_SVG = `{{PACKAGE_OPEN_ICON_SVG}}`;
const PACKAGE_ICON_SVG = `{{PACKAGE_ICON_SVG}}`;
// And the plain folder, for the things that really are folders.
const FOLDER_ICON_SVG = `{{FOLDER_ICON_SVG}}`;
// The tick on the switcher's active row, and the mark on New vault…. Inline like
// the folder glyph so both take the row's color from currentColor, and so every
// row carries one and the labels line up.
const MENU_CHECK_SVG = '<svg class="crumb-menu-check" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>';
const MENU_PLUS_SVG = '<svg class="library-folder-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>';
// The button on a vault row that opens everything you can do to it — the same
// sliders the app's own Settings wears, because that panel is this vault's
// settings. Visible on the row, not behind a right-click: a menu you have to
// guess at is a menu nobody finds.
const MENU_SETTINGS_SVG = `{{SETTINGS_ICON_SVG}}`;
const MENU_TRASH_SVG = '<svg class="library-folder-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>';
const BACK_ARROW_SVG = '<svg class="library-folder-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>';
// Vaults. A vault is a folder the app treats as a library root; nothing is
// written into it, the app just remembers the choice. The host owns the list and
// seeds it before the first paint. Rows are keyed on id, never on name.
const LEAF_VAULTS = (window.__leafVaults && typeof window.__leafVaults === 'object') ? window.__leafVaults : {};
let leafVaults = Array.isArray(LEAF_VAULTS.vaults) ? LEAF_VAULTS.vaults : [];
let activeVaultId = Number.isFinite(LEAF_VAULTS.active) ? LEAF_VAULTS.active : 0;
function activeVault() {
  if (!activeVaultId) return null;
  return leafVaults.find((vault) => vault && vault.id === activeVaultId) || null;
}
// What the leftmost crumb reads: the vault's name, or the whole library's label.
function libraryRootLabel() {
  const vault = activeVault();
  return (vault && vault.name) || window.leafLocale.t('library.title');
}
const GRAPH_SCOPES = ['small', 'medium', 'large', 'xl'];
let graphScope = GRAPH_SCOPES.includes(LEAF_SETTINGS.graphScope) ? LEAF_SETTINGS.graphScope : 'small';
// Graph size: persist the choice and, if the graph is on screen, rebuild it for
// the new scope right away.
graphScopeControl.value = graphScope;
graphScopeControl.addEventListener('change', () => {
  graphScope = GRAPH_SCOPES.includes(graphScopeControl.value) ? graphScopeControl.value : 'small';
  send({ command: 'setGraphScope', scope: graphScope });
  if (graphViewOpen) requestGraphData();
});
// The folder the pane is inside ('' is the root); the breadcrumb is this path.
let libraryProjectPath = typeof LEAF_SETTINGS.libraryProjectPath === 'string' ? LEAF_SETTINGS.libraryProjectPath : '';
// Library pane open/close + resize. The closed preference and last open width are
// host-persisted (window.__leafSettings + setLibraryLayout), like the other
// settings.
const SNAP_SHUT = 40;           // drag narrower than this and the pane closes
const DEFAULT_PANE_WIDTH = 240; // first-run fallback only
const MIN_READER_WIDTH = 360;   // keep the document column usable as the pane grows
let libraryUserClosed = LEAF_SETTINGS.libraryClosed === true;
// Whether the narrow-window sheet is showing. Never persisted: it describes the
// current view, not a preference, and a window opened wide has no sheet.
let librarySheetOpen = false;
let libraryWidth = Number.isFinite(LEAF_SETTINGS.libraryWidth) && LEAF_SETTINGS.libraryWidth > 0
  ? LEAF_SETTINGS.libraryWidth
  : DEFAULT_PANE_WIDTH;
// The pane shows one folder at a time, read off the disk by the host. These are
// that folder: where it is, the trail down to it, and what is in it. There is no
// tree here and no index behind it — nothing is known about a folder until it is
// opened.
// The pane shows one folder at a time, read off the disk by the host. These are
// that folder: where it is, the trail down to it, and what is in it. There is no
// tree here and no index behind it — nothing is known about a folder until it is
// opened.
let libraryEntries = [];
let libraryChain = [];
let libraryError = null;
// Full-text search over the library. A non-empty query replaces the tree with
// ranked results; clearing it restores the tree. The backend echoes the query so
// a slow response for an old one is dropped.
const SEARCH_DEBOUNCE_MS = 150;
let librarySearchQuery = '';
let librarySearchTimer = 0;
let librarySearchHits = null;
let librarySearchError = null;
let librarySearchLoading = false;
// Search covers the folder the pane is showing (see librarySearchScopePaths).
// Above this many paths it can't be bound in one IN clause, so the query runs
// against the whole library instead.
const SEARCH_SCOPE_CAP = 1500;
// A heading anchor to scroll to once a clicked result's document has rendered.
let pendingSearchJump = null;
// Which documents you have unlocked for editing in the reading view. This used
// to be one switch in Settings governing everything you would ever open, which
// is the wrong shape for the question: whether a page is yours to type into is a
// fact about that page, not about the app. Locked is the default, and the answer
// lasts as long as the window — a document reopened tomorrow is read-only again,
// which is the safe way round to be wrong.
const readerUnlockedByPath = new Set();
function readerEditingAllowed() {
  const path = activeDocumentPath();
  return !!path && readerUnlockedByPath.has(path);
}
// Set by the one gesture that means "leave the map": clicking a node, or a
// search hit whose whole point is landing on the matching line. Everything else
// that opens a file -- the pane, a tab, a link -- keeps the view you are in, so
// changing document does not also change how you are reading it.
let graphExitPending = false;
