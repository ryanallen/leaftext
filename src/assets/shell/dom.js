// A published site draws no Back and no Forward: the browser has its own pair one row above them, and nothing on a site ever tells the page there is anywhere to go. Removed rather than hidden — a hidden button keeps its place in the tab order, keeps its listeners, and still cancels the mouse's own back gesture before sending a command no site host answers, which is the fault rather than a side effect of it. Above the references below, and above the bar's fold: the fold captures its candidates as it loads, and would otherwise move two buttons that are gone into the chevron menu the first time the bar folded.
if (window.__leafSite) {
  const historyActions = document.querySelector('.history-actions');
  if (historyActions) historyActions.remove();
}
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
const THEME_REPO_URL = 'https://github.com/ryanallen/leaftext';
const graphScopeControl = document.getElementById('graphScope');
const graphScopeTool = document.getElementById('graphScopeTool');
const libraryShell = document.getElementById('libraryShell');
const libraryPane = document.getElementById('libraryPane');
const libraryDivider = document.getElementById('libraryDivider');
const libraryOpen = document.getElementById('libraryOpen');
const libraryTree = document.getElementById('libraryTree');
const readerGraph = document.getElementById('readerGraph');
const readerGraphCanvas = document.getElementById('readerGraphCanvas');
const readerGraphStatus = document.getElementById('readerGraphStatus');
const readerGraphLegend = document.getElementById('readerGraphLegend');
const readerToolbar = document.getElementById('readerToolbar');
const viewReadingButton = document.getElementById('viewReadingButton');
const viewCodeButton = document.getElementById('viewCodeButton');
const viewGraphButton = document.getElementById('viewGraphButton');
const readerViewTools = document.getElementById('readerViewTools');
const readerLockButton = document.getElementById('readerLockButton');
const speedReaderButton = document.getElementById('speedReaderButton');
const codeIntelButton = document.getElementById('codeIntelButton');
const libraryCrumbTrail = document.getElementById('libraryCrumbTrail');
const libraryVaultSwitch = document.getElementById('libraryVaultSwitch');
const librarySearch = document.getElementById('librarySearch');
const librarySyncButton = document.getElementById('librarySyncButton');
const librarySearchResults = document.getElementById('librarySearchResults');
const filterMenu = document.getElementById('filterMenu');
// The update bell and its panel. Absent from the bar until there is something to install; the updater un-hides the whole menu.
const updateMenu = document.getElementById('updateMenu');
const updateAlertDot = document.getElementById('updateAlertDot');
const updateButton = document.getElementById('updateButton');
const updateButtonLabel = document.getElementById('updateButtonLabel');
const updateButtonFill = document.getElementById('updateButtonFill');
const updateButtonSpinner = document.getElementById('updateButtonSpinner');
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
// Manual pointer-based tab reordering (WebView2 doesn't fire HTML5 drag events reliably in-page). Computes the insertion slot from the pointer vs. the other tabs' centers and sends moveTab on drop.
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
    leafHoldPointer(tabDrag.el, tabDrag.pointerId);
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
    // Settle the tab into its new slot immediately (transitions suppressed), so it doesn't snap back and then jump when the moveTab re-render lands a frame or two later.
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
// Keeps the promise a bottom sheet's grab bar makes: drag it and the sheet follows, let go and it either falls away or springs back. The travel rides a custom property rather than an inline transform, because the wide layout also centers the sheet with translateX(-50%) -- composing the two in CSS keeps that rule the only place that knows about the centering. Let go part-way down and the sheet stays there. That is the whole point of dragging one: something behind it is being read, and a sheet that springs back the moment you release it is a sheet you cannot see past. It only leaves when it is most of the way gone, or thrown there.
const SHEET_PARK_MIN_PX = 20;
const SHEET_DISMISS_FRACTION = 0.6;
const SHEET_FLICK_FRACTION = 0.2;
const SHEET_FLICK_PX_PER_MS = 0.9;

