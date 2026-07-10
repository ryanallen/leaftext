const app = document.getElementById('app');
const tabBar = document.getElementById('tabBar');
const homeButton = document.getElementById('homeButton');
const backButton = document.getElementById('backButton');
const forwardButton = document.getElementById('forwardButton');
const themeModeControl = document.getElementById('themeMode');
const minimapEnabledControl = document.getElementById('minimapEnabled');
const graphScopeControl = document.getElementById('graphScope');
const pagerEnabledControl = document.getElementById('pagerEnabled');
const speedReaderEnabledControl = document.getElementById('speedReaderEnabled');
const indexingEnabledControl = document.getElementById('indexingEnabled');
const libraryShell = document.getElementById('libraryShell');
const libraryPane = document.getElementById('libraryPane');
const libraryDivider = document.getElementById('libraryDivider');
const libraryOpen = document.getElementById('libraryOpen');
const libraryTree = document.getElementById('libraryTree');
const libraryGraph = document.getElementById('libraryGraph');
const libraryGraphCanvas = document.getElementById('libraryGraphCanvas');
const libraryGraphStatus = document.getElementById('libraryGraphStatus');
const libraryViewToggle = document.getElementById('libraryViewToggle');
const libraryViewLabel = document.getElementById('libraryViewLabel');
const libraryViewSelect = document.getElementById('libraryViewSelect');
const libraryViewMenu = document.getElementById('libraryViewMenu');
const librarySearch = document.getElementById('librarySearch');
const librarySearchScope = document.getElementById('librarySearchScope');
const librarySearchScopeLabel = document.getElementById('librarySearchScopeLabel');
const librarySearchResults = document.getElementById('librarySearchResults');
const libraryScanProgress = document.getElementById('libraryScanProgress');
const settingsMenu = document.getElementById('settingsMenu');
let tabDrag = null;
let suppressTabClick = false;
tabBar.addEventListener('wheel', (event) => {
  if (event.deltaY === 0) return;
  if (tabBar.scrollWidth <= tabBar.clientWidth) return;
  event.preventDefault();
  tabBar.scrollLeft += event.deltaY;
}, { passive: false });
// Manual pointer-based tab reordering. WebView2 does not fire HTML5 drag
// events reliably for in-page elements, so we drive the drag ourselves and
// send a moveTab command on drop, computing the insertion slot from the
// pointer position relative to the other tabs' centers.
function tabDropIndex(clientX) {
  const before = tabDrag.others.findIndex((entry) => clientX < entry.mid);
  return before === -1 ? tabDrag.others.length : before;
}
function updateTabSlides() {
  const from = tabDrag.filteredFrom;
  const to = tabDrag.to;
  tabDrag.others.forEach((t, i) => {
    let shift = 0;
    if (from < to && i >= from && i < to) shift = -tabDrag.draggedWidth;
    else if (from > to && i >= to && i < from) shift = tabDrag.draggedWidth;
    t.el.style.transform = shift !== 0 ? 'translateX(' + shift + 'px)' : '';
  });
}
function autoScrollTabBar(clientX) {
  const rect = tabBar.getBoundingClientRect();
  const zone = 48;
  if (clientX < rect.left + zone) {
    tabBar.scrollLeft -= Math.ceil((1 - (clientX - rect.left) / zone) * 8);
  } else if (clientX > rect.right - zone) {
    tabBar.scrollLeft += Math.ceil((1 - (rect.right - clientX) / zone) * 8);
  }
}
document.addEventListener('pointermove', (event) => {
  if (!tabDrag) return;
  if (!tabDrag.moved) {
    if (Math.abs(event.clientX - tabDrag.startX) < 4) return;
    tabDrag.moved = true;
    tabDrag.el.classList.add('tab-dragging');
    try { tabDrag.el.setPointerCapture(tabDrag.pointerId); } catch (_) {}
  }
  tabDrag.el.style.transform = 'translateX(' + (event.clientX - tabDrag.startX) + 'px)';
  tabDrag.to = tabDropIndex(event.clientX);
  updateTabSlides();
  autoScrollTabBar(event.clientX);
});
function endTabDrag(commit) {
  if (!tabDrag) return;
  const drag = tabDrag;
  tabDrag = null;
  const committing = drag.moved && commit && drag.to !== drag.filteredFrom;
  if (committing) {
    // Settle the tab into its new slot immediately. The moveTab round-trip
    // re-renders the tab bar a frame or two later; without this the dragged
    // tab would first snap back to where it started and then jump to the new
    // spot once the re-render lands. Reorder the DOM ourselves with all tab
    // transitions suppressed so the slid layout from the drag cuts straight to
    // the final order with no animation, matching what the re-render produces.
    const reference = drag.others[drag.to] ? drag.others[drag.to].el : null;
    tabBar.classList.add('tabs-settling');
    drag.el.style.transform = '';
    drag.el.classList.remove('tab-dragging');
    drag.others.forEach((t) => { t.el.style.transform = ''; });
    tabBar.insertBefore(drag.el, reference);
    void tabBar.offsetWidth; // flush layout so the cut applies before transitions return
    tabBar.classList.remove('tabs-settling');
  } else {
    // No move: let the tab glide back to its resting place instead of snapping.
    drag.el.classList.remove('tab-dragging');
    drag.el.style.transform = '';
    drag.others.forEach((t) => { t.el.style.transform = ''; });
  }
  if (drag.moved) {
    suppressTabClick = true;
    setTimeout(() => { suppressTabClick = false; }, 0);
    if (committing) {
      send({ command: 'moveTab', from: drag.index, to: drag.to });
    }
  }
}
document.addEventListener('pointerup', () => endTabDrag(true));
document.addEventListener('pointercancel', () => endTabDrag(false));
const send = (message) => window.ipc.postMessage(JSON.stringify(message));
const MERMAID_SCRIPT_URL = '{{MERMAID_SCRIPT_URL}}';
const KATEX_SCRIPT_URL = '{{KATEX_SCRIPT_URL}}';
const PIXI_SCRIPT_URL = '{{PIXI_SCRIPT_URL}}';
const PIXI_UNSAFE_EVAL_SCRIPT_URL = '{{PIXI_UNSAFE_EVAL_SCRIPT_URL}}';
const D3_FORCE_SCRIPT_URL = '{{D3_FORCE_SCRIPT_URL}}';
let mermaidLoadPromise = null;
let katexLoadPromise = null;
document.getElementById('openButton').addEventListener('click', () => send({ command: 'open' }));
homeButton.addEventListener('click', () => send({ command: 'goHome' }));
// Right-click menu for library file rows. Every item acts on the row's path.
// Layout groups: open, clipboard (cut/copy/copy path), rename, locate
// (reveal/properties), and the destructive delete last, set off by separators.
const contextMenu = document.createElement('div');
contextMenu.className = 'context-menu';
contextMenu.hidden = true;
contextMenu.setAttribute('role', 'menu');
document.body.appendChild(contextMenu);
let contextMenuPath = null;
const isMacPlatform = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const CONTEXT_MENU_ITEMS = [
  { action: 'open', labelKey: 'actions.open' },
  'separator',
  { action: 'cut', labelKey: 'actions.cut' },
  { action: 'copy', labelKey: 'actions.copy' },
  { action: 'copyPath', labelKey: 'actions.copyPath' },
  'separator',
  { action: 'rename', labelKey: 'actions.rename' },
  'separator',
  { action: 'reveal', labelKey: 'actions.revealFile' },
  { action: 'properties', labelKey: isMacPlatform ? 'actions.getInfo' : 'actions.properties' },
  'separator',
  { action: 'delete', labelKey: 'actions.delete', danger: true },
];
function hideContextMenu() {
  if (contextMenu.hidden) {
    return;
  }
  contextMenu.hidden = true;
  contextMenuPath = null;
}
function runContextAction(action, path) {
  switch (action) {
    case 'open': send({ command: 'openRecent', path }); break;
    case 'cut': send({ command: 'copyFile', path, cut: true }); break;
    case 'copy': send({ command: 'copyFile', path, cut: false }); break;
    case 'copyPath': send({ command: 'copyPath', path }); break;
    case 'reveal': send({ command: 'revealFile', path }); break;
    case 'properties': send({ command: 'showProperties', path }); break;
    case 'delete': send({ command: 'deleteFile', path }); break;
    case 'rename': openRenameBox(path); break;
  }
}
function buildContextMenu() {
  contextMenu.textContent = '';
  for (const entry of CONTEXT_MENU_ITEMS) {
    if (entry === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      sep.setAttribute('role', 'separator');
      contextMenu.appendChild(sep);
      continue;
    }
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'context-menu-item' + (entry.danger ? ' is-danger' : '');
    item.setAttribute('role', 'menuitem');
    item.textContent = window.leafLocale.t(entry.labelKey);
    item.addEventListener('click', () => {
      const path = contextMenuPath;
      hideContextMenu();
      if (path) {
        runContextAction(entry.action, path);
      }
    });
    contextMenu.appendChild(item);
  }
}
function showContextMenu(x, y, path) {
  if (!path) {
    return;
  }
  contextMenuPath = path;
  buildContextMenu();
  contextMenu.hidden = false;
  const left = Math.max(8, Math.min(x, window.innerWidth - contextMenu.offsetWidth - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - contextMenu.offsetHeight - 8));
  contextMenu.style.left = left + 'px';
  contextMenu.style.top = top + 'px';
  const first = contextMenu.querySelector('.context-menu-item');
  if (first) {
    first.focus();
  }
}
document.addEventListener('contextmenu', (event) => {
  const target = event.target.closest('[data-reveal-path]');
  if (target) {
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, target.getAttribute('data-reveal-path'));
  } else {
    hideContextMenu();
  }
});
// On macOS a Control+click is a secondary click, but unlike a two-finger
// trackpad click it also emits a trailing left-click (with ctrlKey still set)
// once the button is released. That trailing click would otherwise reach the
// dismiss handler below and close the menu the instant it appeared, or activate
// whichever item sat under the cursor. Swallow it in the capture phase so the
// menu stays put. Real follow-up clicks to pick an item are not Control-held.
document.addEventListener('click', (event) => {
  if (isMacPlatform && event.ctrlKey && !contextMenu.hidden) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);
window.addEventListener('click', hideContextMenu);
window.addEventListener('blur', hideContextMenu);
window.addEventListener('resize', hideContextMenu);
app.addEventListener('scroll', hideContextMenu, true);

// Inline rename: a small floating input prefilled with the file name. It lives
// outside the tree DOM so a live tree refresh cannot clobber it mid-edit. Enter
// commits; Escape or losing focus cancels.
const renameBox = document.createElement('div');
renameBox.className = 'rename-box';
renameBox.hidden = true;
const renameInput = document.createElement('input');
renameInput.type = 'text';
renameInput.className = 'rename-input';
renameInput.spellcheck = false;
renameInput.setAttribute('autocomplete', 'off');
renameInput.setAttribute('aria-label', 'Rename file');
renameBox.appendChild(renameInput);
document.body.appendChild(renameBox);
let renamePath = null;
let renameSettled = false;
function fileBaseName(path) {
  const parts = (path || '').split(/[\\/]/);
  return parts[parts.length - 1] || path || '';
}
function hideRenameBox() {
  if (renameBox.hidden) {
    return;
  }
  renameBox.hidden = true;
  renamePath = null;
}
function commitRename() {
  if (renameSettled || !renamePath) {
    return;
  }
  const path = renamePath;
  const newName = renameInput.value.trim();
  const current = fileBaseName(path);
  renameSettled = true;
  hideRenameBox();
  if (newName && newName !== current) {
    send({ command: 'renameFile', path, newName });
  }
}
function openRenameBox(path) {
  renamePath = path;
  renameSettled = false;
  const name = fileBaseName(path);
  renameInput.value = name;
  renameBox.hidden = false;
  // Anchor over the row if it is on screen, otherwise near the top of the pane.
  let row = null;
  libraryTree.querySelectorAll('[data-reveal-path]').forEach((el) => {
    if (el.getAttribute('data-reveal-path') === path) row = el;
  });
  const rect = row ? row.getBoundingClientRect() : null;
  const left = rect ? rect.left : 16;
  const top = rect ? rect.top : 80;
  renameBox.style.left = Math.max(8, Math.min(left, window.innerWidth - 248)) + 'px';
  renameBox.style.top = Math.max(8, Math.min(top, window.innerHeight - 48)) + 'px';
  renameInput.focus();
  // Preselect the name without its extension for a quick edit.
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    renameInput.setSelectionRange(0, dot);
  } else {
    renameInput.select();
  }
}
renameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitRename();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    renameSettled = true;
    hideRenameBox();
  }
});
renameInput.addEventListener('blur', () => {
  commitRename();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideContextMenu();
  }
});
// The reader's place as a document-intrinsic anchor (heading + block + fraction)
// rather than a pixel offset, so it survives the full re-render a tab switch or
// history navigation performs. Falls back to the top when there is no document.
function currentScrollAnchor() {
  return captureReaderScrollAnchor() || { section: null, block: 0, offsetY: 0 };
}
function sendNavigationCommand(command) {
  send({ command, scroll_anchor: currentScrollAnchor() });
}
backButton.addEventListener('click', () => sendNavigationCommand('goBack'));
forwardButton.addEventListener('click', () => sendNavigationCommand('goForward'));
function isEditableMouseTarget(target) {
  const element = target instanceof Element ? target : target?.parentElement;
  return Boolean(element?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'));
}
function navigationCommandForMouseButton(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isEditableMouseTarget(event.target)) {
    return null;
  }
  if (event.button === 3) {
    return 'goBack';
  }
  if (event.button === 4) {
    return 'goForward';
  }
  return null;
}
window.addEventListener('mousedown', (event) => {
  const command = navigationCommandForMouseButton(event);
  if (!command) {
    return;
  }
  event.preventDefault();
  sendNavigationCommand(command);
});
settingsMenu.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    settingsMenu.open = false;
    settingsMenu.querySelector('summary').focus();
  }
});
document.addEventListener('click', (event) => {
  if (settingsMenu.open && !settingsMenu.contains(event.target)) {
    settingsMenu.open = false;
  }
});
let currentState = { recent: [], tabs: [], active: null, document: null };
let navigationState = { canGoBack: false, canGoForward: false };
// Subtext under the home-screen hero: the original invitation plus a handful of
// palm-leaf manuscript facts (leaves as the original pages of knowledge). One is
// chosen at random each time the home screen is shown, and the chosen key is
// kept so a language switch re-translates the same fact rather than re-rolling.
const EMPTY_DESCRIPTION_KEYS = [
  'empty.description',
  'empty.description.incised',
  'empty.description.stylus',
  'empty.description.bound',
  'empty.description.lifespan',
  'empty.description.roundLetters',
  'empty.description.lontar',
  'empty.description.coldDry',
  'empty.description.bali',
  'empty.description.printing',
];
function pickEmptyDescriptionKey() {
  return EMPTY_DESCRIPTION_KEYS[Math.floor(Math.random() * EMPTY_DESCRIPTION_KEYS.length)];
}
let emptyDescriptionKey = pickEmptyDescriptionKey();
// UI toggles (theme, minimap, indexing, library view) are persisted by the Rust
// host, which injects them as window.__leafSettings before any page script runs
// (see initial_settings_script). The app shell's opaque origin makes localStorage
// non-durable across launches, so the host owns these values: we seed from them
// synchronously here — no post-load re-apply, no flash — and report every change
// back so it can save them.
const LEAF_SETTINGS = (window.__leafSettings && typeof window.__leafSettings === 'object') ? window.__leafSettings : {};
let minimapEnabled = typeof LEAF_SETTINGS.minimapEnabled === 'boolean' ? LEAF_SETTINGS.minimapEnabled : true;
const minimapListeners = new Set();
window.leafMinimap = {
  getEnabled: () => minimapEnabled,
  setEnabled(nextEnabled) {
    minimapEnabled = Boolean(nextEnabled);
    document.documentElement.dataset.minimapEnabled = String(minimapEnabled);
    minimapListeners.forEach((listener) => listener(minimapEnabled));
  },
  subscribe(listener) {
    minimapListeners.add(listener);
    listener(minimapEnabled);
    return () => minimapListeners.delete(listener);
  },
};
window.leafMinimap.setEnabled(minimapEnabled);
minimapEnabledControl.checked = window.leafMinimap.getEnabled();
minimapEnabledControl.addEventListener('change', () => {
  window.leafMinimap.setEnabled(minimapEnabledControl.checked);
  send({ command: 'setMinimapEnabled', enabled: minimapEnabledControl.checked });
});
// Previous/Next pager visibility. The pager markup is emitted into every
// document by the host; a single data-attribute on <html> shows or hides it via
// CSS, so toggling never needs a re-render. On by default.
let pagerEnabled = typeof LEAF_SETTINGS.pagerEnabled === 'boolean' ? LEAF_SETTINGS.pagerEnabled : true;
function applyPagerEnabled() {
  document.documentElement.dataset.pagerEnabled = String(pagerEnabled);
}
applyPagerEnabled();
pagerEnabledControl.checked = pagerEnabled;
pagerEnabledControl.addEventListener('change', () => {
  pagerEnabled = pagerEnabledControl.checked;
  applyPagerEnabled();
  send({ command: 'setPagerEnabled', enabled: pagerEnabled });
});
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
// A token is part of a code-like run — and so should not get a lead anchor —
// only when a digit is fused to it (page2, COVID19) or a joiner punctuation
// glues it to another word character on the joiner's far side (file.md, a@b,
// x=y, v1.2). A joiner against whitespace, the end of the text, or sentence
// punctuation (a trailing period, comma, colon, …) is ordinary prose, so words
// ending a sentence still get anchored.
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
speedReaderEnabledControl.checked = speedReaderEnabled;
speedReaderEnabledControl.addEventListener('change', () => {
  setSpeedReaderEnabled(speedReaderEnabledControl.checked);
  send({ command: 'setSpeedReaderEnabled', enabled: speedReaderEnabled });
});
// Library pane: a drill-in Project view, an expandable Tree view, and a flat
// All-files view. The host persists the chosen view, the Tree's open folders,
// and the Project view's current folder; the frontend reports each change and
// applies host values on boot. The "Index entire device" setting lives here too.
const LIBRARY_VIEWS = ['project', 'tree', 'flat', 'graph'];
const VIEW_LABEL_KEY = { project: 'library.view.project', tree: 'library.view.tree', flat: 'library.view.all', graph: 'library.view.graph' };
// Markdown files are badged with the app's own leaf mark; the host substitutes
// the data URI into this string the same way it does in the header <img>.
const LEAF_FILE_ICON = "{{BRAND_LOGO}}";
let indexingEnabled = LEAF_SETTINGS.indexingEnabled === true;
let libraryView = LIBRARY_VIEWS.includes(LEAF_SETTINGS.libraryView) ? LEAF_SETTINGS.libraryView : 'graph';
const GRAPH_SCOPES = ['small', 'medium', 'large', 'xl'];
let graphScope = GRAPH_SCOPES.includes(LEAF_SETTINGS.graphScope) ? LEAF_SETTINGS.graphScope : 'small';
// Graph size: persist the choice and, if the graph is on screen, rebuild it for
// the new scope right away.
graphScopeControl.value = graphScope;
graphScopeControl.addEventListener('change', () => {
  graphScope = GRAPH_SCOPES.includes(graphScopeControl.value) ? graphScopeControl.value : 'small';
  send({ command: 'setGraphScope', scope: graphScope });
  if (libraryView === 'graph') requestGraphData();
});
let libraryProjectPath = typeof LEAF_SETTINGS.libraryProjectPath === 'string' ? LEAF_SETTINGS.libraryProjectPath : '';
let expandedFolders = new Set(Array.isArray(LEAF_SETTINGS.libraryExpanded) ? LEAF_SETTINGS.libraryExpanded : []);
// Library pane open/close + resize. The user's explicit closed preference and last
// open width are host-persisted (window.__leafSettings + setLibraryLayout), the
// same path as the other settings — the app shell's opaque origin makes
// localStorage non-durable, so the host owns these too.
const SNAP_SHUT = 40;           // drag narrower than this and the pane closes
const DEFAULT_PANE_WIDTH = 240; // first-run fallback only
const MIN_READER_WIDTH = 360;   // keep the document column usable as the pane grows
let libraryUserClosed = LEAF_SETTINGS.libraryClosed === true;
let libraryWidth = Number.isFinite(LEAF_SETTINGS.libraryWidth) && LEAF_SETTINGS.libraryWidth > 0
  ? LEAF_SETTINGS.libraryWidth
  : DEFAULT_PANE_WIDTH;
