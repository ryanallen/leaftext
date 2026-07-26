const app = document.getElementById('app');
const appBar = document.getElementById('appBar');
const appTrailing = document.querySelector('.app-trailing');
const appTrailingItems = document.getElementById('appTrailingItems');
const overflowToggle = document.getElementById('overflowToggle');
const tabBar = document.getElementById('tabBar');
const homeButton = document.getElementById('homeButton');
const backButton = document.getElementById('backButton');
const forwardButton = document.getElementById('forwardButton');
const themeSheet = document.getElementById('themeSheet');
const themeBackdrop = document.getElementById('themeBackdrop');
const themeSheetOpen = document.getElementById('themeSheetOpen');
const themeSheetClose = document.getElementById('themeSheetClose');
const themeSheetModes = document.getElementById('themeSheetModes');
const themeSheetGrid = document.getElementById('themeSheetGrid');
const themeSheetBrowse = document.getElementById('themeSheetBrowse');
const themeCurrentLabel = document.getElementById('themeCurrentLabel');
const THEME_REPO_URL = 'https://github.com/ryanallen/leaftext';
const minimapEnabledControl = document.getElementById('minimapEnabled');
const graphScopeControl = document.getElementById('graphScope');
const pagerEnabledControl = document.getElementById('pagerEnabled');
const speedReaderEnabledControl = document.getElementById('speedReaderEnabled');
const lineNumbersEnabledControl = document.getElementById('lineNumbersEnabled');
const readerEditingEnabledControl = document.getElementById('readerEditingEnabled');
const indexingEnabledControl = document.getElementById('indexingEnabled');
const libraryShell = document.getElementById('libraryShell');
const libraryPane = document.getElementById('libraryPane');
const libraryDivider = document.getElementById('libraryDivider');
const libraryOpen = document.getElementById('libraryOpen');
const libraryTree = document.getElementById('libraryTree');
const libraryGraph = document.getElementById('libraryGraph');
const libraryGraphCanvas = document.getElementById('libraryGraphCanvas');
const libraryGraphStatus = document.getElementById('libraryGraphStatus');
const libraryCrumbTrail = document.getElementById('libraryCrumbTrail');
const libraryGraphToggle = document.getElementById('libraryGraphToggle');
const librarySearch = document.getElementById('librarySearch');
const librarySearchResults = document.getElementById('librarySearchResults');
const libraryScanProgress = document.getElementById('libraryScanProgress');
const settingsMenu = document.getElementById('settingsMenu');
const readerLoading = document.getElementById('readerLoading');
let tabDrag = null;
let suppressTabClick = false;
tabBar.addEventListener('wheel', (event) => {
  if (event.deltaY === 0) return;
  if (tabBar.scrollWidth <= tabBar.clientWidth) return;
  event.preventDefault();
  tabBar.scrollLeft += event.deltaY;
}, { passive: false });
// Manual pointer-based tab reordering (WebView2 doesn't fire HTML5 drag events
// reliably in-page). Computes the insertion slot from the pointer vs. the other
// tabs' centers and sends moveTab on drop.
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
    // Settle the tab into its new slot immediately (transitions suppressed), so
    // it doesn't snap back and then jump when the moveTab re-render lands a frame
    // or two later.
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
// A slow document renders on the Rust side before the HTML comes back. Show a
// spinner over the reader immediately during that work, cleared when the
// document state arrives; a safety timeout guarantees it never sticks.
const READER_LOADING_SAFETY_MS = 30000;
let readerLoadingSafety = 0;
function beginReaderLoading() {
  clearReaderLoading();
  if (readerLoading) readerLoading.hidden = false;
  readerLoadingSafety = setTimeout(clearReaderLoading, READER_LOADING_SAFETY_MS);
}
function clearReaderLoading() {
  if (readerLoadingSafety) { clearTimeout(readerLoadingSafety); readerLoadingSafety = 0; }
  if (readerLoading) readerLoading.hidden = true;
}
// Commands whose host handler always renders a document back, so raising the
// spinner here and letting that reply lower it is safe. Tab switches and the
// code-view toggle arm at their call sites (they need a no-op guard); other
// paths (picker, drag-drop, links) are armed host-side before the render.
const READER_LOADING_COMMANDS = new Set(['openRecent']);
const send = (message) => {
  if (message && READER_LOADING_COMMANDS.has(message.command)) beginReaderLoading();
  window.ipc.postMessage(JSON.stringify(message));
};

// Custom title-bar chrome for frameless windows (Windows): there's no native
// title bar, so the app bar is the drag region and carries our own window
// controls. On decorated platforms this stays hidden and the OS chrome is used.
if (window.__leafFrameless) {
  document.body.classList.add('frameless');
  const windowControls = document.getElementById('windowControls');
  if (windowControls) {
    windowControls.hidden = false;
    windowControls.setAttribute('aria-hidden', 'false');
  }
  const winButton = (id, command) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => send({ command }));
  };
  winButton('winMinimize', 'windowMinimize');
  winButton('winMaximize', 'windowToggleMaximize');
  winButton('winClose', 'windowClose');
  // Drag from empty app-bar space only — never from a control, tab, or field.
  const isDragTarget = (target) =>
    target &&
    !target.closest('button, a, input, select, textarea, [role="tab"], .tab, .window-controls, .settings-menu');
  appBar.addEventListener('mousedown', (event) => {
    if (event.button === 0 && isDragTarget(event.target)) send({ command: 'windowDrag' });
  });
  appBar.addEventListener('dblclick', (event) => {
    if (isDragTarget(event.target)) send({ command: 'windowToggleMaximize' });
  });
}
// Reflect the real maximized state: body.is-maximized swaps the maximize glyph
// for restore-down (CSS) and the label follows. Defined unconditionally (not just
// frameless) so the host's call is always safe — a no-op where controls are hidden.
window.leafSetWindowMaximized = (maximized) => {
  document.body.classList.toggle('is-maximized', !!maximized);
  const el = document.getElementById('winMaximize');
  if (el) {
    const label = maximized ? 'Restore' : 'Maximize';
    el.setAttribute('aria-label', label);
    el.setAttribute('title', label);
  }
};
window.leafSetWindowMaximized(window.__leafMaximized);

// --- App-bar overflow -------------------------------------------------------
// Too narrow to show the trailing group (actions + window controls) inline? Fold
// it into a chevron dropdown, leaving just the chevron. Fit is measured, not a
// breakpoint, because the lead widens with the library rail.
let appTrailingInlineWidth = 0;
const APP_BAR_MIN_TABS = 56; // room kept for at least a sliver of the tab strip
function closeOverflowMenu() {
  appTrailing.classList.remove('overflow-open');
  overflowToggle.setAttribute('aria-expanded', 'false');
}
function refitAppBar() {
  const collapsed = appTrailing.classList.contains('collapsed');
  // Measure the inline row only while expanded; collapsed it's an absolute
  // dropdown whose width isn't what the fit compares against.
  if (!collapsed) appTrailingInlineWidth = appTrailingItems.offsetWidth;
  const lead = document.querySelector('.app-bar-lead');
  const needed = (lead ? lead.offsetWidth : 0) + appTrailingInlineWidth + APP_BAR_MIN_TABS;
  const shouldCollapse = needed > appBar.clientWidth;
  if (shouldCollapse === collapsed) return;
  appTrailing.classList.toggle('collapsed', shouldCollapse);
  if (!shouldCollapse) closeOverflowMenu();
}
overflowToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  const open = appTrailing.classList.toggle('overflow-open');
  overflowToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
});
// Dismiss on outside click / Escape, like the other menus.
document.addEventListener('click', (event) => {
  if (appTrailing.classList.contains('overflow-open') && !appTrailing.contains(event.target)) {
    closeOverflowMenu();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeOverflowMenu();
});
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => refitAppBar()).observe(appBar);
}
window.addEventListener('resize', refitAppBar);
const MERMAID_SCRIPT_URL = '{{MERMAID_SCRIPT_URL}}';
const KATEX_SCRIPT_URL = '{{KATEX_SCRIPT_URL}}';
const PIXI_SCRIPT_URL = '{{PIXI_SCRIPT_URL}}';
const PIXI_UNSAFE_EVAL_SCRIPT_URL = '{{PIXI_UNSAFE_EVAL_SCRIPT_URL}}';
const D3_FORCE_SCRIPT_URL = '{{D3_FORCE_SCRIPT_URL}}';
let mermaidLoadPromise = null;
let katexLoadPromise = null;
document.getElementById('openButton').addEventListener('click', () => send({ command: 'open' }));
homeButton.addEventListener('click', () => send({ command: 'goHome' }));
// Right-click menu for library file rows, acting on the row's path. Groups:
// open, clipboard, rename, locate, and destructive delete last.
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
// On macOS a Control+click also emits a trailing left-click (ctrlKey still set)
// that would reach the dismiss handler and close the menu instantly. Swallow it
// in the capture phase; real item clicks aren't Control-held.
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

// Inline rename: a floating input prefilled with the file name, outside the tree
// DOM so a live refresh can't clobber it. Enter commits; Escape/blur cancels.
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
// The reader's place as a document-intrinsic anchor (heading + block + fraction),
// so it survives a full re-render. Falls back to the top with no document.
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
// Subtext under the home-screen hero: one of several palm-leaf facts, chosen at
// random per showing. The chosen key is kept so a language switch re-translates
// the same fact rather than re-rolling.
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
// UI toggles are persisted by the host, injected as window.__leafSettings before
// any page script (the app shell's opaque origin can't use localStorage). We seed
// from them synchronously here and report every change back so it can save them.
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
// Previous/Next pager visibility. A data-attribute on <html> shows/hides the
// host-emitted markup via CSS, so toggling never re-renders. On by default.
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
// Gutter permalink numbers. A data-attribute on <html> shows/hides them via CSS
// (no re-render); hiding drops only the visible number, blocks keep their ids so
// #locus links still resolve. Off by default.
let lineNumbersEnabled =
  typeof LEAF_SETTINGS.lineNumbersEnabled === 'boolean' ? LEAF_SETTINGS.lineNumbersEnabled : false;
function applyLineNumbersEnabled() {
  document.documentElement.dataset.lineNumbersEnabled = String(lineNumbersEnabled);
}
applyLineNumbersEnabled();
lineNumbersEnabledControl.checked = lineNumbersEnabled;
lineNumbersEnabledControl.addEventListener('change', () => {
  lineNumbersEnabled = lineNumbersEnabledControl.checked;
  applyLineNumbersEnabled();
  send({ command: 'setLineNumbersEnabled', enabled: lineNumbersEnabled });
});
// Whether the reading view is a live editor. On by default; off keeps the page a
// pure reader (no click-to-edit, checkboxes inert). The code view still edits
// source. Toggling just re-renders the open document to apply it.
let readerEditingEnabled =
  typeof LEAF_SETTINGS.readerEditingEnabled === 'boolean' ? LEAF_SETTINGS.readerEditingEnabled : true;
