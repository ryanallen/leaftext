const app = document.getElementById('app');
const appBar = document.getElementById('appBar');
const appTrailing = document.querySelector('.app-trailing');
const appActionsItems = document.getElementById('appActionsItems');
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
const settingsMenu = document.getElementById('settingsMenu');
const readerLoading = document.getElementById('readerLoading');
const readerMinimap = document.getElementById('readerMinimap');
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