function resetSheetDrag(sheet) {
  if (sheet) sheet.style.removeProperty('--sheet-drag');
}
function makeSheetDraggable(sheet, grip, dismiss) {
  if (!sheet || !grip) return;
  let drag = null;
  grip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault(); // don't start a text selection on the way down
    // From wherever it is sitting, not from flush: a sheet parked half-way down has to be draggable back up, and a drag that always started at zero could only ever push it further away.
    const parked = parseFloat(sheet.style.getPropertyValue('--sheet-drag')) || 0;
    drag = {
      id: event.pointerId,
      startY: event.clientY,
      from: parked,
      dy: parked,
      lastY: event.clientY,
      lastT: event.timeStamp,
      speed: 0,
    };
    sheet.classList.add('is-dragging');
    leafHoldPointer(grip, event.pointerId);
  });
  grip.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    // Never above flush: dragging up past that would lift the sheet off the window's edge and show a gap under it.
    drag.dy = Math.max(0, drag.from + (event.clientY - drag.startY));
    const dt = event.timeStamp - drag.lastT;
    if (dt > 0) drag.speed = (event.clientY - drag.lastY) / dt;
    drag.lastY = event.clientY;
    drag.lastT = event.timeStamp;
    sheet.style.setProperty('--sheet-drag', drag.dy + 'px');
  });
  const finish = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    // Measured against the sheet's own height, not a fixed number of pixels: a tall sheet dragged 90px has barely moved, a short one is nearly gone.
    const tall = sheet.getBoundingClientRect().height || 1;
    const dy = drag.dy;
    const leaving =
      dy > tall * SHEET_DISMISS_FRACTION ||
      (drag.speed > SHEET_FLICK_PX_PER_MS && dy > tall * SHEET_FLICK_FRACTION);
    drag = null;
    // Dropping the class first puts the transition back, so both endings animate from wherever the drag left the sheet.
    sheet.classList.remove('is-dragging');
    if (!leaving) {
      // Nudged rather than moved: sit flush again. Anything more stays put.
      if (dy < SHEET_PARK_MIN_PX) sheet.style.removeProperty('--sheet-drag');
      return;
    }
    // The sheet's own close slides it to translateY(100%) from here; the offset can only be cleared once that has finished, or it would jump first.
    dismiss();
    window.setTimeout(() => sheet.style.removeProperty('--sheet-drag'), 400);
  };
  grip.addEventListener('pointerup', finish);
  grip.addEventListener('pointercancel', finish);
}
// A growl: one line, bottom right, gone on its own. One slot that replaces itself, not a stack -- a stack is a thing that then needs managing. Failures hold longer: a success is read at a glance, a failure has to be finished and acted on.
const TOAST_MS = 5000;
const TOAST_ERROR_MS = 8000;
let toastTimer = 0;
// What to run when the current toast leaves, whether it timed out or another replaced it. An offer riding on a toast is only good while the toast is up, so whatever armed it is told the moment it is not.
let toastGone = null;
function endToast() {
  const gone = toastGone;
  toastGone = null;
  if (gone) gone();
}
// `action` is an optional { label, run, gone } -- a single button on the toast, which is the only thing on one that has ever been pressable.
function leafToast(message, tone, action) {
  const existing = document.querySelector('.app-toast');
  if (existing) existing.remove();
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = 0;
  }
  endToast();
  if (!message) return;
  const toast = document.createElement('div');
  const error = tone === 'error';
  toast.className = error ? 'app-toast is-error' : 'app-toast';
  // `status` rather than `alert` even for failures: nothing here is urgent enough to interrupt a screen reader mid-sentence.
  toast.setAttribute('role', 'status');
  if (action) {
    const said = document.createElement('span');
    said.className = 'app-toast-text';
    said.textContent = message;
    toast.appendChild(said);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-toast-action';
    button.textContent = action.label;
    // The toast goes as the button is pressed: the offer has been taken, so leaving it up invites a second press on an offer already spent.
    button.addEventListener('click', () => {
      const run = action.run;
      leafToast('');
      run();
    });
    toast.appendChild(button);
    toastGone = action.gone || null;
  } else {
    toast.textContent = message;
  }
  appSurface.appendChild(toast);
  // A frame later, so the transition has a start state to move away from.
  window.requestAnimationFrame(() => toast.classList.add('is-shown'));
  toastTimer = setTimeout(() => {
    toast.classList.remove('is-shown');
    setTimeout(() => toast.remove(), 200);
    endToast();
  }, error ? TOAST_ERROR_MS : TOAST_MS);
}