readerEditingEnabledControl.checked = readerEditingEnabled;
readerEditingEnabledControl.addEventListener('change', () => {
  // Commit any block being edited before flipping, so it isn't silently dropped.
  commitActiveEditingBlock();
  readerEditingEnabled = readerEditingEnabledControl.checked;
  send({ command: 'setReaderEditingEnabled', enabled: readerEditingEnabled });
  renderState();
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
speedReaderEnabledControl.checked = speedReaderEnabled;
speedReaderEnabledControl.addEventListener('change', () => {
  setSpeedReaderEnabled(speedReaderEnabledControl.checked);
  send({ command: 'setSpeedReaderEnabled', enabled: speedReaderEnabled });
});
// Library pane: one file view (Project — folders entered one at a time, with the
// breadcrumb above saying where you are) plus the graph, behind its own toggle.
// The host persists the view and the folder; the frontend reports each change and
// applies host values on boot.
const LIBRARY_VIEWS = ['project', 'graph'];
// Markdown files are badged with the app's own leaf mark. The host inlines the
// same glyph the header uses, so the row tints it via stroke/fill currentColor
// rather than shipping a fixed color.
const LEAF_FILE_ICON = `{{LEAF_ICON_SVG}}`;
// Outline folder glyph shown before folder names in the library. Inherits the
// row color via stroke="currentColor".
const FOLDER_ICON_SVG = '<svg class="library-folder-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" /></svg>';
let indexingEnabled = LEAF_SETTINGS.indexingEnabled === true;
// The file list is where the pane opens, not the graph.
let libraryView = LIBRARY_VIEWS.includes(LEAF_SETTINGS.libraryView) ? LEAF_SETTINGS.libraryView : 'project';
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
// The folder the pane is inside ('' is the root); the breadcrumb is this path.
let libraryProjectPath = typeof LEAF_SETTINGS.libraryProjectPath === 'string' ? LEAF_SETTINGS.libraryProjectPath : '';
// Library pane open/close + resize. The closed preference and last open width are
// host-persisted (window.__leafSettings + setLibraryLayout), like the other
// settings.
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
indexingEnabledControl.checked = indexingEnabled;
indexingEnabledControl.addEventListener('change', () => {
  indexingEnabled = indexingEnabledControl.checked;
  send({ command: 'setIndexingEnabled', enabled: indexingEnabled });
});
function persistLibraryState() {
  send({
    command: 'setLibraryState',
    view: libraryView,
    projectPath: libraryProjectPath,
  });
}
function persistLibraryLayout() {
  send({ command: 'setLibraryLayout', closed: libraryUserClosed, width: Math.round(libraryWidth) });
}
// The widest the open pane may get while leaving the reader usable. Floored at
// SNAP_SHUT so an explicit open always shows a real pane.
function maxOpenPaneWidth() {
  return Math.max(SNAP_SHUT, libraryShell.clientWidth - MIN_READER_WIDTH);
}
function clampOpenPaneWidth(width) {
  return Math.min(Math.max(width, SNAP_SHUT), maxOpenPaneWidth());
}
// A window too narrow for both reader and pane shows the pane closed regardless
// of preference — a display fallback, not a saved state.
function libraryTooNarrow() {
  return libraryShell.clientWidth < SNAP_SHUT + MIN_READER_WIDTH;
}
function libraryIsClosed() {
  return libraryUserClosed || libraryTooNarrow();
}
function applyPaneLayout() {
  const closed = libraryIsClosed();
  libraryShell.classList.toggle('library-closed', closed);
  // Mirror the pane state onto the header so its left zone (the tab rail) tracks
  // the library width and its dividing stroke drops when the library is closed.
  appBar.classList.toggle('has-rail', !closed);
  if (!closed) {
    const width = clampOpenPaneWidth(libraryWidth);
    libraryShell.style.setProperty('--library-width', width + 'px');
    document.documentElement.style.setProperty('--library-rail-width', width + 'px');
  } else {
    document.documentElement.style.setProperty('--library-rail-width', '0px');
  }
  // The lead grows/shrinks with the rail, changing how much room the actions
  // have — re-evaluate the overflow fold.
  refitAppBar();
  // Opening, closing, or re-clamping the pane changes the breadcrumb's room too.
  scheduleCrumbFit();
}
// The panel button in the app bar toggles the library: closed → open at the
// default width (never the sliver it was dragged to before snapping shut), open
// → closed. On a too-narrow window the pane stays display-closed regardless.
function toggleLibrary() {
  if (libraryIsClosed()) {
    libraryUserClosed = false;
    libraryWidth = DEFAULT_PANE_WIDTH;
  } else {
    libraryUserClosed = true;
  }
  applyPaneLayout();
  persistLibraryLayout();
}
libraryOpen.addEventListener('click', toggleLibrary);
// Drag-to-resize the pane from its right edge, rAF-throttling width writes so the
// grid doesn't relayout on every pointer event.
let dividerDrag = null;
function applyPendingDividerWidth() {
  if (!dividerDrag) return;
  dividerDrag.frame = 0;
  if (dividerDrag.pendingWidth != null) {
    libraryWidth = dividerDrag.pendingWidth;
    libraryShell.style.setProperty('--library-width', libraryWidth + 'px');
    // Push the header's tab rail live so the tabs track the pane during the drag.
    document.documentElement.style.setProperty('--library-rail-width', libraryWidth + 'px');
    // The breadcrumb shows as much of the path as fits, so it refits mid-drag.
    scheduleCrumbFit();
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
// On resize, re-clamp the open width and re-evaluate the too-narrow fallback. The
// auto-hide is display-only; the saved preference is never overwritten, so
// widening restores the pane.
let paneResizeFrame = 0;
window.addEventListener('resize', () => {
  if (paneResizeFrame) return;
  paneResizeFrame = requestAnimationFrame(() => {
    paneResizeFrame = 0;
    if (!libraryIsClosed()) libraryWidth = clampOpenPaneWidth(libraryWidth);
    applyPaneLayout();
  });
});
// The file the library highlights as "current" (active tab's path), plus a
// one-shot request to reveal it on the next render (drill Project in, expand Tree
// ancestors, scroll into view). Set only when the user goes to a file, never on a
// passive re-render, so manual browsing isn't disturbed.
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
// The folder path chain from the tree root down to the folder containing
// `filePath`. null when no such file is in the tree; empty array = at the root.
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
// Carry out a pending reveal: move the pane into the open document's folder so
// its row (and the breadcrumb to it) is on screen. Returns false (still pending)
// until the tree loads, so leafSetLibraryState can retry.
function revealSelectedInLibrary() {
  if (!libraryRevealPending || !librarySelectedPath) return false;
  const nodes = libraryTreeData || [];
  if (!nodes.length) return false;
  libraryRevealPending = false;
  const ancestors = folderAncestorsOf(nodes, librarySelectedPath);
  if (ancestors) {
    libraryProjectPath = ancestors.length ? ancestors[ancestors.length - 1] : '';
    persistLibraryState();
  }
  renderLibrary();
  if (ancestors) scrollSelectedLibraryRowIntoView();
  return true;
}
// Mark `path` the library's current file and ask the next render to reveal it.
// null (home screen) just clears the highlight, leaving the browse position.
function followFileInLibrary(path, focus, forceRefresh) {
  librarySelectedPath = path || null;
  libraryRevealPending = !!path;
  // In graph mode there are no rows; move the highlight to the active node. On a
  // deliberate navigation, also fly the camera to it and zoom in; `forceRefresh`
  // rebuilds the slice too.
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
// Switching between the file list and the graph. One icon, pressed while the
// graph is up, so the pane never hides which of the two you are looking at.
function setLibraryView(view) {
  if (!LIBRARY_VIEWS.includes(view) || view === libraryView) return;
  libraryView = view;
  persistLibraryState();
  // Leaving the graph lands on the open document, not wherever the list was left.
  libraryRevealPending = view !== 'graph' && !!librarySelectedPath;
  if (!libraryRevealPending || !revealSelectedInLibrary()) renderLibrary();
  // The reach changed, so re-run the active query under the new one.
  if (librarySearchQuery) runLibrarySearch(librarySearch.value);
}
if (libraryGraphToggle) {
  libraryGraphToggle.addEventListener('click', () => {
    setLibraryView(libraryView === 'graph' ? 'project' : 'graph');
  });
}
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
  return `<button type="button" class="library-file${selected}"${current} data-open-path="${escapeAttr(node.path)}" data-reveal-path="${escapeAttr(node.path)}" title="${escapeAttr(node.path)}">${LEAF_FILE_ICON}<span class="library-file-label">${escapeText(label)}</span></button>`;
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
// The chain of folder nodes from the tree root down to `path` — what the
// breadcrumb draws. Empty at the root; null when the path isn't in the tree.
function folderChainTo(nodes, path) {
  if (!path) return [];
  const walk = (list, trail) => {
    for (const node of list || []) {
      if (node.kind !== 'folder') continue;
      const next = trail.concat(node);
      if (node.path === path) return next;
      const found = walk(node.children, next);
      if (found) return found;
    }
    return null;
  };
  return walk(nodes, []);
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
// The folder rows for the folder we're inside. Walking back out is the
// breadcrumb's job, so no "up" row here.
function renderProject(nodes, chain) {
  const children = chain.length ? (chain[chain.length - 1].children || []) : nodes;
  const rows = [];
  for (const node of projectChildrenSorted(children)) {
    if (node.kind === 'folder') {
      rows.push(`<button type="button" class="library-nav-folder" data-nav-into="${escapeAttr(node.path)}" title="${escapeAttr(node.name)}">${FOLDER_ICON_SVG}<span class="library-file-label">${escapeText(node.name)}</span><span class="library-nav-chevron" aria-hidden="true">›</span></button>`);
    } else {
      rows.push(fileRowHtml(node));
    }
  }
  return `<div class="library-project">${rows.join('')}</div>`;
}
// Enter a folder (or, from a crumb, step back out to one). '' is the root.
function setLibraryFolder(path) {
  libraryProjectPath = path || '';
  persistLibraryState();
  renderLibrary();
  // Search covers the folder on screen, so moving changes the result set.
  if (librarySearchQuery) runLibrarySearch(librarySearch.value);
}
function bindLibraryRows() {
  libraryTree.querySelectorAll('[data-open-path]').forEach((button) => {
    button.addEventListener('click', () => send({ command: 'openRecent', path: button.dataset.openPath }));
  });
  libraryTree.querySelectorAll('[data-nav-into]').forEach((button) => {
    button.addEventListener('click', () => setLibraryFolder(button.dataset.navInto));
  });
}
// The breadcrumb: the library root, then one crumb per folder entered, the last
// being where you are. How many crumbs show is measured against the band's real
// width, not a fixed count — widening the pane reveals more of the path. What
// doesn't fit collapses into a "…" button that opens a menu of the folders it
// swallowed, so a deep path is still one click from any ancestor.
function crumbSegments(chain) {
  return [{ path: '', name: window.leafLocale.t('library.title') }]
    .concat(chain.map((node) => ({ path: node.path, name: node.name || node.path })));
}
// The chain the trail is currently drawing, kept so a resize can refit without
// re-walking the tree.
let libraryCrumbChain = [];
const CRUMB_SEP_HTML = '<span class="library-crumb-sep" aria-hidden="true">›</span>';
function crumbHtml(segment, current) {
  if (current) {
    return `<span class="library-crumb is-current" aria-current="true" title="${escapeAttr(segment.path || segment.name)}">${escapeText(segment.name)}</span>`;
  }
  const enter = escapeAttr(window.leafLocale.t('library.crumbs.enter', { name: segment.name }));
  return `<button type="button" class="library-crumb" data-crumb-path="${escapeAttr(segment.path)}" title="${enter}">${escapeText(segment.name)}</button>`;
}
function crumbElisionHtml(hidden) {
  const names = hidden.map((segment) => segment.name);
  const label = escapeAttr(window.leafLocale.t('library.crumbs.more', { names: names.join(' › ') }));
  return `<button type="button" class="library-crumb is-elided" data-crumb-more="1" title="${label}" aria-label="${label}" aria-haspopup="menu" aria-expanded="false">…</button>`;
}
// What the trail was last laid out for. The library re-renders on every indexer
// push, and rebuilding the crumbs threw away the "…" an open menu hangs off.
let libraryCrumbFitKey = null;
function crumbFitKey(segments) {
  return segments.map((segment) => segment.path + '>' + segment.name).join('|')
    + '@' + libraryCrumbTrail.clientWidth;
}
// Lay the trail out for a pane of this width. One measuring pass renders every
// crumb (plus the "…" button, so its cost is known) with shrinking disabled and
// reads the natural widths; the fit is then arithmetic, and the final markup is
// written once. Both writes happen inside the same task, so nothing intermediate
// paints.
function fitLibraryCrumbs() {
  if (!libraryCrumbTrail || libraryView === 'graph') return;
  const segments = crumbSegments(libraryCrumbChain);
  // The trail fills the band whatever is in it, so its width keys the fit safely.
  const key = crumbFitKey(segments);
  if (key === libraryCrumbFitKey) return;
  libraryCrumbFitKey = key;
  const last = segments.length - 1;
  const fullHtml = segments.map((segment, index) => crumbHtml(segment, index === last)).join(CRUMB_SEP_HTML);
  let hidden = [];
  let shown = segments;
  // Past here the trail is rebuilt, so an open menu loses the "…" it hangs off.
  hideCrumbMenu();
  // Measure with shrinking off and the "…" in the row, so every box reports the
  // width it actually wants. A closed pane measures zero — draw the whole path and
  // let the reopen (which resizes the band) refit it.
  libraryCrumbTrail.classList.add('is-measuring');
  libraryCrumbTrail.innerHTML = fullHtml + CRUMB_SEP_HTML + crumbElisionHtml([]);
  const avail = libraryCrumbTrail.clientWidth;
  const parts = Array.from(libraryCrumbTrail.children);
  const widthOf = (el) => (el ? el.getBoundingClientRect().width : 0);
  const crumbWidths = segments.map((_, index) => widthOf(parts[index * 2]));
  const sepWidth = widthOf(parts[1]);
  const moreWidth = widthOf(parts[parts.length - 1]);
  const gap = parseFloat(getComputedStyle(libraryCrumbTrail).columnGap) || 0;
  libraryCrumbTrail.classList.remove('is-measuring');
  // Width of a row of boxes: the boxes plus the gaps between them.
  const rowWidth = (boxes) => boxes.reduce((sum, w) => sum + w, 0) + Math.max(0, boxes.length - 1) * gap;
  const full = rowWidth(crumbWidths.flatMap((w, index) => (index ? [sepWidth, w] : [w])));
  if (avail > 0 && segments.length > 2 && full > avail) {
    // Root and current folder always stay. Between them, keep as many of the
    // nearest ancestors as fit behind the "…" — at least the current folder, which
    // shrinks with an ellipsis of its own if even that overruns.
    let keep = 1;
    for (let first = segments.length - 2; first >= 2; first -= 1) {
      const tail = segments.slice(first);
      const boxes = [crumbWidths[0], sepWidth, moreWidth]
        .concat(tail.flatMap((_, i) => [sepWidth, crumbWidths[first + i]]));
      if (rowWidth(boxes) > avail) break;
      keep = segments.length - first;
    }
    hidden = segments.slice(1, segments.length - keep);
    shown = segments.slice(segments.length - keep);
  }
  const rendered = shown.map((segment, index) => crumbHtml(segment, index === shown.length - 1));
  libraryCrumbTrail.innerHTML = hidden.length
    ? [crumbHtml(segments[0], false), crumbElisionHtml(hidden)].concat(rendered).join(CRUMB_SEP_HTML)
    : rendered.join(CRUMB_SEP_HTML);
  libraryCrumbTrail.querySelectorAll('[data-crumb-path]').forEach((crumb) => {
    crumb.addEventListener('click', () => setLibraryFolder(crumb.dataset.crumbPath));
  });
  const more = libraryCrumbTrail.querySelector('[data-crumb-more]');
  if (more) {
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleCrumbMenu(more, hidden);
    });
  }
}
function renderLibraryCrumbs(chain) {
  if (!libraryCrumbTrail) return;
  if (libraryView === 'graph') {
    hideCrumbMenu();
    libraryCrumbTrail.innerHTML = `<span class="library-crumb is-current">${escapeText(window.leafLocale.t('library.view.graph'))}</span>`;
    // The graph took the band over; the next file-list render starts from scratch.
    libraryCrumbFitKey = null;
    return;
  }
  libraryCrumbChain = chain;
  fitLibraryCrumbs();
}
// The elided folders, as a menu under the "…". Same chrome as the file
// right-click menu; each item enters that folder.
const crumbMenu = document.createElement('div');
crumbMenu.className = 'context-menu crumb-menu';
crumbMenu.hidden = true;
crumbMenu.setAttribute('role', 'menu');
document.body.appendChild(crumbMenu);
let crumbMenuOwner = null;
function hideCrumbMenu() {
  if (crumbMenu.hidden) return;
  // Hand focus back to the "…" before hiding, or it would be stranded on a
  // hidden item and keyboard travel would restart from the top of the page.
  const returnFocus = crumbMenu.contains(document.activeElement);
  crumbMenu.hidden = true;
  if (crumbMenuOwner) {
    crumbMenuOwner.setAttribute('aria-expanded', 'false');
    if (returnFocus && crumbMenuOwner.isConnected) crumbMenuOwner.focus();
  }
  crumbMenuOwner = null;
}
function toggleCrumbMenu(button, hidden) {
  if (!crumbMenu.hidden && crumbMenuOwner === button) {
    hideCrumbMenu();
    return;
  }
  hideCrumbMenu();
  if (!hidden.length) return;
  crumbMenu.textContent = '';
  for (const segment of hidden) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'context-menu-item crumb-menu-item';
    item.setAttribute('role', 'menuitem');
    item.title = segment.path || segment.name;
    item.innerHTML = `${FOLDER_ICON_SVG}<span class="crumb-menu-label"></span>`;
    item.querySelector('.crumb-menu-label').textContent = segment.name;
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      hideCrumbMenu();
      setLibraryFolder(segment.path);
    });
    crumbMenu.appendChild(item);
  }
  crumbMenuOwner = button;
  button.setAttribute('aria-expanded', 'true');
  crumbMenu.hidden = false;
  const anchor = button.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - crumbMenu.offsetWidth - 8));
  const top = Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - crumbMenu.offsetHeight - 8));
  crumbMenu.style.left = left + 'px';
  crumbMenu.style.top = top + 'px';
  const first = crumbMenu.querySelector('.context-menu-item');
  if (first) first.focus();
}
window.addEventListener('click', (event) => {
  if (!crumbMenu.contains(event.target)) hideCrumbMenu();
});
window.addEventListener('blur', hideCrumbMenu);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideCrumbMenu();
});
// The band's width changes with a divider drag, a window resize, and the pane
// opening — all of which change how much of the path fits. One rAF-throttled
// refit covers every case.
let crumbFitFrame = 0;
function scheduleCrumbFit() {
  if (crumbFitFrame) return;
  crumbFitFrame = requestAnimationFrame(() => {
    crumbFitFrame = 0;
    fitLibraryCrumbs();
  });
}
// Every pane-width change calls scheduleCrumbFit itself (the divider drag and
// applyPaneLayout) — a ResizeObserver here proved unreliable in the web view,
// delivering its first observation and nothing after. Keep one anyway, on the band
// rather than the trail (the band's width comes from the pane, so a refit can't
// feed back into what it measures), for the widths nothing else announces: a
// zoom change, or a font arriving late and re-measuring every crumb.
if (typeof ResizeObserver !== 'undefined' && libraryCrumbTrail && libraryCrumbTrail.parentElement) {
  new ResizeObserver(scheduleCrumbFit).observe(libraryCrumbTrail.parentElement);
}
window.addEventListener('resize', scheduleCrumbFit);
function renderLibraryGraphToggle() {
  if (!libraryGraphToggle) return;
  const on = libraryView === 'graph';
  const label = window.leafLocale.t(on ? 'library.view.graph.off' : 'library.view.graph.on');
  libraryGraphToggle.setAttribute('aria-pressed', String(on));
  libraryGraphToggle.title = label;
  libraryGraphToggle.setAttribute('aria-label', label);
}
function renderLibrary() {
  const nodes = libraryTreeData || [];
  // A saved folder this tree doesn't have (a rescan dropped it) falls back to the
  // root. Only judge that with nodes in hand: empty means loading, not gone.
  let chain = nodes.length ? folderChainTo(nodes, libraryProjectPath) : [];
  if (!chain) {
    chain = [];
    libraryProjectPath = '';
  }
  renderLibraryGraphToggle();
  renderLibraryCrumbs(chain);
  // The graph view replaces the file list with an interactive canvas. It owns the
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
  if (!nodes.length) {
    libraryTree.innerHTML = `<p class="library-empty">${escapeText(window.leafLocale.t('library.empty'))}</p>`;
    return;
  }
  libraryTree.innerHTML = renderProject(nodes, chain);
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
// How far the world container can zoom in/out (mouse wheel and focus flights are
// both clamped to this). Kept as constants so the label supersample below can be
// tied to the same ceiling.
const GRAPH_MIN_ZOOM = 0.15;
const GRAPH_MAX_ZOOM = 4;
// When we fly the graph to a node (clicking its tab), settle at least this zoom
// so the node reads as focused; never zoom out from a closer view the user set.
const GRAPH_FOCUS_ZOOM = 2.2;
const GRAPH_FOCUS_DURATION_MS = 420;
// Ambient labels (the names floating by the nodes you are not on) render at a
// fixed screen size and are decluttered by collision — see layoutGraphLabels.
const GRAPH_LABEL_FONT_SIZE = 11;
const GRAPH_LABEL_GAP = 4; // screen px between a node and the top of its label
// Above this node count, skip ambient labels: the collision pass would rarely
// place any in a dense overview and the per-relayout cost stops being free.
// Active/hover labels still show at any size.
const GRAPH_AMBIENT_LABEL_MAX = 400;

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

// The graph's palette, read fresh from the theme tokens. Used at build time and
// re-read on theme change so the canvas recolors with the rest of the app.
function graphColors() {
  return {
    node: cssVarColor('--app-muted-foreground', 0x8b95a5),
    active: cssVarColor('--accent', 0x8a63d2),
    hot: cssVarColor('--app-foreground', 0xe6e6e6),
    edge: cssVarColor('--app-border', 0x3a3f4b),
    // Ambient labels for the documents you are not on: the muted-foreground token
    // (a dim grey), so they read as secondary next to the active/hover labels.
    dim: cssVarColor('--app-muted-foreground', 0x8b95a5),
  };
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

  const colors = graphColors();

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
    // Ambient labels wait for the layout to settle so they resolve on stable
    // positions instead of flickering as the simulation jiggles the nodes.
    settled: false,
    // A 2D context used only to measure label widths for the collision pass.
    measureCtx: document.createElement('canvas').getContext('2d'),
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

  // Scale the layout to the node count. Edge drawing dominates, so large graphs
  // paint every Nth tick, settle faster, approximate charge more coarsely, and
  // drop the collide force once it's unaffordable.
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
  sim.on('end', () => {
    // The layout has stopped moving: let ambient labels resolve on the final
    // positions, then paint.
    scene.settled = true;
    layoutGraphLabels(scene);
    renderGraphFrame(scene);
  });
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
  }
  // Labels keep a fixed on-screen size and stay anchored under their node; this
  // only moves the labels already chosen visible, it does not re-decide the set.
  positionGraphLabels(scene);
  scene.app.render();
}

// Recolour and resize the node dots for the current active/hover state, then let
// the label pass decide which names to show. Cheap and only called on state
// changes, not per frame.
function applyGraphStyles() {
  const scene = graphScene;
  if (!scene) return;
  const { colors, hoverNode } = scene;
  const hoverSet = hoverNode ? scene.neighbors.get(hoverNode.path) : null;
  for (const node of scene.nodes) {
    let color = colors.node;
    let alpha = 1;
    let scale = 1;
    const isActive = graphActivePath && node.path === graphActivePath;
    if (isActive) { color = colors.active; scale = 1.7; }
    if (hoverNode) {
      if (node === hoverNode) { color = colors.hot; scale = 1.6; }
      else if (hoverSet && hoverSet.has(node.path)) { color = colors.hot; }
      else if (!isActive) { alpha = 0.22; }
    }
    node.gfx.tint = color;
    node.gfx.alpha = alpha;
    node.gfx.scale.set(scale);
  }
  layoutGraphLabels(scene);
  renderGraphFrame(scene);
}

// Re-read the theme tokens into the live scene and repaint, so the open graph
// recolors when the theme changes (the palette is captured at build time).
function refreshGraphColors() {
  if (!graphScene) return;
  graphScene.colors = graphColors();
  applyGraphStyles();
}

// Choose which labels are visible and place them. Active/hovered nodes (and a
// hover's neighbours) are forced; when settled with no hover, every other node
// is an ambient candidate walked most-connected-first, each winning a label only
// if its screen box clears the ones already placed. So the visible set scales
// with available room, and zooming in surfaces more names.
function layoutGraphLabels(scene) {
  const { world, colors } = scene;
  const ws = world.scale.x || 1;
  const ox = world.position.x;
  const oy = world.position.y;
  const screenW = scene.app.screen.width;
  const screenH = scene.app.screen.height;
  const hoverNode = scene.hoverNode;
  const hoverSet = hoverNode ? scene.neighbors.get(hoverNode.path) : null;
  const activeNode = graphActivePath ? scene.nodeByPath.get(graphActivePath) : null;

  // Build the priority-ordered candidate list. `forced` labels always show;
  // ambient ones must clear the collision test. Nodes without a position yet
  // (before the first tick) are skipped.
  const candidates = [];
  const seen = new Set();
  const push = (node, color, forced) => {
    if (!node || seen.has(node) || typeof node.x !== 'number') return;
    seen.add(node);
    candidates.push({ node, color, forced });
  };
  push(activeNode, colors.active, true);
  if (hoverNode) {
    push(hoverNode, colors.hot, true);
    let n = 0;
    for (const node of scene.nodes) {
      if (n >= GRAPH_NEIGHBOR_LABEL_CAP) break;
      if (hoverSet && hoverSet.has(node.path) && !seen.has(node)) { push(node, colors.hot, true); n++; }
    }
  } else if (scene.settled && scene.nodes.length <= GRAPH_AMBIENT_LABEL_MAX) {
    const rest = scene.nodes.filter((node) => !seen.has(node) && typeof node.x === 'number');
    // Hubs first, so the most-connected documents keep their names when space is tight.
    rest.sort((a, b) => (b.degree - a.degree) || (a.path < b.path ? -1 : 1));
    for (const node of rest) push(node, colors.dim, false);
  }

  const placed = [];
  const PADX = 5;
  const PADY = 2;
  const visible = new Set();
  for (const cand of candidates) {
    const node = cand.node;
    const sx = ox + node.x * ws;
    const sy = oy + node.y * ws;
    const w = labelScreenWidth(scene, node) + PADX * 2;
    const h = GRAPH_LABEL_FONT_SIZE + PADY * 2 + 2;
    const top = sy + graphNodeRadius(node.degree) * node.gfx.scale.y * ws + GRAPH_LABEL_GAP;
    const left = sx - w / 2;
    // Off-canvas labels are neither drawn nor allowed to block on-screen ones.
    if (left > screenW || left + w < 0 || top > screenH || top + h < 0) continue;
    const rect = { l: left, t: top, r: left + w, b: top + h };
    if (!cand.forced) {
      let hit = false;
      for (const p of placed) {
        if (rect.l < p.r && rect.r > p.l && rect.t < p.b && rect.b > p.t) { hit = true; break; }
      }
      if (hit) continue;
    }
    placed.push(rect);
    visible.add(node);
    setNodeLabel(scene, node, true, cand.color);
  }
  // Hide any label that did not win a slot this pass.
  for (const node of scene.nodes) {
    if (!visible.has(node) && node.labelText) node.labelText.visible = false;
  }
  positionGraphLabels(scene);
}

// Measure a label's on-screen width once (labels are a fixed screen size, so the
// unscaled text width is the screen width) and cache it on the node.
function labelScreenWidth(scene, node) {
  if (node.labelWidth == null) {
    scene.measureCtx.font = GRAPH_LABEL_FONT_SIZE + 'px "Noto Sans", sans-serif';
    node.labelWidth = scene.measureCtx.measureText(node.label).width;
  }
  return node.labelWidth;
}

// Keep every visible label a constant on-screen size (counter-scaling the world
// zoom) and anchored a fixed gap under its node. Positions live in world space;
// the inverse scale cancels the world zoom so the text neither grows nor blurs.
function positionGraphLabels(scene) {
  const inv = 1 / (scene.world.scale.x || 1);
  for (const node of scene.nodes) {
    const label = node.labelText;
    if (!label || !label.visible || typeof node.x !== 'number') continue;
    label.scale.set(inv);
    label.position.set(node.x, node.y + graphNodeRadius(node.degree) * node.gfx.scale.y + GRAPH_LABEL_GAP * inv);
  }
}