let libraryTreeData = [];
let libraryError = null;
let lastScanProgress = { phase: 'idle', filesFound: 0 };
// Full-text search over the library. A non-empty query replaces the tree with
// ranked results; clearing it restores the tree (and any active view). The query
// is echoed by the backend so a slow response for an old query is dropped.
const SEARCH_DEBOUNCE_MS = 150;
let librarySearchQuery = '';
let librarySearchTimer = 0;
let librarySearchHits = null;
let librarySearchError = null;
let librarySearchLoading = false;
// Focus search: when on, restrict results to the files currently shown in the
// library pane (the graph's nodes, or the listed files). Off = whole library.
let librarySearchFocus = false;
// A visible set larger than this is not a meaningful "focus", and a huge IN
// clause is not worth it, so we fall back to searching everything.
const SEARCH_SCOPE_CAP = 1500;
// A heading anchor to scroll to once a clicked result's document has rendered.
let pendingSearchJump = null;
indexingEnabledControl.checked = indexingEnabled;
indexingEnabledControl.addEventListener('change', () => {
  indexingEnabled = indexingEnabledControl.checked;
  send({ command: 'setIndexingEnabled', enabled: indexingEnabled });
});
function persistLibraryState() {
  send({
    command: 'setLibraryState',
    view: libraryView,
    expanded: Array.from(expandedFolders),
    projectPath: libraryProjectPath,
  });
}
function persistLibraryLayout() {
  send({ command: 'setLibraryLayout', closed: libraryUserClosed, width: Math.round(libraryWidth) });
}
// The widest the open pane may get while still leaving the reader usable. Floored
// at SNAP_SHUT so an explicit open always shows a real pane even on a small window.
function maxOpenPaneWidth() {
  return Math.max(SNAP_SHUT, libraryShell.clientWidth - MIN_READER_WIDTH);
}
function clampOpenPaneWidth(width) {
  return Math.min(Math.max(width, SNAP_SHUT), maxOpenPaneWidth());
}
// A window too narrow to hold both a usable reader and the pane shows the pane
// closed regardless of preference — a small-window desktop fallback, not a saved
// state. The user's explicit closed preference still wins when there IS room.
function libraryTooNarrow() {
  return libraryShell.clientWidth < SNAP_SHUT + MIN_READER_WIDTH;
}
function libraryIsClosed() {
  return libraryUserClosed || libraryTooNarrow();
}
function applyPaneLayout() {
  const closed = libraryIsClosed();
  libraryShell.classList.toggle('library-closed', closed);
  if (!closed) {
    libraryShell.style.setProperty('--library-width', clampOpenPaneWidth(libraryWidth) + 'px');
  }
}
function openLibrary() {
  libraryUserClosed = false;
  // Tapping the icon always reopens at the default width, not whatever sliver
  // the pane was dragged down to before it snapped shut.
  libraryWidth = DEFAULT_PANE_WIDTH;
  applyPaneLayout();
  persistLibraryLayout();
}
libraryOpen.addEventListener('click', openLibrary);
// Drag-to-resize the pane from its right edge. We rAF-throttle the width writes:
// the first pointermove of a frame stashes the target width and schedules a frame;
// later moves just overwrite the target until the frame applies it. This keeps the
// grid from relaying out on every pointer event.
let dividerDrag = null;
function applyPendingDividerWidth() {
  if (!dividerDrag) return;
  dividerDrag.frame = 0;
  if (dividerDrag.pendingWidth != null) {
    libraryWidth = dividerDrag.pendingWidth;
    libraryShell.style.setProperty('--library-width', libraryWidth + 'px');
  }
}
function endDividerDrag() {
  if (!dividerDrag) return;
  if (dividerDrag.frame) cancelAnimationFrame(dividerDrag.frame);
  try { libraryDivider.releasePointerCapture(dividerDrag.pointerId); } catch (_) {}
  dividerDrag = null;
  document.body.classList.remove('library-resizing');
}
libraryDivider.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || libraryIsClosed()) return;
  event.preventDefault();
  dividerDrag = { pointerId: event.pointerId, frame: 0, pendingWidth: null };
  try { libraryDivider.setPointerCapture(event.pointerId); } catch (_) {}
  document.body.classList.add('library-resizing');
});
document.addEventListener('pointermove', (event) => {
  if (!dividerDrag || event.pointerId !== dividerDrag.pointerId) return;
  // Pane width is the distance from the shell's left edge to the pointer.
  const raw = event.clientX - libraryShell.getBoundingClientRect().left;
  if (raw < SNAP_SHUT) {
    // Below the threshold: snap shut and stop tracking this drag.
    endDividerDrag();
    libraryUserClosed = true;
    applyPaneLayout();
    persistLibraryLayout();
    return;
  }
  dividerDrag.pendingWidth = clampOpenPaneWidth(raw);
  if (!dividerDrag.frame) dividerDrag.frame = requestAnimationFrame(applyPendingDividerWidth);
});
document.addEventListener('pointerup', (event) => {
  if (!dividerDrag || event.pointerId !== dividerDrag.pointerId) return;
  endDividerDrag();
  persistLibraryLayout();
});
document.addEventListener('pointercancel', (event) => {
  if (!dividerDrag || event.pointerId !== dividerDrag.pointerId) return;
  endDividerDrag();
  persistLibraryLayout();
});
// On window resize, re-clamp the open width to the new window and re-evaluate the
// too-narrow fallback so the pane hides/shows as the window crosses the threshold.
// The auto-hide is a display state only; we never overwrite the saved preference,
// so widening the window again restores the pane the user wanted open.
let paneResizeFrame = 0;
window.addEventListener('resize', () => {
  if (paneResizeFrame) return;
  paneResizeFrame = requestAnimationFrame(() => {
    paneResizeFrame = 0;
    if (!libraryIsClosed()) libraryWidth = clampOpenPaneWidth(libraryWidth);
    applyPaneLayout();
  });
});
// The file the library highlights as "current" (the active tab's path), plus a
// one-shot request to reveal it on the next render: drill the Project view into
// its folder, expand its Tree ancestors, and scroll the row into view. The flag
// is only set when the user *goes to* a file (opens one, or switches/clicks a
// tab) — never on a passive re-render — so manual library browsing while a file
// is open is left where the user put it until they click that file's tab again.
let librarySelectedPath = null;
let libraryRevealPending = false;
function activeDocumentPath() {
  const tabs = (currentState && currentState.tabs) || [];
  const active = currentState && currentState.active;
  if (active == null || !tabs[active]) return null;
  return tabs[active].path || null;
}
function requestDocumentPager(path) {
  const placeholder = app.querySelector('.document-body .docs-pager-loading');
  if (!placeholder || !path) return;
  send({ command: 'loadPager', path });
}
window.leafSetPager = (state) => {
  if (!state || state.path !== activeDocumentPath()) return;
  const body = app.querySelector('.document-body');
  const current = body ? body.querySelector('.docs-pager') : null;
  if (!current) return;
  if (!state.html) {
    current.remove();
    scheduleReaderLayoutUpdate();
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.innerHTML = state.html;
  const pager = wrapper.firstElementChild;
  if (!pager) {
    current.remove();
    scheduleReaderLayoutUpdate();
    return;
  }
  current.replaceWith(pager);
  bindDocumentLinks();
  scheduleReaderLayoutUpdate();
};
// The chain of folder paths from the tree root down to (and including) the
// folder that directly contains `filePath`. Returns null when no file with that
// path exists in the tree; an empty array means the file sits at the root.
function folderAncestorsOf(nodes, filePath) {
  const walk = (list, trail) => {
    for (const node of list || []) {
      if (node.kind === 'folder') {
        const found = walk(node.children, trail.concat(node.path));
        if (found) return found;
      } else if (node.path === filePath) {
        return trail;
      }
    }
    return null;
  };
  return walk(nodes, []);
}
function scrollSelectedLibraryRowIntoView() {
  const row = libraryTree.querySelector('.library-file.is-selected');
  // Centered so a deeply nested file lands away from the app bar and bottom edge.
  if (row) row.scrollIntoView({ block: 'center' });
}
// Carry out a pending reveal. Returns false (still pending) until the tree is
// loaded, so leafSetLibraryState can retry once it arrives. When the tree is
// present we always render; if the file is found we first point the Project view
// at its folder and open its Tree ancestors so the row shows in every view.
function revealSelectedInLibrary() {
  if (!libraryRevealPending || !librarySelectedPath) return false;
  const nodes = libraryTreeData || [];
  if (!nodes.length) return false;
  libraryRevealPending = false;
  const ancestors = folderAncestorsOf(nodes, librarySelectedPath);
  if (ancestors) {
    libraryProjectPath = ancestors.length ? ancestors[ancestors.length - 1] : '';
    for (const folder of ancestors) expandedFolders.add(folder);
    persistLibraryState();
  }
  renderLibrary();
  if (ancestors) scrollSelectedLibraryRowIntoView();
  return true;
}
// Mark `path` as the library's current file and ask the next render to reveal
// it. Passing null (the home screen, no active file) just clears the highlight;
// the Project/Tree position is left exactly as the user last had it.
function followFileInLibrary(path, focus, forceRefresh) {
  librarySelectedPath = path || null;
  libraryRevealPending = !!path;
  // In graph mode there are no rows to reveal; move the highlight to the node for
  // the newly active document. When the move came from a deliberate navigation
  // (clicking/switching a tab), also fly the camera to that node and zoom in;
  // `forceRefresh` additionally rebuilds the slice so it can't stay stale.
  if (libraryView === 'graph') {
    graphSetActive(librarySelectedPath, focus, forceRefresh);
    return;
  }
  if (libraryRevealPending) {
    if (!revealSelectedInLibrary()) renderLibrary();
  } else {
    renderLibrary();
  }
}
// The view picker is a dropdown listbox: the button shows the active view and a
// caret; clicking opens a menu of the three views, and choosing one switches.
function closeLibraryViewMenu() {
  libraryViewMenu.hidden = true;
  libraryViewToggle.setAttribute('aria-expanded', 'false');
}
function openLibraryViewMenu() {
  libraryViewMenu.hidden = false;
  libraryViewToggle.setAttribute('aria-expanded', 'true');
}
function renderLibraryViewMenu() {
  libraryViewMenu.innerHTML = LIBRARY_VIEWS.map((view) => {
    const selected = view === libraryView;
    return `<li role="option" class="library-view-option" data-view="${view}" aria-selected="${selected}">${escapeText(window.leafLocale.t(VIEW_LABEL_KEY[view]))}</li>`;
  }).join('');
}
libraryViewToggle.addEventListener('click', () => {
  if (libraryViewMenu.hidden) {
    renderLibraryViewMenu();
    openLibraryViewMenu();
  } else {
    closeLibraryViewMenu();
  }
});
libraryViewMenu.addEventListener('click', (event) => {
  const option = event.target.closest('[data-view]');
  if (!option) return;
  libraryView = option.dataset.view;
  closeLibraryViewMenu();
  persistLibraryState();
  renderLibrary();
  // A Focus search is scoped to the files the view shows, so switching views
  // changes the scope — re-run the active query against the new set.
  if (librarySearchFocus && librarySearchQuery) runLibrarySearch(librarySearch.value);
});
document.addEventListener('click', (event) => {
  if (!libraryViewMenu.hidden && !libraryViewSelect.contains(event.target)) {
    closeLibraryViewMenu();
  }
});
function applyScanProgress(progress) {
  lastScanProgress = progress || { phase: 'idle', filesFound: 0 };
  if (lastScanProgress.phase === 'scanning') {
    const count = window.leafLocale.formatNumber(lastScanProgress.filesFound || 0);
    libraryScanProgress.textContent = window.leafLocale.t('library.scanning') + ' ' + window.leafLocale.t('library.filesFound', { count });
    libraryScanProgress.hidden = false;
  } else {
    libraryScanProgress.hidden = true;
    libraryScanProgress.textContent = '';
  }
}
// A library row's display name: a file shows its file name (basename minus a
// .md-style extension), matching the tabs; a folder shows its folder name.
function fileDisplayName(node) {
  return stripMarkdownExt(node && node.name) || (node && (node.title || node.path)) || '';
}
function nodeSortKey(node) {
  const label = node && node.kind === 'folder' ? (node.name || '') : fileDisplayName(node);
  return label.toLowerCase();
}
// A Markdown file row: the leaf mark, then the file name, truncated.
function fileRowHtml(node) {
  const label = fileDisplayName(node);
  const isSelected = librarySelectedPath && node.path === librarySelectedPath;
  const selected = isSelected ? ' is-selected' : '';
  const current = isSelected ? ' aria-current="true"' : '';
  return `<button type="button" class="library-file${selected}"${current} data-open-path="${escapeAttr(node.path)}" data-reveal-path="${escapeAttr(node.path)}" title="${escapeAttr(node.path)}"><img class="library-file-icon" src="${LEAF_FILE_ICON}" alt="" aria-hidden="true"><span class="library-file-label">${escapeText(label)}</span></button>`;
}
function renderTreeNode(node) {
  if (node && node.kind === 'folder') {
    const open = expandedFolders.has(node.path) ? ' open' : '';
    return `<details class="library-folder" data-folder-path="${escapeAttr(node.path)}"${open}><summary>${escapeText(node.name)}</summary><div class="library-children">${renderTreeNodes(node.children || [])}</div></details>`;
  }
  return fileRowHtml(node);
}
function renderTreeNodes(nodes) {
  return (nodes || []).map(renderTreeNode).join('');
}
function collectLibraryFiles(nodes, out) {
  for (const node of nodes || []) {
    if (node.kind === 'file') {
      out.push(node);
    } else {
      collectLibraryFiles(node.children, out);
    }
  }
  return out;
}
function renderFlatList(nodes) {
  const files = collectLibraryFiles(nodes, []);
  files.sort((a, b) => {
    const ta = nodeSortKey(a);
    const tb = nodeSortKey(b);
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return (a.path || '').localeCompare(b.path || '');
  });
  return `<div class="library-flat">${files.map(fileRowHtml).join('')}</div>`;
}
// Project (drill-in) view helpers. Folders are entered one level at a time; the
// current folder is located in the tree by its full path.
function findFolderByPath(nodes, path) {
  for (const node of nodes || []) {
    if (node.kind !== 'folder') continue;
    if (node.path === path) return node;
    const found = findFolderByPath(node.children, path);
    if (found) return found;
  }
  return null;
}
function findParentPath(nodes, path, parentPath) {
  for (const node of nodes || []) {
    if (node.kind !== 'folder') continue;
    if (node.path === path) return parentPath;
    const found = findParentPath(node.children, path, node.path);
    if (found !== null) return found;
  }
  return null;
}
function projectChildrenSorted(nodes) {
  const folders = [];
  const files = [];
  for (const node of nodes || []) {
    (node.kind === 'folder' ? folders : files).push(node);
  }
  const byName = (a, b) => nodeSortKey(a).localeCompare(nodeSortKey(b));
  folders.sort(byName);
  files.sort(byName);
  return folders.concat(files);
}
function renderProject(nodes) {
  let children = nodes;
  if (libraryProjectPath) {
    const current = findFolderByPath(nodes, libraryProjectPath);
    if (current) {
      children = current.children || [];
    } else {
      // The saved folder is gone (e.g. after a rescan); fall back to the root.
      libraryProjectPath = '';
    }
  }
  const rows = [];
  if (libraryProjectPath) {
    const current = findFolderByPath(nodes, libraryProjectPath);
    const parent = findParentPath(nodes, libraryProjectPath, '');
    const parentPath = parent === null ? '' : parent;
    const currentName = (current && current.name) || '';
    rows.push(`<button type="button" class="library-nav-up" data-nav-path="${escapeAttr(parentPath)}" title="${escapeAttr(window.leafLocale.t('library.up'))}"><span class="library-nav-arrow" aria-hidden="true">←</span><span class="library-file-label">${escapeText(currentName)}</span></button>`);
  }
  for (const node of projectChildrenSorted(children)) {
    if (node.kind === 'folder') {
      rows.push(`<button type="button" class="library-nav-folder" data-nav-into="${escapeAttr(node.path)}" title="${escapeAttr(node.name)}"><span class="library-file-label">${escapeText(node.name)}</span><span class="library-nav-chevron" aria-hidden="true">›</span></button>`);
    } else {
      rows.push(fileRowHtml(node));
    }
  }
  return `<div class="library-project">${rows.join('')}</div>`;
}
function bindLibraryRows() {
  libraryTree.querySelectorAll('[data-open-path]').forEach((button) => {
    button.addEventListener('click', () => send({ command: 'openRecent', path: button.dataset.openPath }));
  });
  libraryTree.querySelectorAll('[data-nav-into]').forEach((button) => {
    button.addEventListener('click', () => {
      libraryProjectPath = button.dataset.navInto;
      persistLibraryState();
      renderLibrary();
    });
  });
  libraryTree.querySelectorAll('[data-nav-path]').forEach((button) => {
    button.addEventListener('click', () => {
      libraryProjectPath = button.dataset.navPath;
      persistLibraryState();
      renderLibrary();
    });
  });
  libraryTree.querySelectorAll('details[data-folder-path]').forEach((details) => {
    details.addEventListener('toggle', () => {
      const path = details.dataset.folderPath;
      if (details.open) {
        expandedFolders.add(path);
      } else {
        expandedFolders.delete(path);
      }
      persistLibraryState();
    });
  });
}
function renderLibrary() {
  libraryViewLabel.textContent = window.leafLocale.t(VIEW_LABEL_KEY[libraryView]);
  if (!libraryViewMenu.hidden) renderLibraryViewMenu();
  // The graph view replaces the tree list with an interactive canvas. It owns the
  // whole pane body, so hide the list and let the graph module drive itself.
  if (libraryView === 'graph') {
    libraryTree.hidden = true;
    libraryGraph.hidden = false;
    showGraph();
    return;
  }
  libraryGraph.hidden = true;
  libraryTree.hidden = false;
  teardownGraph();
  if (libraryError) {
    libraryTree.innerHTML = `<p class="library-empty">${escapeText(libraryError.message || '')}</p>`;
    return;
  }
  const nodes = libraryTreeData || [];
  if (!nodes.length) {
    libraryTree.innerHTML = `<p class="library-empty">${escapeText(window.leafLocale.t('library.empty'))}</p>`;
    return;
  }
  if (libraryView === 'flat') {
    libraryTree.innerHTML = renderFlatList(nodes);
  } else if (libraryView === 'tree') {
    libraryTree.innerHTML = renderTreeNodes(nodes);
  } else {
    libraryTree.innerHTML = renderProject(nodes);
  }
  bindLibraryRows();
}
window.leafSetLibraryState = (state) => {
  const next = state || {};
  if (next.error) {
    libraryError = next.error;
    renderLibrary();
    return;
  }
  libraryError = null;
  if (next.tree) {
    libraryTreeData = next.tree;
  }
  if (next.progress) {
    applyScanProgress(next.progress);
  }
  // The indexer just came online (or refreshed the tree). If the graph view is
  // open but has no data yet — e.g. the app launched straight into it before the
  // reader thread was ready and the first request was dropped — ask again.
  if (libraryView === 'graph' && !graphData) {
    graphRequested = false;
  }
  // A reveal queued before the tree loaded (e.g. launching straight into a file)
  // runs here once the nodes are in hand; revealSelectedInLibrary renders itself.
  if (libraryRevealPending && libraryView !== 'graph' && revealSelectedInLibrary()) return;
  renderLibrary();
};
window.leafSetScanProgress = (progress) => {
  applyScanProgress(progress);
};

// ---------------------------------------------------------------------------
// Graph view: an Obsidian-style force-directed map of how documents link to one
// another, rendered with PixiJS (WebGL) and laid out with d3-force. Nodes are
// documents; edges are resolved doc-to-doc links. The active document is the
// highlighted centre; clicking a node opens it; hovering lights up its links.
// ---------------------------------------------------------------------------
let graphData = null; // last {nodes, edges, truncated} payload from the backend
let graphRequested = false; // asked the backend since entering the graph view
let graphScene = null; // live Pixi/d3 scene while the view is open
let graphActivePath = null;
let graphLibsPromise = null;
let graphSeedKey = null; // scope+seeds of the last request, to skip redundant refetches
let graphFocusPending = false; // fly to the active node once the next scene finishes building
const GRAPH_NEIGHBOR_LABEL_CAP = 12;
// Focus scope on the start screen seeds from the recent files; cap how many so a
// long history does not balloon the neighborhood.
const GRAPH_RECENT_SEED_CAP = 50;
// When we fly the graph to a node (clicking its tab), settle at least this zoom
// so the node reads as focused; never zoom out from a closer view the user set.
const GRAPH_FOCUS_ZOOM = 2.2;
const GRAPH_FOCUS_DURATION_MS = 420;

function setGraphStatus(message) {
  if (!message) {
    libraryGraphStatus.hidden = true;
    libraryGraphStatus.textContent = '';
    return;
  }
  libraryGraphStatus.hidden = false;
  libraryGraphStatus.textContent = message;
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

// Load PixiJS and the d3-force bundle once, lazily, only when the graph opens.
function loadGraphLibs() {
  const ready = () => window.PIXI && window.d3 && typeof window.d3.forceSimulation === 'function';
  if (ready()) return Promise.resolve();
  if (graphLibsPromise) return graphLibsPromise;
  // Pixi must load before its unsafe-eval companion, which patches Pixi's shader
  // and uniform systems to avoid `new Function` (blocked by the CSP). d3-force
  // loads in parallel — it shares nothing with Pixi.
  const pixiChain = window.PIXI
    ? Promise.resolve()
    : loadScriptOnce(PIXI_SCRIPT_URL).then(() => loadScriptOnce(PIXI_UNSAFE_EVAL_SCRIPT_URL));
  graphLibsPromise = Promise.all([
    pixiChain,
    window.d3 && window.d3.forceSimulation ? Promise.resolve() : loadScriptOnce(D3_FORCE_SCRIPT_URL),
  ]).then(() => {
    if (!ready()) throw new Error('Graph runtimes loaded without exposing PIXI/d3');
  });
  return graphLibsPromise;
}

// Resolve a CSS custom property to a 0xRRGGBB number for Pixi tints.
function cssVarColor(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return parseCssColor(raw, fallback);
}
function parseCssColor(value, fallback) {
  if (!value) return fallback;
  if (value[0] === '#') {
    let hex = value.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    return Number.isNaN(n) ? fallback : n;
  }
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(',').map((x) => parseFloat(x));
    return ((parts[0] & 255) << 16) | ((parts[1] & 255) << 8) | (parts[2] & 255);
  }
  return fallback;
}

function graphNodeRadius(degree) {
  return Math.max(3, Math.min(14, 3 + Math.sqrt(degree || 0) * 1.1));
}

// The Focus scope seeds from the open document, or from the recent files when no
// document is open (the start screen). Other scopes ignore seeds.
function graphSeeds() {
  const active = activeDocumentPath();
  if (active) return [active];
  return ((currentState && currentState.recent) || []).slice(0, GRAPH_RECENT_SEED_CAP);
}

// Ask the backend for the graph slice for the current scope + seeds, resetting any
// existing scene so the view reads "loading" until fresh data arrives.
function requestGraphData() {
  const seeds = graphSeeds();
  graphSeedKey = graphScope + '|' + seeds.join('\n');
  graphRequested = true;
  graphData = null;
  teardownGraphScene();
  setGraphStatus(window.leafLocale.t('library.graph.loading'));
  send({ command: 'getGraph', scope: graphScope, seeds });
}

// Entry point when the graph view becomes visible. Requests fresh data the first
// time, then either builds the scene (data already in hand) or just moves the
// active-node highlight (scene already built).
function showGraph() {
  graphActivePath = activeDocumentPath();
  if (!graphRequested) {
    requestGraphData();
  }
  if (graphScene) {
    applyGraphStyles();
  } else if (graphData) {
    buildGraphScene();
  }
}

window.leafSetGraph = (payload) => {
  if (payload && payload.error) {
    graphData = null;
    if (libraryView === 'graph') {
      teardownGraphScene();
      setGraphStatus((payload.error && payload.error.message) || window.leafLocale.t('library.graph.error'));
    }
    return;
  }
  graphData = payload || { nodes: [], edges: [], truncated: false };
  if (libraryView === 'graph') buildGraphScene();
};

function teardownGraph() {
  graphRequested = false;
  teardownGraphScene();
}

function teardownGraphScene() {
  if (graphScene) {
    if (graphScene.focusRaf) { try { cancelAnimationFrame(graphScene.focusRaf); } catch (_) { /* noop */ } }
    if (graphScene.resizeObserver) { try { graphScene.resizeObserver.disconnect(); } catch (_) { /* noop */ } }
    try { graphScene.sim.stop(); } catch (_) { /* already gone */ }
    try { graphScene.app.destroy(true, { children: true, texture: true }); } catch (_) { /* already gone */ }
    graphScene = null;
  }
  libraryGraphCanvas.innerHTML = '';
}

async function buildGraphScene() {
  teardownGraphScene();
  const data = graphData;
  if (!data || !data.nodes || !data.nodes.length) {
    setGraphStatus(window.leafLocale.t('library.graph.empty'));
    return;
  }
  try {
    await loadGraphLibs();
  } catch (err) {
    console.error('Leaf graph runtimes failed to load', err);
    setGraphStatus((err && err.message) ? String(err.message) : window.leafLocale.t('library.graph.error'));
    return;
  }
  // The view may have changed while the runtimes loaded.
  if (libraryView !== 'graph') return;

  try {
  const width = libraryGraphCanvas.clientWidth || 300;
  const height = libraryGraphCanvas.clientHeight || 300;
  const app = new PIXI.Application();
  await app.init({
    resizeTo: libraryGraphCanvas,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    preference: 'webgl',
  });
  if (libraryView !== 'graph') {
    try { app.destroy(true, { children: true }); } catch (_) { /* noop */ }
    return;
  }
  // Pixi renders on demand (not every frame) to stay quiet once the layout settles.
  app.ticker.stop();
  libraryGraphCanvas.appendChild(app.canvas);
  setGraphStatus(data.truncated
    ? window.leafLocale.t('library.graph.truncated', { count: window.leafLocale.formatNumber(data.nodes.length) })
    : '');

  const colors = {
    node: cssVarColor('--app-muted-foreground', 0x8b95a5),
    active: cssVarColor('--accent', 0x8a63d2),
    hot: cssVarColor('--app-foreground', 0xe6e6e6),
    edge: cssVarColor('--app-border', 0x3a3f4b),
  };

  // Build node objects d3 will mutate with x/y, plus their Pixi graphics.
  const nodes = data.nodes.map((n) => ({ path: n.path, label: n.label || n.path, degree: n.degree || 0 }));
  const nodeByPath = new Map(nodes.map((n) => [n.path, n]));
  const links = (data.edges || [])
    .filter((e) => nodeByPath.has(e.source) && nodeByPath.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));

  const world = new PIXI.Container();
  world.position.set(width / 2, height / 2);
  app.stage.addChild(world);
  const edgesGfx = new PIXI.Graphics();
  world.addChild(edgesGfx);
  const nodesLayer = new PIXI.Container();
  world.addChild(nodesLayer);
  const labelsLayer = new PIXI.Container();
  world.addChild(labelsLayer);

  const scene = {
    app, world, edgesGfx, nodes, links, nodeByPath, colors, labelsLayer,
    hoverNode: null, draggingNode: null, panning: false, panLast: null, pressGlobal: null,
    lastWidth: width, lastHeight: height,
  };

  // Adjacency for hover highlighting.
  const neighbors = new Map(nodes.map((n) => [n.path, new Set()]));
  for (const link of links) {
    neighbors.get(link.source).add(link.target);
    neighbors.get(link.target).add(link.source);
  }
  scene.neighbors = neighbors;

  for (const node of nodes) {
    const gfx = new PIXI.Graphics();
    // Drawn white so a tint shows the true state colour; radius set once.
    gfx.circle(0, 0, graphNodeRadius(node.degree)).fill(0xffffff);
    gfx.eventMode = 'static';
    gfx.cursor = 'pointer';
    gfx.hitArea = new PIXI.Circle(0, 0, graphNodeRadius(node.degree) + 3);
    gfx.on('pointerover', () => {
      scene.hoverNode = node;
      // The same native tooltip the library rows, hits, and tabs use: the full
      // document path on the canvas element under the cursor.
      scene.app.canvas.title = node.path;
      applyGraphStyles();
    });
    gfx.on('pointerout', () => {
      if (scene.hoverNode === node) {
        scene.hoverNode = null;
        scene.app.canvas.title = '';
        applyGraphStyles();
      }
    });
    gfx.on('pointerdown', (event) => startNodeDrag(scene, node, event));
    node.gfx = gfx;
    node.labelText = null;
    nodesLayer.addChild(gfx);
  }

  // Scale the layout to the node count so the bigger scopes stay responsive.
  // Drawing every edge on every tick is the dominant cost, so on large graphs we
  // paint only every Nth tick (plus a final paint when the layout settles), settle
  // faster (higher alphaDecay), approximate charge more coarsely (higher theta),
  // and drop the per-node collide force once it stops being affordable.
  const nodeCount = nodes.length;
  const heavy = nodeCount > 1500;
  const veryHeavy = nodeCount > 4000;
  const sim = window.d3.forceSimulation(nodes)
    .velocityDecay(heavy ? 0.5 : 0.4)
    .alphaDecay(veryHeavy ? 0.06 : heavy ? 0.045 : 0.0228)
    .force('charge', window.d3.forceManyBody()
      .strength(-90)
      .distanceMax(heavy ? 300 : 400)
      .theta(heavy ? 1.2 : 0.9))
    .force('link', window.d3.forceLink(links).id((d) => d.path).distance(46).strength(0.6))
    .force('center', window.d3.forceCenter(0, 0));
  if (!veryHeavy) {
    sim.force('collide', window.d3.forceCollide().radius((d) => graphNodeRadius(d.degree) + 3));
  }
  const renderEvery = veryHeavy ? 6 : heavy ? 3 : 1;
  let tickCount = 0;
  sim.on('tick', () => {
    tickCount += 1;
    if (tickCount % renderEvery === 0) renderGraphFrame(scene);
  });
  sim.on('end', () => renderGraphFrame(scene));
  scene.sim = sim;

  wireGraphPointer(scene);
  wireGraphResize(scene);
  graphScene = scene;
  applyGraphStyles();
  renderGraphFrame(scene);
  // A rebuild triggered by a deliberate navigation (tab click/switch) flies to
  // the active node now that its graphics exist; d3 seeds positions before the
  // first tick, so focusGraphNode tracks it as the layout settles.
  if (graphFocusPending && graphActivePath) {
    graphFocusPending = false;
    const activeNode = scene.nodeByPath.get(graphActivePath);
    if (activeNode) focusGraphNode(scene, activeNode);
  }
  } catch (err) {
    // Surface the real failure (e.g. WebGL unavailable in this WebView) on the
    // status line instead of hanging on "Building graph…", and log a breadcrumb.
    console.error('Leaf graph build failed', err);
    teardownGraphScene();
    setGraphStatus((err && err.message) ? String(err.message) : window.leafLocale.t('library.graph.error'));
  }
}

