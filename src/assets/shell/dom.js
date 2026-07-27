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
const libraryShell = document.getElementById('libraryShell');
const libraryPane = document.getElementById('libraryPane');
const libraryDivider = document.getElementById('libraryDivider');
const libraryOpen = document.getElementById('libraryOpen');
const libraryTree = document.getElementById('libraryTree');
const readerGraph = document.getElementById('readerGraph');
const readerGraphCanvas = document.getElementById('readerGraphCanvas');
const readerGraphStatus = document.getElementById('readerGraphStatus');
const readerToolbar = document.getElementById('readerToolbar');
const viewReadingButton = document.getElementById('viewReadingButton');
const viewCodeButton = document.getElementById('viewCodeButton');
const viewGraphButton = document.getElementById('viewGraphButton');
const readerViewTools = document.getElementById('readerViewTools');
const readerLockButton = document.getElementById('readerLockButton');
const speedReaderButton = document.getElementById('speedReaderButton');
const lineNumbersButton = document.getElementById('lineNumbersButton');
const libraryCrumbTrail = document.getElementById('libraryCrumbTrail');
const libraryVaultSwitch = document.getElementById('libraryVaultSwitch');
const librarySearch = document.getElementById('librarySearch');
const librarySyncButton = document.getElementById('librarySyncButton');
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
// Keeps the promise a bottom sheet's grab bar makes: drag it and the sheet
// follows, let go and it either falls away or springs back. The travel rides a
// custom property rather than an inline transform, because the wide layout also
// centers the sheet with translateX(-50%) -- composing the two in CSS keeps that
// rule the only place that knows about the centering.
const SHEET_DISMISS_PX = 88;
const SHEET_FLICK_PX_PER_MS = 0.5;
function makeSheetDraggable(sheet, grip, dismiss) {
  if (!sheet || !grip) return;
  let drag = null;
  grip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault(); // don't start a text selection on the way down
    drag = {
      id: event.pointerId,
      startY: event.clientY,
      dy: 0,
      lastY: event.clientY,
      lastT: event.timeStamp,
      speed: 0,
    };
    sheet.classList.add('is-dragging');
    try { grip.setPointerCapture(event.pointerId); } catch (_) {}
  });
  grip.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    // Downward only: dragging up would lift the sheet off the window's edge.
    drag.dy = Math.max(0, event.clientY - drag.startY);
    const dt = event.timeStamp - drag.lastT;
    if (dt > 0) drag.speed = (event.clientY - drag.lastY) / dt;
    drag.lastY = event.clientY;
    drag.lastT = event.timeStamp;
    sheet.style.setProperty('--sheet-drag', drag.dy + 'px');
  });
  const finish = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const leaving = drag.dy > SHEET_DISMISS_PX || (drag.speed > SHEET_FLICK_PX_PER_MS && drag.dy > 12);
    drag = null;
    // Dropping the class first puts the transition back, so both endings
    // animate from wherever the drag left the sheet.
    sheet.classList.remove('is-dragging');
    if (!leaving) {
      sheet.style.removeProperty('--sheet-drag');
      return;
    }
    // The sheet's own close slides it to translateY(100%) from here; the offset
    // can only be cleared once that has finished, or it would jump first.
    dismiss();
    window.setTimeout(() => sheet.style.removeProperty('--sheet-drag'), 400);
  };
  grip.addEventListener('pointerup', finish);
  grip.addEventListener('pointercancel', finish);
}
// A growl: one line, bottom right, gone on its own. One slot that replaces
// itself, not a stack -- a stack is a thing that then needs managing. Failures
// hold longer: a success is read at a glance, a failure has to be finished and
// acted on.
const TOAST_MS = 5000;
const TOAST_ERROR_MS = 8000;
let toastTimer = 0;
function leafToast(message, tone) {
  const existing = document.querySelector('.app-toast');
  if (existing) existing.remove();
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = 0;
  }
  if (!message) return;
  const toast = document.createElement('div');
  const error = tone === 'error';
  toast.className = error ? 'app-toast is-error' : 'app-toast';
  // `status` rather than `alert` even for failures: nothing here is urgent
  // enough to interrupt a screen reader mid-sentence.
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.appendChild(toast);
  // A frame later, so the transition has a start state to move away from.
  window.requestAnimationFrame(() => toast.classList.add('is-shown'));
  toastTimer = setTimeout(() => {
    toast.classList.remove('is-shown');
    setTimeout(() => toast.remove(), 200);
  }, error ? TOAST_ERROR_MS : TOAST_MS);
}

// A slow document renders on the Rust side before the HTML comes back. Show a
// spinner over the reader immediately during that work, cleared when the
// document state arrives; a safety timeout guarantees it never sticks.
const READER_LOADING_SAFETY_MS = 30000;
let readerLoadingSafety = 0;
// Who put the overlay up. It covers the reader cell and the graph draws there
// too, so a document rendering behind the map must neither cover it nor clear
// the map's own spinner. Pass 'graph' to speak for the map.
let readerLoadingOwner = null;
function beginReaderLoading(owner) {
  const forGraph = owner === 'graph';
  if (graphViewOpen && !forGraph) return;
  clearReaderLoading(owner);
  readerLoadingOwner = forGraph ? 'graph' : null;
  if (readerLoading) readerLoading.hidden = false;
  // The safety net answers to nobody: whoever raised it, it comes down.
  readerLoadingSafety = setTimeout(() => {
    readerLoadingOwner = null;
    clearReaderLoading();
  }, READER_LOADING_SAFETY_MS);
}
function clearReaderLoading(owner) {
  if (readerLoadingOwner === 'graph' && owner !== 'graph') return;
  readerLoadingOwner = null;
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