function setNodeLabel(scene, node, show, color) {
  if (show && !node.labelText) {
    const text = new PIXI.Text({
      text: node.label,
      // White base so the tint reproduces the target colour exactly, the same way
      // the node dots are drawn white and tinted.
      style: { fontFamily: 'Noto Sans, sans-serif', fontSize: GRAPH_LABEL_FONT_SIZE, fill: 0xffffff, align: 'center' },
    });
    text.anchor.set(0.5, 0);
    // Labels hold a fixed on-screen size (positionGraphLabels counter-scales the
    // world zoom), so the bitmap never magnifies past its rasterized size — the
    // display density alone keeps it crisp at every zoom.
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
    if (scene.panning) {
      // A pan slid nodes across the viewport edges; re-decide which labels are
      // on screen (overlaps are translation-invariant, but culling is not).
      scene.panning = false;
      scene.panLast = null;
      layoutGraphLabels(scene);
      renderGraphFrame(scene);
      return;
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
    // Zoom changes how far apart the nodes sit on screen, so re-decide which
    // ambient labels fit before repainting.
    layoutGraphLabels(scene);
    renderGraphFrame(scene);
  }, { passive: false });
}

// Pixi's `resizeTo` only reacts to window resizes, so a pane-splitter drag
// (element resize) wouldn't resize or repaint. Observe the canvas ourselves:
// resize, shift the view by half the delta to keep content centred, repaint.
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
    layoutGraphLabels(scene);
    renderGraphFrame(scene);
  });
  ro.observe(libraryGraphCanvas);
  scene.resizeObserver = ro;
}

function graphZoomAt(scene, sx, sy, factor) {
  const current = scene.world.scale.x;
  const next = Math.max(GRAPH_MIN_ZOOM, Math.min(GRAPH_MAX_ZOOM, current * factor));
  const ratio = next / current;
  scene.world.position.x = sx - (sx - scene.world.position.x) * ratio;
  scene.world.position.y = sy - (sy - scene.world.position.y) * ratio;
  scene.world.scale.set(next);
}

// Smoothly pan+zoom so `node` ends centred and zoomed in. The target recomputes
// each frame from the node's live position, so it lands centred even mid-settle.
// Cancels any in-flight focus animation so rapid tab clicks don't fight.
function focusGraphNode(scene, node) {
  if (!scene || !node || typeof node.x !== 'number') return;
  if (scene.focusRaf) { cancelAnimationFrame(scene.focusRaf); scene.focusRaf = null; }
  const width = scene.app.screen.width;
  const height = scene.app.screen.height;
  const startScale = scene.world.scale.x;
  const startX = scene.world.position.x;
  const startY = scene.world.position.y;
  const targetScale = Math.min(GRAPH_MAX_ZOOM, Math.max(startScale, GRAPH_FOCUS_ZOOM));
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
      // Settled at the focus zoom: re-decide labels for the final view.
      layoutGraphLabels(scene);
      renderGraphFrame(scene);
    }
  };
  scene.focusRaf = requestAnimationFrame(step);
}

// Move the highlight to a newly active document. Focus scope refetches+rebuilds
// (its slice is the active document's neighborhood); fixed scopes keep the scene
// and recolour, flying the camera when `focus`. `forceRefresh` (resync gesture)
// always rebuilds so a stale graph catches up.
function graphSetActive(path, focus, forceRefresh) {
  graphActivePath = path || null;
  if (libraryView !== 'graph') return;
  // Focus scope's slice is the active document's neighborhood, so changed seeds
  // (a different document) mean the scene in memory is for the wrong file.
  const seedChanged =
    graphScope === 'small' && graphScope + '|' + graphSeeds().join('\n') !== graphSeedKey;
  // No scene, or the document's node isn't in it (a new/re-indexed file), or an
  // explicit resync: fetch a fresh slice and fly to the node once it builds.
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
// The document paths to restrict a search to, or null for the whole library. The
// file list narrows to the folder it is inside (the root narrows to nothing) and
// the graph to the nodes it drew; a set too large to bind also searches all.
function librarySearchScopePaths() {
  let paths;
  if (libraryView === 'graph') {
    // Not yet loaded: search everything rather than an empty (match-nothing) set.
    if (!graphData || !graphData.nodes) return null;
    paths = graphData.nodes.map((n) => n.path);
  } else if (libraryProjectPath) {
    const folder = findFolderByPath(libraryTreeData || [], libraryProjectPath);
    paths = collectLibraryFiles(folder ? (folder.children || []) : [], []).map((f) => f.path);
  } else {
    return null;
  }
  return paths.length > SEARCH_SCOPE_CAP ? null : paths;
}
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
// Paint the pane from the seeded settings, then ask for the tree. The host owns
// indexing and starts the rescan itself, so there's no JS-initiated crawl on boot.
renderLibrary();
applyPaneLayout();
send({ command: 'getFileTree' });
// Updates. The check compares the running version against the latest GitHub
// release; if a newer one exists and publishes a checksum for this platform's
// installer, the page downloads it and streams it to the host, which writes,
// hashes, and stages it. The button then offers a restart. Silent on any
// failure — offline, rate-limited, or a malformed response leaves the UI alone.
//
// The download lives here rather than in Rust because the web view already has
// an OS-maintained TLS stack; the host owns everything that decides whether the
// bytes are allowed to run.
const settingsAlertDot = document.getElementById('settingsAlertDot');
const settingsUpdate = document.getElementById('settingsUpdate');
const settingsUpdateLabel = document.getElementById('settingsUpdateLabel');
const settingsUpdateFill = document.getElementById('settingsUpdateFill');
const settingsUpdateSpinner = document.getElementById('settingsUpdateSpinner');
const settingsUpdateNote = document.getElementById('settingsUpdateNote');
const settingsCheck = document.getElementById('settingsCheck');
const settingsCheckLabel = document.getElementById('settingsCheckLabel');
const settingsCheckSpinner = document.getElementById('settingsCheckSpinner');
const autoUpdateControl = document.getElementById('autoUpdateEnabled');
const LEAF_VERSION = typeof window.__leafVersion === 'string' ? window.__leafVersion : null;
// Running version at the foot of the settings panel: confirms an update landed.
const settingsVersion = document.getElementById('settingsVersion');
if (settingsVersion) settingsVersion.textContent = LEAF_VERSION ? `v${LEAF_VERSION}` : '';
let autoUpdateEnabled = LEAF_SETTINGS.autoUpdateEnabled !== false;
if (autoUpdateControl) {
  autoUpdateControl.checked = autoUpdateEnabled;
  autoUpdateControl.addEventListener('change', () => {
    autoUpdateEnabled = autoUpdateControl.checked;
    send({ command: 'setAutoUpdateEnabled', enabled: autoUpdateEnabled });
  });
}
function parseVersion(value) {
  return String(value || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}
function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}
const RELEASES_PAGE = 'https://github.com/ryanallen/leaftext/releases/latest';
const UPDATE_ASSET_SUFFIX = typeof window.__leafUpdateAsset === 'string' ? window.__leafUpdateAsset : '';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// One IPC message per network chunk would be hundreds of messages for a 6 MB
// installer, so bytes are pooled to roughly this much before being handed over.
const UPDATE_CHUNK_BYTES = 256 * 1024;

// What the update controls are currently reporting.
//
//   idle         nothing asked yet (a throttled launch lands here)
//   checking     a release request is in flight
//   upToDate     GitHub answered and this is the newest version
//   checkFailed  the check itself broke — offline, rate-limited, malformed
//   available    a newer release exists but will not be installed for us:
//                downloads are off, or it publishes no checksummed installer
//   downloading  bytes are moving; `percent` is live
//   staged       a verified installer is on disk and the app can restart into it
//   failed       the download or its verification broke
//
// The last four raise the dot on the gear; the quiet ones only write the note,
// since a permanent amber dot for a laptop that is merely offline would be noise.
let updateState = {
  status: 'idle',
  version: '',
  url: RELEASES_PAGE,
  percent: 0,
  message: '',
  checkedAt: Number(LEAF_SETTINGS.updateLastChecked || 0) * 1000,
};
// Why the last install did not take, from the applier's record: `{ version,
// message }`, or null. Kept raw so a locale change re-renders it, and sticky for
// the session — a failed install stays true until the next one succeeds.
const updateApplyFailure = (() => {
  const applied = window.__leafUpdateApply;
  if (!applied || typeof applied !== 'object' || applied.ok) return null;
  return {
    version: String(applied.version || '').replace(/^v/i, ''),
    message: String(applied.message || ''),
  };
})();
const UPDATE_NEWS_STATES = ['available', 'downloading', 'staged', 'failed'];

// "Last checked 3 hours ago", from the coarsest unit that fits. Relative rather
// than a timestamp: the only thing worth knowing is whether the answer is stale.
function formatCheckedAgo(when) {
  const seconds = Math.max(0, Math.round((Date.now() - when) / 1000));
  const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    if (seconds >= size) {
      const ago = window.leafLocale.formatRelativeTime(-Math.floor(seconds / size), unit);
      return window.leafLocale.t('update.lastChecked', { when: ago });
    }
  }
  return window.leafLocale.t('update.checkedNow');
}

// The line under the check row: what the last attempt actually said.
function updateNoteText() {
  const { status, message, checkedAt } = updateState;
  // This attempt's own failure first, then the last install's — a fresh error
  // must not be masked by a stale one.
  if (status === 'checkFailed') {
    return window.leafLocale.t('update.checkFailed', { message: message || '' }).trim();
  }
  if (status === 'failed') {
    return message
      ? window.leafLocale.t('update.failedReason', { message })
      : window.leafLocale.t('update.failed');
  }
  if (updateApplyFailure) {
    return window.leafLocale.t('update.applyFailed', {
      version: updateApplyFailure.version,
      message: updateApplyFailure.message,
    });
  }
  if (status === 'available' && message) return message;
  if (status === 'upToDate') return window.leafLocale.t('update.upToDate');
  if (checkedAt) return formatCheckedAgo(checkedAt);
  return '';
}

function renderUpdateButton() {
  if (!settingsUpdate) return;
  const { status, version, percent } = updateState;
  const news = UPDATE_NEWS_STATES.indexOf(status) !== -1;
  const busy = status === 'checking' || status === 'downloading';

  // The dot on the gear, all a user sees with the panel shut: green for something
  // to install, a spinning ring while it downloads, amber when the attempt broke.
  if (settingsAlertDot) {
    settingsAlertDot.hidden = !news;
    settingsAlertDot.className = 'settings-alert-dot'
      + (status === 'downloading' ? ' is-downloading' : '')
      + (status === 'failed' ? ' is-failed' : '');
  }

  settingsUpdate.hidden = !news;
  settingsUpdate.classList.toggle('is-failed', status === 'failed');
  if (news) {
    const labels = {
      available: () => window.leafLocale.t('update.available', { version }),
      downloading: () => window.leafLocale.t('update.downloading', { version, percent }),
      staged: () => window.leafLocale.t('update.restart', { version }),
      failed: () => window.leafLocale.t('update.failed'),
    };
    (settingsUpdateLabel || settingsUpdate).textContent = (labels[status] || labels.available)();
    settingsUpdate.title = updateState.message || window.leafLocale.t('update.title');
    if (settingsUpdateSpinner) settingsUpdateSpinner.hidden = status !== 'downloading';
    if (settingsUpdateFill) {
      settingsUpdateFill.style.width = status === 'downloading' ? `${percent}%` : '0';
    }
    // Only a staged, verified installer offers to install. Everything else falls
    // back to the release page, which is what the app did before it could update
    // itself, and is always a safe thing for the button to do.
    settingsUpdate.disabled = status === 'downloading';
    settingsUpdate.onclick = status === 'staged'
      ? () => send({ command: 'applyUpdate' })
      : () => send({ command: 'openExternal', url: updateState.url || RELEASES_PAGE });
  }

  // The check row reports every state, including the quiet ones.
  if (settingsCheck) {
    settingsCheck.disabled = busy;
    settingsCheck.title = window.leafLocale.t('update.checkTitle');
  }
  if (settingsCheckLabel) {
    settingsCheckLabel.textContent = window.leafLocale.t(busy ? 'update.checking' : 'update.check');
  }
  if (settingsCheckSpinner) settingsCheckSpinner.hidden = !busy;
  if (settingsUpdateNote) {
    const note = updateNoteText();
    settingsUpdateNote.textContent = note;
    settingsUpdateNote.hidden = !note;
    settingsUpdateNote.classList.toggle(
      'is-error',
      Boolean(updateApplyFailure) || status === 'failed' || status === 'checkFailed',
    );
  }
}

function setUpdateState(next) {
  updateState = Object.assign({}, updateState, next);
  renderUpdateButton();
}

// Terminal states pushed by the host once it has written and verified (or
// rejected) the download. Progress is tracked here, since this side is the one
// doing the fetching.
window.leafUpdateState = (state) => {
  if (!state || typeof state !== 'object') return;
  setUpdateState({
    status: state.status || 'failed',
    version: state.version || updateState.version,
    message: state.message || '',
    percent: 0,
  });
};

// Base64 without blowing the argument limit: btoa needs a binary string, and
// String.fromCharCode.apply on a whole 256 KB buffer overflows the stack.
function base64FromBytes(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

// Stream the installer to the host, which writes and hashes it. Chunks are
// pooled first so the IPC channel carries tens of messages, not hundreds.
async function streamInstaller(url, size) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`download failed (${response.status})`);
  const reader = response.body.getReader();
  let pending = [];
  let pendingBytes = 0;
  let received = 0;
  // Repaint on whole percent changes only: the reader hands back tens of chunks
  // per percent, and each repaint rewrites the whole panel row.
  let painted = -1;

  const flush = () => {
    if (!pendingBytes) return;
    const merged = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const part of pending) {
      merged.set(part, offset);
      offset += part.length;
    }
    send({ command: 'updateDownloadChunk', data: base64FromBytes(merged) });
    pending = [];
    pendingBytes = 0;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending.push(value);
    pendingBytes += value.length;
    received += value.length;
    if (pendingBytes >= UPDATE_CHUNK_BYTES) flush();
    if (size) {
      const percent = Math.min(99, Math.floor((received / size) * 100));
      if (percent !== painted) {
        painted = percent;
        setUpdateState({ status: 'downloading', percent });
      }
    }
  }
  flush();
}

// Stream the installer to the host, which writes and hashes it. Anything that
// goes wrong leaves the button pointing at the release page.
async function downloadUpdate(version, installer) {
  setUpdateState({ status: 'downloading', version, percent: 0 });
  try {
    send({
      command: 'updateDownloadBegin',
      version,
      asset: installer.name,
      size: installer.size,
    });
    await streamInstaller(installer.browser_download_url, installer.size);
    send({ command: 'updateDownloadFinish' });
  } catch (error) {
    send({ command: 'updateDownloadFailed', message: String((error && error.message) || error) });
  }
}

// Guards two overlapping checks: the periodic tick firing while a manual check
// (or its download) is still running.
let updateCheckInFlight = false;