// Position node graphics + redraw edges for the current simulation state, then
// draw one Pixi frame. Called on every d3 tick and after each interaction.
function renderGraphFrame(scene) {
  const { edgesGfx, colors, hoverNode } = scene;
  edgesGfx.clear();
  for (const link of scene.links) {
    const s = link.source;
    const t = link.target;
    if (typeof s.x !== 'number' || typeof t.x !== 'number') continue;
    const hot = hoverNode && (s === hoverNode || t === hoverNode);
    edgesGfx.moveTo(s.x, s.y).lineTo(t.x, t.y);
    edgesGfx.stroke({
      width: hot ? 1.6 : 1,
      color: hot ? colors.active : colors.edge,
      alpha: hoverNode ? (hot ? 0.9 : 0.12) : 0.4,
    });
  }
  for (const node of scene.nodes) {
    if (typeof node.x === 'number') node.gfx.position.set(node.x, node.y);
    if (node.labelText && node.labelText.visible) node.labelText.position.set(node.x, node.y + graphNodeRadius(node.degree) + 2);
  }
  scene.app.render();
}

// Recolour nodes and choose which labels to show for the current active/hover
// state. Cheap and only called on state changes, not per frame.
function applyGraphStyles() {
  const scene = graphScene;
  if (!scene) return;
  const { colors, hoverNode } = scene;
  const hoverSet = hoverNode ? scene.neighbors.get(hoverNode.path) : null;
  let neighborLabels = 0;
  for (const node of scene.nodes) {
    let color = colors.node;
    let alpha = 1;
    let scale = 1;
    let showLabel = false;
    const isActive = graphActivePath && node.path === graphActivePath;
    if (isActive) { color = colors.active; scale = 1.7; showLabel = true; }
    if (hoverNode) {
      if (node === hoverNode) { color = colors.hot; scale = 1.6; showLabel = true; }
      else if (hoverSet && hoverSet.has(node.path)) { color = colors.hot; if (neighborLabels++ < GRAPH_NEIGHBOR_LABEL_CAP) showLabel = true; }
      else if (!isActive) { alpha = 0.22; }
    }
    node.gfx.tint = color;
    node.gfx.alpha = alpha;
    node.gfx.scale.set(scale);
    setNodeLabel(scene, node, showLabel, color);
  }
  renderGraphFrame(scene);
}

function setNodeLabel(scene, node, show, color) {
  if (show && !node.labelText) {
    const text = new PIXI.Text({
      text: node.label,
      style: { fontFamily: 'Noto Sans, sans-serif', fontSize: 11, fill: scene.colors.hot, align: 'center' },
    });
    text.anchor.set(0.5, 0);
    text.resolution = window.devicePixelRatio || 1;
    node.labelText = text;
    scene.labelsLayer.addChild(text);
  }
  if (node.labelText) {
    node.labelText.visible = show;
    node.labelText.tint = color;
  }
}

// Pixi "global" coordinates are logical (CSS) pixels measured from the canvas
// origin, the same space the world container's position/scale live in — so a
// global point maps to world space directly, no getBoundingClientRect needed.
function graphGlobalToWorld(scene, gx, gy) {
  return {
    x: (gx - scene.world.position.x) / scene.world.scale.x,
    y: (gy - scene.world.position.y) / scene.world.scale.y,
  };
}