// A slow document renders on the Rust side before the HTML comes back. Show a spinner over the reader immediately during that work, cleared when the document state arrives; a safety timeout guarantees it never sticks.
const READER_LOADING_SAFETY_MS = 30000;
let readerLoadingSafety = 0;
// Who put the overlay up. It covers the reader cell and the graph draws there too, so a document rendering behind the map must neither cover it nor clear the map's own spinner. Pass 'graph' to speak for the map.
let readerLoadingOwner = null;
function beginReaderLoading(owner) {
  const forGraph = owner === 'graph';
  // Only while the map is staying up. A gesture that leaves it -- a search hit, or the jump to the source -- deliberately holds the map until its replacement is ready, so suppressing the spinner there leaves the wait looking like a freeze.
  if (graphViewOpen && !graphExitPending && !forGraph) return;
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
  // The same rule the other way round: the map tearing itself down must not pull down a spinner raised for the document that is replacing it, or the wait reappears as a blink between the map going and the page arriving.
  if (owner === 'graph' && readerLoadingOwner !== 'graph') return;
  readerLoadingOwner = null;
  if (readerLoadingSafety) { clearTimeout(readerLoadingSafety); readerLoadingSafety = 0; }
  if (readerLoading) readerLoading.hidden = true;
}
// Commands whose host handler always renders a document back, so raising the spinner here and letting that reply lower it is safe. Tab switches and the code-view toggle arm at their call sites (they need a no-op guard); other paths (picker, drag-drop, links) are armed host-side before the render.
const READER_LOADING_COMMANDS = new Set(['openRecent']);
const send = (message) => {
  if (message && READER_LOADING_COMMANDS.has(message.command)) beginReaderLoading();
  window.ipc.postMessage(JSON.stringify(message));
};