async function checkForUpdate(force) {
  if (!LEAF_VERSION || updateCheckInFlight) return;

  // An installer verified in an earlier session is still good; offer it before
  // going anywhere near the network.
  const staged = LEAF_SETTINGS.updateStagedVersion;
  if (staged && isNewerVersion(staged, LEAF_VERSION)) {
    setUpdateState({ status: 'staged', version: String(staged) });
    return;
  }

  // Throttled: the app used to spend a request on every launch against an
  // unauthenticated 60-per-hour limit, for an answer that changes at most daily.
  // A check the user clicked ignores it: one deliberate request is not what
  // exhausts that budget, and waiting six hours for an answer is not an answer.
  if (!force && updateState.checkedAt && Date.now() - updateState.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
    renderUpdateButton();
    return;
  }

  updateCheckInFlight = true;
  setUpdateState({ status: 'checking', message: '', percent: 0 });
  try {
    // no-store: a cached 200 from the last check would make a forced one answer
    // with yesterday's release.
    const res = await fetch('https://api.github.com/repos/ryanallen/leaftext/releases/latest', {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(window.leafLocale.t('update.httpError', { status: res.status }));
    const data = await res.json();
    const tag = data && data.tag_name;
    const newer = Boolean(tag) && isNewerVersion(tag, LEAF_VERSION);
    send({ command: 'updateChecked', version: newer ? String(tag) : '' });
    if (!newer) {
      setUpdateState({ status: 'upToDate', version: '', checkedAt: Date.now() });
      return;
    }

    const version = String(tag).replace(/^v/i, '');
    const url = data.html_url || RELEASES_PAGE;
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const installer = UPDATE_ASSET_SUFFIX
      ? assets.find((asset) => asset && typeof asset.name === 'string' && asset.name.endsWith(UPDATE_ASSET_SUFFIX))
      : null;

    // No installer for this platform, or the user turned auto-update off: notify
    // only, which is what the button did before any of this existed. Say which,
    // so a release that failed to publish one doesn't read as a broken updater.
    if (!installer || !autoUpdateEnabled) {
      setUpdateState({
        status: 'available',
        version,
        url,
        checkedAt: Date.now(),
        message: window.leafLocale.t(autoUpdateEnabled ? 'update.noInstaller' : 'update.downloadsOff'),
      });
      return;
    }
    setUpdateState({ status: 'available', version, url, checkedAt: Date.now(), message: '' });
    await downloadUpdate(version, installer);
  } catch (error) {
    // Offline, rate-limited, or a malformed answer. `checkedAt` is deliberately
    // left alone so the next tick retries instead of waiting out the interval.
    setUpdateState({ status: 'checkFailed', message: String((error && error.message) || error) });
  } finally {
    updateCheckInFlight = false;
  }
}
if (settingsCheck) {
  settingsCheck.addEventListener('click', () => checkForUpdate(true));
}
// Opening the panel re-renders, so "last checked 3 hours ago" is current rather
// than however stale it was when the page loaded.
if (settingsMenu) {
  settingsMenu.addEventListener('toggle', () => {
    if (settingsMenu.open) renderUpdateButton();
  });
}
// Paint the row before anything asks the network, so the panel is never blank on
// a build with no version to compare.
renderUpdateButton();
checkForUpdate();
// So a window left open for days notices a release. The tick is short; the
// throttle above decides whether it actually reaches the network.
window.setInterval(() => checkForUpdate(), 30 * 60 * 1000);
let minimapViewportFrame = 0;
let minimapPreviewFrame = 0;
// Rebuilding the thumbnail clones the whole document, so only rebuild when the
// content, wrap width, or rail width changed. minimapContentVersion bumps on
// mutation; the minimapBuilt* values record the last clone's inputs, so a
// height-only resize reuses the existing clone.
let minimapContentVersion = 0;
let minimapBuiltVersion = -1;
let minimapBuiltSourceWidth = -1;
let minimapBuiltPreviewWidth = -1;
let minimapDragging = false;
let minimapPointerId = null;
let minimapPointerOffsetY = null;
// Document geometry captured once at the start of a minimap drag (it doesn't
// change while dragging, and re-measuring forces a synchronous layout). Then map
// pointer -> scrollTop with pure math.
let minimapDragMetrics = null;
let minimapResizeObserver = null;
let minimapBodyObserver = null;
let readerLayoutFrame = 0;
let readerScrollAnchor = null;
let readerReflowObserver = null;
let resetReaderScrollOnNextRender = false;
// Cached list of the document's anchor blocks, rebuilt when the document changes,
// so the per-scroll probe never re-runs querySelectorAll over huge documents.
let readerAnchorBlocks = null;
let readerAnchorBlocksCount = -1;
// The `.document-body` the cache was built against. A re-render swaps in a fresh
// body node, so comparing identity catches that immediately instead of relying
// on the child-count heuristic alone.
let readerAnchorBlocksSource = null;
const READER_CONTENT_TOP_GAP = 88;
const READER_ANCHOR_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, table, details, figure, hr';
// The theme selector: a bottom sheet reached from Settings, with an appearance
// row (System/Light/Dark/Daylight) and the list of theme families. Picking
// either applies it live and asks the host to persist it. The family list is
// server-rendered into #themeSheetGrid from theme.rs, so it's the single source
// of truth; this only wires interaction and reflects the current selection.
function themeFamilyName(family) {
  const item = themeSheetGrid.querySelector('.theme-item[data-family="' + family + '"]');
  return item ? item.textContent.trim() : family;
}
function updateThemeSelection() {
  const mode = window.leafTheme.getMode();
  const family = window.leafTheme.getFamily();
  if (themeCurrentLabel) {
    themeCurrentLabel.textContent =
      themeFamilyName(family) + ' · ' + window.leafLocale.t('settings.theme.' + mode);
  }
  themeSheetModes.querySelectorAll('.theme-mode-btn').forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  themeSheetGrid.querySelectorAll('.theme-item').forEach((btn) => {
    const active = btn.dataset.family === family;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}
function openThemeSheet() {
  const settingsMenu = document.getElementById('settingsMenu');
  if (settingsMenu) {
    settingsMenu.open = false;
  }
  themeBackdrop.hidden = false;
  themeSheet.hidden = false;
  requestAnimationFrame(() => {
    themeBackdrop.classList.add('open');
    themeSheet.classList.add('open');
  });
}
function closeThemeSheet() {
  themeBackdrop.classList.remove('open');
  themeSheet.classList.remove('open');
  setTimeout(() => {
    themeBackdrop.hidden = true;
    themeSheet.hidden = true;
  }, 200);
}
if (themeSheetOpen) {
  themeSheetOpen.addEventListener('click', openThemeSheet);
}
if (themeSheetClose) {
  themeSheetClose.addEventListener('click', closeThemeSheet);
}
if (themeBackdrop) {
  themeBackdrop.addEventListener('click', closeThemeSheet);
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && themeSheet && !themeSheet.hidden) {
    closeThemeSheet();
  }
});
themeSheetModes.querySelectorAll('.theme-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    window.leafTheme.setMode(btn.dataset.mode);
    send({ command: 'setThemeMode', mode: btn.dataset.mode });
  });
});
themeSheetGrid.querySelectorAll('.theme-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    window.leafTheme.setFamily(btn.dataset.family);
    send({ command: 'setThemeFamily', family: btn.dataset.family });
  });
});
if (themeSheetBrowse) {
  themeSheetBrowse.addEventListener('click', (event) => {
    event.preventDefault();
    send({ command: 'openExternal', url: THEME_REPO_URL });
  });
}
// Tell the host what the page background and divider color resolve to so it can
// paint the native title bar to match the page and the window border to the
// theme's divider color (a darker line on light themes, a colored rule on
// themes like Nightshade). Runs on every theme change, including system light/dark flips, so
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
// Editing (code view + save) state. Declared here — before the subscriptions
// below, which invoke renderState() synchronously on load — so it is out of the
// temporal dead zone by the time renderState() first reads it. The functions
// that use it are defined further down (near the rest of the editing code).
const codeViewButton = document.getElementById('codeViewButton');
const saveButton = document.getElementById('saveButton');
const undoButton = document.getElementById('undoButton');
// Whether each document has a reading-view edit to undo. Set optimistically
// when an edit is sent, then overwritten by the host's authoritative answer in
// leafBlocksResynced and cleared on save. The host owns the undo stack, so the
// button can never linger after undoing all the way back or saving a baseline.
const undoableByPath = new Map();
// Whether the reader is currently showing raw source instead of the rendered
// document. Reset by renderState(), set by leafShowCodeView().
let codeViewActive = false;
// The last textarea value, mirrored so a save (and the debounced re-highlight)
// send the current buffer even if a keystroke is still within the debounce.
let codeViewText = '';
let sourceUpdateTimer = 0;
// Unsaved-edits state per document path, so the tab dot and Save button survive
// the tab bar being re-rendered. Absent / false means clean.
const dirtyByPath = new Map();
// Scroll fraction captured when toggling between the reading and code views, so
// the destination view opens at the same relative position (top stays top,
// mid-document stays mid-document). Consumed (and cleared) by the next render.
// Declared here, above the subscriptions that run renderState() on load.
let pendingViewScrollFraction = null;
// Byte offset of the block at the top of the reading viewport when the code view
// opens, so it lands on the line you were reading rather than a height fraction
// (rendered height and source length diverge). Consumed by the next renderCodeView.
let pendingCodeViewSrcOffset = null;
// The mirror for leaving the code view: byte offset of the top source line,
// consumed by the next reading render so it lands on that block. Replaces a racy
// fraction hand-off that dropped the reader to the top of the document.
let pendingReadingSrcOffset = null;
// True when the source view was scrolled to the very top as the toggle fired, so
// the destination lands flush at the top instead of aligning the first block just
// below the edge (which read as an unwanted little scroll-down). Consumed by the
// next render in either direction.
let pendingViewAtTop = false;
// Live reading-view editing. The source buffer stays authoritative in Rust; the
// reading view anchors each edit to a source byte range and asks the host to
// splice it. These hold what the frontend needs between renders. Declared here,
// above the subscriptions that run renderState() on load.
let currentDocumentFormat = 'markdown';
let currentDocumentSource = '';
// Where the caret should land after the next render, carrying it across the
// re-render a structural edit (Enter/Backspace) triggers so typing flows on.
// `srcStart` names the block by its post-splice source offset, `textOffset` the
// position inside it; `insertBelow` opens a fresh empty paragraph after it.
let pendingCaret = null;
// A reader anchor the next leafReloadDocument should restore instead of its own
// top-visible capture. Set when committing a source-edited block (e.g. an image)
// whose own height swings across the re-render: it points at the stable block
// ABOVE the edit, so the reader holds its place rather than snapping to the top.
let pendingEditAnchor = null;
window.leafTheme.subscribe((theme) => {
  updateThemeSelection();
  reportWindowChrome(theme);
  refreshGraphColors();
});
window.leafLocale.subscribe(() => {
  renderStaticText();
  renderState();
  applyScanProgress(lastScanProgress);
  renderLibrary();
  updateThemeSelection();
  renderUpdateButton();
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
        // The keyboard cycle always lands on a different tab, so its document
        // load may be slow — show the spinner while the host renders it.
        beginReaderLoading();
        send({
          command: 'switchTab',
          index: next - 1,
          scroll_anchor: currentScrollAnchor(),
          code_scroll: codeViewActive ? viewScrollFraction() : null,
        });
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
// Above this many characters of view HTML, building the DOM (innerHTML plus
// the layout-forcing decoration passes) blocks this thread long enough that
// the spinner should be painted on screen before the work starts.
const READER_LOADING_HEAVY_HTML = 250000;
// Invalidates a deferred heavy render when a newer render supersedes it.
let readerRenderToken = 0;
// Run a blocking view render. The real stall on a big payload is the render
// itself, so a heavy payload pops the spinner and yields two frames — one for
// rAF callbacks, one so the compositor actually paints it — before blocking.
function runViewRender(payload, render) {
  const token = ++readerRenderToken;
  const run = () => {
    if (token !== readerRenderToken) return;
    render();
    clearReaderLoading();
  };
  if (payload && payload.length >= READER_LOADING_HEAVY_HTML) {
    beginReaderLoading();
    window.requestAnimationFrame(() => window.requestAnimationFrame(run));
  } else {
    run();
  }
}
window.leafSetState = (state) => {
  currentState = state || { recent: [], tabs: [], active: null, document: null };
  if (!currentState.document) {
    emptyDescriptionKey = pickEmptyDescriptionKey();
  }
  runViewRender(currentState.document && currentState.document.html, () => {
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
  });
};
// Re-render the active document after a live reload without scrolling to the top:
// capture the position, re-render, restore it (clamped if the document shrank).
window.leafReloadDocument = (state) => {
  // A source-block commit leaves an above-edit anchor; prefer it over the
  // top-visible capture, which would target the momentarily zero-height block.
  const anchor = pendingEditAnchor || captureReaderScrollAnchor();
  pendingEditAnchor = null;
  currentState = state || currentState || { recent: [], tabs: [], active: null, document: null };
  runViewRender(currentState.document && currentState.document.html, () => {
    resetReaderScrollOnNextRender = false;
    renderState();
    readerScrollAnchor = anchor;
    window.requestAnimationFrame(() => {
      restoreReaderScrollAnchor(anchor);
      readerScrollAnchor = captureReaderScrollAnchor();
      updateMinimapViewport();
    });
  });
};
// Switch to another tab and land where it was last left. `anchor` is a content
// anchor that survives the re-render, null the first time (starts at the top).
// Skips the reset-to-top that leafSetState runs so a tab click never jumps up.
window.leafSwitchTab = (state, anchor) => {
  currentState = state || { recent: [], tabs: [], active: null, document: null };
  if (!currentState.document) {
    emptyDescriptionKey = pickEmptyDescriptionKey();
  }
  runViewRender(currentState.document && currentState.document.html, () => {
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
    // Re-apply after layout settles; renderState's reflow observer keeps re-pinning
    // the anchor as images above it decode and grow, so the landing doesn't drift.
    window.requestAnimationFrame(() => {
      restoreReaderScrollAnchor(anchor);
      readerScrollAnchor = captureReaderScrollAnchor();
      updateMinimapViewport();
    });
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
    // Record where we landed as the reader anchor, or the ResizeObserver's
    // scheduleReaderLayoutUpdate would re-pin the pre-jump position and yank the
    // page back. Re-pin next frame too so the landing converges on the target.
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
  graphScopeControl.setAttribute('aria-label', window.leafLocale.t('settings.graphScope.aria'));
  minimapEnabledControl.setAttribute('aria-label', window.leafLocale.t('settings.minimap.aria'));
  speedReaderEnabledControl.setAttribute('aria-label', window.leafLocale.t('settings.speedReader.aria'));
  lineNumbersEnabledControl.setAttribute('aria-label', window.leafLocale.t('settings.lineNumbers.aria'));
  readerEditingEnabledControl.setAttribute('aria-label', window.leafLocale.t('settings.readerEditing.aria'));
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
  tabBar.innerHTML = tabs.map((tab, index) => `<span class="tab${index === active ? ' tab-active' : ''}${isDocumentDirty(tab.path) ? ' tab-modified' : ''}" data-tab-pos="${index}" data-tab-path="${escapeAttr(tab.path || '')}"><button type="button" class="tab-label" data-tab-index="${index}" data-reveal-path="${escapeAttr(tab.path)}" title="${escapeAttr(tab.path)}">${escapeText(tabDisplayName(tab))}</button><span class="tab-dirty-dot" aria-hidden="true"></span><button type="button" class="tab-close" data-tab-close="${index}" aria-label="${escapeAttr(window.leafLocale.t('actions.closeTab'))}" title="${escapeAttr(window.leafLocale.t('actions.closeTab'))}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></span>`).join('');
  tabBar.querySelectorAll('[data-tab-index]').forEach((button) => {
    button.addEventListener('click', () => {
      if (suppressTabClick) return;
      const index = Number(button.dataset.tabIndex);
      const wasActive = index === (currentState && currentState.active);
      // A real switch renders the other document (which may be slow); show the
      // spinner. Re-clicking the active tab is a host no-op, so skip it there.
      if (!wasActive) beginReaderLoading();
      send({
        command: 'switchTab',
        index,
        scroll_anchor: currentScrollAnchor(),
        code_scroll: codeViewActive ? viewScrollFraction() : null,
      });
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
// ---- Editing: code view + save -------------------------------------------
// Source-of-truth is in Rust: the host owns the buffer and re-highlights. The JS
// only drives the code view (a textarea over a highlight layer), tracks unsaved
// edits, and relays intent. Its mutable state is declared earlier, above the
// subscriptions that fire renderState() synchronously on load.

function isDocumentDirty(path) {
  return !!(path && dirtyByPath.get(path));
}

// Reflect a document's dirty state into the tab dot and, when it is the active
// document, the Save button — without forcing a full re-render.
function setDirtyState(path, dirty) {
  if (!path) return;
  if (dirty) dirtyByPath.set(path, true);
  else dirtyByPath.delete(path);
  document.querySelectorAll('.tab').forEach((tabEl) => {
    if (tabEl.dataset.tabPath === path) {
      tabEl.classList.toggle('tab-modified', !!dirty);
    }
  });
  updateEditingChrome();
}

// Show/hide and style the code-view toggle and Save button for the active
// document. Both are hidden on the home screen; Save enables (and greens) only
// when the active document has unsaved edits.
function updateEditingChrome() {
  const path = activeDocumentPath();
  const hasDocument = !!path;
  if (codeViewButton) {
    codeViewButton.hidden = !hasDocument;
    codeViewButton.setAttribute('aria-pressed', codeViewActive ? 'true' : 'false');
    codeViewButton.classList.toggle('is-active', codeViewActive);
  }
  if (saveButton) {
    // Nothing to save, nothing shown: the green "Save" button appears only when
    // the active document has unsaved edits.
    saveButton.hidden = !(hasDocument && isDocumentDirty(path));
  }
  if (undoButton) {
    // Undo appears whenever the document has reading-view edits since the last
    // successful save.
    undoButton.hidden = !(hasDocument && undoableByPath.get(path) === true);
  }
  // Save/Undo/code-view visibility changes the action row's width — refold.
  refitAppBar();
}

// Ask the host to revert the most recent reading-view edit. The host pops its
// snapshot, re-renders, and resyncs the chrome, so undoing the last edit hides
// both buttons.
function undoLastEdit() {
  const path = activeDocumentPath();
  if (!path || undoableByPath.get(path) !== true) return;
  send({ command: 'undoEdit' });
}

// The last buffer text handed to the host, so a stale re-highlight response
// (typing continued after it was sent) is ignored rather than regressing.
let lastSentSourceText = null;

// One right-aligned number per source line, paired with a transparent copy of
// the line's text so the row wraps to the same height as the colour layer —
// keeping numbers aligned once lines wrap. Rebuilt when the text changes.
function buildLineNumbers(container, text) {
  const lines = text.split('\n');
  container.innerHTML = lines
    .map(
      (line, index) =>
        `<div class="cv-lnrow"><span class="cv-lnnum">${index + 1}</span><span class="cv-lntxt">${escapeText(line) || '​'}</span></div>`
    )
    .join('');
}

// A zero-width space stands in for an empty source line so its box keeps a full
// row's height, aligning the colour layer and gutter with the textarea.
const CODE_VIEW_BLANK = '​';

// Split the flat highlighter output into one HTML string per source line, closing
// and re-opening any span that straddles a line break so colour carries across
// without leaking markup. Returns null unless the split yields exactly
// `expectedCount` lines, so the caller can fall back to a plain render.
function highlightedHtmlToLines(html, expectedCount) {
  const lines = [];
  const openStack = [];
  let current = '';
  const tokenRe = /<span\b[^>]*>|<\/span>|[^<]+/g;
  let match;
  while ((match = tokenRe.exec(html)) !== null) {
    const token = match[0];
    if (token[0] === '<') {
      if (token[1] === '/') {
        openStack.pop();
        current += '</span>';
      } else {
        openStack.push(token);
        current += token;
      }
    } else {
      let start = 0;
      for (let i = 0; i < token.length; i += 1) {
        if (token[i] === '\n') {
          current += token.slice(start, i);
          current += '</span>'.repeat(openStack.length);
          lines.push(current);
          current = openStack.join('');
          start = i + 1;
        }
      }
      current += token.slice(start);
    }
  }
  lines.push(current);
  if (expectedCount != null && lines.length !== expectedCount) {
    return null;
  }
  return lines;
}

// The inner HTML each colour-layer line currently shows, one per source line. A
// recolour compares against this to touch only changed lines; a keystroke sets an
// edited line's entry to plain text so the next recolour repaints it.
let codeViewColourHtml = [];

// The inner markup for one colour-layer line: the highlighted line when the
// per-line split lined up, a zero-width space for a blank line (so its box keeps a
// row's height), or plain-escaped text as a fallback.
function colourLineInner(lineText, colouredLine) {
  if (lineText === '') {
    return CODE_VIEW_BLANK;
  }
  return colouredLine != null ? colouredLine : escapeText(lineText);
}

// The per-line inner markup for a whole buffer, coloured from `html` (falling back
// to plain-escaped text if the split doesn't line up 1:1). The single source both
// the full build and the incremental recolour compute their line HTML from.
function computeColourInner(html, text) {
  const lineTexts = text.split('\n');
  const coloured = highlightedHtmlToLines(html || '', lineTexts.length);
  return lineTexts.map((lineText, index) =>
    colourLineInner(lineText, coloured ? coloured[index] : null)
  );
}

// Rebuild the whole colour layer, one `<div class="cv-line">` per source line.
// Used on entry and as a self-heal; the keystroke/recolour paths patch instead.
function setCodeViewColourLines(codeEl, html, text) {
  const inner = computeColourInner(html, text);
  codeEl.innerHTML = inner.map((line) => `<div class="cv-line">${line}</div>`).join('');
  codeViewColourHtml = inner;
}

// Repaint after a debounced re-highlight by replacing only the lines whose markup
// changed (edited lines, plus any whose colour shifted from multi-line state like
// a fence). Diffs against the authoritative full highlight, so unchanged lines
// stay in place and the whole document never re-lays-out.
function recolourCodeViewLines(codeEl, html, text) {
  const inner = computeColourInner(html, text);
  if (
    codeViewColourHtml.length !== inner.length ||
    codeEl.children.length !== inner.length
  ) {
    // Line structure drifted from the highlight; rebuild once to resync.
    setCodeViewColourLines(codeEl, html, text);
    return;
  }
  for (let i = 0; i < inner.length; i += 1) {
    if (codeViewColourHtml[i] !== inner[i]) {
      codeEl.children[i].innerHTML = inner[i];
      codeViewColourHtml[i] = inner[i];
    }
  }
}

// A single colour-layer line element. Freshly typed lines show as plain text (via
// textContent, so no markup leaks); the debounced re-highlight recolours them.
function makeColourLine(text) {
  const div = document.createElement('div');
  div.className = 'cv-line';
  div.textContent = text === '' ? CODE_VIEW_BLANK : text;
  return div;
}

// A single gutter row: the right-aligned number plus a transparent copy of the
// line's text (so the row wraps to the same height as the colour line).
function makeGutterRow(text, index) {
  const row = document.createElement('div');
  row.className = 'cv-lnrow';
  const num = document.createElement('span');
  num.className = 'cv-lnnum';
  num.textContent = String(index + 1);
  const txt = document.createElement('span');
  txt.className = 'cv-lntxt';
  txt.textContent = text === '' ? CODE_VIEW_BLANK : text;
  row.append(num, txt);
  return row;
}

// Replace a contiguous run of `container`'s children (its line elements are 1:1
// with source lines) — remove `removeCount` starting at `start`, then insert one
// element per entry in `newTexts`, built by `makeEl(text, index)`.
function spliceLineElements(container, start, removeCount, newTexts, makeEl) {
  let node = container.children[start] || null;
  for (let i = 0; i < removeCount && node; i += 1) {
    const next = node.nextSibling;
    node.remove();
    node = next;
  }
  const frag = document.createDocumentFragment();
  for (let i = 0; i < newTexts.length; i += 1) {
    frag.appendChild(makeEl(newTexts[i], start + i));
  }
  container.insertBefore(frag, node);
}

// The text nodes of one colour-layer line, in document order. Their concatenated
// data equals the line's text; the elements around them are the colour spans.
function codeLineTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node);
    node = walker.nextNode();
  }
  return nodes;
}

// Delete `len` chars at column `start` from a colour line's text nodes, leaving
// the colour spans in place. Offsets are read before any node is edited, so
// mutating one doesn't disturb the others.
function deleteCodeLineRange(root, start, len) {
  if (len <= 0) return;
  const end = start + len;
  let offset = 0;
  for (const node of codeLineTextNodes(root)) {
    const nodeStart = offset;
    const nodeEnd = offset + node.data.length;
    offset = nodeEnd;
    if (nodeEnd <= start) continue;
    if (nodeStart >= end) break;
    const from = Math.max(start, nodeStart) - nodeStart;
    const to = Math.min(end, nodeEnd) - nodeStart;
    node.data = node.data.slice(0, from) + node.data.slice(to);
  }
}

// Insert `str` at column `at`, inside the colour run to its left so typed text
// inherits that colour (a char added in a blue link stays blue).
function insertCodeLineText(root, at, str) {
  if (!str) return;
  const nodes = codeLineTextNodes(root);
  if (nodes.length === 0) {
    root.appendChild(document.createTextNode(str));
    return;
  }
  let offset = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const nodeStart = offset;
    const nodeEnd = offset + node.data.length;
    if (at <= nodeEnd && (at > nodeStart || i === 0)) {
      const local = at - nodeStart;
      node.data = node.data.slice(0, local) + str + node.data.slice(local);
      return;
    }
    offset = nodeEnd;
  }
  const last = nodes[nodes.length - 1];
  last.data += str;
}

// Edit one coloured line's DOM in place so its colours survive the keystroke:
// diff old vs new text to the changed span, then delete/insert only those chars
// among the text nodes. The debounced re-highlight corrects boundary shifts after.
// Stops the edited line dropping to plain text between keystroke and re-highlight.
function patchColourLineText(lineEl, oldText, newText) {
  if (newText === '') {
    lineEl.innerHTML = CODE_VIEW_BLANK;
    return;
  }
  if (oldText === '') {
    // The line was blank (a zero-width space), so there's no colouring to
    // preserve — show the typed text plainly.
    lineEl.textContent = newText;
    return;
  }
  const maxCommon = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxCommon && oldText[prefix] === newText[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < maxCommon - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  deleteCodeLineRange(lineEl, prefix, oldText.length - prefix - suffix);
  insertCodeLineText(lineEl, prefix, newText.slice(prefix, newText.length - suffix));
}

// The line text a colour-layer element is currently showing, mapping the blank
// line's zero-width-space placeholder back to an empty string.
function colourLineText(lineEl) {
  const text = lineEl.textContent;
  return text === CODE_VIEW_BLANK ? '' : text;
}

// Patch only the lines a keystroke changed. A textarea edit is one contiguous
// splice, so the shared prefix/suffix of the old and new line arrays is untouched
// and only the range between them is rebuilt — keeping large documents from
// re-rendering on every keystroke.
function updateCodeViewLinesIncremental(codeEl, gutterEl, prevText, nextText) {
  const prev = prevText.split('\n');
  const next = nextText.split('\n');
  const maxCommon = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < maxCommon && prev[prefix] === next[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < maxCommon - prefix &&
    prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const removeCount = prev.length - suffix - prefix;
  const inserted = next.slice(prefix, next.length - suffix);
  // The overwhelmingly common edit — typing within a single line — replaces one
  // line with one line. Keep that line's existing coloured element and edit only
  // the changed characters into it, so its colours never drop to plain text. Fall
  // back to a plain rebuild only if the element's text has drifted from what we
  // expect (then the debounced recolour restores it).
  if (removeCount === 1 && inserted.length === 1) {
    const lineEl = codeEl.children[prefix];
    if (lineEl && colourLineText(lineEl) === prev[prefix]) {
      patchColourLineText(lineEl, prev[prefix], inserted[0]);
      codeViewColourHtml[prefix] = lineEl.innerHTML;
    } else {
      spliceLineElements(codeEl, prefix, removeCount, inserted, makeColourLine);
      codeViewColourHtml.splice(prefix, removeCount, ...inserted.map(() => null));
    }
    // The gutter mirror is transparent (it only sets each row's height), so a
    // plain rebuild of the one changed row is fine.
    spliceLineElements(gutterEl, prefix, removeCount, inserted, makeGutterRow);
    return;
  }
  spliceLineElements(codeEl, prefix, removeCount, inserted, makeColourLine);
  spliceLineElements(gutterEl, prefix, removeCount, inserted, makeGutterRow);
  // Keep the recolour bookkeeping in step: the edited lines now show plain text,
  // so mark them (null) to guarantee the next recolour repaints them.
  codeViewColourHtml.splice(prefix, removeCount, ...inserted.map(() => null));
  // Inserting or removing lines shifts every following line's number; renumber the
  // suffix rows the splice left in place. A same-line edit skips this entirely.
  if (prev.length !== next.length) {
    const rows = gutterEl.children;
    for (let i = prefix; i < rows.length; i += 1) {
      const num = rows[i].firstChild;
      if (num) {
        num.textContent = String(i + 1);
      }
    }
  }
}

// Rebuild the code view's minimap thumbnail now. The per-keystroke DOM edits do
// NOT drive the minimap — its content mutation observer is deliberately detached
// in the code view (see renderCodeView) so a full-document clone does not run on
// every character. Instead we refresh it on the debounced edit cycle.
function refreshCodeViewMinimap() {
  if (!codeViewActive) {
    return;
  }
  invalidateMinimapPreview();
}

function scheduleSourceUpdate() {
  if (sourceUpdateTimer) clearTimeout(sourceUpdateTimer);
  sourceUpdateTimer = setTimeout(() => {
    sourceUpdateTimer = 0;
    lastSentSourceText = codeViewText;
    send({ command: 'updateSource', text: codeViewText });
  }, 180);
}

// Push the latest buffer to the host now, cancelling any pending debounce, so a
// save writes exactly what is in the textarea.
function flushSourceUpdate() {
  if (!codeViewActive) return;
  if (sourceUpdateTimer) {
    clearTimeout(sourceUpdateTimer);
    sourceUpdateTimer = 0;
  }
  lastSentSourceText = codeViewText;
  send({ command: 'updateSource', text: codeViewText });
}

// The code view reuses the reader's own minimap (the scaled document clone in a
// sticky rail, bound by bindDocumentMinimap / updated by updateMinimapViewport).
// That machinery finds its content via minimapSourceElement(), which matches the
// code view's document container too — no separate code-view minimap exists.

function saveActiveDocument() {
  const path = activeDocumentPath();
  if (!path || !isDocumentDirty(path)) return;
  flushSourceUpdate();
  send({ command: 'saveDocument' });
}

// How far down the reader shell is scrolled, as a 0..1 fraction of its
// scrollable range. Approximate by design — the two views wrap differently —
// but it keeps "top is top" and "middle is middle" across the toggle.
function viewScrollFraction() {
  const scrollable = app.scrollHeight - app.clientHeight;
  if (scrollable <= 0) return 0;
  return Math.min(1, Math.max(0, app.scrollTop / scrollable));
}

// The source byte offset of the block at the top of the reading viewport, or
// null when there's nothing to anchor to. Blocks carry their source range in
// data-src-start (attached for every Markdown block, stamped inline on TEI
// blocks), so the topmost visible block names where the reader is in the
// source exactly — unlike the whole-document height fraction.
function topReadingBlockSourceOffset() {
  const anchorEl = resolveReaderAnchorElement(captureReaderScrollAnchor());
  const block = anchorEl && anchorEl.closest ? anchorEl.closest('[data-src-start]') : null;
  if (!block) return null;
  const start = Number(block.dataset.srcStart);
  return Number.isFinite(start) ? start : null;
}

// The 0-based source line containing a UTF-8 byte offset. Block source ranges
// are byte offsets (pulldown-cmark / roxmltree), but the buffer is a UTF-16 JS
// string, so walk code points accumulating byte lengths until the offset is
// reached, counting the newlines passed. Only scans up to the offset.
function lineIndexAtByteOffset(text, byteOffset) {
  if (!Number.isFinite(byteOffset) || byteOffset <= 0) return 0;
  let bytes = 0;
  let line = 0;
  for (let i = 0; i < text.length && bytes < byteOffset; ) {
    const cp = text.codePointAt(i);
    if (cp === 0x0a) line += 1;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    i += cp > 0xffff ? 2 : 1;
  }
  return line;
}

// The inverse: UTF-8 byte offset of the start of a 0-based source line.
function byteOffsetAtLineIndex(text, lineIndex) {
  if (!Number.isFinite(lineIndex) || lineIndex <= 0) return 0;
  let bytes = 0;
  let line = 0;
  for (let i = 0; i < text.length && line < lineIndex; ) {
    const cp = text.codePointAt(i);
    if (cp === 0x0a) line += 1;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    i += cp > 0xffff ? 2 : 1;
  }
  return bytes;
}

// The 0-based index of the code view's top visible gutter line, by binary
// search over the in-order line rows.
function topVisibleCodeLineIndex() {
  const rows = app.querySelectorAll('.cv-lnrow');
  if (!rows.length) return null;
  const topEdge = app.getBoundingClientRect().top + 1;
  let lo = 0;
  let hi = rows.length - 1;
  let found = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].getBoundingClientRect().bottom > topEdge) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}

// Scroll the reading view so the block containing `srcOffset` sits at the top
// edge: the deterministic landing for leaving the code view. Falls back to
// no-op (caller keeps its own fallback) when the block map is missing.
function scrollReadingToSrcOffset(srcOffset) {
  const body = app.querySelector('.document-body');
  if (!body) return false;
  const blocks = body.querySelectorAll('[data-src-start]');
  if (!blocks.length) return false;
  let target = null;
  for (const el of blocks) {
    const start = Number(el.dataset.srcStart);
    if (!Number.isFinite(start) || start > srcOffset) break;
    target = el;
  }
  if (!target) target = blocks[0];
  correctReaderScrollOrigin();
  const shellRect = app.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  setReaderScrollTop(app.scrollTop + rect.top - shellRect.top);
  return true;
}

if (codeViewButton) {
  codeViewButton.addEventListener('click', () => {
    if (!activeDocumentPath()) return;
    // Carry the current position across the toggle; the destination view's
    // render consumes it and lands at the same relative spot.
    pendingViewScrollFraction = viewScrollFraction();
    // At the very top, land flush at the top of the other view — don't align the
    // first block below the edge, which reads as a stray scroll-down.
    pendingViewAtTop = app.scrollTop <= 1;
    // Entering the code view: remember which source line the reader is on, so
    // it opens there. Leaving: remember which line the code view is on, so the
    // reading view lands on that block. The fraction stays as the fallback.
    if (codeViewActive) {
      pendingCodeViewSrcOffset = null;
      const lineIndex = topVisibleCodeLineIndex();
      pendingReadingSrcOffset = lineIndex == null ? null : byteOffsetAtLineIndex(codeViewText, lineIndex);
    } else {
      pendingReadingSrcOffset = null;
      pendingCodeViewSrcOffset = topReadingBlockSourceOffset();
    }
    // Either direction re-renders the whole view (highlighting a big source or
    // rebuilding a big document is slow), so arm the spinner for the wait.
    beginReaderLoading();
    send({ command: codeViewActive ? 'exitCodeView' : 'enterCodeView' });
  });
}
if (saveButton) {
  saveButton.addEventListener('click', saveActiveDocument);
}
if (undoButton) {
  undoButton.addEventListener('click', undoLastEdit);
}
// Ctrl/Cmd+S saves the active document when there is something to save.
window.addEventListener('keydown', (event) => {
  const saveKey = (event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 's' || event.key === 'S');
  if (!saveKey) return;
  if (!activeDocumentPath() || !isDocumentDirty(activeDocumentPath())) return;
  event.preventDefault();
  saveActiveDocument();
});
// Ctrl/Cmd+Z steps back one committed reading-view edit — but only when the
// keystroke is NOT inside a live editing surface, whose own native undo still
// covers uncommitted typing keystroke by keystroke.
window.addEventListener('keydown', (event) => {
  const undoKey =
    (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key === 'z' || event.key === 'Z');
  if (!undoKey) return;
  if (isEditableMouseTarget(event.target)) return;
  const path = activeDocumentPath();
  if (!path || undoableByPath.get(path) !== true) return;
  event.preventDefault();
  undoLastEdit();
});

// Build the wrapped raw-source code view: three exactly-aligned layers (colour,
// line-number mirror, transparent textarea) that the reader shell (#app)
// scrolls as one — the same scroller the reading view uses, whose native
// scrollbar is already hidden. The document never scrolls sideways: long lines
// wrap, and the line numbers stay pinned to their lines.
//
// The rail on the right is the reader's own document minimap — identical markup
// and machinery (bindDocumentMinimap, updateMinimapViewport, the clone-based
// thumbnail). It renders here regardless of the reading view's minimap setting
// because it is the code view's vertical scroll affordance.
function renderCodeView(state) {
  disconnectMinimapPreviewObservers();
  disconnectReaderReflowObserver();
  readerAnchorBlocks = null;
  // If the code view is already on screen (live reload, tab reorder), remember
  // where it sits so an in-place re-render doesn't jump to the top. An explicit
  // restored fraction or a pending toggle fraction still wins over this.
  const priorCodeScroll = app.querySelector('.code-view-input') ? viewScrollFraction() : null;
  app.className = 'reader-shell has-document code-view-shell';
  // Flag the code view at the document root so the header's active tab (a sibling
  // of the reader, not a descendant) can match the code surface color.
  document.documentElement.dataset.codeView = 'true';
  const text = state.text || '';
  lastSentSourceText = text;
  app.innerHTML = `
    <div class="code-view" data-language="${escapeAttr(state.displayName || '')}">
      <div class="code-view-doc">
        <pre class="code-view-highlight" aria-hidden="true"><code class="language-${escapeAttr(state.language || '')}"></code></pre>
        <div class="code-view-linenums" aria-hidden="true"></div>
        <textarea class="code-view-input" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off"></textarea>
      </div>
      <aside class="document-minimap" aria-label="${escapeAttr(window.leafLocale.t('minimap.aria'))}"><div class="document-minimap-track" aria-hidden="true"><div class="document-minimap-content" aria-hidden="true"></div><div class="document-minimap-viewport" aria-hidden="true"></div></div></aside>
    </div>`;
  const textarea = app.querySelector('.code-view-input');
  const highlight = app.querySelector('.code-view-highlight');
  const code = highlight.querySelector('code');
  const linenums = app.querySelector('.code-view-linenums');
  textarea.value = text;
  setCodeViewColourLines(code, state.html, text);
  buildLineNumbers(linenums, text);
  // Tab edits the document — insert a tab character at the caret — instead of
  // moving focus to the next control. Inserted via execCommand so the
  // textarea's native undo stack keeps working. Shift+Tab is left alone as the
  // standard keyboard escape out of the editor.
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      document.execCommand('insertText', false, '\t');
    }
  });
  textarea.addEventListener('input', () => {
    const prevText = codeViewText;
    codeViewText = textarea.value;
    // Patch only the changed lines into the colour layer and gutter. A within-line
    // edit splices chars into the existing spans so the line never drops to plain
    // text; the debounced re-highlight corrects boundary shifts after.
    updateCodeViewLinesIncremental(code, linenums, prevText, codeViewText);
    const path = activeDocumentPath();
    if (path) setDirtyState(path, true);
    scheduleSourceUpdate();
  });
  // Wire the reader's minimap to this DOM: rail drag/click, the resize observer,
  // and the first thumbnail build. The global #app scroll listener keeps the
  // viewport box in sync while scrolling.
  bindDocumentMinimap();
  // Detach the minimap's mutation observer: the document mutates on every
  // keystroke here, and re-cloning it each time stuttered on large files. The
  // thumbnail refreshes on the debounced edit cycle instead.
  if (minimapBodyObserver) {
    minimapBodyObserver.disconnect();
    minimapBodyObserver = null;
  }
  // Setting .value parks the caret at the end, and focus() would scroll it into
  // view (yanking to the bottom). Park at the start, focus without scrolling,
  // then land where we should: an explicit restored position (returning to a
  // tab left in code view), else a pending toggle fraction, else the position
  // the code view already held (in-place re-render).
  textarea.setSelectionRange(0, 0);
  textarea.focus({ preventScroll: true });
  const explicit = typeof state.scrollFraction === 'number' ? state.scrollFraction : null;
  const srcOffset = pendingCodeViewSrcOffset;
  pendingCodeViewSrcOffset = null;
  const atTop = pendingViewAtTop;
  pendingViewAtTop = false;
  let positioned = false;
  // Landing on the reader's exact source line wins over any fraction, but only
  // when this render isn't restoring an explicit saved position (a tab reopened
  // in the code view) and wasn't toggled from the very top — there we skip the
  // block landing and let the fraction (0) fall through to a flush-top landing.
  if (explicit == null && !atTop && srcOffset != null) {
    const lineIndex = lineIndexAtByteOffset(text, srcOffset);
    const row = linenums.children[Math.min(lineIndex, linenums.children.length - 1)];
    if (row) {
      const shellRect = app.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      // Land the target line just below the top edge, echoing the reading gap.
      app.scrollTop = Math.max(0, app.scrollTop + (rowRect.top - shellRect.top) - 12);
      positioned = true;
    }
  }
  if (!positioned) {
    let fraction = explicit;
    if (fraction == null) fraction = pendingViewScrollFraction;
    if (fraction == null) fraction = priorCodeScroll;
    const scrollable = Math.max(0, app.scrollHeight - app.clientHeight);
    app.scrollTop = (fraction || 0) * scrollable;
  }
  pendingViewScrollFraction = null;
  window.requestAnimationFrame(() => updateMinimapViewport());
}

// Enter the code view: the host sends the highlighted source, the exact buffer
// text, the language, and the dirty state.
window.leafShowCodeView = (state) => {
  runViewRender(state && state.html, () => {
    codeViewActive = true;
    codeViewText = (state && state.text) || '';
    renderCodeView(state || {});
    const path = activeDocumentPath();
    if (path) setDirtyState(path, !!(state && state.dirty));
    updateEditingChrome();
  });
};

// Refresh the code view's colour layer and dirty state after a debounced
// re-highlight. Only recolour when the buffer still matches what was sent, or
// stale HTML would hide newer keystrokes.
window.leafSourceUpdated = (state) => {
  if (!codeViewActive || !state) return;
  if (lastSentSourceText === null || codeViewText === lastSentSourceText) {
    const code = app.querySelector('.code-view-highlight code');
    if (code) recolourCodeViewLines(code, state.html, codeViewText);
  }
  const path = activeDocumentPath();
  if (path) setDirtyState(path, !!state.dirty);
  // The document settled — refresh the thumbnail once, not per keystroke.
  refreshCodeViewMinimap();
};

// The host reports a save's outcome. On success the document is no longer dirty;
// on failure, keep the edits and surface the error.
window.leafSaved = (path, ok, error) => {
  if (ok) {
    undoableByPath.delete(path);
    setDirtyState(path, false);
  } else if (error) {
    window.leafShowOpenError(path, error);
  }
};

// ---------------------------------------------------------------------------
// Live editing in the reading view (source-anchored, both Markdown and XML).
//
// The source buffer is the single source of truth in Rust. Every editable block
// carries its source byte range (Markdown ranges attached here from `blocks`,
// XML ranges stamped inline by the TEI renderer); an edit serializes the block
// back to source and asks the host to splice that range and re-render. Markdown
// text edits WYSIWYG; XML edits its exact source (TEI can't be reconstructed from
// the HTML). Anything not safely round-trippable stays read-only (code view only).
// ---------------------------------------------------------------------------

const sourceByteEncoder = new TextEncoder();
const sourceByteDecoder = new TextDecoder();
// The raw source between two UTF-8 byte offsets. Block ranges are byte offsets
// (Rust), but JS strings are UTF-16, so slice on the encoded bytes.
function sliceSourceBytes(source, start, end) {
  const bytes = sourceByteEncoder.encode(source || '');
  return sourceByteDecoder.decode(bytes.slice(start, end));
}

// Attach each Markdown block's source range to its rendered element. Blocks come
// in document order, but a raw-HTML wrapper (e.g. `<div align="center">`) nests
// the blocks that follow it, so they aren't all immediate children of the body.
// Walk the tree instead: descend into wrappers to reach their blocks, and step
// over a wrapper's closing tag (`</div>`), which renders to no element. If the
// structure can't be matched cleanly, attach nothing so a misaligned range can't
// drive an edit. XML ranges are stamped inline by the renderer, not here.
function attachMarkdownBlockRanges(body, blocks, source) {
  const src = typeof source === 'string' ? source : '';
  // Reader-injected, non-source elements to skip while walking.
  const isInjected = (el) =>
    el.classList.contains('document-outline') ||
    el.classList.contains('docs-pager') ||
    el.classList.contains('docs-pager-loading') ||
    el.classList.contains('frontmatter');
  // A raw-HTML block whose source is a closing tag (`</div>`) closes a wrapper
  // rather than opening an element, so it maps to no element and is stepped over.
  const isClosingHtmlBlock = (block) =>
    block.kind === 'html_block' &&
    sliceSourceBytes(src, block.start, block.end).trimStart().startsWith('</');
  const hasElementChild = (el) => Array.from(el.children).some((child) => child.nodeType === 1);

  const pairs = [];
  let cursor = 0;
  let mismatch = false;
  const nextBlock = () => {
    while (cursor < blocks.length && isClosingHtmlBlock(blocks[cursor])) cursor += 1;
    return cursor < blocks.length ? blocks[cursor] : null;
  };
  const walk = (elements) => {
    for (const el of elements) {
      if (el.nodeType !== 1 || isInjected(el)) continue;
      const block = nextBlock();
      if (!block) {
        mismatch = true;
        return;
      }
      cursor += 1;
      // A raw-HTML wrapper is a transparent container, not an editable block:
      // descend to its blocks but never stamp the wrapper itself, or source-
      // editing it would replace its rendered children with raw tag text.
      if (block.kind === 'html_block' && hasElementChild(el)) {
        walk(el.children);
      } else {
        pairs.push([el, block]);
      }
    }
  };
  walk(body.children);
  // Every non-closing block must have found an element, or the mapping drifted
  // and none of it can be trusted.
  if (nextBlock() !== null) mismatch = true;
  if (mismatch) return;

  for (const [el, block] of pairs) {
    el.dataset.blockId = String(block.id);
    el.dataset.srcStart = String(block.start);
    el.dataset.srcEnd = String(block.end);
    el.dataset.blockKind = block.kind;
    if (block.editable) el.dataset.editable = 'true';
  }
}

// The document-order checkboxes the reader may toggle: every body checkbox not in
// a table cell. Table-cell markers are synthesized (not `TaskListMarker`s), so the
// host's offsets exclude them; excluding them here keeps the Nth checkbox aligned.
function readingTaskCheckboxes() {
  const body = app.querySelector('.document-body');
  if (!body) return [];
  return Array.from(body.querySelectorAll('input[type="checkbox"]')).filter((box) => !box.closest('td'));
}

function bindTaskCheckboxes(tasks) {
  const boxes = readingTaskCheckboxes();
  const count = Array.isArray(tasks) ? tasks.length : 0;
  if (boxes.length !== count) {
    // Alignment can't be trusted — leave read-only.
    return;
  }
  boxes.forEach((box, index) => {
    box.removeAttribute('disabled');
    box.dataset.taskIndex = String(index);
    // A checkbox toggle auto-saves and records no undo, so it uses a plain send
    // (not sendEditCommand, which would optimistically flag the doc dirty).
    box.addEventListener('change', () => {
      send({ command: 'toggleTask', index });
    });
  });
}

// Make table-cell checkboxes interactive. They have no marker offset to flip
// (synthesized from cell text), so a click re-serializes the whole table from the
// DOM and splices it over the table's source range. WYSIWYG tables only — checked
// directly, since these bind even when reader editing is off (no contenteditable).
function bindTableCheckboxes() {
  const body = app.querySelector('.document-body');
  if (!body) return;
  body.querySelectorAll('[data-block-kind="table"]').forEach((table) => {
    if (!tableWysiwygSafe(table)) return;
    const start = Number(table.dataset.srcStart);
    const end = Number(table.dataset.srcEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    table.querySelectorAll('td input[type="checkbox"]').forEach((box) => {
      box.removeAttribute('disabled');
      box.addEventListener('change', () => {
        sendCheckboxBlockEdit(table, start, end, tableDomToMarkdown(table));
      });
    });
  });
}

// Serialize an anchor back to Markdown. The renderer makes several kinds of `<a>`
// that must NOT all become `[text](href)`:
//   - the gutter permalink → nothing;
//   - glossary links and GitHub refs (`.github-ref`) → their plain text;
//   - autolinks (visible text == URL) → kept bare;
//   - everything else → `[text](href)`.
function anchorToMarkdown(el) {
  if (el.classList.contains('heading-anchor')) {
    return '';
  }
  const href = el.getAttribute('href') || '';
  const text = el.textContent;
  if (href.startsWith('glossary:') || el.classList.contains('github-ref')) {
    return text;
  }
  if (
    href === text ||
    href === 'mailto:' + text ||
    href === 'http://' + text ||
    href === 'https://' + text
  ) {
    return text;
  }
  return '[' + inlineDomToMarkdown(el) + '](' + href + ')';
}

const MARKDOWN_RAW_INLINE_TAGS = new Set(['abbr', 'kbd', 'mark', 'ins', 'sub', 'sup', 'span', 'div']);
const MARKDOWN_RAW_INLINE_ATTRIBUTES = {
  abbr: ['title'],
  div: ['align', 'id'],
  span: ['id'],
};

function htmlAttributeEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function rawInlineHtmlAttributes(el, tag) {
  const allowed = MARKDOWN_RAW_INLINE_ATTRIBUTES[tag] || [];
  let out = '';
  allowed.forEach((name) => {
    if (!el.hasAttribute(name)) return;
    out += ' ' + name + '="' + htmlAttributeEscape(el.getAttribute(name) || '') + '"';
  });
  return out;
}

function rawInlineHtmlToMarkdown(el, tag) {
  return '<' + tag + rawInlineHtmlAttributes(el, tag) + '>' + inlineDomToMarkdown(el) + '</' + tag + '>';
}

// Serialize a block's inline DOM back to Markdown (bold, italic, strikethrough,
// code, links, and safe raw inline HTML), stripping render-only decorations.
// Unknown wrappers contribute just their text.
function inlineDomToMarkdown(node) {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.nodeValue;
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const tag = child.tagName.toLowerCase();
    if (child.classList.contains('heading-anchor')) {
      return;
    }
    if (tag === 'br') {
      // Keep breaks inline. A backslash-newline hard break would end an ATX
      // heading's source line and split the rendered heading apart on re-render.
      out += '<br>';
      return;
    }
    if (tag === 'strong' || tag === 'b') {
      out += '**' + inlineDomToMarkdown(child) + '**';
      return;
    }
    if (tag === 'em' || tag === 'i') {
      out += '*' + inlineDomToMarkdown(child) + '*';
      return;
    }
    if (tag === 'del' || tag === 's') {
      out += '~~' + inlineDomToMarkdown(child) + '~~';
      return;
    }
    if (tag === 'code') {
      out += '`' + child.textContent + '`';
      return;
    }
    if (tag === 'a') {
      out += anchorToMarkdown(child);
      return;
    }
    if (MARKDOWN_RAW_INLINE_TAGS.has(tag)) {
      out += rawInlineHtmlToMarkdown(child, tag);
      return;
    }
    out += inlineDomToMarkdown(child);
  });
  return out;
}

function blockDomToMarkdown(el) {
  const kind = el.dataset.blockKind;
  if (kind === 'list') {
    return listDomToMarkdown(el, '');
  }
  if (kind === 'table') {
    return tableDomToMarkdown(el);
  }
  if (kind === 'blockquote') {
    return blockquoteDomToMarkdown(el);
  }
  const text = inlineDomToMarkdown(el).trim();
  if (kind === 'heading') {
    const level = Number(el.tagName.substring(1)) || 1;
    return '#'.repeat(level) + ' ' + text;
  }
  return text;
}

// Serialize a rendered list back to Markdown item by item. Checkboxes read their
// live checked property, nested lists recurse with the marker-width indent, and
// ordered lists renumber from `start`. Only tight inline-content lists reach here
// (listWysiwygSafe gates the rest to the raw editor).
function listDomToMarkdown(listEl, indent) {
  const ordered = listEl.tagName.toLowerCase() === 'ol';
  const startNum = Number(listEl.getAttribute('start') || '1') || 1;
  const lines = [];
  let index = 0;
  Array.from(listEl.children).forEach((li) => {
    if (li.tagName.toLowerCase() !== 'li') return;
    const marker = ordered ? String(startNum + index) + '. ' : '- ';
    index += 1;
    let task = '';
    const box = Array.from(li.children).find(
      (child) => child.tagName && child.tagName.toLowerCase() === 'input' && child.type === 'checkbox',
    );
    if (box) task = box.checked ? '[x] ' : '[ ] ';
    // The item's own text: everything but its checkbox and nested lists (handled
    // separately; the clone keeps the live DOM untouched).
    const clone = li.cloneNode(true);
    Array.from(clone.children).forEach((child) => {
      const tag = child.tagName ? child.tagName.toLowerCase() : '';
      if (tag === 'ul' || tag === 'ol' || tag === 'input') child.remove();
    });
    lines.push(indent + marker + task + inlineDomToMarkdown(clone).trim());
    Array.from(li.children).forEach((child) => {
      const tag = child.tagName ? child.tagName.toLowerCase() : '';
      if (tag === 'ul' || tag === 'ol') {
        lines.push(listDomToMarkdown(child, indent + ' '.repeat(marker.length)));
      }
    });
  });
  return lines.join('\n');
}

// Serialize a rendered blockquote to `> `-prefixed Markdown, one quoted paragraph
// per child separated by a bare `>` line. `.blockquote-line` spans (from consumed
// <br>s) re-join with backslash hard breaks. Any unexpected child still
// serializes as a paragraph rather than being dropped.
function blockquoteDomToMarkdown(el) {
  const paragraphs = [];
  Array.from(el.children).forEach((child) => {
    const tag = child.tagName.toLowerCase();
    if (tag === 'a' && child.classList.contains('heading-anchor')) return;
    const lines = Array.from(child.children).filter(
      (node) => node.classList && node.classList.contains('blockquote-line'),
    );
    const text = lines.length
      ? lines.map((line) => inlineDomToMarkdown(line).trim()).join('\\\n')
      : inlineDomToMarkdown(child).trim();
    if (text) paragraphs.push(text);
  });
  return paragraphs
    .map((text) =>
      text
        .split('\n')
        .map((line) => ('> ' + line).trimEnd())
        .join('\n'),
    )
    .join('\n>\n');
}

// The delimiter row for a serialized table. Alignment (`:---:`) is stripped by
// the sanitizer and can't be read from the DOM, so reuse the original delimiter
// row when its column count still matches; only a column-count change regenerates it.
function tableDelimiterRow(el, columnCount) {
  const start = Number(el.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (Number.isFinite(start) && Number.isFinite(end)) {
    const src = sliceSourceBytes(currentDocumentSource, start, end);
    for (const line of src.split('\n').slice(1, 3)) {
      const trimmed = line.trim();
      if (/^\|?[\s:|-]+\|?$/.test(trimmed) && trimmed.includes('-')) {
        const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
        if (cells.length === columnCount) return trimmed;
      }
    }
  }
  return '| ' + Array.from({ length: columnCount }, () => '---').join(' | ') + ' |';
}

// Serialize a rendered table to GFM pipes. Cells collapse newlines and escape
// pipes; a checkbox-only cell writes its live state as `[ ]`/`[x]`.
function tableDomToMarkdown(el) {
  const cellText = (cell) => {
    const box = cell.querySelector('input[type="checkbox"]');
    const text = inlineDomToMarkdown(cell)
      .trim()
      .replace(/\|/g, '\\|')
      .replace(/\\\n/g, ' ')
      .replace(/\n+/g, ' ');
    if (box && !text) return box.checked ? '[x]' : '[ ]';
    return text;
  };
  const headCells = Array.from(el.querySelectorAll(':scope > thead > tr > th'));
  const lines = ['| ' + headCells.map(cellText).join(' | ') + ' |'];
  lines.push(tableDelimiterRow(el, headCells.length));
  el.querySelectorAll(':scope > tbody > tr').forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll(':scope > td'));
    lines.push('| ' + cells.map(cellText).join(' | ') + ' |');
  });
  return lines.join('\n');
}