function startNodeDrag(scene, node, event) {
  scene.draggingNode = node;
  scene.pressGlobal = { x: event.global.x, y: event.global.y };
  const p = graphGlobalToWorld(scene, event.global.x, event.global.y);
  node.fx = p.x;
  node.fy = p.y;
  scene.sim.alphaTarget(0.3).restart();
}

// All pointer interaction runs through Pixi's own event graph so background vs.
// node presses are disambiguated by event.target (deterministic), not listener
// order. Wheel is the one exception — a DOM event on the canvas.
function wireGraphPointer(scene) {
  const stage = scene.app.stage;
  stage.eventMode = 'static';
  stage.hitArea = scene.app.screen; // a Rectangle Pixi keeps sized to the canvas
  stage.on('pointerdown', (event) => {
    if (event.target !== stage) return; // a node handled it
    scene.panning = true;
    scene.panLast = { x: event.global.x, y: event.global.y };
  });
  stage.on('globalpointermove', (event) => {
    if (scene.draggingNode) {
      const p = graphGlobalToWorld(scene, event.global.x, event.global.y);
      scene.draggingNode.fx = p.x;
      scene.draggingNode.fy = p.y;
      renderGraphFrame(scene);
    } else if (scene.panning && scene.panLast) {
      scene.world.position.x += event.global.x - scene.panLast.x;
      scene.world.position.y += event.global.y - scene.panLast.y;
      scene.panLast = { x: event.global.x, y: event.global.y };
      renderGraphFrame(scene);
    }
  });
  const endPress = (event) => {
    if (scene.draggingNode) {
      const node = scene.draggingNode;
      scene.draggingNode = null;
      node.fx = null;
      node.fy = null;
      scene.sim.alphaTarget(0);
      // A press that barely moved is a click: open that document.
      const moved = scene.pressGlobal
        && Math.hypot(event.global.x - scene.pressGlobal.x, event.global.y - scene.pressGlobal.y) > 4;
      if (!moved) send({ command: 'openRecent', path: node.path });
    }
    scene.panning = false;
    scene.panLast = null;
  };
  stage.on('pointerup', endPress);
  stage.on('pointerupoutside', endPress);
  scene.app.canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    graphZoomAt(scene, event.offsetX, event.offsetY, factor);
    renderGraphFrame(scene);
  }, { passive: false });
}

// Pixi's `resizeTo` only reacts to window resizes, and the ticker is stopped, so
// dragging the pane splitter (an element resize, not a window one) neither
// resizes the renderer nor repaints — the graph stays clustered in the old box.
// Observe the canvas ourselves: resize the renderer to the new size, shift the
// view by half the delta so the centred content stays centred (preserving any
// pan/zoom), and repaint.
function wireGraphResize(scene) {
  const ro = new ResizeObserver(() => {
    const w = libraryGraphCanvas.clientWidth;
    const h = libraryGraphCanvas.clientHeight;
    if (!w || !h || (w === scene.lastWidth && h === scene.lastHeight)) return;
    const dx = (w - scene.lastWidth) / 2;
    const dy = (h - scene.lastHeight) / 2;
    scene.lastWidth = w;
    scene.lastHeight = h;
    try { scene.app.renderer.resize(w, h); } catch (_) { /* renderer gone */ }
    scene.world.position.x += dx;
    scene.world.position.y += dy;
    renderGraphFrame(scene);
  });
  ro.observe(libraryGraphCanvas);
  scene.resizeObserver = ro;
}

function graphZoomAt(scene, sx, sy, factor) {
  const current = scene.world.scale.x;
  const next = Math.max(0.15, Math.min(4, current * factor));
  const ratio = next / current;
  scene.world.position.x = sx - (sx - scene.world.position.x) * ratio;
  scene.world.position.y = sy - (sy - scene.world.position.y) * ratio;
  scene.world.scale.set(next);
}

// Smoothly pan+zoom the world so `node` ends centred and comfortably zoomed in.
// The target recomputes each frame from the node's live position, so it lands
// centred even while the force simulation is still nudging the layout. Any
// in-flight focus animation is cancelled first so rapid tab clicks don't fight.
function focusGraphNode(scene, node) {
  if (!scene || !node || typeof node.x !== 'number') return;
  if (scene.focusRaf) { cancelAnimationFrame(scene.focusRaf); scene.focusRaf = null; }
  const width = scene.app.screen.width;
  const height = scene.app.screen.height;
  const startScale = scene.world.scale.x;
  const startX = scene.world.position.x;
  const startY = scene.world.position.y;
  const targetScale = Math.min(4, Math.max(startScale, GRAPH_FOCUS_ZOOM));
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / GRAPH_FOCUS_DURATION_MS);
    // easeInOutCubic
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const scale = startScale + (targetScale - startScale) * e;
    // Where the world must sit for the node (at its current position) to be
    // centred on the canvas at this scale; blend from the start position so the
    // motion eases rather than snapping.
    const wantX = width / 2 - node.x * scale;
    const wantY = height / 2 - node.y * scale;
    scene.world.scale.set(scale);
    scene.world.position.x = startX + (wantX - startX) * e;
    scene.world.position.y = startY + (wantY - startY) * e;
    renderGraphFrame(scene);
    if (t < 1) {
      scene.focusRaf = requestAnimationFrame(step);
    } else {
      scene.focusRaf = null;
    }
  };
  scene.focusRaf = requestAnimationFrame(step);
}

