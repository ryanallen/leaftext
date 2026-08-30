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
  '.library-pane',
  '.tab-bar',
  '.app-bar',
  '.document-minimap',
  '.glossary-sheet',
  '.docs-pager',
  '[data-speed-reader-skip]',
  '.speed-reader-anchor',
].join(',');
// Building the splitter is the browser standing a language service up, and that is nearly the whole of what it costs — so it waits for the first word a reader actually starts on rather than being paid by every launch. Kept from that call on; `null` where the browser has no `Intl.Segmenter`, which is why the held answer is told apart by `undefined` rather than by being falsy.
let speedReaderSegmenterHeld;
function speedReaderSegmenter() {
  if (speedReaderSegmenterHeld === undefined) {
    speedReaderSegmenterHeld = (typeof Intl !== 'undefined' && Intl.Segmenter)
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  }
  return speedReaderSegmenterHeld;
}
function speedReaderGraphemes(text) {
  const segmenter = speedReaderSegmenter();
  if (segmenter) {
    return Array.from(segmenter.segment(text), (part) => part.segment);
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
// An all-uppercase word (HTML, GFM, JSON) is an acronym read as a single unit, so it is bolded whole rather than split into a lead prefix and a dim tail.
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
// A token is code-like (no lead anchor) only when a digit is fused to it (page2) or a joiner glues it to a word char on its far side (file.md, a@b, x=y). A joiner against whitespace or sentence punctuation is ordinary prose.
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
// Markdown files are badged with the app's own leaf mark. The host inlines the same glyph the header uses, so the row tints it via stroke/fill currentColor rather than shipping a fixed color.
const LEAF_FILE_ICON = `<span class="lt-icon lt-icon-leaf"></span>`;
// Sending a vault to GitHub. Inlined the same way the rest are.
const SYNC_ICON_SVG = `<span class="lt-icon lt-icon-sync"></span>`;
// What the host last said about each vault's repository, by id. Kept so reopening the panel shows what it knew rather than blanking while git is asked again.
const vaultGitByVault = new Map();

// A vault's glyph, inlined from the same files the host stamps into the switcher's button, so the button and its menu can never drift apart. Open is the vault you are in; closed is one you are not.
const CLOUD_ICON_SVG = `<span class="lt-icon lt-icon-cloud"></span>`;
const PACKAGE_OPEN_ICON_SVG = `<span class="lt-icon lt-icon-package-open"></span>`;
const PACKAGE_ICON_SVG = `<span class="lt-icon lt-icon-package"></span>`;
// The whole library is not a vault at all — it is everything on this machine, so it wears the machine rather than a box.
const COMPUTER_ICON_SVG = `<span class="lt-icon lt-icon-computer"></span>`;
// And the plain folder, for the things that really are folders.
const FOLDER_ICON_SVG = `<span class="lt-icon lt-icon-folder"></span>`;
// The tick on the switcher's active row, and the mark on New vault…. Inline like the folder glyph so both take the row's color from currentColor, and so every row carries one and the labels line up.
const MENU_CHECK_SVG = '<span class="lt-icon crumb-menu-check lt-icon-check"></span>';
const MENU_PLUS_SVG = '<span class="lt-icon library-action-icon lt-icon-new"></span>';
// The button on a vault row that opens everything you can do to it — the same sliders the app's own Settings wears, because that panel is this vault's settings. Visible on the row, not behind a right-click: a menu you have to guess at is a menu nobody finds.
const MENU_SETTINGS_SVG = `<span class="lt-icon lt-icon-settings"></span>`;
const MENU_TRASH_SVG = '<span class="lt-icon library-action-icon lt-icon-trash"></span>';
const BACK_ARROW_SVG = '<span class="lt-icon library-action-icon lt-icon-back"></span>';
// Vaults. A vault is a folder the app treats as a library root; nothing is written into it, the app just remembers the choice. The host owns the list and seeds it before the first paint. Rows are keyed on id, never on name.
const LEAF_VAULTS = (window.__leafVaults && typeof window.__leafVaults === 'object') ? window.__leafVaults : {};
leafVaults = Array.isArray(LEAF_VAULTS.vaults) ? LEAF_VAULTS.vaults : [];
activeVaultId = Number.isFinite(LEAF_VAULTS.active) ? LEAF_VAULTS.active : 0;
function activeVault() {
  if (!activeVaultId) return null;
  return leafVaults.find((vault) => vault && vault.id === activeVaultId) || null;
}
// What the leftmost crumb reads: the vault's name, the name the host gave the root, or the whole library's label. A vault wins because on the desktop the root is the vault you are standing in.
function libraryRootLabel() {
  const vault = activeVault();
  return (vault && vault.name) || libraryRootName || 'Library';
}
// The folder the pane is inside ('' is the root); the breadcrumb is this path.
libraryProjectPath = typeof LEAF_SETTINGS.libraryProjectPath === 'string' ? LEAF_SETTINGS.libraryProjectPath : '';
const SNAP_SHUT = 40;           // drag narrower than this and the pane closes
const DEFAULT_PANE_WIDTH = 240; // first-run fallback only
const MIN_READER_WIDTH = 360;   // keep the document column usable as the pane grows
// The pane shows one folder at a time, read off the disk by the host. These are that folder: where it is, the trail down to it, and what is in it. There is no tree here and no index behind it — nothing is known about a folder until it is opened. Full-text search over the library. A non-empty query replaces the tree with ranked results; clearing it restores the tree. The backend echoes the query so a slow response for an old one is dropped.
const SEARCH_DEBOUNCE_MS = 150;
// A heading anchor to scroll to once a clicked result's document has rendered. The padlocks: whether documents open ready to type into. Saved settings, not a question asked again on every file you open. One per editable view, because typing in the page and typing in the source are two different risks and unlocking one is not consent to the other. Both locked by default.
readingUnlocked = LEAF_SETTINGS.readingUnlocked === true;
codeUnlocked = LEAF_SETTINGS.codeUnlocked === true;
function readerEditingAllowed() {
  return readingUnlocked;
}
// Set by the two gestures that mean "leave the map": a search hit, whose whole point is landing on the matching line, and the jump to the source view. Everything else that opens a file -- the pane, a tab, a link, a node on the map -- keeps the view you are in, so changing document does not change how you read.