const MARKDOWN_WYSIWYG_INLINE_TAGS = new Set([
  'a', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'code',
  'abbr', 'kbd', 'mark', 'ins', 'sub', 'sup', 'span', 'div',
]);

function inlineMarkdownDomWysiwygSafe(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.classList && node.classList.contains('heading-anchor')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const tag = node.tagName.toLowerCase();
    if (!MARKDOWN_WYSIWYG_INLINE_TAGS.has(tag)) return false;
  }
  return true;
}

// Whether a Markdown block edits WYSIWYG safely. Links are fine
// (anchorToMarkdown reproduces each form), but raw HTML elements such as <sub>
// cannot be reconstructed from their rendered DOM, so they use source editing.
function markdownBlockWysiwygSafe(el) {
  return (
    inlineMarkdownDomWysiwygSafe(el) &&
    !el.querySelector('img, sup.footnote-reference, .katex, .mermaid, input')
  );
}

// A list serializes faithfully only when tight and inline-content (plus
// checkboxes and nested lists). Loose lists or ones holding blocks fall back to
// the raw-source editor.
function listWysiwygSafe(el) {
  return !el.querySelector('p, pre, blockquote, table, img, sup.footnote-reference, .katex, .mermaid');
}

// A table serializes back faithfully when its cells hold only inline content
// (checkbox cells included) and it has a real header row to key the pipes off.
function tableWysiwygSafe(el) {
  return (
    !el.querySelector('img, pre, blockquote, table, sup.footnote-reference, .katex, .mermaid') &&
    !!el.querySelector(':scope > thead > tr > th')
  );
}