// Move the highlight to a newly active document. In Focus scope the visible slice
// is the neighborhood of the active document, so a changed document means a
// refetch + rebuild rather than a recolour. In the fixed scopes we keep the scene
// and just recolour, and when `focus` is true also fly the camera to that node.
// `forceRefresh` is the deliberate "resync this file" gesture (clicking the tab
// you are already on): it always rebuilds the slice so a graph that went stale in
// memory catches up, instead of leaving you stuck on an old scene.
function graphSetActive(path, focus, forceRefresh) {
  graphActivePath = path || null;
  if (libraryView !== 'graph') return;
  // Focus scope's slice is the active document's neighborhood, so changed seeds
  // (a different document) mean the scene in memory is for the wrong file.
  const seedChanged =
    graphScope === 'small' && graphScope + '|' + graphSeeds().join('\n') !== graphSeedKey;
  // The current scene can't represent the active document when there is no scene
  // or the document's node isn't in it (a new/re-indexed file). In every one of
  // these cases — plus an explicit resync — fetch a fresh slice rather than
  // silently doing nothing, and fly to the node once it builds.
  const staleForActive =
    focus && !!graphActivePath && (!graphScene || !graphScene.nodeByPath.has(graphActivePath));
  if (forceRefresh || seedChanged || staleForActive) {
    graphFocusPending = focus && !!graphActivePath;
    requestGraphData();
    return;
  }
  if (!graphScene) return;
  applyGraphStyles();
  if (focus && graphActivePath) {
    const node = graphScene.nodeByPath.get(graphActivePath);
    if (node) focusGraphNode(graphScene, node);
  }
}
// The snippet() markers from the backend are control characters (STX/ETX) that
// cannot occur in normal Markdown, so we can escape the whole untrusted snippet
// for the DOM first and only then swap the markers for <mark> tags.
function highlightSnippet(snippet) {
  return escapeText(snippet || '')
    .split('').join('<mark class="library-hit-mark">')
    .split('').join('</mark>');
}
function searchHitHtml(hit) {
  const path = (hit && hit.absPath) || '';
  const title = (hit && hit.title) || path;
  const anchor = (hit && hit.anchor) || '';
  return `<button type="button" class="library-hit" data-open-path="${escapeAttr(path)}" data-anchor="${escapeAttr(anchor)}" title="${escapeAttr(path)}"><span class="library-hit-title">${escapeText(stripMarkdownExt(title) || title)}</span><span class="library-hit-snippet">${highlightSnippet(hit && hit.snippet)}</span></button>`;
}
function bindSearchHits() {
  librarySearchResults.querySelectorAll('[data-open-path]').forEach((button) => {
    button.addEventListener('click', () => {
      const path = button.dataset.openPath;
      const anchor = button.dataset.anchor || '';
      // Open (or focus) the file, then scroll to the matching heading once it
      // renders. Files with no heading above the match open at the top.
      pendingSearchJump = anchor ? { path, anchor } : null;
      send({ command: 'openRecent', path });
    });
  });
}
// Swap between the tree and the search results. A non-empty query shows the
// results pane (loading, error, no-results, or the ranked hits); an empty query
// restores the tree exactly as it was, including the active view and filters.
function renderLibrarySearch() {
  const active = !!librarySearchQuery;
  const graphMode = libraryView === 'graph';
  // In graph mode the tree stays hidden; an active search shows results over the
  // pane and hides the graph, and clearing the search restores the graph.
  librarySearchResults.hidden = !active;
  libraryTree.hidden = active || graphMode;
  libraryGraph.hidden = graphMode ? active : true;
  if (graphMode && !active) showGraph();
  if (!active) {
    librarySearchResults.innerHTML = '';
    return;
  }
  if (librarySearchError) {
    const message = (librarySearchError && librarySearchError.message) || window.leafLocale.t('library.search.error');
    librarySearchResults.innerHTML = `<p class="library-empty">${escapeText(message)}</p>`;
    return;
  }
  if (librarySearchLoading && !librarySearchHits) {
    librarySearchResults.innerHTML = `<p class="library-empty">${escapeText(window.leafLocale.t('library.search.loading'))}</p>`;
    return;
  }
  const hits = librarySearchHits || [];
  if (!hits.length) {
    librarySearchResults.innerHTML = `<p class="library-empty">${escapeText(window.leafLocale.t('library.search.noResults'))}</p>`;
    return;
  }
  const count = window.leafLocale.formatNumber(hits.length);
  const countLine = `<p class="library-results-count">${escapeText(window.leafLocale.t('library.search.count', { count }))}</p>`;
  librarySearchResults.innerHTML = countLine + hits.map(searchHitHtml).join('');
  bindSearchHits();
}
function runLibrarySearch(value) {
  const query = (value || '').trim();
  librarySearchQuery = query;
  if (!query) {
    librarySearchHits = null;
    librarySearchError = null;
    librarySearchLoading = false;
    renderLibrarySearch();
    return;
  }
  librarySearchLoading = true;
  librarySearchError = null;
  renderLibrarySearch();
  send({ command: 'search', query, scope: librarySearchScopePaths() });
}
// The document paths to restrict a Focus search to, or null for the whole
// library. Focus off, or a visible set too large to be a meaningful focus (or to
// bind in one query), searches everything.
function librarySearchScopePaths() {
  if (!librarySearchFocus) return null;
  let paths;
  if (libraryView === 'graph') {
    paths = (graphData && graphData.nodes) ? graphData.nodes.map((n) => n.path) : [];
  } else {
    let roots = libraryTreeData || [];
    if (libraryView === 'project' && libraryProjectPath) {
      const folder = findFolderByPath(roots, libraryProjectPath);
      if (folder) roots = folder.children || [];
    }
    paths = collectLibraryFiles(roots, []).map((f) => f.path);
  }
  return paths.length > SEARCH_SCOPE_CAP ? null : paths;
}
// Reflect the current Focus state on the toggle chip.
function renderLibrarySearchScope() {
  librarySearchScope.setAttribute('aria-pressed', String(librarySearchFocus));
  librarySearchScopeLabel.textContent = window.leafLocale.t(
    librarySearchFocus ? 'library.search.scope.focus' : 'library.search.scope.all',
  );
}
librarySearchScope.addEventListener('click', () => {
  librarySearchFocus = !librarySearchFocus;
  renderLibrarySearchScope();
  // Re-run the active query under the new scope; nothing to do when idle.
  if (librarySearchQuery) runLibrarySearch(librarySearch.value);
});
librarySearch.addEventListener('input', () => {
  const value = librarySearch.value;
  if (librarySearchTimer) clearTimeout(librarySearchTimer);
  librarySearchTimer = window.setTimeout(() => runLibrarySearch(value), SEARCH_DEBOUNCE_MS);
});
// Escape clears the field and returns to the tree immediately.
librarySearch.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && librarySearch.value) {
    event.stopPropagation();
    librarySearch.value = '';
    if (librarySearchTimer) clearTimeout(librarySearchTimer);
    runLibrarySearch('');
  }
});
window.leafSetSearchResults = (payload) => {
  const data = payload || {};
  const query = typeof data.query === 'string' ? data.query : '';
  // Drop stale responses: the input has moved on since this query was sent.
  if (query !== librarySearchQuery) return;
  librarySearchLoading = false;
  if (data.error) {
    librarySearchError = data.error;
    librarySearchHits = null;
  } else {
    librarySearchError = null;
    librarySearchHits = Array.isArray(data.hits) ? data.hits : [];
  }
  renderLibrarySearch();
};
// Paint the pane from the seeded settings right away (correct view + toggle
// label), then ask for the tree. The host owns the indexing setting and starts
// the launch rescan itself when enabled, so there is no JS-initiated crawl on
// boot. Both are no-ops until the worker is ready.
renderLibrary();
applyPaneLayout();
send({ command: 'getFileTree' });
let minimapViewportFrame = 0;
let minimapPreviewFrame = 0;
// Rebuilding the thumbnail means cloning the whole (possibly huge) document, so
// only do it when something that changes the thumbnail actually moved: the
// document content, its wrap width, or the rail width. minimapContentVersion is
// bumped whenever the document mutates; the minimapBuilt* values record what the
// last-built clone was for. A resize that only changed height, or any redundant
// trigger, matches all three and reuses the existing clone. See
// updateDocumentMinimapPreview.
let minimapContentVersion = 0;
let minimapBuiltVersion = -1;
let minimapBuiltSourceWidth = -1;
let minimapBuiltPreviewWidth = -1;
// Unscaled offsetTop of each READER_ANCHOR_SELECTOR block in the fully-laid-out
// clone, in document order (parallel to readerAnchorBlocks). This is the ground
// truth the viewport box reads its scroll position from: the reader's own
// scrollTop/scrollHeight is a content-visibility estimate that is wrong whenever
// blocks above the viewport were never rendered (a scrollbar jump, a find, an
// #anchor), so mapping the top-visible reader block to its true clone offset is
// what keeps the box on the content. Rebuilt whenever the clone is rebuilt.
let minimapCloneOffsets = null;
let minimapDragging = false;
let minimapPointerId = null;
let minimapPointerOffsetY = null;
// Document geometry captured once at the start of a minimap drag. It does not
// change while dragging, so re-measuring on every pointermove is pure waste — and
// worse, measureDocumentMinimap/setReaderScrollTop both call correctReaderScrollOrigin,
// which writes a style then reads geometry (a forced synchronous layout). On a
// large document that layout thrash on every move is what made minimap dragging
// take many seconds. Measure once here, then map pointer -> scrollTop with pure math.
let minimapDragMetrics = null;
let minimapDragScale = 1;
let minimapResizeObserver = null;
let minimapBodyObserver = null;
let readerLayoutFrame = 0;
let readerScrollAnchor = null;
let readerReflowObserver = null;
let resetReaderScrollOnNextRender = false;
// Cached list of the document's anchor blocks. Rebuilt when the document
// changes (a new render, an async Mermaid/math swap, or the pager appending)
// so the per-scroll position probe never re-runs querySelectorAll over tens of
// thousands of blocks.
let readerAnchorBlocks = null;
let readerAnchorBlocksCount = -1;
const READER_CONTENT_TOP_GAP = 88;
const READER_ANCHOR_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, table, details, figure, hr';
themeModeControl.value = window.leafTheme.getMode();
themeModeControl.addEventListener('change', () => {
  window.leafTheme.setMode(themeModeControl.value);
  send({ command: 'setThemeMode', mode: themeModeControl.value });
});
// Tell the host what the page background and divider color resolve to so it can
// paint the native title bar to match the page and the window border to the
// theme's divider color (a darker line on light themes, the blue rule on
// Dracula). Runs on every theme change, including system light/dark flips, so
// the OS chrome always tracks the document.
function reportWindowChrome(theme) {
  const shell = document.getElementById('app');
  if (!shell) {
    return;
  }
  const parts = getComputedStyle(shell).backgroundColor.match(/\d+(?:\.\d+)?/g);
  if (!parts || parts.length < 3) {
    return;
  }
  // Resolve the divider color (a var() chain) to concrete rgb via a probe.
  const probe = document.createElement('span');
  probe.style.color = 'var(--app-border)';
  shell.appendChild(probe);
  const borderParts = getComputedStyle(probe).color.match(/\d+(?:\.\d+)?/g);
  probe.remove();
  const border = borderParts && borderParts.length >= 3 ? borderParts : parts;
  send({
    command: 'setWindowChrome',
    r: Math.round(Number(parts[0])),
    g: Math.round(Number(parts[1])),
    b: Math.round(Number(parts[2])),
    borderR: Math.round(Number(border[0])),
    borderG: Math.round(Number(border[1])),
    borderB: Math.round(Number(border[2])),
    dark: theme.resolvedTheme === 'dark',
  });
}
window.leafTheme.subscribe((theme) => {
  themeModeControl.value = theme.mode;
  reportWindowChrome(theme);
});
window.leafLocale.subscribe(() => {
  renderStaticText();
  renderState();
  applyScanProgress(lastScanProgress);
  renderLibrary();
});
window.leafMinimap.subscribe((enabled) => {
  minimapEnabledControl.checked = enabled;
  renderState();
});
let composing = false;
window.addEventListener('compositionstart', () => {
  composing = true;
});
window.addEventListener('compositionupdate', () => {
  composing = true;
});
window.addEventListener('compositionend', () => {
  composing = false;
});
window.addEventListener('keydown', (event) => {
  if (event.isComposing || composing) {
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    send({ command: 'open' });
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w' && currentState.active != null) {
    event.preventDefault();
    send({ command: 'closeTab', index: currentState.active });
    return;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
    event.preventDefault();
    const tabCount = (currentState.tabs || []).length;
    if (tabCount > 0) {
      // Cycle through the home screen plus every open tab. Position 0 is the
      // home screen; positions 1..=tabCount map to tab indices 0..tabCount-1.
      const stops = tabCount + 1;
      const current = currentState.active == null ? 0 : currentState.active + 1;
      const step = event.shiftKey ? -1 : 1;
      const next = (current + step + stops) % stops;
      if (next === 0) {
        send({ command: 'goHome' });
      } else {
        send({ command: 'switchTab', index: next - 1, scroll_anchor: currentScrollAnchor() });
      }
    }
    return;
  }
  const key = event.key;
  const isBackShortcut = event.altKey && !event.ctrlKey && !event.metaKey && key === 'ArrowLeft';
  const isForwardShortcut = event.altKey && !event.ctrlKey && !event.metaKey && key === 'ArrowRight';
  const isMacBackShortcut = event.metaKey && !event.altKey && !event.ctrlKey && key === 'ArrowLeft';
  const isMacForwardShortcut = event.metaKey && !event.altKey && !event.ctrlKey && key === 'ArrowRight';
  if (isBackShortcut || isMacBackShortcut) {
    event.preventDefault();
    sendNavigationCommand('goBack');
    return;
  }
  if (isForwardShortcut || isMacForwardShortcut) {
    event.preventDefault();
    sendNavigationCommand('goForward');
  }
});
window.leafSetState = (state) => {
  currentState = state || { recent: [], tabs: [], active: null, document: null };
  if (!currentState.document) {
    emptyDescriptionKey = pickEmptyDescriptionKey();
  }
  resetReaderScrollOnNextRender = true;
  renderState();
  // Opening a file lands on it; the home screen (no active tab) clears the
  // highlight and leaves the Project/Tree position as the user last saved it.
  // Fly the graph to it only when the active document actually changed, so a
  // plain state refresh of the same file doesn't yank a panned-away view back.
  const openedPath = activeDocumentPath();
  followFileInLibrary(openedPath, !!openedPath && openedPath !== librarySelectedPath);
  // A search result was clicked: once its document is the active one, jump to the
  // matching heading. One-shot — cleared whether or not it applied this render.
  if (pendingSearchJump) {
    const jump = pendingSearchJump;
    pendingSearchJump = null;
    if (jump.anchor && activeDocumentPath() === jump.path) {
      window.leafScrollToFragment('#' + jump.anchor);
    }
  }
};
// Re-render the active document after it changed on disk (live reload) without
// scrolling back to the top: capture the current position, re-render, then put
// the reader back where it was (clamped if the document got shorter).
window.leafReloadDocument = (state) => {
  const anchor = captureReaderScrollAnchor();
  currentState = state || currentState || { recent: [], tabs: [], active: null, document: null };
  resetReaderScrollOnNextRender = false;
  renderState();
  readerScrollAnchor = anchor;
  window.requestAnimationFrame(() => {
    restoreReaderScrollAnchor(anchor);
    readerScrollAnchor = captureReaderScrollAnchor();
    updateMinimapViewport();
  });
};
// Switch to another tab's document and land where that tab was last left. The
// position is a content anchor (heading + block + fraction), not a pixel, so it
// survives the full re-render the switch performs. `anchor` is null the first
// time a tab is opened, which starts at the top of the content. We deliberately
// skip the reset-to-content-start that leafSetState runs so clicking a tab never
// jumps to the top.
window.leafSwitchTab = (state, anchor) => {
  currentState = state || { recent: [], tabs: [], active: null, document: null };
  if (!currentState.document) {
    emptyDescriptionKey = pickEmptyDescriptionKey();
  }
  resetReaderScrollOnNextRender = false;
  renderState();
  // Switching to a tab is "going to" that file: reveal and select it, and in
  // graph mode fly to its node when the switch changed the active document.
  const switchedPath = activeDocumentPath();
  followFileInLibrary(switchedPath, !!switchedPath && switchedPath !== librarySelectedPath);
  if (!anchor) {
    resetReaderScrollToContentStart();
    return;
  }
  readerScrollAnchor = anchor;
  // Restore synchronously, before the browser paints the freshly rendered
  // document, so switching tabs never flashes at the top for a frame.
  restoreReaderScrollAnchor(anchor);
  updateMinimapViewport();
  // Re-apply after layout settles. The reflow observer installed by renderState
  // keeps re-pinning this anchor as images above it decode and grow, so the
  // landing no longer drifts once they finish loading.
  window.requestAnimationFrame(() => {
    restoreReaderScrollAnchor(anchor);
    readerScrollAnchor = captureReaderScrollAnchor();
    updateMinimapViewport();
  });
};
window.leafSetNavigation = (state) => {
  navigationState = state || { canGoBack: false, canGoForward: false };
  renderNavigation();
};
window.leafScrollToFragment = (fragment) => {
  const raw = String(fragment || '').replace(/^#/, '');
  if (!raw) {
    return;
  }
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch (error) {
    decoded = raw;
  }
  window.requestAnimationFrame(() => {
    const target = document.getElementById(decoded) || document.getElementById(raw);
    if (!target) {
      return;
    }
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start' });
    setReaderScrollTop(app.scrollTop);
    // Record where we landed as the reader anchor. content-visibility lays out
    // only on-screen blocks, so their heights keep settling after the jump and
    // the .document-body ResizeObserver fires scheduleReaderLayoutUpdate; without
    // a fresh anchor that re-pins the PRE-jump position and yanks the page back
    // (the "tries to jump but snaps back, and the outline stays open" bug). Re-pin
    // on the next frame too, the way leafSwitchTab/leafReloadDocument do, so the
    // landing converges on the target instead of an off-screen size estimate.
    readerScrollAnchor = captureReaderScrollAnchor();
    updateMinimapViewport();
    window.requestAnimationFrame(() => {
      restoreReaderScrollAnchor(readerScrollAnchor);
      readerScrollAnchor = captureReaderScrollAnchor();
      updateMinimapViewport();
    });
  });
};
window.leafRestoreScrollAnchor = (anchor) => {
  if (!anchor) {
    return;
  }
  readerScrollAnchor = anchor;
  window.requestAnimationFrame(() => {
    restoreReaderScrollAnchor(anchor);
    readerScrollAnchor = captureReaderScrollAnchor();
    updateMinimapViewport();
  });
};
function renderStaticText() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = window.leafLocale.t(node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((node) => {
    node.title = window.leafLocale.t(node.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-label]').forEach((node) => {
    node.label = window.leafLocale.t(node.dataset.i18nLabel);
  });
  document.querySelectorAll('[aria-label][data-i18n-aria-label]').forEach((node) => {
    node.setAttribute('aria-label', window.leafLocale.t(node.dataset.i18nAriaLabel));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.setAttribute('placeholder', window.leafLocale.t(node.dataset.i18nPlaceholder));
  });
  themeModeControl.setAttribute('aria-label', window.leafLocale.t('settings.theme.aria'));
  graphScopeControl.setAttribute('aria-label', window.leafLocale.t('settings.graphScope.aria'));
  minimapEnabledControl.setAttribute('aria-label', window.leafLocale.t('settings.minimap.aria'));
  speedReaderEnabledControl.setAttribute('aria-label', window.leafLocale.t('settings.speedReader.aria'));
  // The scope chip's label is state-dependent (All vs Focus), so re-derive it
  // after the generic data-i18n pass has reset it.
  renderLibrarySearchScope();
}
// Tabs and the library both show the file name (basename, minus a .md/.markdown
// extension), not the document's heading title. Falls back to the title, then
// the raw path.
function stripMarkdownExt(name) {
  return (name || '').replace(/\.(md|markdown|mdown|mkd)$/i, '');
}
function tabDisplayName(tab) {
  const base = (tab.path || '').split(/[\\/]/).pop() || '';
  return stripMarkdownExt(base) || tab.title || tab.path || '';
}
function renderTabs(state) {
  const tabs = state.tabs || [];
  const active = state.active;
  tabBar.innerHTML = tabs.map((tab, index) => `<span class="tab${index === active ? ' tab-active' : ''}" data-tab-pos="${index}"><button type="button" class="tab-label" data-tab-index="${index}" data-reveal-path="${escapeAttr(tab.path)}" title="${escapeAttr(tab.path)}">${escapeText(tabDisplayName(tab))}</button><button type="button" class="tab-close" data-tab-close="${index}" aria-label="${escapeAttr(window.leafLocale.t('actions.closeTab'))}" title="${escapeAttr(window.leafLocale.t('actions.closeTab'))}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></span>`).join('');
  tabBar.querySelectorAll('[data-tab-index]').forEach((button) => {
    button.addEventListener('click', () => {
      if (suppressTabClick) return;
      const index = Number(button.dataset.tabIndex);
      const wasActive = index === (currentState && currentState.active);
      send({ command: 'switchTab', index, scroll_anchor: currentScrollAnchor() });
      // Reveal even when this is already the active tab (no state round-trip
      // from the host): clicking a file's tab snaps the library back to it, and
      // in graph mode flies the camera to that node and zooms in. Clicking the
      // tab you are already on is a deliberate resync — force the graph to
      // rebuild so it can't stay stuck on a stale scene in memory.
      const tab = (currentState.tabs || [])[index];
      followFileInLibrary(tab ? tab.path || null : null, true, wasActive);
    });
  });
  tabBar.querySelectorAll('[data-tab-close]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      send({ command: 'closeTab', index: Number(button.dataset.tabClose) });
    });
  });
  tabBar.querySelectorAll('.tab').forEach((tabEl) => {
    tabEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('.tab-close')) return;
      const dragIndex = Number(tabEl.dataset.tabPos);
      const dragRect = tabEl.getBoundingClientRect();
      const dragMid = dragRect.left + dragRect.width / 2;
      const others = Array.from(tabBar.querySelectorAll('.tab'))
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return { pos: Number(el.dataset.tabPos), el, mid: rect.left + rect.width / 2 };
        })
        .filter((t) => t.pos !== dragIndex)
        .sort((a, b) => a.mid - b.mid);
      const filteredFrom = others.filter((t) => t.mid < dragMid).length;
      tabDrag = {
        index: dragIndex,
        el: tabEl,
        startX: event.clientX,
        pointerId: event.pointerId,
        moved: false,
        to: filteredFrom,
        others,
        draggedWidth: dragRect.width,
        filteredFrom,
      };
    });
  });
}
function renderState() {
  const state = currentState || { recent: [], tabs: [], active: null, document: null };
  disconnectMinimapPreviewObservers();
  disconnectReaderReflowObserver();
  readerAnchorBlocks = null;
  renderTabs(state);
  if (state.document) {
    document.title = window.leafLocale.t('titles.document', { title: state.document.title });
    app.className = 'reader-shell has-document';
    const minimapHtml = renderDocumentMinimap(state.document.minimap);
    const layoutClass = minimapHtml ? 'reader-layout' : 'reader-layout reader-layout-no-minimap';
    app.innerHTML = `<div class="${layoutClass}">${state.document.html}${minimapHtml}</div>`;
    decorateBlockquoteLines();
    buildDocumentOutline();
    decorateAnchorLinks();
    bindDocumentLinks();
    requestDocumentPager(state.document.path || activeDocumentPath());
    bindDocumentMinimap();
    renderMermaidDiagrams();
    renderMathElements();
    decorateCodeBlocks();
    applySpeedReaderToDocument();
    observeReaderReflow();
    scheduleMinimapPreviewUpdate();
    if (resetReaderScrollOnNextRender) {
      resetReaderScrollOnNextRender = false;
      resetReaderScrollToContentStart();
    } else {
      updateMinimapViewport();
    }
    return;
  }
  resetReaderScrollOnNextRender = false;
  document.title = window.leafLocale.t('titles.app');
  app.className = 'reader-shell empty';
  const recent = state.recent || [];
  app.innerHTML = `
    <section class="empty-state">
      <p class="kicker">${escapeText(window.leafLocale.t('empty.kicker'))}</p>
      <h1>${escapeText(window.leafLocale.t('empty.title'))}</h1>
      <p class="empty-description">${escapeText(window.leafLocale.t(emptyDescriptionKey))}</p>
      <button type="button" class="primary-open">${escapeText(window.leafLocale.t('actions.chooseFile'))}</button>
      ${recent.length ? `<div class="recent"><h2>${escapeText(window.leafLocale.t('recent.headingWithCount', { count: window.leafLocale.formatNumber(recent.length) }))}</h2><ol>${recent.map((path) => `<li><button type="button" title="${escapeAttr(window.leafLocale.t('recent.openTitle', { path }))}" data-path="${escapeAttr(path)}" data-reveal-path="${escapeAttr(path)}">${escapeText(path)}</button></li>`).join('')}</ol></div>` : `<p class="empty-help">${escapeText(window.leafLocale.t('empty.noRecent'))}</p>`}
    </section>`;
  app.querySelector('.primary-open').addEventListener('click', () => send({ command: 'open' }));
  app.querySelectorAll('[data-path]').forEach((button) => {
    button.addEventListener('click', () => send({ command: 'openRecent', path: button.dataset.path }));
  });
}
function renderNavigation() {
  backButton.disabled = !navigationState.canGoBack;
  forwardButton.disabled = !navigationState.canGoForward;
}
function sameDocumentFragmentHref(rawHref) {
  if (rawHref.startsWith('#')) {
    return rawHref;
  }
  if (rawHref.startsWith('./#')) {
    return rawHref.slice(2);
  }
  if (rawHref.startsWith('.#')) {
    return rawHref.slice(1);
  }
  return null;
}
// ---- Glossary bottom sheet ------------------------------------------------
// A glossary link (its file basename is GLOSSARY.md and it carries a #anchor)
// opens the term in a sheet over the current document instead of navigating.
// The webview cannot read the file itself, so the click asks the host, which
// reads + renders the glossary and calls window.leafShowGlossary below.
const glossarySheet = document.getElementById('glossarySheet');
const glossaryBackdrop = document.getElementById('glossaryBackdrop');
const glossarySheetBody = document.getElementById('glossarySheetBody');
const glossarySheetClose = document.getElementById('glossarySheetClose');
const glossaryFullLink = document.getElementById('glossaryFullLink');
// The path part of the last glossary link followed from a document, reused so a
// glossary-to-glossary jump resolves against the same file the host opened.
let glossaryHrefBase = 'GLOSSARY.md';
let glossaryLastFocus = null;
function glossaryAnchorFromHref(rawHref) {
  if (!rawHref) return '';
  // Preferred form: a fake `glossary:slug` URL. No file path, so it works at any
  // folder depth. The host finds the nearest GLOSSARY.md when it opens the sheet.
  const scheme = /^glossary:(.*)$/i.exec(rawHref);
  if (scheme) {
    let anchor = scheme[1].replace(/^#/, '');
    try { anchor = decodeURIComponent(anchor); } catch (e) {}
    return anchor;
  }
  if (/^[a-z]+:\/\//i.test(rawHref) || rawHref.startsWith('mailto:')) return '';
  // Real form: a `…/GLOSSARY.md#slug` relative link (what /check expands the
  // shorthand into; also works in plain Markdown viewers). Matched case-insensitively.
  const hashAt = rawHref.indexOf('#');
  if (hashAt < 0) return '';
  const path = rawHref.slice(0, hashAt).split('?')[0];
  const base = path.split(/[\\/]/).pop().toLowerCase();
  if (base !== 'glossary.md') return '';
  let anchor = rawHref.slice(hashAt + 1);
  try { anchor = decodeURIComponent(anchor); } catch (e) {}
  return anchor;
}
function glossaryHeadingLevel(el) {
  const match = /^H([1-6])$/.exec(el.tagName);
  return match ? Number(match[1]) : 0;
}
function extractGlossaryEntry(root, anchor) {
  const start = Array.from(root.querySelectorAll('[id]')).find((el) => el.id === anchor);
  if (!start) return null;
  const level = glossaryHeadingLevel(start) || 6;
  const frag = document.createDocumentFragment();
  frag.appendChild(start.cloneNode(true));
  let node = start.nextElementSibling;
  while (node) {
    const lvl = glossaryHeadingLevel(node);
    if (lvl && lvl <= level) break;
    frag.appendChild(node.cloneNode(true));
    node = node.nextElementSibling;
  }
  return frag;
}
function onGlossaryKey(event) {
  if (event.key === 'Escape') dismissGlossary();
}
function showGlossary() {
  glossaryLastFocus = document.activeElement;
  glossaryBackdrop.hidden = false;
  glossarySheet.hidden = false;
  requestAnimationFrame(() => {
    glossaryBackdrop.classList.add('open');
    glossarySheet.classList.add('open');
  });
  document.addEventListener('keydown', onGlossaryKey);
  glossarySheetClose.focus();
}
function dismissGlossary() {
  if (glossarySheet.hidden) return;
  glossaryBackdrop.classList.remove('open');
  glossarySheet.classList.remove('open');
  document.removeEventListener('keydown', onGlossaryKey);
  const hide = () => {
    glossarySheet.hidden = true;
    glossaryBackdrop.hidden = true;
    glossarySheet.removeEventListener('transitionend', hide);
  };
  glossarySheet.addEventListener('transitionend', hide);
  setTimeout(hide, 320);
  if (glossaryLastFocus && glossaryLastFocus.focus) glossaryLastFocus.focus();
}
glossaryBackdrop.addEventListener('click', dismissGlossary);
glossarySheetClose.addEventListener('click', dismissGlossary);
// "Open the full glossary" opens the glossary file as an ordinary document tab,
// resolved (like the link that opened the sheet) against the active document.
glossaryFullLink.addEventListener('click', (event) => {
  event.preventDefault();
  dismissGlossary();
  send({ command: 'openLink', href: glossaryHrefBase, scroll_anchor: currentScrollAnchor() });
});
glossarySheetBody.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  const rawHref = link.getAttribute('href') || '';
  if (!rawHref || /^[a-z]+:\/\//i.test(rawHref) || rawHref.startsWith('mailto:')) return;
  event.preventDefault();
  const within = glossaryAnchorFromHref(rawHref) || (rawHref.startsWith('#') ? rawHref.slice(1) : '');
  if (within) {
    send({ command: 'openGlossary', href: glossaryHrefBase + '#' + within });
    return;
  }
  dismissGlossary();
  send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });
});
const linkHoverTip = document.createElement('div');
linkHoverTip.className = 'link-hover-tip';
linkHoverTip.hidden = true;
linkHoverTip.innerHTML =
  '<div class="link-hover-tip-kind"></div>' +
  '<div class="link-hover-tip-detail"></div>' +
  '<div class="link-hover-tip-lines" hidden></div>';