// Custom title-bar chrome, in two kinds. Neither platform gives us a native title bar to keep: on Windows there is none, and on a Mac Apple's own three dots are turned off so ours can fold into the chevron menu the way every other control does. So both draw the same three buttons, from the same markup, wired to the same three commands — the Mac styles them as dots and stands them at the bar's left end. Both kinds get the drag region.
if (window.__leafFrameless || window.__leafMacFrame) {
  document.body.classList.add('frameless');
  // The Mac's own look for those three: circles at the left, not squares at the right.
  if (window.__leafMacFrame) document.body.classList.add('mac-frame');
  const windowControls = document.getElementById('windowControls');
  if (windowControls) {
    windowControls.hidden = false;
    windowControls.setAttribute('aria-hidden', 'false');
    // Left of the leaf, where a Mac's are. Moved rather than written twice, and before overflow.js loads, so the fold records this as where they came from and puts them back here.
    const lead = window.__leafMacFrame && document.querySelector('.app-bar-lead');
    if (lead) lead.prepend(windowControls);
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
    !target.closest('button, a, input, select, textarea, [role="tab"], .tab, .window-controls, .update-menu');
  // The three window buttons are ours on both platforms now, so the one exclusion above covers a press on a Mac dot as well as on a Windows one. Maximize is decided on the way down: a drag hands the window to the platform's own move loop, which swallows every later mouse event, so an app-bar dblclick can never fire. event.detail is the click count, but it counts in page coordinates and a dragged window carries the page under the cursor — so a press just after a quick drag also arrives as 2. An unmoved window.screenX is what tells the second click apart from the tail of a drag.
  let pressedAtX = null;
  let pressedAtY = null;
  const dragWindowFrom = (bar) => {
    if (!bar) return;
    bar.addEventListener('mousedown', (event) => {
      const wasX = pressedAtX;
      const wasY = pressedAtY;
      pressedAtX = null;
      pressedAtY = null;
      if (event.button !== 0 || !isDragTarget(event.target)) return;
      pressedAtX = window.screenX;
      pressedAtY = window.screenY;
      const windowStayedPut = window.screenX === wasX && window.screenY === wasY;
      send({ command: event.detail === 2 && windowStayedPut ? 'windowToggleMaximize' : 'windowDrag' });
    });
  };
  dragWindowFrom(appBar);
  // The flowchart sheet covers the app bar, so its header is the drag bar while it is open — otherwise the window cannot be moved without closing the sheet.
  dragWindowFrom(document.getElementById('flowSheetHead'));
}
// The shadow band is the window's edge on both. On Windows there is no platform frame left at all, so the window's own edge test is never reached; on a Mac the frame's resize edge is at the band's outer rim, a band's width outside where the app looks like it ends and dead everywhere inside that. Either way the page is the only thing that sees the press, and it hands the drag to the host — which is why this is gated on having a frame of the app's own rather than on being Windows. A browser carries neither flag and watches nothing.
if (window.__leafFrameless || window.__leafMacFrame) {
  // Which of the eight compass points a press landed on, or null anywhere inside the app. Read off the app box rather than off the band's own sizes, so there is one copy of them; a window filling the screen has no band and no resize, and the platform refuses one anyway.
  const resizeEdgeAt = (x, y) => {
    if (document.body.classList.contains('is-maximized')) return null;
    const box = leafAppRect();
    // In as far as the inside of the app's own drawn line, which is the edge somebody aims at. The element knows how thick that line is, so the width is not written down a second time beside the one in `design/`.
    const line = appSurface.clientTop || 0;
    const northSouth = y < box.top + line ? 'n' : y >= box.bottom - line ? 's' : '';
    const eastWest = x < box.left + line ? 'w' : x >= box.right - line ? 'e' : '';
    return northSouth + eastWest || null;
  };
  const resizeDrag = (direction, phase, event) =>
    send({ command: 'windowResizeDrag', direction, phase, x: event.screenX, y: event.screenY });
  // Watched on the document rather than on the body: everything the page has is inside one fixed box, so the body has no flowed content and no height of its own — a press in the band lands on the page root above it and never reaches a body listener at all.
  if (window.__leafFrameless) {
    // The press is the whole gesture here: the host hands the window to the platform's own resize loop, which swallows every later mouse event and brings snapping, the size limits and the live redraw with it.
    document.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const direction = resizeEdgeAt(event.clientX, event.clientY);
      if (!direction) return;
      // Otherwise the drag sweeps a text selection across the page under the band.
      event.preventDefault();
      resizeDrag(direction, 'start', event);
    });
  } else {
    // No resize loop to hand a Mac window to, so the drag is followed here and the host sets the window from every move. Pointer events rather than mouse ones for the capture: a drag outward leaves the window at once, and without it the moves stop at the edge it started from.
    let dragging = null;
    document.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const direction = resizeEdgeAt(event.clientX, event.clientY);
      if (!direction) return;
      event.preventDefault();
      dragging = direction;
      leafHoldPointer(document.documentElement, event.pointerId);
      resizeDrag(direction, 'start', event);
    });
    document.addEventListener('pointermove', (event) => {
      if (dragging) resizeDrag(dragging, 'move', event);
    });
    const endDrag = (event) => {
      if (!dragging) return;
      resizeDrag(dragging, 'end', event);
      dragging = null;
    };
    document.addEventListener('pointerup', endDrag);
    // A capture lost to the platform ends the drag too, or the host holds a window rectangle nothing will ever clear.
    document.addEventListener('pointercancel', endDrag);
    document.addEventListener('lostpointercapture', endDrag);
  }
  // What tells somebody the band can be grabbed at all: the same eight zones the press reads, as the eight pointer shapes named after them. Set here rather than declared in the stylesheet, which would be a second copy of the zone table — and written only when it changes, since this runs on every move.
  let shape = '';
  document.addEventListener('mousemove', (event) => {
    const direction = resizeEdgeAt(event.clientX, event.clientY);
    const wanted = direction ? `${direction}-resize` : '';
    if (wanted === shape) return;
    shape = wanted;
    // On the page root, for the same reason the press is: the band is outside the body's own box.
    document.documentElement.style.cursor = wanted;
  });
}
// A full-screen Mac window shows no window buttons — the pointer at the top edge is how you get them — so ours go with them and the bar takes the room back. The Mac class itself stays on: it is what says which shell this is, and the dots' look and place are still the Mac's underneath. Defined unconditionally, like the maximize sync below, so the host's call is safe on every window.
window.leafSetFullscreen = (fullscreen) => {
  document.body.classList.toggle('is-fullscreen', !!fullscreen);
};
// Reflect the real maximized state: body.is-maximized swaps the maximize glyph for restore-down (CSS) and the label follows. Defined unconditionally (not just frameless) so the host's call is always safe — a no-op where controls are hidden.
window.leafSetWindowMaximized = (maximized) => {
  document.body.classList.toggle('is-maximized', !!maximized);
  const el = document.getElementById('winMaximize');
  if (el) {
    const label = maximized ? 'Restore' : 'Maximize';
    el.setAttribute('aria-label', label);
    el.setAttribute('title', label);
  }
};
// Put a floating thing where it was asked for, but inside the app: a menu opened near the right edge would otherwise hang off it, and one at the bottom would open below the fold. Both menus place themselves this way, so the arithmetic is here. The point comes in as the window's and goes out as the app's — leafClampToApp does that crossing for everything that places an overlay.
const LEAF_FLOAT_MARGIN = 8;
function leafPlaceFloating(el, x, y) {
  // Measured, so it has to be shown first — hidden elements have no size.
  el.hidden = false;
  const at = leafClampToApp(x, y, el.offsetWidth, el.offsetHeight, LEAF_FLOAT_MARGIN);
  el.style.left = at.left + 'px';
  el.style.top = at.top + 'px';
}
// Hold the pointer so it keeps reporting after it leaves the element — every drag in the app needs that, and it is the one line they all share. Wrapped because a browser may refuse: the drag still works, it just stops tracking outside the box, and an exception here would lose the whole gesture.
function leafHoldPointer(el, pointerId) {
  try {
    el.setPointerCapture(pointerId);
  } catch (_) {}
}
function leafReleasePointer(el, pointerId) {
  try {
    el.releasePointerCapture(pointerId);
  } catch (_) {}
}
// Escape closes whatever is open. The caller says what that means for it, and a caller whose thing is already shut does nothing — which is what lets four of these live on one page. `target` is the caller's own, because a listener on window is asked after one on document, and which closes first is sometimes the point.
function leafOnEscape(close, target) {
  (target || document).addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close(event);
  });
}
// Whether the keyboard is what is driving. A mouse never earns a focus ring: pressing a button and getting a ring that stays is the browser telling a mouse user about a keyboard feature, so anything that hands focus about asks this first.
let leafKeyboardDriving = false;
window.addEventListener('keydown', () => { leafKeyboardDriving = true; }, true);
window.addEventListener('pointerdown', () => { leafKeyboardDriving = false; }, true);
// Move focus, but only for the keyboard. Two jobs, both of them the same rule: giving focus back to whatever opened a menu when it closes, and putting it on the first row when one opens. A keyboard user must never be dropped at the top of the page; a mouse user must never be left with a ring on something they pressed.
function leafFocusForKeyboard(target) {
  if (!leafKeyboardDriving || !target || !target.isConnected || !target.focus) return false;
  target.focus();
  return true;
}
// Every bar in the app answers the scroll, not the pointer: it is there while that box is moving and gone a moment after it stops. Pointing at a list on the way somewhere else is not asking to be told how long it is.
var LEAF_SCROLL_REST_MS = 700;
const leafScrollResting = new WeakMap();
function leafMarkScrolling(box) {
  if (!box || !box.classList) return;
  box.classList.add('is-scrolling');
  clearTimeout(leafScrollResting.get(box));
  leafScrollResting.set(box, setTimeout(() => box.classList.remove('is-scrolling'), LEAF_SCROLL_REST_MS));
}
// `scroll` does not bubble, but it does reach an ancestor in the capture phase — so one listener sees every scroller in the page. It has to be one: the reader is rebuilt on every render and a wide table comes out of Markdown with nothing to bind to, and a box a re-bind missed would be a box whose bar never comes back.
document.addEventListener('scroll', (event) => leafMarkScrolling(event.target), { capture: true, passive: true });
// Resting the pointer in the bar's own gutter is aiming at a control, which is not the same as passing over the list it belongs to — so this raises the bar and thickens it, where a hover on the whole box was refused twice. The same four wearers as the stylesheet, named here as well because the cheap match is what keeps the layout read below off every move in the window.
const LEAF_SCROLL_WEARERS = '.leaf-scroll, .library-scroll, .reader-shell:not(.has-minimap), .table-lane > table';
let leafPointedBox = null;
// The gutter is real and sits outside the box's own width, so a move whose offset is past `clientWidth` — or past `clientHeight`, for a sideways bar — is on the bar and nothing else is. Never a rectangle: one per move is a forced layout on every move across the window.
function leafMarkPointing(event) {
  const box = event && event.target;
  const on = box && box.matches && box.matches(LEAF_SCROLL_WEARERS)
    && (event.offsetX >= box.clientWidth || event.offsetY >= box.clientHeight)
    ? box
    : null;
  if (on === leafPointedBox) return;
  if (leafPointedBox && leafPointedBox.classList) leafPointedBox.classList.remove('is-pointing');
  leafPointedBox = on;
  if (on && on.classList) on.classList.add('is-pointing');
}
document.addEventListener('pointermove', leafMarkPointing, { capture: true, passive: true });
// The pointer leaving the window fires no move, so without this the last box keeps its bar up for as long as the window is unattended.
document.addEventListener('pointerleave', () => leafMarkPointing(null), { capture: true, passive: true });
window.leafSetWindowMaximized(window.__leafMaximized);