// A blockquote edits WYSIWYG when it's a plain quote of paragraphs. GitHub alerts
// and quotes holding nested blocks keep the raw-source editor.
function blockquoteWysiwygSafe(el) {
  if (el.classList.contains('markdown-alert')) return false;
  if (el.querySelector('blockquote, pre, table, ul, ol, img, sup.footnote-reference, .katex, .mermaid, input')) {
    return false;
  }
  return Array.from(el.children).every((child) => {
    const tag = child.tagName.toLowerCase();
    return tag === 'p' || (tag === 'a' && child.classList.contains('heading-anchor'));
  });
}

function utf8ByteLength(text) {
  return sourceByteEncoder.encode(text).length;
}

// Claim the caret for the next render, stamped with its document so a caret
// queued before a navigation can't land in the newly opened page.
function setPendingCaret(next) {
  pendingCaret = next ? { ...next, path: activeDocumentPath() } : null;
}

// Send a buffer-mutating reading-view command. Each lands one host undo snapshot,
// and this raises the dirty state (Save button + tab dot) optimistically.
function sendEditCommand(message) {
  const path = activeDocumentPath();
  if (path) {
    undoableByPath.set(path, true);
    setDirtyState(path, true);
  }
  send(message);
}

// The length of a block's user-visible text — its text content minus the gutter
// permalink's locus text, which is a decoration the caret never counts.
function visibleTextLength(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.heading-anchor').forEach((node) => node.remove());
  return clone.textContent.length;
}

// The caret's character offset inside `el`'s visible text, or null when the
// selection is missing, uncollapsed, or outside the block.
function caretTextOffsetIn(el) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !selection.isCollapsed) return null;
  const caret = selection.getRangeAt(0);
  if (!el.contains(caret.startContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(caret.startContainer, caret.startOffset);
  const fragment = before.cloneContents();
  fragment.querySelectorAll('.heading-anchor').forEach((node) => node.remove());
  return fragment.textContent.length;
}

// Put the caret at a character offset inside `el`'s visible text (clamped to the
// end), walking text nodes and skipping the gutter permalink.
function placeCaretInBlock(el, offset) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement && node.parentElement.closest('.heading-anchor')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  let remaining = Math.max(0, offset || 0);
  let lastNode = null;
  let placed = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.nodeValue.length;
    if (remaining <= length) {
      range.setStart(node, remaining);
      placed = true;
      break;
    }
    remaining -= length;
    lastNode = node;
  }
  if (!placed) {
    if (lastNode) {
      range.setStart(lastNode, lastNode.nodeValue.length);
    } else {
      range.selectNodeContents(el);
    }
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

// Send an edit for `el`'s source range, only if `text` differs from the baseline
// captured when editing began (so a no-edit focus costs nothing). If the caret
// already moved into another block, carry it across this commit's re-render
// (adjusting for the splice's offset shift) so it isn't dumped out.
function commitBlockEdit(el, text) {
  const start = Number(el.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  if (text === el.__editBaseline) return;
  sendEditCommand({ command: 'editBlock', start, end, text });
  const delta = utf8ByteLength(text) - (end - start);
  window.setTimeout(() => {
    if (pendingCaret) return; // a structural edit already claimed the caret
    const active = document.activeElement;
    if (!active || active === el || !active.dataset || active.dataset.srcStart == null) return;
    if (active.getAttribute('contenteditable') !== 'true') return;
    if (active.dataset.editingSource === 'true') return;
    const activeStart = Number(active.dataset.srcStart);
    if (!Number.isFinite(activeStart)) return;
    const offset = caretTextOffsetIn(active);
    setPendingCaret({
      srcStart: activeStart >= end ? activeStart + delta : activeStart,
      textOffset: offset == null ? 0 : offset,
    });
  }, 0);
}

// Commit whichever block holds an active editing session. Used before actions
// that bypass the focusout commit — e.g. a link click whose mousedown is swallowed.
function commitActiveEditingBlock() {
  const active = document.activeElement;
  if (!active || !active.__editingActive) return;
  active.__editingActive = false;
  commitBlockEdit(active, blockDomToMarkdown(active));
}

// Splice `text` over `[start, end)` for a STRUCTURAL edit (split/merge/insert).
// Unlike commitBlockEdit this always sends, and it neutralizes the block's blur
// baseline afterwards: the DOM still shows the pre-splice content, and letting
// the blur commit fire would replay a stale range against the new buffer.
function sendBlockSplice(el, start, end, text) {
  sendEditCommand({ command: 'editBlock', start, end, text });
  el.__editBaseline = blockDomToMarkdown(el);
}

// A table checkbox toggle: autosave tells the host to write to disk with no undo
// step, and the plain send avoids a dirty flash. Neutralizes the blur baseline
// like sendBlockSplice, in case the table was also being edited.
function sendCheckboxBlockEdit(el, start, end, text) {
  send({ command: 'editBlock', start, end, text, autosave: true });
  el.__editBaseline = blockDomToMarkdown(el);
}

// Enter inside a paragraph/heading: split the block at the caret into two
// blocks. The serialized halves replace the block's source range, joined by a
// blank line; the caret carries over to the start of the second block. Enter at
// the end instead opens a fresh empty paragraph below (Markdown has no empty
// block, so it stays DOM-local until first commit); Enter at the very start is
// a no-op.
function splitBlockAtCaret(el) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const caret = selection.getRangeAt(0);
  if (!el.contains(caret.startContainer)) return;
  const start = Number(el.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(el);
  beforeRange.setEnd(caret.startContainer, caret.startOffset);
  const afterRange = document.createRange();
  afterRange.selectNodeContents(el);
  afterRange.setStart(caret.startContainer, caret.startOffset);
  const part1Inline = inlineDomToMarkdown(beforeRange.cloneContents()).trim();
  const part2Inline = inlineDomToMarkdown(afterRange.cloneContents()).trim();
  if (!part1Inline) return;
  const prefix =
    el.dataset.blockKind === 'heading' ? '#'.repeat(Number(el.tagName.substring(1)) || 1) + ' ' : '';
  const part1 = prefix + part1Inline;
  if (part2Inline) {
    // Both halves keep the block's own kind — splitting a heading yields two
    // headings at the same level, splitting a paragraph two paragraphs.
    const part2 = prefix + part2Inline;
    sendBlockSplice(el, start, end, part1 + '\n\n' + part2);
    setPendingCaret({ srcStart: start + utf8ByteLength(part1) + 2, textOffset: 0 });
  } else if (blockDomToMarkdown(el) !== el.__editBaseline) {
    // Enter at the end with unsaved text edits: commit them, then reopen the
    // empty insert paragraph on the far side of the re-render.
    sendBlockSplice(el, start, end, part1);
    setPendingCaret({ srcStart: start, insertBelow: true });
  } else {
    openInsertBlockAfter(el);
  }
}

// Backspace at the very start of a paragraph/heading: merge it into the previous
// block, Notion-style — the two texts join at a caret that stays put. Only fires
// when the previous sibling is itself a WYSIWYG paragraph/heading; anything else
// (a list, a code block, a rule) leaves Backspace inert at the boundary.
function mergeBlockIntoPrevious(el, prev) {
  const start = Number(prev.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  const junction = visibleTextLength(prev);
  const merged = blockDomToMarkdown(prev) + inlineDomToMarkdown(el).trim();
  sendBlockSplice(el, start, end, merged);
  setPendingCaret({ srcStart: start, textOffset: junction });
}

// A fresh empty paragraph below `el`, ready to type into. Markdown cannot hold
// an empty block, so it exists only in the DOM until its first commit, which
// inserts `\n\n` + the typed text at the previous block's end offset. Enter
// commits and chains another empty paragraph below (continuous writing flow);
// Backspace on the empty block dissolves it back into the previous block's end;
// clicking away commits, or dissolves it if nothing was typed.
function openInsertBlockAfter(el) {
  const insertAt = Number(el.dataset.srcEnd);
  if (!Number.isFinite(insertAt)) return;
  const block = document.createElement('p');
  block.className = 'leaf-editable leaf-insert-block';
  block.dataset.blockKind = 'paragraph';
  block.setAttribute('contenteditable', 'true');
  block.setAttribute('spellcheck', 'false');
  el.insertAdjacentElement('afterend', block);
  const commit = (chainBelow) => {
    if (block.__committed) return true;
    const text = inlineDomToMarkdown(block).trim();
    if (!text) return false;
    block.__committed = true;
    sendEditCommand({ command: 'editBlock', start: insertAt, end: insertAt, text: '\n\n' + text });
    if (chainBelow) setPendingCaret({ srcStart: insertAt + 2, insertBelow: true });
    return true;
  };
  block.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      commit(true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      block.blur();
      return;
    }
    if (event.key === 'Backspace' && !inlineDomToMarkdown(block).trim()) {
      event.preventDefault();
      block.remove();
      el.focus({ preventScroll: true });
      placeCaretInBlock(el, visibleTextLength(el));
    }
  });
  block.addEventListener('blur', () => {
    if (!commit(false)) block.remove();
  });
  block.focus({ preventScroll: true });
}

// Structural keys for a WYSIWYG block, by kind. Paragraphs and headings get the
// block-editor behaviours (Enter splits, Shift+Enter breaks the line, Backspace
// at the start merges up); lists lean on the browser's native contenteditable
// list handling (Enter makes a new item, Backspace joins items) and serialize
// whatever structure results; table cells are single-line, so Enter is inert.
function handleWysiwygKeydown(el, event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    el.blur();
    return;
  }
  const kind = el.dataset.blockKind;
  if (kind === 'table') {
    if (event.key === 'Enter') event.preventDefault();
    return;
  }
  if (kind === 'blockquote') {
    // Enter inside a quote adds a quoted line (a hard break) rather than
    // splitting the quote — a native Enter would create markup the quote's
    // serializer has no `>`-form for.
    if (event.key === 'Enter') {
      event.preventDefault();
      document.execCommand('insertLineBreak');
    }
    return;
  }
  if (kind === 'list') return;
  if (event.key === 'Enter') {
    if (event.shiftKey) {
      // Shift+Enter: a line break. Natural in a paragraph (Chromium inserts a
      // <br>, serialized as a hard break); meaningless in a single-line heading.
      if (kind === 'heading') event.preventDefault();
      return;
    }
    event.preventDefault();
    splitBlockAtCaret(el);
    return;
  }
  if (event.key === 'Backspace') {
    const selection = window.getSelection();
    if (selection && selection.isCollapsed && caretTextOffsetIn(el) === 0) {
      const prev = el.previousElementSibling;
      if (
        prev &&
        prev.getAttribute &&
        prev.getAttribute('contenteditable') === 'true' &&
        (prev.dataset.blockKind === 'paragraph' || prev.dataset.blockKind === 'heading')
      ) {
        event.preventDefault();
        mergeBlockIntoPrevious(el, prev);
      }
    }
  }
}