document.body.appendChild(linkHoverTip);
const linkHoverTipKind = linkHoverTip.querySelector('.link-hover-tip-kind');
const linkHoverTipDetail = linkHoverTip.querySelector('.link-hover-tip-detail');
const linkHoverTipLines = linkHoverTip.querySelector('.link-hover-tip-lines');
const canHoverLinks = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
// A hovered "Another page" link shows how many lines the target document is.
// The webview can't read sibling files itself, so it asks the host (countLines
// IPC) and the host answers by calling window.leafLineCount. Each hover gets a
// token so a slow answer for a link you already left is ignored; answers are
// cached by href so re-hovering the same link is instant.
let activeHoverToken = 0;
const lineCountCache = new Map();
const pendingLineTokens = new Map();
function formatLineCount(n) {
  const num = window.leafLocale ? window.leafLocale.formatNumber(n) : String(n);
  return num + ' ' + (n === 1 ? 'line' : 'lines');
}
function setLinkHoverLines(count) {
  if (typeof count === 'number' && count >= 0) {
    linkHoverTipLines.textContent = formatLineCount(count);
    linkHoverTipLines.hidden = false;
  } else {
    linkHoverTipLines.textContent = '';
    linkHoverTipLines.hidden = true;
  }
}
window.leafLineCount = (token, lines) => {
  const key = pendingLineTokens.get(token);
  if (key !== undefined) {
    pendingLineTokens.delete(token);
    if (typeof lines === 'number' && lines >= 0) lineCountCache.set(key, lines);
  }
  if (token === activeHoverToken && typeof lines === 'number' && lines >= 0) {
    setLinkHoverLines(lines);
  }
};
let activeHoverLink = null;
function hideLinkHoverTip() {
  activeHoverLink = null;
  linkHoverTip.hidden = true;
}
function positionLinkHoverTip(event) {
  const margin = 14;
  const rect = linkHoverTip.getBoundingClientRect();
  let left = event.clientX + 18;
  let top = event.clientY + 18;
  if (left + rect.width > window.innerWidth - margin) {
    left = Math.max(margin, event.clientX - rect.width - 18);
  }
  if (top + rect.height > window.innerHeight - margin) {
    top = Math.max(margin, event.clientY - rect.height - 18);
  }
  linkHoverTip.style.left = left + 'px';
  linkHoverTip.style.top = top + 'px';
}
// What to print as the tooltip's detail line. The authored href may be
// percent-encoded (a heading slug with diacritics becomes `#%C5%9B...`), which
// is unreadable, so decode it for display and fall back to the raw href if it is
// not valid percent-encoding.
function hoverDetail(rawHref) {
  try { return decodeURIComponent(rawHref); } catch (e) { return rawHref; }
}
function linkHoverInfo(rawHref) {
  if (!rawHref) return null;
  if (/^glossary:\s*$/i.test(rawHref)) {
    return { kind: 'Full glossary', detail: hoverDetail(rawHref) };
  }
  if (glossaryAnchorFromHref(rawHref)) {
    return { kind: 'Glossary entry', detail: hoverDetail(rawHref) };
  }
  if (sameDocumentFragmentHref(rawHref)) {
    return { kind: 'In-page jump', detail: hoverDetail(rawHref) };
  }
  if (/^mailto:/i.test(rawHref)) {
    return { kind: 'Email link', detail: hoverDetail(rawHref) };
  }
  if (/^https?:\/\//i.test(rawHref)) {
    return { kind: 'External site', detail: hoverDetail(rawHref) };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref)) {
    return { kind: 'App link', detail: hoverDetail(rawHref) };
  }
  if (/\.md(?:[#?].*)?$/i.test(rawHref)) {
    return { kind: 'Another page', detail: hoverDetail(rawHref) };
  }
  if (rawHref.startsWith('/')) {
    return { kind: 'Local path', detail: hoverDetail(rawHref) };
  }
  return { kind: 'Link', detail: hoverDetail(rawHref) };
}
if (canHoverLinks) {
  document.addEventListener('pointerover', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const rawHref = (link.getAttribute('href') || '').trim();
    const info = linkHoverInfo(rawHref);
    if (!info) {
      hideLinkHoverTip();
      return;
    }
    activeHoverLink = link;
    linkHoverTipKind.textContent = info.kind;
    linkHoverTipDetail.textContent = info.detail;
    const token = ++activeHoverToken;
    setLinkHoverLines(null);
    // Only links that open another document in-app (Markdown pages) carry a line
    // count; everything else (glossary, in-page jumps, external, mail) does not.
    if (info.kind === 'Another page') {
      const key = link.href || rawHref;
      if (lineCountCache.has(key)) {
        setLinkHoverLines(lineCountCache.get(key));
      } else {
        pendingLineTokens.set(token, key);
        send({ command: 'countLines', href: key, token });
      }
    }
    linkHoverTip.hidden = false;
    positionLinkHoverTip(event);
  });
  document.addEventListener('pointermove', (event) => {
    if (!activeHoverLink) return;
    positionLinkHoverTip(event);
  });
  document.addEventListener('pointerout', (event) => {
    if (!activeHoverLink) return;
    const next = event.relatedTarget;
    if (next && next.closest && next.closest('a[href]') === activeHoverLink) return;
    hideLinkHoverTip();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hideLinkHoverTip();
  });
  window.addEventListener('blur', hideLinkHoverTip);
  app.addEventListener('scroll', hideLinkHoverTip, true);
}
// The parsed glossary document, kept between calls. Parsing the fully rendered
// glossary into a DOM just to lift out one entry is the dominant cost of opening
// the sheet — the glossary is often multiple megabytes — and the file is the
// same for every term you look up. Cache the parsed tree keyed by the exact html
// the host sent, so repeat lookups reuse it; a different or edited glossary sends
// different html and reparses once. extractGlossaryEntry only reads + clones from
// the tree, so sharing it across calls is safe.
let glossaryParsedHtml = null;
let glossaryParsedRoot = null;
// Called by the host with the fully rendered glossary document; pull out the
// requested entry and slide the sheet up.
window.leafShowGlossary = (html, anchor) => {
  if (html !== glossaryParsedHtml) {
    glossaryParsedRoot = document.createElement('div');
    glossaryParsedRoot.innerHTML = html;
    glossaryParsedHtml = html;
  }
  const entry = extractGlossaryEntry(glossaryParsedRoot, anchor);
  glossarySheetBody.innerHTML = '';
  if (entry) {
    glossarySheetBody.appendChild(entry);
  } else {
    glossarySheetBody.textContent = 'No glossary entry for “' + anchor + '”.';
  }
  glossarySheetBody.scrollTop = 0;
  showGlossary();
};
// One delegated click listener for every document link, bound once. The old
// per-link binding attached a handler to each `a[href]` — tens of thousands of
// them in a large document (every heading permalink is an `a`), a major slice of
// open time. The sanitizer already sets `rel="noopener noreferrer"` and strips
// `target`, so no per-link attribute fix-up is needed here. Delegation also means
// links added later (the async pager) are handled with no rebinding.
let documentLinksBound = false;
function bindDocumentLinks() {
  if (documentLinksBound) {
    return;
  }
  documentLinksBound = true;
  app.addEventListener('click', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link || !app.contains(link) || !link.closest('.document-body')) {
      return;
    }
    // A tap/click on the gutter permalink copies its #locus (even with a modifier
    // held) without blocking the jump; a brief is-copied flash confirms it.
    if (link.classList.contains('heading-anchor')) {
      const locus = link.parentElement && link.parentElement.dataset ? link.parentElement.dataset.locus : '';
      if (locus) {
        copyToClipboard('#' + locus);
        link.classList.add('is-copied');
        window.clearTimeout(link.__copiedTimer);
        link.__copiedTimer = window.setTimeout(() => link.classList.remove('is-copied'), 900);
      }
    }
    if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const rawHref = link.getAttribute('href') || '';
    if (!rawHref) {
      return;
    }
    const glossaryTerm = glossaryAnchorFromHref(rawHref);
    if (glossaryTerm) {
      event.preventDefault();
      // For a `glossary:` link keep the bare scheme as the base, so a jump to
      // another term (glossaryHrefBase + '#' + term) and "open full glossary"
      // both stay on the scheme and let the host re-resolve the nearest file.
      glossaryHrefBase = /^glossary:/i.test(rawHref) ? 'glossary:' : rawHref.split('#')[0];
      send({ command: 'openGlossary', href: rawHref });
      return;
    }
    const fragmentHref = sameDocumentFragmentHref(rawHref);
    if (fragmentHref) {
      event.preventDefault();
      send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });
      return;
    }
    event.preventDefault();
    send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });
  });
}
function loadMermaid() {
  if (window.mermaid) {
    return Promise.resolve(window.mermaid);
  }
  if (mermaidLoadPromise) {
    return mermaidLoadPromise;
  }
  mermaidLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MERMAID_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.mermaid) {
        resolve(window.mermaid);
        return;
      }
      reject(new Error('Mermaid runtime loaded without exposing window.mermaid'));
    };
    script.onerror = () => reject(new Error('Mermaid runtime failed to load'));
    document.head.appendChild(script);
  });
  return mermaidLoadPromise;
}
function renderMermaidDiagrams() {
  const diagrams = Array.from(app.querySelectorAll('pre.mermaid:not([data-processed="true"]):not([data-mermaid-render="failed"])'));
  if (!diagrams.length) {
    return;
  }
  loadMermaid()
    .then((mermaid) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
        fontFamily: "'Noto Sans', sans-serif",
        themeVariables: { fontFamily: "'Noto Sans', sans-serif" },
      });
      return mermaid.run({ nodes: diagrams });
    })
    .then(() => {
      // Diagrams changed the block layout; drop the cached anchor list.
      readerAnchorBlocks = null;
    })
    .catch((error) => {
      console.error(error);
      diagrams.forEach((diagram) => {
        diagram.dataset.mermaidRender = 'failed';
      });
    });
}
// KaTeX (bundled, loaded lazily) renders the .math elements pulldown-cmark emits
// for $…$ and $$…$$. The raw TeX is the element's text; KaTeX replaces it in
// place, falling back to that readable text if the runtime can't load.
function loadKatex() {
  if (window.katex) {
    return Promise.resolve(window.katex);
  }
  if (katexLoadPromise) {
    return katexLoadPromise;
  }
  katexLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = KATEX_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.katex) {
        resolve(window.katex);
        return;
      }
      reject(new Error('KaTeX runtime loaded without exposing window.katex'));
    };
    script.onerror = () => reject(new Error('KaTeX runtime failed to load'));
    document.head.appendChild(script);
  });
  return katexLoadPromise;
}
function renderMathElements() {
  const nodes = Array.from(app.querySelectorAll('.math:not([data-math-rendered])'));
  if (!nodes.length) {
    return;
  }
  loadKatex()
    .then((katex) => {
      nodes.forEach((node) => {
        try {
          katex.render(node.textContent, node, {
            displayMode: node.classList.contains('math-display'),
            throwOnError: false,
          });
        } catch (error) {
          console.error(error);
        }
        node.dataset.mathRendered = 'true';
      });
    })
    .catch((error) => {
      console.error(error);
    });
}
function decorateBlockquoteLines(root = app) {
  root.querySelectorAll('blockquote:not(.markdown-alert) p').forEach((paragraph) => {
    if (paragraph.querySelector('.blockquote-line')) return;
    const children = Array.from(paragraph.childNodes);
    if (!children.some((node) => node.nodeName === 'BR')) return;
    const fragment = document.createDocumentFragment();
    let line = document.createElement('span');
    line.className = 'blockquote-line';
    children.forEach((node) => {
      if (node.nodeName === 'BR') {
        fragment.appendChild(line);
        line = document.createElement('span');
        line.className = 'blockquote-line';
        return;
      }
      line.appendChild(node);
    });
    fragment.appendChild(line);
    paragraph.replaceChildren(fragment);
    paragraph.classList.add('blockquote-lines');
  });
}
// Copy ("document duplicate") and check marks, sized by CSS. The button holds
// both and the .is-copied class swaps which one shows.
const CODE_COPY_ICON = '<svg class="code-copy-mark code-copy-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75"/></svg><svg class="code-copy-mark code-copy-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>';
// Give every fenced/indented code block (but not Mermaid diagrams) a "copy all"
// button. Done here in JS, after the sanitized HTML is in the DOM, so the markup
// the sanitizer sees stays just <pre><code>. The button copies the code verbatim.
function decorateCodeBlocks() {
  app.querySelectorAll('.document-body pre:not(.mermaid)').forEach((pre) => {
    if (pre.querySelector(':scope > .code-copy')) return;
    const code = pre.querySelector('code');
    if (!code) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.innerHTML = CODE_COPY_ICON;
    setCodeCopyLabel(button, 'actions.copyCode');
    button.addEventListener('click', () => copyCodeBlock(button, code.textContent || ''));
    pre.appendChild(button);
  });
}
// Built once and cloned per block. Cloning a bare anchor and stamping its line
// number in per block is far cheaper than building the element from scratch tens
// of thousands of times on a big document.
const anchorLinkTemplate = (() => {
  const link = document.createElement('a');
  link.className = 'heading-anchor';
  return link;
})();
// `pre:not(.mermaid)` excludes Mermaid diagrams: a permalink gutter link makes
// no sense on a diagram, and inserting one as the pre's first child corrupts the
// source Mermaid reads from innerHTML, yielding a "Syntax error" bomb.
const ANCHOR_LINK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre:not(.mermaid), table, details, figure, div[id], a[id]';
function uniqueAnchorBlockId(seen, base) {
  let candidate = base;
  let suffix = 1;
  while (!candidate || seen.has(candidate)) {
    candidate = base + '-' + suffix;
    suffix += 1;
  }
  seen.add(candidate);
  return candidate;
}
// A list item that is purely a link (or links) is a table-of-contents /
// navigation entry, not body content, so it takes no number.
function isNavOutlineItem(el) {
  if (el.tagName !== 'LI') return false;
  const text = (el.textContent || '').replace(/\\s+/g, '');
  if (!text) return false;
  let linkText = '';
  el.querySelectorAll('a').forEach((a) => { linkText += a.textContent || ''; });
  return text === linkText.replace(/\\s+/g, '');
}
// Give `target` the address `locus`: if it already has an id (a heading slug or
// an author anchor) keep that id and add a hidden alias carrying the locus, so
// #<locus> still lands on it; otherwise the locus becomes the id. Either way the
// locus is recorded on dataset.locus for the gutter permalink.
function assignLocus(target, locus, seen) {
  if (target.id) {
    seen.add(target.id);
    const alias = document.createElement('span');
    alias.className = 'locus-alias';
    alias.id = uniqueAnchorBlockId(seen, locus);
    alias.setAttribute('aria-hidden', 'true');
    target.insertBefore(alias, target.firstChild);
    target.dataset.locus = alias.id;
  } else {
    target.id = uniqueAnchorBlockId(seen, locus);
    target.dataset.locus = target.id;
  }
}
// Number the document so each block has a short, citable address: a flat running
// count down the page — 1, 2, 3, 4 … — like a code editor's line gutter, with no
// reset at headings. A heading keeps the slug id the renderer gave it (so the
// table of contents and #slug links resolve) and carries its number through a
// hidden alias. The navigation outline (link-only list items) is skipped. The
// address is pure ASCII, so a heading with diacritics still reads cleanly in the
// link tooltip. Numbering is deterministic, so the ids survive the re-render a
// fragment jump triggers.
function ensureAnchorLinkTargets(body) {
  const seen = new Set(Array.from(body.querySelectorAll('[id]')).map((element) => element.id).filter(Boolean));
  let line = 0;
  body.querySelectorAll(ANCHOR_LINK_SELECTOR).forEach((target) => {
    if (target.classList.contains('footnote-definition')) return;
    // The generated outline is navigation, not body content — no locus number.
    if (target.closest('.document-outline')) return;
    if (isNavOutlineItem(target)) return;
    line += 1;
    assignLocus(target, '' + line, seen);
  });
  return line;
}
// Build a collapsed "Outline" (table of contents) from the document's headings
// and insert it just under the title. Mirrors site/outline.js: a pure DOM pass
// over the <h1>–<h6> the renderer emits (each with a slug id), so it behaves the
// same for Markdown and TEI XML. Entries nest as a bulleted list — one step in
// per step down in heading level — inside a <details> that starts closed so it
// never crowds the top. Bullets, not numbers: a deep document runs the counter
// into the hundreds and the wide markers overflow the panel's left edge. Run before the anchor pass so its link-only entries stay
// out of the block-numbering scheme, and before bindDocumentLinks so each entry's
// #slug jump is wired into fragment navigation like any other TOC link.
function buildDocumentOutline() {
  const body = app.querySelector('.document-body');
  if (!body) return;
  const existing = body.querySelector(':scope > .document-outline');
  if (existing) existing.remove();
  const headings = Array.from(body.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(
    (h) => !h.closest('.document-outline') && !h.closest('.footnotes') && !h.closest('.tei-front')
  );
  if (headings.length < 2) return;
  const title = headings[0];
  const rest = headings.slice(1);
  rest.forEach((h, i) => { if (!h.id) h.id = 'section-' + (i + 1); });
  const details = document.createElement('details');
  details.className = 'document-outline';
  const summary = document.createElement('summary');
  summary.className = 'document-outline-summary';
  const summaryLabel = document.createElement('span');
  summaryLabel.dataset.i18n = 'outline.title';
  summaryLabel.textContent = window.leafLocale.t('outline.title');
  summary.appendChild(summaryLabel);
  // Filled in by decorateAnchorLinks once the numbering pass knows the
  // document's total line count — a separate span so renderStaticText's
  // [data-i18n] sweep never wipes the count.
  const summaryCount = document.createElement('span');
  summaryCount.className = 'document-outline-count';
  summary.appendChild(summaryCount);
  details.appendChild(summary);
  // The entry list can be enormous (one <li> per heading — ~25k on a glossary),
  // so build it only when the reader first opens the outline instead of at every
  // document render. bindDocumentLinks is delegated on the shell, so the entries'
  // #slug jumps are wired the moment they exist, with no rebinding.
  details.addEventListener('toggle', () => {
    if (details.open) populateDocumentOutline(details, rest);
  });
  title.insertAdjacentElement('afterend', details);
}
function populateDocumentOutline(details, rest) {
  if (details.dataset.outlinePopulated === 'true') return;
  details.dataset.outlinePopulated = 'true';
  const readHeadingText = (h) => {
    const clone = h.cloneNode(true);
    clone.querySelectorAll('.heading-anchor, .anchor-link, .locus-alias, .footnote-ref').forEach((n) => n.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const rootList = document.createElement('ul');
  const stack = [{ level: 0, list: rootList }];
  rest.forEach((h) => {
    const level = Number(h.tagName.slice(1)) || 1;
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    let container = parent.list;
    if (parent.level !== 0) {
      const lastLi = parent.list.lastElementChild;
      let sub = lastLi ? lastLi.querySelector(':scope > ul') : null;
      if (!sub) { sub = document.createElement('ul'); (lastLi || parent.list).appendChild(sub); }
      container = sub;
    }
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'document-outline-link';
    link.href = '#' + encodeURIComponent(h.id);
    link.textContent = readHeadingText(h) || h.id;
    li.appendChild(link);
    container.appendChild(li);
    stack.push({ level, list: container });
  });
  details.appendChild(rootList);
}
// Give every anchor-addressable block a permalink button in the left gutter,
// GitHub style. Done in JS, after sanitized HTML is in the DOM, so it catches
// raw-HTML blocks uniformly without parsing strings in Rust. The button is a
// real anchor link to the target id, so bindDocumentLinks (run right after this)
// wires it into the same in-document fragment navigation as a TOC link. Clicking
// it also copies that #locus to the clipboard (without blocking the jump) so the
// canonical number can be pasted out — the only way to read the locus on touch,
// where there is no hover tooltip to reveal it.
function decorateAnchorLinks() {
  const body = app.querySelector('.document-body');
  if (!body) return;
  const lineTotal = ensureAnchorLinkTargets(body);
  // The numbering pass just walked the whole document, so its final count is
  // the document's line total — stamp it into the outline summary:
  // "Outline (1234 lines)".
  const outlineCount = body.querySelector('.document-outline-count');
  if (outlineCount) {
    outlineCount.textContent = window.leafLocale.t('outline.lineCount', { count: lineTotal });
  }
  const label = window.leafLocale.t('actions.anchorLink');
  body.querySelectorAll(ANCHOR_LINK_SELECTOR).forEach((target) => {
    const locus = target.dataset.locus;
    if (!locus) return;
    if (target.classList.contains('footnote-definition')) return;
    if (target.closest('.document-outline')) return;
    if (target.querySelector(':scope > .heading-anchor')) return;
    // A blockquote (or GitHub alert) is one citable unit: it carries the button,
    // and the gutter carve on it drags its left bar 40px into the margin, which
    // the .has-anchor-link CSS repaints inset. Its inner paragraphs must NOT also
    // carve a gutter — a second -40px shift would drag the quote text off the
    // column (the bug the repaint alone left behind). So skip the button on any
    // block nested inside a blockquote; the block keeps its id, so #locus links to
    // it still resolve, it just shares the blockquote's permalink.
    if (target.tagName !== 'BLOCKQUOTE' && target.closest('blockquote')) return;
    const link = anchorLinkTemplate.cloneNode(true);
    link.href = '#' + encodeURIComponent(locus);
    link.setAttribute('aria-label', label);
    link.title = label;
    // The gutter shows the block's line number as faint monospace text; clicking
    // it still copies the deep link (handled by the delegated body listener).
    link.textContent = locus;
    target.classList.add('has-anchor-link');
    target.insertBefore(link, target.firstChild);
  });
  // The button no longer needs JS positioning: it lives in each block's own
  // left-padding gutter (see the .has-anchor-link CSS), so a nested block's
  // button sits beside that block rather than being measured back to a shared
  // column. Clicks (copy + jump) are handled by the delegated body listener in
  // bindDocumentLinks, so no per-button listener is attached here.
}
function setCodeCopyLabel(button, key) {
  const label = window.leafLocale.t(key);
  button.setAttribute('aria-label', label);
  button.title = label;
}
// Copy via the async clipboard API, falling back to a hidden textarea +
// execCommand for webview contexts where the async API is blocked.
function copyCodeBlock(button, text) {
  const ok = () => flashCodeCopied(button);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(ok, () => { if (legacyCopy(text)) ok(); });
  } else if (legacyCopy(text)) {
    ok();
  }
}
function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    copied = false;
  }
  document.body.removeChild(area);
  return copied;
}
// Copy arbitrary text, preferring the async clipboard API and falling back to the
// hidden-textarea path for webview contexts where it is blocked. Used by the
// gutter permalink so a tapped locus number can be pasted out.
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => { legacyCopy(text); });
    return;
  }
  legacyCopy(text);
}
// Briefly show the check mark and a "Copied" label, then revert.
function flashCodeCopied(button) {
  button.classList.add('is-copied');
  setCodeCopyLabel(button, 'actions.copiedCode');
  window.clearTimeout(button.__copiedTimer);
  button.__copiedTimer = window.setTimeout(() => {
    button.classList.remove('is-copied');
    setCodeCopyLabel(button, 'actions.copyCode');
  }, 1400);
}
function renderDocumentMinimap(model) {
  if (!window.leafMinimap.getEnabled()) {
    return '';
  }
  if (!model || !Number.isFinite(model.line_count) || model.line_count <= 0) {
    return '';
  }
  return `<aside class="document-minimap" aria-label="${escapeAttr(window.leafLocale.t('minimap.aria'))}"><div class="document-minimap-track" aria-hidden="true"><div class="document-minimap-content" aria-hidden="true"></div><div class="document-minimap-viewport" aria-hidden="true"></div></div></aside>`;
}
function bindDocumentMinimap() {
  const minimap = app.querySelector('.document-minimap');
  const track = minimap ? minimap.querySelector('.document-minimap-track') : null;
  if (!track) {
    return;
  }
  const restoreFocus = () => {
    const active = document.activeElement;
    return () => {
      if (active && typeof active.focus === 'function' && document.contains(active)) {
        active.focus({ preventScroll: true });
      }
    };
  };
  const minimapPointerOffset = (event) => {
    const viewport = track.querySelector('.document-minimap-viewport');
    const viewportRect = viewport ? viewport.getBoundingClientRect() : null;
    if (!viewportRect || event.clientY < viewportRect.top || event.clientY > viewportRect.bottom) {
      return null;
    }
    return event.clientY - viewportRect.top;
  };
  // Dragging the handle keeps the grabbed point of the box under the cursor and
  // converts the box's new position back into a reader scroll offset — the inverse
  // of updateMinimapViewport()'s placement math, so the box and the thumbnail slide
  // stay under the cursor even on documents taller than the rail.
  const dragMinimapViewportToPointer = (event, pointerOffsetY) => {
    // Use the geometry captured at pointerdown — never re-measure mid-drag (that
    // forces a full document layout each move; see minimapDragMetrics).
    const metrics = minimapDragMetrics || measureDocumentMinimap(track);
    const rect = metrics.trackRect;
    if (rect.height <= 0 || metrics.scrollable <= 0) {
      updateMinimapViewport();
      return;
    }
    const previewScale = metrics.scrollHeight <= 0 ? 1 : minimapDragScale;
    const scaledDocumentHeight = Math.max(1, metrics.scrollHeight * previewScale);
    const viewportHeight = metrics.scrollHeight <= 0 ? metrics.trackHeight : Math.max(22, metrics.viewportHeight * previewScale);
    const boundedViewportHeight = Math.min(metrics.trackHeight, viewportHeight);
    const handleRange = Math.max(0, metrics.trackHeight - boundedViewportHeight);
    const offsetY = Number.isFinite(pointerOffsetY) ? pointerOffsetY : boundedViewportHeight / 2;
    const targetViewportTop = Math.min(handleRange, Math.max(0, event.clientY - rect.top - offsetY));
    // Inverse of updateMinimapViewport()'s box placement, which is
    // viewportTop = scrollRatio * boxTravel: the full handle range on a thumbnail
    // taller than the rail, or the short thumbnail's own travel when it fits. Both
    // are driven by scrollRatio, so a box position maps straight back to a reader
    // scroll offset.
    const previewTravel = Math.max(0, scaledDocumentHeight - metrics.trackHeight);
    const boxTravel = previewTravel > 0 ? handleRange : Math.max(0, scaledDocumentHeight - boundedViewportHeight);
    const targetViewportScrollTop = boxTravel <= 0 ? 0 : (targetViewportTop / boxTravel) * metrics.scrollable;
    // Set scrollTop directly against the cached range. The target is already bounded
    // to [0, scrollable], so going through setReaderScrollTop (which re-derives the
    // range via correctReaderScrollOrigin — a write+read layout) would only add the
    // per-move thrash this drag path is built to avoid.
    app.scrollTop = metrics.topOffset + Math.min(metrics.scrollable, Math.max(0, targetViewportScrollTop));
    // Pin the box (and thumbnail slide) to the cursor for the duration of the drag
    // instead of recomputing from the reader's geometry. On a huge document the reader
    // is still laying out under the drag (content-visibility), so a geometry-driven
    // update mid-drag makes the box flicker to the top and back. The scroll handler
    // skips its update while minimapDragging is set; pointerup settles to the true
    // position once (see endDrag).
    const minimap = track.closest('.document-minimap');
    if (minimap) {
      const dragRatio = boxTravel <= 0 ? 0 : Math.min(1, Math.max(0, targetViewportTop / boxTravel));
      minimap.style.setProperty('--minimap-viewport-top', `${targetViewportTop}px`);
      minimap.style.setProperty('--minimap-viewport-height', `${boundedViewportHeight}px`);
      minimap.style.setProperty('--minimap-preview-top', `${-dragRatio * previewTravel}px`);
    } else {
      updateMinimapViewport();
    }
  };
  // A plain click on the rail centers the reader on the clicked point of the
  // thumbnail (mapped straight through the preview scale).
  const scrollToMinimapSnapshotPoint = (event) => {
    const metrics = measureDocumentMinimap(track);
    const content = track.querySelector('.document-minimap-content');
    const contentRect = content ? content.getBoundingClientRect() : null;
    if (!contentRect || contentRect.height <= 0 || metrics.scrollHeight <= 0 || metrics.scrollable <= 0) {
      updateMinimapViewport();
      return;
    }
    const previewScale = minimapPreviewScale(track, metrics);
    if (!Number.isFinite(previewScale) || previewScale <= 0) {
      updateMinimapViewport();
      return;
    }
    const clickedDocumentY = (event.clientY - contentRect.top) / previewScale;
    const targetViewportScrollTop = Math.min(metrics.scrollable, Math.max(0, clickedDocumentY - metrics.viewportHeight / 2));
    setReaderScrollTop(metrics.topOffset + targetViewportScrollTop);
    updateMinimapViewport();
  };
  track.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    const focusAfterJump = restoreFocus();
    event.preventDefault();
    minimapPointerId = event.pointerId;
    minimapDragging = true;
    minimapPointerOffsetY = minimapPointerOffset(event);
    // Measure the document geometry ONCE for the whole drag (see minimapDragMetrics).
    minimapDragMetrics = measureDocumentMinimap(track);
    minimapDragScale =
      minimapDragMetrics.scrollHeight <= 0 ? 1 : minimapPreviewScale(track, minimapDragMetrics);
    track.setPointerCapture(event.pointerId);
    if (Number.isFinite(minimapPointerOffsetY)) {
      dragMinimapViewportToPointer(event, minimapPointerOffsetY);
    } else {
      scrollToMinimapSnapshotPoint(event);
    }
    focusAfterJump();
  });
  track.addEventListener('pointermove', (event) => {
    if (event.pointerId !== minimapPointerId) {
      return;
    }
    event.preventDefault();
    dragMinimapViewportToPointer(event, minimapPointerOffsetY);
  });
  const endDrag = (event) => {
    if (event.pointerId === minimapPointerId) {
      minimapPointerId = null;
      minimapPointerOffsetY = null;
      minimapDragging = false;
      minimapDragMetrics = null;
      // Settle the box/thumbnail onto the true reading position now that the drag is
      // over. Content that streamed in under the drag keeps settling afterward via the
      // reader's reflow observer, which also refreshes the box.
      updateMinimapViewport();
    }
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('lostpointercapture', endDrag);
  bindDocumentMinimapPreview(track);
}
// The minimap is a shrunken clone of the rendered document, so the rail shows the
// real text — not abstract bars. The clone is rebuilt only when the document's
// CONTENT changes (a new document, live reload, or code highlighting / Mermaid /
// math settling — all real DOM mutations), never on scroll. content-visibility
// resizes the reader's blocks as you scroll, but that is pure rendering (no
// mutation) and the clone lays out in full regardless, so we deliberately do NOT
// observe the source's SIZE: rebuilding a whole-document clone on every scroll is
// exactly what stuttered on large files. Only the small viewport box (and, on tall
// documents, the thumbnail's slide) moves on scroll.
function bindDocumentMinimapPreview(track) {
  disconnectMinimapPreviewObservers();
  const source = app.querySelector('.document-body');
  if (!source) {
    return;
  }
  minimapBodyObserver = new MutationObserver(invalidateMinimapPreview);
  minimapBodyObserver.observe(source, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  if (window.ResizeObserver) {
    // Watch the rail, not the document: the rail's width changes at the responsive
    // breakpoints (which the source's own resize would miss when the reading column
    // is already at its max width), and it never fires on scroll.
    minimapResizeObserver = new ResizeObserver(() => {
      scheduleReaderLayoutUpdate();
      scheduleMinimapPreviewUpdate();
    });
    minimapResizeObserver.observe(track);
  }
  source.querySelectorAll('img').forEach((image) => {
    if (image.complete) {
      return;
    }
    image.addEventListener('load', invalidateMinimapPreview, { once: true });
    image.addEventListener('error', invalidateMinimapPreview, { once: true });
  });
  scheduleMinimapPreviewUpdate();
}
function disconnectMinimapPreviewObservers() {
  if (minimapBodyObserver) {
    minimapBodyObserver.disconnect();
    minimapBodyObserver = null;
  }
  if (minimapResizeObserver) {
    minimapResizeObserver.disconnect();
    minimapResizeObserver = null;
  }
  if (minimapPreviewFrame) {
    window.cancelAnimationFrame(minimapPreviewFrame);
    minimapPreviewFrame = 0;
  }
  // A different document is coming: force the next update to rebuild the clone
  // rather than match the previous document's cached width/version by chance.
  minimapBuiltVersion = -1;
  minimapBuiltSourceWidth = -1;
  minimapBuiltPreviewWidth = -1;
}
function measureDocumentContent(source) {
  if (!source) {
    return { rawTopOffset: 0, topOffset: 0, height: 1 };
  }
  const shellRect = app.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  const firstContent = source.firstElementChild;
  const firstContentRect = firstContent ? firstContent.getBoundingClientRect() : sourceRect;
  const rawTopOffset = Math.ceil(app.scrollTop + firstContentRect.top - shellRect.top);
  const topOffset = Math.max(0, rawTopOffset - READER_CONTENT_TOP_GAP);
  const sourceTop = Math.max(0, app.scrollTop + sourceRect.top - shellRect.top);
  const sourceBottom = sourceTop + Math.max(source.scrollHeight, sourceRect.height);
  const height = Math.max(1, Math.ceil(sourceBottom - topOffset));
  return { rawTopOffset, topOffset, height };
}
function readerScrollOrigin(source) {
  if (!source) {
    return 0;
  }
  const value = Number.parseFloat(source.style.getPropertyValue('--reader-scroll-origin'));
  return Number.isFinite(value) ? value : 0;
}
function correctReaderScrollOrigin(source = app.querySelector('.document-body')) {
  if (!currentState?.document || !source) {
    return { rawTopOffset: 0, topOffset: 0, height: 1 };
  }
  const content = measureDocumentContent(source);
  const origin = readerScrollOrigin(source);
  const nextOrigin = Math.max(0, Math.ceil(content.rawTopOffset + origin - READER_CONTENT_TOP_GAP));
  if (Math.abs(nextOrigin - origin) >= 0.5) {
    source.style.setProperty('--reader-scroll-origin', `${nextOrigin}px`);
  }
  return measureDocumentContent(source);
}
function measureReaderScrollRange(documentContent, viewportHeight) {
  const scrollHeight = Math.max(documentContent.height, Math.ceil(app.scrollHeight - documentContent.topOffset));
  const scrollable = Math.max(0, scrollHeight - viewportHeight);
  return {
    scrollHeight,
    scrollable,
    minScrollTop: documentContent.topOffset,
    maxScrollTop: documentContent.topOffset + scrollable,
  };
}
function clampReaderScrollTop(scrollTop) {
  const nextScrollTop = Number(scrollTop);
  if (!Number.isFinite(nextScrollTop)) {
    return 0;
  }
  const source = app.querySelector('.document-body');
  if (!currentState?.document || !source) {
    return Math.max(0, nextScrollTop);
  }
  const content = correctReaderScrollOrigin(source);
  const viewportHeight = Math.max(1, Math.ceil(app.clientHeight));
  const range = measureReaderScrollRange(content, viewportHeight);
  return Math.min(range.maxScrollTop, Math.max(range.minScrollTop, nextScrollTop));
}
function setReaderScrollTop(scrollTop) {
  app.scrollTop = clampReaderScrollTop(scrollTop);
}
function clampReaderScrollPosition() {
  if (!currentState?.document) {
    return false;
  }
  const clampedScrollTop = clampReaderScrollTop(app.scrollTop);
  if (Math.abs(clampedScrollTop - app.scrollTop) < 0.5) {
    return false;
  }
  app.scrollTop = clampedScrollTop;
  return true;
}
function resetReaderScrollToContentStart() {
  window.requestAnimationFrame(() => {
    const source = app.querySelector('.document-body');
    const content = correctReaderScrollOrigin(source);
    setReaderScrollTop(content.topOffset);
    readerScrollAnchor = captureReaderScrollAnchor();
    updateMinimapViewport();
  });
}
// Describe the reader's current position as a serializable, render-independent
// anchor: the nearest heading slug above the top edge, the ordinal of the block
// within that section (the heading itself is block 0), and the signed pixel
// offset of the top edge from that block's top. The offset is signed so it
// preserves the reading-mode top gap at the start of a document (where the edge
// sits above the first block). Measuring the ordinal from the section, not the
// document start, keeps the landing stable when content is added to earlier
// sections (e.g. live reload after an edit).
// The anchor blocks are in document order, so their vertical positions increase
// monotonically down the list. That lets the topmost-visible block be found with
// a binary search (~log2(n) rect reads) instead of scanning every block on every
// scroll event — the difference between a handful of reads and ~25k deep in a
// glossary.
function readerAnchorBlockList(source) {
  const count = source.childElementCount;
  const stale =
    !readerAnchorBlocks ||
    readerAnchorBlocksCount !== count ||
    !readerAnchorBlocks.length ||
    !readerAnchorBlocks[0].isConnected;
  if (stale) {
    readerAnchorBlocks = Array.from(source.querySelectorAll(READER_ANCHOR_SELECTOR));
    readerAnchorBlocksCount = count;
  }
  return readerAnchorBlocks;
}
function captureReaderScrollAnchor() {
  const source = app.querySelector('.document-body');
  if (!currentState?.document || !source) {
    return null;
  }
  const blocks = readerAnchorBlockList(source);
  if (!blocks.length) {
    return null;
  }
  const shellRect = app.getBoundingClientRect();
  const topEdge = shellRect.top + 1;
  let lo = 0;
  let hi = blocks.length - 1;
  let targetIndex = blocks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].getBoundingClientRect().bottom > topEdge) {
      targetIndex = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  let sectionIndex = -1;
  let section = null;
  for (let i = targetIndex; i >= 0; i--) {
    const element = blocks[i];
    if (/^H[1-6]$/.test(element.tagName) && element.id) {
      section = element.id;
      sectionIndex = i;
      break;
    }
  }
  const target = blocks[targetIndex];
  const rect = target.getBoundingClientRect();
  const offsetY = shellRect.top - rect.top;
  return { section, block: targetIndex - (sectionIndex < 0 ? 0 : sectionIndex), offsetY };
}
// Re-resolve a serializable anchor against the current DOM. The same Markdown
// renders the same blocks, so the section heading and block ordinal point back
// at the original element even after a full re-render.
function resolveReaderAnchorElement(anchor) {
  const source = app.querySelector('.document-body');
  if (!source || !anchor) {
    return null;
  }
  const blocks = Array.from(source.querySelectorAll(READER_ANCHOR_SELECTOR));
  if (!blocks.length) {
    return null;
  }
  let start = 0;
  if (anchor.section) {
    const index = blocks.findIndex((element) => element.id === anchor.section && /^H[1-6]$/.test(element.tagName));
    if (index >= 0) {
      start = index;
    }
  }
  const block = Math.max(0, Math.floor(Number(anchor.block) || 0));
  return blocks[Math.min(start + block, blocks.length - 1)] || blocks[blocks.length - 1];
}
function restoreReaderScrollAnchor(anchor) {
  const element = resolveReaderAnchorElement(anchor);
  if (!element || !element.isConnected) {
    clampReaderScrollPosition();
    return;
  }
  const shellRect = app.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const offsetY = Number.isFinite(anchor?.offsetY) ? anchor.offsetY : 0;
  setReaderScrollTop(app.scrollTop + rect.top - shellRect.top + offsetY);
}
function scheduleReaderLayoutUpdate(anchor = readerScrollAnchor || captureReaderScrollAnchor()) {
  if (readerLayoutFrame) {
    return;
  }
  readerLayoutFrame = window.requestAnimationFrame(() => {
    readerLayoutFrame = 0;
    correctReaderScrollOrigin();
    restoreReaderScrollAnchor(anchor);
    readerScrollAnchor = captureReaderScrollAnchor();
    // Don't move the box off the cursor while the minimap is being dragged; the drag
    // pins it and endDrag settles it.
    if (!minimapDragging) {
      updateMinimapViewport();
    }
  });
}
function disconnectReaderReflowObserver() {
  if (readerReflowObserver) {
    readerReflowObserver.disconnect();
    readerReflowObserver = null;
  }
}
// Keep the reader pinned to its anchor as the document settles. Images decode a
// few frames after a re-render and grow the content above the reader; without
// this the saved anchor would be restored once into a still-collapsing layout
// and then drift downward as the images land. Re-pinning on every reflow — and
// on each image load — holds the reader on the same block until layout is final.
function observeReaderReflow() {
  disconnectReaderReflowObserver();
  const source = app.querySelector('.document-body');
  if (!source) {
    return;
  }
  if (typeof ResizeObserver !== 'undefined') {
    readerReflowObserver = new ResizeObserver(() => scheduleReaderLayoutUpdate());
    readerReflowObserver.observe(source);
  }
  source.querySelectorAll('img').forEach((image) => {
    if (image.complete) {
      return;
    }
    image.addEventListener('load', () => scheduleReaderLayoutUpdate(), { once: true });
    image.addEventListener('error', () => scheduleReaderLayoutUpdate(), { once: true });
  });
}
function syncMinimapTrackHeight(minimap) {
  const shellRect = app.getBoundingClientRect();
  const minimapRect = minimap.getBoundingClientRect();
  const availableHeight = Math.max(1, Math.floor(shellRect.bottom - minimapRect.top));
  const content = minimap.querySelector('.document-minimap-content');
  const contentRect = content ? content.getBoundingClientRect() : null;
  const contentHeight = contentRect ? Math.ceil(contentRect.height) : 0;
  const trackHeight = contentHeight > 0 ? Math.min(availableHeight, contentHeight) : availableHeight;
  minimap.style.setProperty('--minimap-track-height', `${trackHeight}px`);
  return { availableHeight, trackHeight };
}
function measureDocumentMinimap(track) {
  const minimap = track.closest('.document-minimap');
  const source = app.querySelector('.document-body');
  const trackSize = minimap ? syncMinimapTrackHeight(minimap) : null;
  const shellHeight = trackSize ? trackSize.availableHeight : Math.max(1, app.clientHeight);
  const sourceRect = source ? source.getBoundingClientRect() : null;
  const sourceWidth = sourceRect ? Math.max(1, Math.ceil(sourceRect.width)) : 1;
  const documentContent = correctReaderScrollOrigin(source);
  const documentHeight = documentContent.height;
  const trackRect = track.getBoundingClientRect();
  const trackHeight = Math.max(1, Math.ceil(track.clientHeight || trackRect.height || trackSize?.trackHeight || shellHeight));
  const viewportHeight = Math.max(1, Math.ceil(app.clientHeight || shellHeight));
  const scrollRange = measureReaderScrollRange(documentContent, viewportHeight);
  const scrollHeight = scrollRange.scrollHeight;
  const scrollable = scrollRange.scrollable;
  const viewportScrollTop = Math.min(scrollable, Math.max(0, app.scrollTop - documentContent.topOffset));
  return { source, sourceWidth, documentHeight, topOffset: documentContent.topOffset, trackRect, trackHeight, viewportHeight, scrollHeight, scrollable, viewportScrollTop };
}
function minimapPreviewScale(track, metrics) {
  const content = track.querySelector('.document-minimap-content');
  const contentWidth = content ? Math.max(1, content.getBoundingClientRect().width) : metrics.sourceWidth;
  return contentWidth / Math.max(1, metrics.sourceWidth);
}
function scheduleMinimapPreviewUpdate() {
  if (minimapPreviewFrame) {
    return;
  }
  minimapPreviewFrame = window.requestAnimationFrame(() => {
    minimapPreviewFrame = 0;
    updateDocumentMinimapPreview();
  });
}
// The document content changed (a mutation, an image finishing decode): the
// cached clone is stale, so mark it for a rebuild and schedule one. Geometry-only
// triggers (resize) call scheduleMinimapPreviewUpdate directly and let the
// width check in updateDocumentMinimapPreview decide whether a rebuild is needed.
function invalidateMinimapPreview() {
  minimapContentVersion += 1;
  scheduleMinimapPreviewUpdate();
}
// Build the thumbnail: clone the rendered document, strip ids/links (so nothing is
// focusable or duplicated for assistive tech), and shrink it to the rail width with
// a CSS transform. The clone is exempt from content-visibility (see the CSS), so it
// lays out in full at its true height — the ground truth we size the lane to, so
// the viewport box lines up with the real thumbnail even while the reader's own
// content-visibility scroll estimate is still settling.
function updateDocumentMinimapPreview() {
  const minimap = app.querySelector('.document-minimap');
  const track = minimap ? minimap.querySelector('.document-minimap-track') : null;
  const content = track ? track.querySelector('.document-minimap-content') : null;
  const source = app.querySelector('.document-body');
  if (!track || !content || !source) {
    return;
  }
  const metrics = measureDocumentMinimap(track);
  const contentRect = content.getBoundingClientRect();
  const previewWidth = Math.max(1, Math.ceil(contentRect.width));
  const previewScale = previewWidth / metrics.sourceWidth;
  // Skip the clone when nothing that shapes the thumbnail changed: same content
  // (version), same wrap width (sourceWidth governs how the clone's text wraps),
  // and same rail width (previewWidth governs the scale). This is the common
  // resize — a height-only change, or a width change within the capped reading
  // column — and any redundant trigger. Just reposition the box off the existing
  // clone; the whole-document cloneNode below is what made resize feel like a reload.
  if (
    content.querySelector('.document-minimap-preview') &&
    minimapBuiltVersion === minimapContentVersion &&
    minimapBuiltSourceWidth === metrics.sourceWidth &&
    minimapBuiltPreviewWidth === previewWidth
  ) {
    updateMinimapViewport();
    return;
  }
  const preview = source.cloneNode(true);
  preview.removeAttribute('id');
  preview.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  preview.querySelectorAll('a[href]').forEach((link) => {
    // Glossary terms blend into the body text on the page (the a[href^="glossary:"]
    // rule takes the surrounding colour, not the accent link colour). Stripping the
    // href for a11y also drops that href-based blend, which would leave the terms on
    // the generic accent colour in the thumbnail. Tag them first so a class-based
    // rule can re-blend them in the clone, keeping the rail true to the page.
    const href = link.getAttribute('href') || '';
    if (/^glossary:/i.test(href) || /GLOSSARY\.md#/i.test(href)) {
      link.classList.add('glossary-term');
    }
    link.removeAttribute('href');
  });
  preview.classList.add('document-minimap-preview');
  preview.setAttribute('aria-hidden', 'true');
  preview.style.width = `${metrics.sourceWidth}px`;
  preview.style.transform = `scale(${previewScale})`;
  content.replaceChildren(preview);
  // The transform does not affect layout height, so preview.scrollHeight is the
  // clone's true unscaled height; scale it for the lane the box travels.
  const documentHeight = Math.max(1, metrics.scrollHeight, Math.ceil(preview.scrollHeight));
  content.style.height = `${documentHeight * previewScale}px`;
  // Record each anchor block's true (unscaled) offset in the clone, in document
  // order, so updateMinimapViewport can map the reader's top-visible block to its
  // real document position. offsetTop is a layout value, unaffected by the scale
  // transform, so it is already in the same unscaled space as documentHeight.
  const cloneBlocks = preview.querySelectorAll(READER_ANCHOR_SELECTOR);
  minimapCloneOffsets = new Float64Array(cloneBlocks.length);
  for (let i = 0; i < cloneBlocks.length; i++) {
    minimapCloneOffsets[i] = cloneBlocks[i].offsetTop;
  }
  minimapBuiltVersion = minimapContentVersion;
  minimapBuiltSourceWidth = metrics.sourceWidth;
  minimapBuiltPreviewWidth = previewWidth;
  updateMinimapViewport();
}
function scheduleMinimapViewportUpdate() {
  if (minimapViewportFrame) {
    return;
  }
  minimapViewportFrame = window.requestAnimationFrame(() => {
    minimapViewportFrame = 0;
    updateMinimapViewport();
  });
}
// The reader's true scroll distance (unscaled document px from the content start to
// the viewport top), read from real geometry only. Find the topmost anchor block
// still crossing the viewport top (binary search, same as the scroll anchor), then
// add its own true offset in the clone to how far the viewport has scrolled into it.
// The reader block is on screen so its rect is real; the clone offset is real; so the
// result is exact even when app.scrollTop is a content-visibility estimate (blocks
// above never rendered after a jump). Returns null when the clone/anchor lists are not
// yet in sync, so the caller can fall back to the estimate.
function minimapReaderTrueScrolled() {
  const source = app.querySelector('.document-body');
  if (!source || !minimapCloneOffsets || !minimapCloneOffsets.length) {
    return null;
  }
  const blocks = readerAnchorBlockList(source);
  if (blocks.length !== minimapCloneOffsets.length) {
    return null;
  }
  const shellRect = app.getBoundingClientRect();
  const topEdge = shellRect.top + 1;
  let lo = 0;
  let hi = blocks.length - 1;
  let targetIndex = blocks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].getBoundingClientRect().bottom > topEdge) {
      targetIndex = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  const rect = blocks[targetIndex].getBoundingClientRect();
  const offsetIntoBlock = topEdge - rect.top;
  return Math.max(0, minimapCloneOffsets[targetIndex] + offsetIntoBlock);
}
// Place the viewport box and, on documents taller than the rail, slide the
// thumbnail inside the rail (the way a code editor's minimap does). The document
// height and the reading position both come from the fully-laid-out clone, so the
// box tracks the real thumbnail; the box height comes from the reader viewport.
function updateMinimapViewport() {
  const minimap = app.querySelector('.document-minimap');
  if (!minimap) {
    return;
  }
  const track = minimap.querySelector('.document-minimap-track');
  const content = minimap.querySelector('.document-minimap-content');
  if (!track) {
    return;
  }
  const metrics = measureDocumentMinimap(track);
  const preview = content ? content.querySelector('.document-minimap-preview') : null;
  const previewScale = metrics.scrollHeight <= 0 ? 1 : minimapPreviewScale(track, metrics);
  const documentHeight = Math.max(1, metrics.scrollHeight, preview ? Math.ceil(preview.scrollHeight) : 0);
  const scaledDocumentHeight = Math.max(1, documentHeight * previewScale);
  if (content) {
    content.style.height = `${scaledDocumentHeight}px`;
  }
  // Scroll fraction lives entirely in the clone's true coordinate space: the reading
  // position from minimapReaderTrueScrolled() (real block geometry) over the true
  // scrollable range (clone height minus the viewport). Neither term uses the reader's
  // scrollHeight, which is a content-visibility ESTIMATE that undershoots on a long
  // document (lower blocks charged at their 48px placeholder) and is flat wrong after a
  // scrollbar jump (blocks above never rendered). Falls back to the scroll-position
  // estimate only until the clone's offsets are ready.
  const trueScrollable = Math.max(0, documentHeight - metrics.viewportHeight);
  const trueScrolled = minimapReaderTrueScrolled();
  const scrolled = trueScrolled === null ? metrics.viewportScrollTop : trueScrolled;
  const scrollRatio = trueScrollable === 0 ? 0 : Math.min(1, Math.max(0, scrolled / trueScrollable));
  const viewportHeight = metrics.scrollHeight <= 0 ? metrics.trackHeight : Math.max(22, metrics.viewportHeight * previewScale);
  const boundedViewportHeight = Math.min(metrics.trackHeight, viewportHeight);
  const previewTop = -scrollRatio * Math.max(0, scaledDocumentHeight - metrics.trackHeight);
  // The reading position within the scaled thumbnail. It must be derived from the
  // same scrollRatio that slides the thumbnail (previewTop), NOT from
  // viewportScrollTop * previewScale: the reader's scrollHeight is a
  // content-visibility ESTIMATE that disagrees with the fully-laid-out clone's true
  // height, so mixing the two puts the box off the top (previewTop + a too-small
  // documentTop goes negative and clamps to 0 — the "stuck at top" bug). Driving both
  // off scrollRatio keeps them consistent: box = scrollRatio * (trackHeight - box) for
  // a tall thumbnail, and stays inside a short thumbnail that fits the rail.
  const viewportDocumentTop = scrollRatio * Math.max(0, scaledDocumentHeight - boundedViewportHeight);
  const viewportTop = Math.min(Math.max(0, metrics.trackHeight - boundedViewportHeight), Math.max(0, previewTop + viewportDocumentTop));
  minimap.style.setProperty('--minimap-viewport-top', `${viewportTop}px`);
  minimap.style.setProperty('--minimap-viewport-height', `${boundedViewportHeight}px`);
  minimap.style.setProperty('--minimap-preview-top', `${previewTop}px`);
}
// The scroll listener must stay cheap: scroll fires many times per frame, so any
// forced layout here stutters the whole page. clampReaderScrollPosition() and
// captureReaderScrollAnchor() both read live geometry (getBoundingClientRect), which
// forces a synchronous reflow — running them on every event is what made desktop
// scrolling judder where the web reader (a passive, rAF-only listener — see
// site/minimap.js) stays smooth. So mark the listener passive and coalesce that work
// into one rAF per frame. scheduleMinimapViewportUpdate() is itself only a flag check
// plus a rAF schedule, so it is safe to call on the event. The scroll anchor is only
// consumed asynchronously (reflow re-pin, re-render, and navigation which recaptures
// it fresh), so updating it a frame late costs nothing.
let readerScrollFrame = 0;
app.addEventListener('scroll', () => {
  // A minimap drag owns the scroll entirely: it sets an already-clamped scrollTop
  // and pins the box via CSS vars, and endDrag re-captures the anchor and box on
  // release. So do NOTHING here during a drag — running clampReaderScrollPosition()
  // and captureReaderScrollAnchor() (each a forced synchronous layout) once per
  // frame while dragging a large document is exactly the stutter we are removing.
  if (minimapDragging) {
    return;
  }
  scheduleMinimapViewportUpdate();
  if (readerScrollFrame) {
    return;
  }
  readerScrollFrame = window.requestAnimationFrame(() => {
    readerScrollFrame = 0;
    clampReaderScrollPosition();
    readerScrollAnchor = captureReaderScrollAnchor();
  });
}, { passive: true });
window.addEventListener('resize', () => {
  scheduleReaderLayoutUpdate();
  scheduleMinimapViewportUpdate();
  scheduleMinimapPreviewUpdate();
});
window.leafShowError = (message) => {
  const existing = document.querySelector('.app-error');
  if (existing) {
    existing.remove();
  }
  const error = document.createElement('div');
  error.className = 'app-error';
  error.setAttribute('role', 'status');
  error.textContent = message;
  document.body.appendChild(error);
  setTimeout(() => error.remove(), 7000);
};
window.leafShowOpenError = (path, reason) => {
  window.leafShowError(window.leafLocale.t('errors.openFailed', { path, reason }));
};
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function escapeAttr(value) {
  return escapeText(value).replace(/`/g, '&#96;');
}
window.leafSetState(window.__leafInitialState || { recent: [], document: null });
window.leafSetNavigation({ canGoBack: false, canGoForward: false });