// Turn `el` into a live Markdown editor: keep the rendered styling, edit in
// place, commit on blur. The gutter permalink and checkboxes stay non-editable
// islands; focus moving within the block neither resets the baseline nor commits.
function makeMarkdownEditable(el) {
  el.setAttribute('contenteditable', 'true');
  el.setAttribute('spellcheck', 'false');
  el.classList.add('leaf-editable');
  el.querySelectorAll('.heading-anchor').forEach((a) => a.setAttribute('contenteditable', 'false'));
  el.querySelectorAll('input[type="checkbox"]').forEach((box) => box.setAttribute('contenteditable', 'false'));
  // A link click is navigation, not "edit here": swallow the mousedown so the
  // block never takes focus (the delegated click still navigates), and commit the
  // block being edited first, since no focusout will fire.
  el.addEventListener('mousedown', (event) => {
    const target = event.target;
    if (!target || !target.closest) return;
    if (target.closest('a')) {
      commitActiveEditingBlock();
      event.preventDefault();
    } else if (target.closest('input[type="checkbox"]')) {
      // Swallow the mousedown so a checkbox toggle doesn't focus the block (which
      // scrolls the clicked row to the top). The click still fires and flips it.
      event.preventDefault();
    }
  });
  el.addEventListener('focusin', () => {
    if (!el.__editingActive) {
      el.__editingActive = true;
      el.__editBaseline = blockDomToMarkdown(el);
    }
  });
  el.addEventListener('focusout', (event) => {
    if (event.relatedTarget && el.contains(event.relatedTarget)) return;
    el.__editingActive = false;
    commitBlockEdit(el, blockDomToMarkdown(el));
  });
  el.addEventListener('keydown', (event) => handleWysiwygKeydown(el, event));
}

// Turn `el` into a raw-source editor, for XML blocks and Markdown blocks that
// don't round-trip WYSIWYG. The block swaps to its exact source on focus and
// splices it back on blur; no change restores the rendered view, a real change
// triggers a host re-render.
function makeSourceEditable(el) {
  const start = Number(el.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  el.classList.add('leaf-editable');
  el.addEventListener('pointerdown', (event) => {
    if (el.dataset.editingSource === 'true') return;
    // Let a link click navigate; source editing starts from a click on any
    // non-link part of the block.
    if (event.target && event.target.closest && event.target.closest('a')) return;
    event.preventDefault();
    // Swapping a rendered block (often a tall image) for its one-line source
    // collapses its height; pin the reader to the block above first, or a near-top
    // image shrinking the document would clamp the scroll to the top. focus() must
    // not scroll either — preventScroll keeps the caret from yanking the view.
    const aboveAnchor = anchorAboveElement(el);
    const src = sliceSourceBytes(currentDocumentSource, start, end);
    el.__editBaseline = src;
    el.__renderedHtml = el.innerHTML;
    el.dataset.editingSource = 'true';
    el.textContent = src;
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    el.classList.add('leaf-editing-source');
    el.focus({ preventScroll: true });
    if (aboveAnchor) {
      readerScrollAnchor = aboveAnchor;
      restoreReaderScrollAnchor(aboveAnchor);
    }
  });
  el.addEventListener('blur', () => {
    if (el.dataset.editingSource !== 'true') return;
    const text = el.innerText;
    el.removeAttribute('contenteditable');
    el.classList.remove('leaf-editing-source');
    delete el.dataset.editingSource;
    // The block is about to grow back to its rendered height (an image re-decodes
    // from zero). Anchor to the stable block above so the reader holds its place.
    const aboveAnchor = anchorAboveElement(el);
    if (text === el.__editBaseline) {
      // No change: restore the rendered view (no host round-trip needed).
      el.innerHTML = el.__renderedHtml;
      stampLocalImages(el);
      if (aboveAnchor) {
        readerScrollAnchor = aboveAnchor;
        restoreReaderScrollAnchor(aboveAnchor);
      }
      return;
    }
    // Hand the host re-render (leafReloadDocument) that same above-anchor: its own
    // top-visible capture would target this block while it is momentarily zero-height.
    pendingEditAnchor = aboveAnchor;
    commitBlockEdit(el, text);
    // The host re-renders the document from the buffer, which restores styling.
  });
}

// Wire up every mapped block. Clean text blocks, tight lists, and tables edit
// WYSIWYG; every other block edits its source in place. A thematic break is left
// alone.
function bindEditableBlocks(format) {
  const body = app.querySelector('.document-body');
  if (!body) return;
  body.querySelectorAll('[data-src-start]').forEach((el) => {
    if (el.dataset.srcStart == null || el.dataset.srcEnd == null) return;
    const kind = el.dataset.blockKind;
    if (kind === 'rule') return;
    const wysiwyg =
      format === 'markdown' &&
      (((kind === 'heading' || kind === 'paragraph') && markdownBlockWysiwygSafe(el)) ||
        (kind === 'list' && listWysiwygSafe(el)) ||
        (kind === 'table' && tableWysiwygSafe(el)) ||
        (kind === 'blockquote' && blockquoteWysiwygSafe(el)));
    if (wysiwyg) {
      makeMarkdownEditable(el);
    } else {
      makeSourceEditable(el);
    }
  });
}

// Land the caret carried across a structural edit's re-render: focus the
// destination block (by its post-splice offset) and restore the position, or open
// the chained empty insert paragraph. A missing target degrades to nothing.
function placePendingCaret(body) {
  const pending = pendingCaret;
  pendingCaret = null;
  if (!pending) return;
  // A caret queued for a different document must not grab focus in this page.
  if (pending.path && pending.path !== activeDocumentPath()) return;
  const target = body.querySelector(`[data-src-start="${pending.srcStart}"]`);
  if (!target) return;
  if (pending.insertBelow) {
    openInsertBlockAfter(target);
    return;
  }
  if (target.getAttribute('contenteditable') !== 'true') return;
  target.focus({ preventScroll: true });
  placeCaretInBlock(target, pending.textOffset || 0);
}

// Orchestrate the reading view's editing layer after each render: remember
// source/format, attach ranges, make checkboxes interactive, wire editors.
function bindReadingEditor(doc) {
  if (!doc) return;
  const body = app.querySelector('.document-body');
  if (!body) return;
  currentDocumentFormat = doc.format || 'markdown';
  currentDocumentSource = typeof doc.source === 'string' ? doc.source : '';
  // Checkboxes stay interactive even with reader editing off: a task toggle is a
  // quick action that auto-saves and records no undo, not text editing. Only the
  // click-to-type editable blocks are gated behind the setting.
  if (currentDocumentFormat === 'markdown') {
    attachMarkdownBlockRanges(body, Array.isArray(doc.blocks) ? doc.blocks : [], currentDocumentSource);
    bindTaskCheckboxes(doc.tasks || []);
  }
  if (readerEditingEnabled) {
    bindEditableBlocks(currentDocumentFormat);
  }
  if (currentDocumentFormat === 'markdown') {
    bindTableCheckboxes();
  }
  placePendingCaret(body);
}

// Re-sync editing state after a buffer edit that needs no re-render (a task
// toggle). Refreshes the dirty state and adopts the toggled buffer as the source
// the raw-source editors slice from, or a later edit would revert the toggle.
window.leafBlocksResynced = (state) => {
  if (!state) return;
  if (typeof state.source === 'string') currentDocumentSource = state.source;
  const path = activeDocumentPath();
  if (path) {
    if (typeof state.canUndo === 'boolean') undoableByPath.set(path, state.canUndo);
    setDirtyState(path, !!state.dirty);
  }
};

function renderState() {
  const state = currentState || { recent: [], tabs: [], active: null, document: null };
  disconnectMinimapPreviewObservers();
  disconnectReaderReflowObserver();
  readerAnchorBlocks = null;
  // Any full render shows the reading view, so we're no longer in the code view.
  codeViewActive = false;
  document.documentElement.dataset.codeView = 'false';
  renderTabs(state);
  if (state.document) {
    document.title = window.leafLocale.t('titles.document', { title: state.document.title });
    app.className = 'reader-shell has-document';
    const minimapHtml = renderDocumentMinimap(state.document.minimap);
    const layoutClass = minimapHtml ? 'reader-layout' : 'reader-layout reader-layout-no-minimap';
    // Carry the scroll origin onto the fresh body — losing it shifts the layout
    // by the origin and the anchor restore lands off by exactly that.
    const previousBody = app.querySelector('.document-body');
    const previousScrollOrigin = previousBody ? previousBody.style.getPropertyValue('--reader-scroll-origin') : '';
    app.innerHTML = `<div class="${layoutClass}">${state.document.html}${minimapHtml}</div>`;
    if (previousScrollOrigin) {
      const freshBody = app.querySelector('.document-body');
      if (freshBody) freshBody.style.setProperty('--reader-scroll-origin', previousScrollOrigin);
    }
    // Fresh epoch per render, so a reopened document never shows a cached image.
    localImageEpoch += 1;
    stampLocalImages();
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
    bindReadingEditor(state.document);
    observeReaderReflow();
    scheduleMinimapPreviewUpdate();
    // Returning from the code view: land on the block holding the source line
    // the code view was scrolled to. This wins over the reset-to-top the
    // host's Reset intent would otherwise run, and doesn't depend on the racy
    // fraction hand-off.
    if (pendingViewAtTop) {
      // Toggled from the very top of the code view: land flush at the reader's
      // content start, not aligned on the first block below its top padding.
      pendingViewAtTop = false;
      pendingReadingSrcOffset = null;
      resetReaderScrollOnNextRender = false;
      resetReaderScrollToContentStart();
    } else if (pendingReadingSrcOffset != null) {
      const srcOffset = pendingReadingSrcOffset;
      pendingReadingSrcOffset = null;
      resetReaderScrollOnNextRender = false;
      window.requestAnimationFrame(() => {
        if (!scrollReadingToSrcOffset(srcOffset)) {
          resetReaderScrollToContentStart();
          return;
        }
        readerScrollAnchor = captureReaderScrollAnchor();
        updateMinimapViewport();
      });
    } else if (resetReaderScrollOnNextRender) {
      resetReaderScrollOnNextRender = false;
      resetReaderScrollToContentStart();
    } else {
      updateMinimapViewport();
    }
    updateEditingChrome();
    return;
  }
  resetReaderScrollOnNextRender = false;
  document.title = window.leafLocale.t('titles.app');
  app.className = 'reader-shell empty';
  updateEditingChrome();
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
// A glossary link opens the term in a sheet over the current document. The
// webview can't read the file, so the click asks the host, which reads + renders
// the glossary and calls window.leafShowGlossary below.
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
  // Preferred form: a `glossary:slug` URL with no file path; the host finds the
  // nearest GLOSSARY.md.
  const scheme = /^glossary:(.*)$/i.exec(rawHref);
  if (scheme) {
    let anchor = scheme[1].replace(/^#/, '');
    try { anchor = decodeURIComponent(anchor); } catch (e) {}
    return anchor;
  }
  if (/^[a-z]+:\/\//i.test(rawHref) || rawHref.startsWith('mailto:')) return '';
  // Real form: a `…/GLOSSARY.md#slug` relative link, matched case-insensitively.
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
// A hovered cross-document link shows the target's line count. The webview asks
// the host (countLines IPC); the host answers via window.leafLineCount. Each hover
// gets a token so a stale answer is ignored, and answers are cached by href.
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
// The tooltip's detail line. Decodes the percent-encoded href for readability,
// falling back to the raw href if it isn't valid percent-encoding.
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
    // Only in-app Markdown page links carry a line count; nothing else does.
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
// The parsed glossary document, cached between calls keyed by the exact html the
// host sent — parsing the (often huge) glossary into a DOM to lift one entry is
// the dominant cost of opening the sheet. A different glossary reparses once;
// extractGlossaryEntry only reads/clones, so sharing is safe.
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
// One delegated click listener for every document link, bound once — a per-link
// binding cost a major slice of open time on large documents. Delegation also
// handles links added later (the async pager) with no rebinding.
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
      // For a `glossary:` link keep the bare scheme as the base, so term jumps
      // and "open full glossary" let the host re-resolve the nearest file.
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
// Rendered-diagram memo: diagram source (+ theme) → finished SVG. Editing
// re-renders the whole document per commit, resetting diagrams to raw text;
// unchanged ones restore from here instantly, so only new/edited ones re-render.
const mermaidRenderCache = new Map();
const MERMAID_CACHE_CAP = 200;
function mermaidCacheKey(source) {
  return (document.documentElement.dataset.theme === 'dark' ? 'dark\n' : 'light\n') + source;
}
function renderMermaidDiagrams() {
  const candidates = Array.from(app.querySelectorAll('pre.mermaid:not([data-processed="true"]):not([data-mermaid-render="failed"])'));
  if (!candidates.length) {
    return;
  }
  const diagrams = [];
  let restored = false;
  candidates.forEach((diagram) => {
    const source = diagram.textContent;
    const cached = mermaidRenderCache.get(mermaidCacheKey(source));
    if (cached) {
      diagram.innerHTML = cached;
      diagram.dataset.processed = 'true';
      restored = true;
      return;
    }
    diagram.__mermaidSource = source;
    diagrams.push(diagram);
  });
  if (restored) {
    readerAnchorBlocks = null;
  }
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
      diagrams.forEach((diagram) => {
        if (diagram.dataset.mermaidRender === 'failed' || diagram.__mermaidSource == null) return;
        if (mermaidRenderCache.size >= MERMAID_CACHE_CAP) mermaidRenderCache.clear();
        mermaidRenderCache.set(mermaidCacheKey(diagram.__mermaidSource), diagram.innerHTML);
      });
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
// Typeset-math memo: TeX source (plus display mode) → the finished KaTeX
// markup. Same reasoning as the Mermaid cache: full re-renders on every editing
// commit re-typeset every formula; unchanged formulas restore instantly.
const katexRenderCache = new Map();
const KATEX_CACHE_CAP = 1000;
function renderMathElements() {
  const nodes = Array.from(app.querySelectorAll('.math:not([data-math-rendered])'));
  if (!nodes.length) {
    return;
  }
  const pending = [];
  nodes.forEach((node) => {
    const key = (node.classList.contains('math-display') ? 'D\n' : 'I\n') + node.textContent;
    const cached = katexRenderCache.get(key);
    if (cached != null) {
      node.innerHTML = cached;
      node.dataset.mathRendered = 'true';
      return;
    }
    pending.push({ node, key });
  });
  if (!pending.length) {
    return;
  }
  loadKatex()
    .then((katex) => {
      pending.forEach(({ node, key }) => {
        try {
          katex.render(node.textContent, node, {
            displayMode: node.classList.contains('math-display'),
            throwOnError: false,
          });
          if (katexRenderCache.size >= KATEX_CACHE_CAP) katexRenderCache.clear();
          katexRenderCache.set(key, node.innerHTML);
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
// Built once and cloned per block — far cheaper than building it from scratch
// tens of thousands of times on a big document.
const anchorLinkTemplate = (() => {
  const link = document.createElement('a');
  link.className = 'heading-anchor';
  // The number lives in an inner span so the anchor inherits the block's font
  // metrics while the glyph stays a fixed small size — see the .heading-anchor CSS.
  const num = document.createElement('span');
  num.className = 'heading-anchor-num';
  link.appendChild(num);
  return link;
})();
// `pre:not(.mermaid)` excludes diagrams: a gutter link inserted as the pre's
// first child would corrupt the source Mermaid reads from innerHTML.
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
// Give `target` the address `locus`. If it already has an id, keep it and add a
// hidden alias carrying the locus (so #<locus> still lands); otherwise the locus
// becomes the id. Recorded on dataset.locus for the gutter permalink.
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
// Number the document so each block has a short citable address: a flat running
// count down the page, no reset at headings. A heading keeps its slug id (so the
// TOC and #slug links resolve) and carries its number through a hidden alias.
// Link-only outline items are skipped. Deterministic, so ids survive a re-render.
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
// Build a collapsed "Outline" from the headings and insert it under the title
// (mirrors site/outline.js). A DOM pass over the <h1>–<h6>, nesting entries as a
// bulleted list in a closed <details>. Run before the anchor pass (so its
// link-only entries skip block-numbering) and before bindDocumentLinks.
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
  // Filled in by decorateAnchorLinks once numbering knows the line count — a
  // separate span so renderStaticText's [data-i18n] sweep never wipes it.
  const summaryCount = document.createElement('span');
  summaryCount.className = 'document-outline-count';
  summary.appendChild(summaryCount);
  details.appendChild(summary);
  // The entry list can be enormous (one <li> per heading), so build it only when
  // the outline first opens. bindDocumentLinks is delegated, so entry jumps wire
  // up with no rebinding.
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
// The host serves local images over leaf-image://, which arrives as
// http://leaf-image.local/ where custom protocols are restricted.
const LOCAL_IMAGE_SRC_PREFIXES = ['leaf-image://', 'http://leaf-image.', 'https://leaf-image.'];
// The web view keeps a decoded image against its URL for the life of the process,
// so a replaced file would show stale until a restart. A per-render token makes
// each request a distinct URL.
let localImageEpoch = 0;
function isLocalImageSrc(src) {
  return LOCAL_IMAGE_SRC_PREFIXES.some((prefix) => src.startsWith(prefix));
}
// The host resolves the path from the URL's segments, so the query is inert to it.
function stampLocalImages(root = app) {
  if (!root) return;
  root.querySelectorAll('img[src]').forEach((img) => {
    // getAttribute, not .src: the property is absolute and hides the prefix.
    const src = img.getAttribute('src') || '';
    if (!isLocalImageSrc(src)) return;
    const base = src.split('?')[0];
    const stamped = `${base}?leaf-epoch=${localImageEpoch}`;
    if (img.getAttribute('src') !== stamped) img.setAttribute('src', stamped);
  });
}
// An image changed on disk: re-fetch rather than re-render, so the reader keeps
// its scroll position.
window.leafRefreshImages = () => {
  localImageEpoch += 1;
  stampLocalImages();
  scheduleMinimapPreviewUpdate();
};
// Give every anchor-addressable block a gutter permalink button, GitHub style.
// A real anchor link to the target id, so bindDocumentLinks wires it into
// fragment navigation like a TOC link. Clicking also copies the #locus (without
// blocking the jump) — the only way to read the locus on touch.
function decorateAnchorLinks() {
  const body = app.querySelector('.document-body');
  if (!body) return;
  const lineTotal = ensureAnchorLinkTargets(body);
  // The numbering pass's final count is the line total; stamp it into the outline
  // summary ("Outline (1234 lines)").
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
    // A blockquote is one citable unit and carries the button; skip it on blocks
    // nested inside a blockquote (a second gutter carve would drag the quote text
    // off the column). They keep their id, so #locus links still resolve.
    if (target.tagName !== 'BLOCKQUOTE' && target.closest('blockquote')) return;
    const link = anchorLinkTemplate.cloneNode(true);
    link.href = '#' + encodeURIComponent(locus);
    link.setAttribute('aria-label', label);
    link.title = label;
    // The digits live in the inner span (see anchorLinkTemplate); clicks copy the
    // deep link via the delegated body listener.
    link.firstChild.textContent = locus;
    target.classList.add('has-anchor-link');
    target.insertBefore(link, target.firstChild);
  });
  // No JS positioning: the button lives in each block's own gutter (see the
  // .has-anchor-link CSS), and clicks are handled by the delegated body listener.
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
  // converts the box's new position back into a scroll offset — the inverse of
  // placeMinimapViewport()'s box placement, so the box and the thumbnail slide stay
  // under the cursor even on documents taller than the rail.
  const dragMinimapViewportToPointer = (event, pointerOffsetY) => {
    // Use the geometry captured at pointerdown — never re-measure mid-drag (that
    // forces a layout each move; see minimapDragMetrics).
    const metrics = minimapDragMetrics || measureDocumentMinimap(track);
    const rect = metrics.trackRect;
    if (rect.height <= 0 || metrics.scrollable <= 0) {
      updateMinimapViewport();
      return;
    }
    const boundedViewportHeight = Math.min(metrics.trackHeight, Math.max(22, metrics.viewportHeight * metrics.previewScale));
    const handleRange = Math.max(0, metrics.trackHeight - boundedViewportHeight);
    const offsetY = Number.isFinite(pointerOffsetY) ? pointerOffsetY : boundedViewportHeight / 2;
    const targetViewportTop = Math.min(handleRange, Math.max(0, event.clientY - rect.top - offsetY));
    // Invert placeMinimapViewport()'s box placement (box top = scrollTop times a
    // slope), so a box position divides back into a scroll offset. Fall back to
    // the handle-range ratio when that slope is non-positive.
    const previewTravel = Math.max(0, metrics.scaledDocumentHeight - metrics.trackHeight);
    const viewportTopPerScrollPixel = metrics.previewScale - previewTravel / metrics.scrollable;
    const targetViewportScrollTop = viewportTopPerScrollPixel > 0
      ? targetViewportTop / viewportTopPerScrollPixel
      : (handleRange <= 0 ? 0 : (targetViewportTop / handleRange) * metrics.scrollable);
    // Set scrollTop against the cached range, then pin the box + thumbnail. The
    // scroll handler skips its update while dragging; pointerup settles once.
    const boundedScrollTop = Math.min(metrics.scrollable, Math.max(0, targetViewportScrollTop));
    app.scrollTop = boundedScrollTop;
    const minimap = track.closest('.document-minimap');
    if (minimap) {
      placeMinimapViewport(minimap, metrics, boundedScrollTop);
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
    if (!contentRect || contentRect.height <= 0 || metrics.previewScale <= 0 || metrics.scrollable <= 0) {
      updateMinimapViewport();
      return;
    }
    const clickedDocumentY = (event.clientY - contentRect.top) / metrics.previewScale;
    app.scrollTop = Math.min(metrics.scrollable, Math.max(0, clickedDocumentY - metrics.viewportHeight / 2));
    recordReaderScrollPosition();
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
      // A pass queued mid-drag holds the pre-drag anchor, so drop it before recording
      // where the drag landed; either omission snaps the reader back to the start.
      cancelReaderLayoutUpdate();
      recordReaderScrollPosition();
      // Settle the box/thumbnail onto the true reading position; content that
      // streamed in keeps settling via the reflow observer.
      updateMinimapViewport();
    }
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('lostpointercapture', endDrag);
  bindDocumentMinimapPreview(track);
}
// The minimap is a shrunken clone of the rendered document, so the rail shows
// real text. The clone rebuilds only on content changes, never on scroll (which
// only moves the viewport box and, on tall documents, the thumbnail's slide).
// The element it mirrors: the reading view's document body, or the code view's
// document container — one shared lookup lets the pipeline serve both views.
function minimapSourceElement() {
  return app.querySelector('.document-body, .code-view-doc');
}
function bindDocumentMinimapPreview(track) {
  disconnectMinimapPreviewObservers();
  const source = minimapSourceElement();
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
    // Watch the rail, not the document: its width changes at the responsive
    // breakpoints (which the source's resize would miss), and it never fires on scroll.
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
  // A different document is coming: force the next update to rebuild the clone.
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
  // >=2px dead-band: the ideal origin can fall on a half-pixel with no integer fixed
  // point, flipping 1px each frame (e.g. 177<->178) and driving an endless relayout
  // loop via the minimap ResizeObserver. Sub-2px jitter is invisible; ignore it.
  if (Math.abs(nextOrigin - origin) >= 2) {
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
let resetReaderScrollFrame = 0;
function resetReaderScrollToContentStart() {
  // Coalesce: back-to-back renders each scheduling a reset must not run it
  // twice — the second pass would see the toggle fraction already consumed
  // and hard-reset a mid-document reader to the top.
  if (resetReaderScrollFrame) {
    return;
  }
  resetReaderScrollFrame = window.requestAnimationFrame(() => {
    resetReaderScrollFrame = 0;
    const source = app.querySelector('.document-body');
    const content = correctReaderScrollOrigin(source);
    // Leaving the code view carries its scroll fraction here so the reading view
    // lands at the same relative position; other resets have none.
    const fraction = pendingViewScrollFraction;
    pendingViewScrollFraction = null;
    if (fraction) {
      const viewportHeight = Math.max(1, Math.ceil(app.clientHeight));
      const range = measureReaderScrollRange(content, viewportHeight);
      setReaderScrollTop(content.topOffset + fraction * range.scrollable);
    } else {
      setReaderScrollTop(content.topOffset);
    }
    readerScrollAnchor = captureReaderScrollAnchor();
    updateMinimapViewport();
  });
}
// Describe the reader's position as a render-independent anchor: nearest heading
// slug above the top edge, block ordinal within that section (heading = block 0),
// and the signed offset from that block's top (signed to keep the reading-mode
// top gap). Measuring from the section keeps the landing stable when earlier
// sections grow (live reload). Anchor blocks are in document order, so the
// topmost-visible one is found by binary search rather than scanning all ~25k.
function readerAnchorBlockList(source) {
  const count = source.childElementCount;
  // Rebuild when the body was replaced, the child count shifted, or either end
  // of the cached list detached. Checking the last block too catches async DOM
  // swaps (Mermaid, KaTeX, code decoration) that leave detached, zero-rect
  // entries — those break the binary search's document-order assumption.
  const stale =
    !readerAnchorBlocks ||
    readerAnchorBlocksSource !== source ||
    readerAnchorBlocksCount !== count ||
    !readerAnchorBlocks.length ||
    !readerAnchorBlocks[0].isConnected ||
    !readerAnchorBlocks[readerAnchorBlocks.length - 1].isConnected;
  if (stale) {
    readerAnchorBlocks = Array.from(source.querySelectorAll(READER_ANCHOR_SELECTOR));
    readerAnchorBlocksCount = count;
    readerAnchorBlocksSource = source;
  }
  return readerAnchorBlocks;
}
// Turn a block-list index into the serializable {section, block, offsetY} anchor:
// nearest heading slug above it, the block's ordinal within that section, and its
// signed offset from the reader's top edge. Shared by the top-visible capture and
// the anchor-above fallback used while editing a block whose height swings.
function anchorForBlockIndex(blocks, targetIndex, shellRect) {
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
  return anchorForBlockIndex(blocks, targetIndex, shellRect);
}
// Settle the reader where it now sits and re-record that as the anchor. Every reflow
// re-pin restores readerScrollAnchor, so anything moving app.scrollTop itself must
// call this — a stale anchor turns the next late layout change (an image decoding,
// the async pager landing) into a yank back to the pre-jump position. The scroll
// listener covers user scrolls; the minimap, which it ignores, calls this instead.
function recordReaderScrollPosition() {
  clampReaderScrollPosition();
  readerScrollAnchor = captureReaderScrollAnchor();
}
// Anchor to the nearest anchorable block strictly above `el`, keeping its offset
// from the top edge. Blocks above a block never move when it resizes, so this
// holds the reader steady while an image collapses to source and re-decodes on
// commit — at worst landing on the line directly above the image, never the top.
// Null when `el` is the first block (nothing above it to anchor to).
function anchorAboveElement(el) {
  const source = app.querySelector('.document-body');
  if (!currentState?.document || !source || !el) {
    return null;
  }
  const blocks = readerAnchorBlockList(source);
  if (!blocks.length) {
    return null;
  }
  const elTop = el.getBoundingClientRect().top;
  let chosenIndex = -1;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    // Skip the edited block itself and any nested anchor blocks it contains (a
    // blockquote/table maps as one editable block but its rows are in the list).
    if (el.contains(block) || block.contains(el)) {
      continue;
    }
    if (block.getBoundingClientRect().top < elTop - 0.5) {
      chosenIndex = i;
    } else {
      break;
    }
  }
  if (chosenIndex < 0) {
    return null;
  }
  return anchorForBlockIndex(blocks, chosenIndex, app.getBoundingClientRect());
}
// Re-resolve a serializable anchor against the current DOM: the same Markdown
// renders the same blocks, so it points at the original element after a re-render.
function resolveReaderAnchorElement(anchor) {
  const source = app.querySelector('.document-body');
  if (!source || !anchor) {
    return null;
  }
  // Resolve against the same list capture used, so a serialized {section, block}
  // pair always points back at the element it named. A divergent list here would
  // shift the index and land the restore on the wrong block.
  const blocks = readerAnchorBlockList(source);
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
  // Settle the origin before measuring — the clamp's own correction would shift
  // the layout after these rects are read and land off by the change.
  correctReaderScrollOrigin();
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
    // A minimap drag owns the scroll: `anchor` predates it (the drag skips the
    // refresh to keep layout reads off the pointer path), so re-pinning would throw
    // the reader back to where the drag started. Leave the box alone too; endDrag
    // settles both.
    if (minimapDragging) {
      return;
    }
    restoreReaderScrollAnchor(anchor);
    readerScrollAnchor = captureReaderScrollAnchor();
    updateMinimapViewport();
  });
}
// Drop a queued layout pass whose captured `anchor` has been superseded.
function cancelReaderLayoutUpdate() {
  if (readerLayoutFrame) {
    window.cancelAnimationFrame(readerLayoutFrame);
    readerLayoutFrame = 0;
  }
}
function disconnectReaderReflowObserver() {
  if (readerReflowObserver) {
    readerReflowObserver.disconnect();
    readerReflowObserver = null;
  }
}
// Keep the reader pinned to its anchor as the document settles: images decode a
// few frames late and grow content above the reader, so re-pinning on every
// reflow and image load holds the reader on the same block until layout is final.
function observeReaderReflow() {
  disconnectReaderReflowObserver();
  const source = app.querySelector('.document-body');
  if (!source) {
    return;
  }
  if (typeof ResizeObserver !== 'undefined') {
    readerReflowObserver = new ResizeObserver(() => {
      // A resize means the block set may have changed (images decoding,
      // Mermaid/KaTeX/code decoration swapping nodes in). Drop the cached anchor
      // list so the next capture reflects the current DOM. Cheap: resizes are rare.
      readerAnchorBlocks = null;
      scheduleReaderLayoutUpdate();
    });
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
function minimapAvailableHeight(minimap) {
  const shellRect = app.getBoundingClientRect();
  const minimapRect = minimap.getBoundingClientRect();
  return Math.max(1, Math.floor(shellRect.bottom - minimapRect.top));
}
// Everything the preview and viewport renderers need, in one layout read. The
// reader renders in full, so app.scrollTop/scrollHeight/clientHeight are exact.
// Mirrors the web minimap's measure() (site/minimap.js).
function measureDocumentMinimap(track) {
  const minimap = track.closest('.document-minimap');
  const source = minimapSourceElement();
  const appRect = app.getBoundingClientRect();
  const sourceRect = source ? source.getBoundingClientRect() : null;
  const sourceWidth = sourceRect ? Math.max(1, Math.ceil(sourceRect.width)) : 1;
  const content = minimap ? minimap.querySelector('.document-minimap-content') : null;
  const contentWidth = content ? Math.max(1, Math.ceil(content.getBoundingClientRect().width)) : sourceWidth;
  const trackRect = track.getBoundingClientRect();
  const scrollHeight = Math.max(1, Math.ceil(app.scrollHeight));
  const viewportHeight = Math.max(1, Math.ceil(app.clientHeight));
  const scrollable = Math.max(0, scrollHeight - viewportHeight);
  const scrollTop = Math.min(scrollable, Math.max(0, app.scrollTop));
  // Where the document content begins in the scroll container (top gap included);
  // the thumbnail starts here too so its top lines up with the real content.
  const sourceTop = sourceRect ? Math.max(0, Math.round(sourceRect.top - appRect.top + app.scrollTop)) : 0;
  const previewScale = contentWidth / sourceWidth;
  const scaledDocumentHeight = Math.max(1, scrollHeight * previewScale);
  // Size the rail to the thumbnail, capped at the space below its top: a short
  // document gets a short rail, a long one fills the screen and slides inside.
  const availableHeight = minimap ? minimapAvailableHeight(minimap) : viewportHeight;
  const trackHeight = Math.max(1, Math.min(availableHeight, scaledDocumentHeight));
  if (minimap) {
    minimap.style.setProperty('--minimap-track-height', `${trackHeight}px`);
  }
  return { source, sourceWidth, contentWidth, sourceTop, trackRect, trackHeight, viewportHeight, scrollHeight, scrollable, scrollTop, previewScale, scaledDocumentHeight };
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
// The document content changed: mark the clone stale and schedule a rebuild.
// Geometry-only triggers (resize) call scheduleMinimapPreviewUpdate directly and
// let the width check decide whether a rebuild is needed.
function invalidateMinimapPreview() {
  minimapContentVersion += 1;
  scheduleMinimapPreviewUpdate();
}
// Any <details> open/close (outline, settings, library folders) changes document
// height, so the minimap clone goes stale. The body MutationObserver misses the
// bare `open` flip; `toggle` catches both — in capture phase, since it doesn't bubble.
document.addEventListener('toggle', invalidateMinimapPreview, true);
// Build the thumbnail: clone the document, strip ids/links (nothing focusable or
// duplicated for a11y), shrink to the rail width with a transform. Rebuilt only on
// content changes; scroll just repositions the box and slides the clone.
function updateDocumentMinimapPreview() {
  const minimap = app.querySelector('.document-minimap');
  const track = minimap ? minimap.querySelector('.document-minimap-track') : null;
  const content = track ? track.querySelector('.document-minimap-content') : null;
  const source = minimapSourceElement();
  if (!track || !content || !source) {
    return;
  }
  const metrics = measureDocumentMinimap(track);
  const contentRect = content.getBoundingClientRect();
  const previewWidth = Math.max(1, Math.ceil(contentRect.width));
  const previewScale = previewWidth / metrics.sourceWidth;
  // Skip the clone when nothing shaping the thumbnail changed: same content
  // version, wrap width, and rail width. The common resize (height-only, or a
  // width change within the capped column) just repositions the box off the
  // existing clone — the cloneNode below is what made resize feel like a reload.
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
  // Drop the code view's focusable textarea from the clone; its text is invisible
  // anyway (the colour layer shows).
  preview.querySelectorAll('textarea').forEach((node) => node.remove());
  preview.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  preview.querySelectorAll('a[href]').forEach((link) => {
    // Glossary terms blend into the body text via an href-based rule; stripping
    // the href for a11y would drop that blend, so tag them first for a class-based
    // rule to re-blend in the clone.
    const href = link.getAttribute('href') || '';
    if (/^glossary:/i.test(href) || /GLOSSARY\.md#/i.test(href)) {
      link.classList.add('glossary-term');
    }
    link.removeAttribute('href');
  });
  preview.classList.add('document-minimap-preview');
  preview.setAttribute('aria-hidden', 'true');
  preview.style.width = `${metrics.sourceWidth}px`;
  // Scale to the rail width, then nudge the clone down by the top gap (sourceTop)
  // so the thumbnail sits where the real content sits in the scroll range.
  preview.style.transform = `translateY(${metrics.sourceTop * previewScale}px) scale(${previewScale})`;
  content.replaceChildren(preview);
  content.style.height = `${metrics.scaledDocumentHeight}px`;
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
function updateMinimapViewport() {
  const minimap = app.querySelector('.document-minimap');
  if (!minimap) {
    return;
  }
  const track = minimap.querySelector('.document-minimap-track');
  if (!track) {
    return;
  }
  placeMinimapViewport(minimap, measureDocumentMinimap(track), null);
}
// Place the viewport box and, on tall documents, slide the thumbnail inside the
// rail. Position is driven by the exact reader scroll and the box height is the
// viewport at thumbnail scale, so it tracks the visible region at any length.
// scrollTopOverride pins to a specific offset (a drag); null reads live scrollTop.
// Mirrors site/minimap.js's updateViewport().
function placeMinimapViewport(minimap, metrics, scrollTopOverride) {
  const content = minimap.querySelector('.document-minimap-content');
  const scaledDocumentHeight = metrics.scaledDocumentHeight;
  if (content) {
    content.style.height = `${scaledDocumentHeight}px`;
  }
  const scrollTop = Math.min(metrics.scrollable, Math.max(0, scrollTopOverride === null ? metrics.scrollTop : scrollTopOverride));
  const scrollRatio = metrics.scrollable === 0 ? 0 : Math.min(1, Math.max(0, scrollTop / metrics.scrollable));
  const viewportHeight = Math.max(22, metrics.viewportHeight * metrics.previewScale);
  const boundedViewportHeight = Math.min(metrics.trackHeight, viewportHeight);
  const previewTop = -scrollRatio * Math.max(0, scaledDocumentHeight - metrics.trackHeight);
  const viewportDocumentTop = scrollTop * metrics.previewScale;
  const viewportTop = Math.min(Math.max(0, metrics.trackHeight - boundedViewportHeight), Math.max(0, previewTop + viewportDocumentTop));
  minimap.style.setProperty('--minimap-viewport-top', `${viewportTop}px`);
  minimap.style.setProperty('--minimap-viewport-height', `${boundedViewportHeight}px`);
  minimap.style.setProperty('--minimap-preview-top', `${previewTop}px`);
}
// The scroll listener must stay cheap: scroll fires many times per frame, so a
// forced layout here stutters the page. clampReaderScrollPosition() and
// captureReaderScrollAnchor() both force a reflow, so the listener is passive and
// coalesces that work into one rAF per frame. scheduleMinimapViewportUpdate() is
// just a flag + rAF, safe on the event. The anchor is consumed asynchronously, so
// updating it a frame late costs nothing.
let readerScrollFrame = 0;
app.addEventListener('scroll', () => {
  // A minimap drag owns the scroll (clamped scrollTop, box pinned via CSS vars,
  // endDrag re-captures on release), so do nothing here during a drag — the
  // forced layouts would be exactly the stutter this avoids.
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
