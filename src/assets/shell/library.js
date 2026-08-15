// Said by both sync buttons and the count chip, so it is written once.
const SYNC_WORKING = 'Working…';
function persistLibraryState() {
  send({ command: 'setLibraryState', projectPath: libraryProjectPath });
}
function persistLibraryLayout() {
  send({ command: 'setLibraryLayout', closed: libraryUserClosed, width: Math.round(libraryWidth) });
}
// The widest the open pane may get while leaving the reader usable. Floored at SNAP_SHUT so an explicit open always shows a real pane.
function maxOpenPaneWidth() {
  return Math.max(SNAP_SHUT, libraryShell.clientWidth - MIN_READER_WIDTH);
}
function clampOpenPaneWidth(width) {
  return Math.min(Math.max(width, SNAP_SHUT), maxOpenPaneWidth());
}
// A window too narrow for both reader and pane shows the pane closed regardless of preference — a display fallback, not a saved state.
function libraryTooNarrow() {
  return libraryShell.clientWidth < SNAP_SHUT + MIN_READER_WIDTH;
}
function libraryIsClosed() {
  return libraryUserClosed || libraryTooNarrow();
}
// Slide the narrow-window sheet away. A no-op when there is no sheet up, so callers don't have to check which layout they are in.
function closeLibrarySheet() {
  if (!librarySheetOpen) return;
  librarySheetOpen = false;
  applyPaneLayout();
}
function applyPaneLayout(holdRail) {
  const closed = libraryIsClosed();
  // Too narrow for a pane beside the page, so the library becomes a sheet over it. Grid-wise it stays closed — the sheet is out of flow — and widening the window drops it, since a pane that fits should never be an overlay.
  const narrow = libraryTooNarrow();
  if (!narrow) librarySheetOpen = false;
  libraryShell.classList.toggle('library-narrow', narrow);
  libraryShell.classList.toggle('library-overlay', narrow && librarySheetOpen);
  libraryOpen.setAttribute('aria-expanded', narrow && librarySheetOpen ? 'true' : 'false');
  libraryShell.classList.toggle('library-closed', closed);
  // Mirror the pane state onto the header so its left zone (the tab rail) tracks the library width and its dividing stroke drops when the library is closed.
  appBar.classList.toggle('has-rail', !closed);
  // One width for everything that follows the pane: the shell's first grid track, the app bar's lead and the reader divider all read this var, so writing it is the whole layout change. `holdRail` lands the classes without it — the open's first step.
  if (!closed) {
    if (!holdRail) document.documentElement.style.setProperty('--library-rail-width', clampOpenPaneWidth(libraryWidth) + 'px');
  } else {
    document.documentElement.style.setProperty('--library-rail-width', '0px');
  }
  // The lead grows/shrinks with the rail, changing how much room the actions have — re-evaluate the overflow fold.
  refitAppBar();
  // Opening, closing, or re-clamping the pane changes the breadcrumb's room too.
  scheduleCrumbFit();
}
// The toggle's motion: a body class holds the transition on for just this gesture, transitionend advances it, and a timeout ends a run Reduce Motion made zero-duration (no event fires) or something interrupted — the flow and glossary sheets' pattern. Open is one overshooting leg. Close is three — slam to the reader's padding, bounce off it once, seat back on it — because one curve cannot come back out of its target, and the padding floors the whole motion: the closed card rests there, so the pane never touches the window edge.
const LIBRARY_MOTION_FALLBACK_MS = 600;
const LIBRARY_BOUNCE_PX = 16;
function readerGutterPx() {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reader-gutter')) || 0;
}
let libraryMotionTimer = 0;
let libraryMotionDone = null;
let libraryMotionStage = '';
function endLibraryMotion() {
  window.clearTimeout(libraryMotionTimer);
  libraryMotionTimer = 0;
  libraryMotionStage = '';
  document.body.classList.remove('is-library-opening', 'is-library-closing', 'is-library-settling');
  const done = libraryMotionDone;
  libraryMotionDone = null;
  // The rail's width write is dropped while the pane moves, since it retargets the transition mid-gesture. This is the one place the classes come off, so it is the one place that can ask for it again.
  scheduleMinimapWidthSync();
  // A full layout of the resting truth, so ending mid-bounce still seats everything.
  if (done) done();
}
function startLibraryMotion(direction, done) {
  // Settle any motion still running, so a re-toggle retargets from where the rail is.
  endLibraryMotion();
  document.body.classList.add(direction);
  libraryMotionStage = direction === 'is-library-closing' ? 'slam' : '';
  libraryMotionDone = done || null;
  libraryMotionTimer = window.setTimeout(endLibraryMotion, LIBRARY_MOTION_FALLBACK_MS);
}
libraryShell.addEventListener('transitionend', (event) => {
  // Only the shell's own track: transitionend bubbles, and the lead's width ending must not finish a motion the grid is still drawing.
  if (event.target !== libraryShell || event.propertyName !== 'grid-template-columns') return;
  if (libraryMotionStage === 'slam') {
    // Hit the padding: bounce open a bit, on the settling curve.
    libraryMotionStage = 'bounce';
    document.body.classList.remove('is-library-closing');
    document.body.classList.add('is-library-settling');
    document.documentElement.style.setProperty('--library-rail-width', readerGutterPx() + LIBRARY_BOUNCE_PX + 'px');
    return;
  }
  if (libraryMotionStage === 'bounce') {
    // Bounced: seat back on the padding, where the closed card rests.
    libraryMotionStage = 'settle';
    document.documentElement.style.setProperty('--library-rail-width', readerGutterPx() + 'px');
    return;
  }
  endLibraryMotion();
});
// The panel button in the app bar toggles the library: closed → open at the default width (never the sliver it was dragged to before snapping shut), open → closed. On a too-narrow window it slides the sheet in and out instead — a transient view state, so nothing about it is persisted.
function toggleLibrary() {
  if (libraryTooNarrow()) {
    librarySheetOpen = !librarySheetOpen;
    applyPaneLayout();
    return;
  }
  if (libraryIsClosed()) {
    libraryUserClosed = false;
    libraryWidth = DEFAULT_PANE_WIDTH;
    // Two steps: land the open classes with the rail at the padding (the closed card's resting edge), flush, then grow — so nothing jumps on the first frame.
    document.documentElement.style.setProperty('--library-rail-width', readerGutterPx() + 'px');
    applyPaneLayout(true);
    void libraryShell.offsetWidth;
    startLibraryMotion('is-library-opening', null);
    applyPaneLayout();
  } else {
    libraryUserClosed = true;
    // Closing: slam to the padding; the chain above bounces off it and seats there.
    startLibraryMotion('is-library-closing', applyPaneLayout);
    document.documentElement.style.setProperty('--library-rail-width', readerGutterPx() + 'px');
  }
  persistLibraryLayout();
}
libraryOpen.addEventListener('click', toggleLibrary);
// Drag-to-resize the pane from its right edge, rAF-throttling width writes so the grid doesn't relayout on every pointer event.
let dividerDrag = null;
function applyPendingDividerWidth() {
  if (!dividerDrag) return;
  dividerDrag.frame = 0;
  if (dividerDrag.pendingWidth != null) {
    libraryWidth = dividerDrag.pendingWidth;
    // One var moves the pane, the tabs and the divider line together, live under the pointer — no motion class, so nothing eases behind the drag.
    document.documentElement.style.setProperty('--library-rail-width', libraryWidth + 'px');
    // The breadcrumb shows as much of the path as fits, so it refits mid-drag.
    scheduleCrumbFit();
  }
}
function endDividerDrag() {
  if (!dividerDrag) return;
  if (dividerDrag.frame) cancelAnimationFrame(dividerDrag.frame);
  leafReleasePointer(libraryDivider, dividerDrag.pointerId);
  dividerDrag = null;
  document.body.classList.remove('library-resizing');
}
libraryDivider.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || libraryIsClosed()) return;
  event.preventDefault();
  dividerDrag = { pointerId: event.pointerId, frame: 0, pendingWidth: null };
  leafHoldPointer(libraryDivider, event.pointerId);
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
// On resize, re-clamp the open width and re-evaluate the too-narrow fallback. The auto-hide is display-only; the saved preference is never overwritten, so widening restores the pane.
let paneResizeFrame = 0;
window.addEventListener('resize', () => {
  if (paneResizeFrame) return;
  paneResizeFrame = requestAnimationFrame(() => {
    paneResizeFrame = 0;
    if (!libraryIsClosed()) libraryWidth = clampOpenPaneWidth(libraryWidth);
    applyPaneLayout();
  });
});
// The file the library highlights as "current" (active tab's path), plus a one-shot request to reveal it on the next render (drill Project in, expand Tree ancestors, scroll into view). Set only when the user goes to a file, never on a passive re-render, so manual browsing isn't disturbed.
let librarySelectedPath = null;
let libraryRevealPending = false;
function activeDocumentPath() {
  const tabs = (currentState && currentState.tabs) || [];
  const active = currentState && currentState.active;
  if (active == null || !tabs[active]) return null;
  return tabs[active].path || null;
}
// What the pager came back as, per document. Every render emits the skeleton and waits to be told what to put there, which flashes a pulsing box at the foot of the page on every edit. The remembered answer goes back before the paint; the ask still goes out, so a neighbor added since still lands.
const pagerHtmlByPath = new Map();

function requestDocumentPager(path) {
  const placeholder = app.querySelector('.document-body .docs-pager-loading');
  if (!placeholder || !path) return;
  if (pagerHtmlByPath.has(path)) applyDocumentPager(placeholder, pagerHtmlByPath.get(path));
  send({ command: 'loadPager', path });
}

// Swap `current` for the pager `html` describes, or take it away when there is none. `current` may be the skeleton or a pager already standing.
function applyDocumentPager(current, html) {
  const wrapper = document.createElement('div');
  if (html) wrapper.innerHTML = html;
  const pager = wrapper.firstElementChild;
  if (!pager) {
    current.remove();
    scheduleReaderLayoutUpdate();
    return;
  }
  current.replaceWith(pager);
  bindDocumentLinks();
  scheduleReaderLayoutUpdate();
}

window.leafSetPager = (state) => {
  if (!state || state.path !== activeDocumentPath()) return;
  pagerHtmlByPath.set(state.path, state.html || '');
  const body = app.querySelector('.document-body');
  const current = body ? body.querySelector('.docs-pager') : null;
  if (current) {
    applyDocumentPager(current, state.html);
    return;
  }
  // Nothing there to replace: a remembered "no neighbors" already took the skeleton away, and this answer says there is one after all.
  if (!body || !state.html) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = state.html;
  const pager = wrapper.firstElementChild;
  if (!pager) return;
  body.appendChild(pager);
  bindDocumentLinks();
  scheduleReaderLayoutUpdate();
};
function scrollSelectedLibraryRowIntoView() {
  const row = libraryTree.querySelector('.library-file.is-selected');
  // Centered so a deeply nested file lands away from the app bar and bottom edge.
  if (row) row.scrollIntoView({ block: 'center' });
}
// Carry out a pending reveal: put the pane where the open document is. The host decides what that means, because only it knows the vaults — a file inside one switches to it, a file in none switches to the whole library, and either way the folder holding it is what opens.
function revealSelectedInLibrary() {
  if (!libraryRevealPending || !librarySelectedPath) return false;
  libraryRevealPending = false;
  send({ command: 'revealInLibrary', path: librarySelectedPath });
  return true;
}
// Mark `path` the library's current file and ask the next render to reveal it. null (home screen) just clears the highlight, leaving the browse position.
function followFileInLibrary(path, focus, forceRefresh) {
  librarySelectedPath = path || null;
  libraryRevealPending = !!path;
  // Going to a file can move the pane's root, and that is true in either view — the graph's scope is the vault, so it follows the document too.
  if (libraryRevealPending) revealSelectedInLibrary();
  // With the graph up, move the highlight to the active node. On a deliberate navigation, also fly the camera to it and zoom in; `forceRefresh` rebuilds the slice too.
  if (graphViewOpen) graphSetActive(librarySelectedPath, focus, forceRefresh);
  renderLibrary();
}
function fileRowHtml(node) {
  const label = (node && (node.name || node.title || node.path)) || '';
  const isSelected = librarySelectedPath && node.path === librarySelectedPath;
  const selected = isSelected ? ' is-selected' : '';
  const current = isSelected ? ' aria-current="true"' : '';
  return `<button type="button" class="library-file${selected}"${current} data-open-path="${escapeAttr(node.path)}" data-reveal-path="${escapeAttr(node.path)}" title="${escapeAttr(node.path)}">${LEAF_FILE_ICON}<span class="library-file-label">${documentNameMarkup(label)}</span></button>`;
}
// Where "up" goes: the folder above this one, or the root when this is the first level in. Null at the top, where there is nothing above — a vault's own folder, or the drive roots. Leaving a vault is the switcher's job, not this row's.
function libraryParentCrumb() {
  if (!libraryChain.length) return null;
  const parent = libraryChain[libraryChain.length - 2];
  return parent ? { path: parent.path, name: parent.name } : { path: '', name: libraryRootLabel() };
}
// The row above the contents: back out one folder. The breadcrumb can do this too, but it is a thin line of small text at the top of the pane — this is a full-width target sitting where the pointer already is.
function upRowHtml(parent) {
  const label = `Back to ${parent.name}`;
  return `<button type="button" class="library-nav-folder library-nav-up" data-nav-into="${escapeAttr(parent.path)}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${BACK_ARROW_SVG}<span class="library-file-label">${escapeText(parent.name)}</span></button>`;
}
function renderProject(entries) {
  const rows = [];
  const parent = libraryParentCrumb();
  if (parent) rows.push(upRowHtml(parent));
  for (const node of entries || []) {
    if (node.kind === 'folder') {
      // A folder row carries data-reveal-path so the right-click menu reaches it.
      rows.push(`<button type="button" class="library-nav-folder" data-nav-into="${escapeAttr(node.path)}" data-reveal-path="${escapeAttr(node.path)}" data-folder-path="${escapeAttr(node.path)}" title="${escapeAttr(node.name)}">${FOLDER_ICON_SVG}<span class="library-file-label">${escapeText(node.name)}</span><span class="library-nav-chevron" aria-hidden="true">›</span></button>`);
    } else {
      rows.push(fileRowHtml(node));
    }
  }
  return `<div class="library-project">${rows.join('')}</div>`;
}
// A browse path as somewhere on disk. Inside a vault the top level is browsed as '' — a stand-in the host resolves — but paste and drop need a real folder, so that resolves to the vault's own root. Outside a vault the top is the list of drive roots, which is not a folder, and stays empty.
function realFolderPath(browsePath) {
  if (browsePath) return browsePath;
  const vault = activeVault();
  return (vault && vault.rootPath) || '';
}
// The real folder the pane is showing.
function libraryFolderHere() {
  return realFolderPath(libraryProjectPath);
}
// Enter a folder (or, from a crumb, step back out to one). '' is the top: the active vault's folder, or the drive roots. The host reads it and calls back — nothing is known about a folder here until it has been opened.
function setLibraryFolder(path) {
  libraryProjectPath = path || '';
  persistLibraryState();
  send({ command: 'getFolder', path: libraryProjectPath });
}
// Read the current folder again, keeping where you are. The host calls this after it changes what is in a folder — a paste, a delete, a rename — so the pane shows the result of what you just did instead of waiting on the watcher.
window.leafRefreshLibraryFolder = () => {
  send({ command: 'getFolder', path: libraryProjectPath });
};
function bindLibraryRows() {
  libraryTree.querySelectorAll('[data-open-path]').forEach(bindLibraryFileRow);
  libraryTree.querySelectorAll('[data-nav-into]').forEach(bindFolderEntryRow);
  const intro = libraryTree.querySelector('.library-intro-action');
  if (intro) {
    intro.addEventListener('click', () => {
      send({ command: 'createVault' });
      retireLibraryIntro();
    });
  }
}
// Act on the mouse's press, not the full click: the watcher re-reads on any change under a recursively watched vault, every re-read rewrites these rows through innerHTML, and a rebuild landing between press and release replaces the button so the click never fires. Keyboard keeps click (it has no press), and so do touch and pen — a touch press that starts a scroll must not act on the row under the finger.
//
// One helper for both kinds of row: they sit in one rebuilt list, so a file row bound on the click while its neighbors are bound on the press is exactly how this came back.
function bindLibraryRowPress(button, act) {
  button.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    // A slow host answer leaves this button in place, so the click completing this press still fires and would act twice without the flag.
    button.leafPressEntered = true;
    act();
  });
  button.addEventListener('click', () => {
    if (button.leafPressEntered) {
      button.leafPressEntered = false;
      return;
    }
    act();
  });
}
function bindFolderEntryRow(button) {
  bindLibraryRowPress(button, () => setLibraryFolder(button.dataset.navInto));
}
function bindLibraryFileRow(button) {
  bindLibraryRowPress(button, () => {
    send({ command: 'openRecent', path: button.dataset.openPath });
    // Picking a document is the sheet's whole purpose, so it gets out of the way — the page it just opened is behind it.
    closeLibrarySheet();
  });
}
// The breadcrumb: the library root, then one crumb per folder entered, the last being where you are. How many crumbs show is measured against the band's real width, not a fixed count — widening the pane reveals more of the path. What doesn't fit collapses into a "…" button that opens a menu of the folders it swallowed, so a deep path is still one click from any ancestor. The leftmost crumb is the root — the whole library, or the vault you are in — and clicking it goes there, the way every other crumb goes to its folder. Changing *which* root that is belongs to the button beside the trail, not to a crumb that looks exactly like a place.
function crumbSegments(chain) {
  return [{ path: '', name: libraryRootLabel() }]
    .concat(chain.map((node) => ({ path: node.path, name: node.name || node.path })));
}
// On a site the trail stands in the bar and names the document being read, not the folder the pane is showing. Nothing on a site reveals an opened file in the pane, so following a link moves the page and leaves the pane where it was — a trail built from the pane's chain would name a folder the reader is not in. The document's own path is always right and needs no host answer: its folders are the links, and the document itself is the last crumb, which like every other current crumb is not one.
function siteCrumbChain() {
  const path = activeDocumentPath();
  if (!path) return [];
  const chain = [];
  let walked = '';
  for (const part of path.split('/')) {
    walked = walked ? `${walked}/${part}` : part;
    chain.push({ name: part, path: walked });
  }
  // The document's crumb reads the way its tab label did, without the extension.
  const last = chain[chain.length - 1];
  last.name = documentNameParts(last.name).stem || last.name;
  return chain;
}
// The chain the trail is currently drawing, kept so a resize can refit without re-walking the tree.
let libraryCrumbChain = [];
const CRUMB_SEP_HTML = '<span class="library-crumb-sep" aria-hidden="true">›</span>';
function crumbHtml(segment, current) {
  if (current) {
    return `<span class="library-crumb is-current" aria-current="true" title="${escapeAttr(segment.path || segment.name)}">${escapeText(segment.name)}</span>`;
  }
  const enter = escapeAttr(`Open ${segment.name}`);
  return `<button type="button" class="library-crumb" data-crumb-path="${escapeAttr(segment.path)}" title="${enter}">${escapeText(segment.name)}</button>`;
}
function crumbElisionHtml(hidden) {
  const names = hidden.map((segment) => segment.name);
  const label = escapeAttr(`Skipped folders: ${names.join(' › ')}`);
  return `<button type="button" class="library-crumb is-elided" data-crumb-more="1" title="${label}" aria-label="${label}" aria-haspopup="menu" aria-expanded="false">…</button>`;
}
// What the trail was last laid out for. The library re-renders whenever a disk change touches the folder on screen, and rebuilding the crumbs throws away the "…" an open menu hangs off.
let libraryCrumbFitKey = null;
function crumbFitKey(segments) {
  return segments.map((segment) => segment.path + '>' + segment.name).join('|')
    + '@' + libraryCrumbTrail.clientWidth;
}
// Lay the trail out for a pane of this width. One measuring pass renders every crumb (plus the "…" button, so its cost is known) with shrinking disabled and reads the natural widths; the fit is then arithmetic, and the final markup is written once. Both writes happen inside the same task, so nothing intermediate paints.
function fitLibraryCrumbs() {
  if (!libraryCrumbTrail) return;
  const segments = crumbSegments(libraryCrumbChain);
  // The trail fills the band whatever is in it, so its width keys the fit safely.
  const key = crumbFitKey(segments);
  if (key === libraryCrumbFitKey) return;
  libraryCrumbFitKey = key;
  const last = segments.length - 1;
  const fullHtml = segments.map((segment, index) => crumbHtml(segment, index === last)).join(CRUMB_SEP_HTML);
  let hidden = [];
  let shown = segments;
  // Past here the trail is rebuilt, so a menu hanging off the "…" loses the button under it. Only that one: the switcher stands outside the trail, and closing it here left it unopenable beside a git vault, where asking about the repository brings a watcher event round to shut the menu that asked.
  if (crumbMenuOwner && libraryCrumbTrail.contains(crumbMenuOwner)) hideCrumbMenu();
  // Measure with shrinking off and the "…" in the row, so every box reports the width it actually wants. A closed pane measures zero — draw the whole path and let the reopen (which resizes the band) refit it.
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
    // Root and current folder always stay. Between them, keep as many of the nearest ancestors as fit behind the "…" — at least the current folder, which shrinks with an ellipsis of its own if even that overruns.
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
  bindCrumbTrailButtons(hidden);
}
// The trail's folder links and its two menu buttons, wired after any rebuild.
function bindCrumbTrailButtons(hidden) {
  libraryCrumbTrail.querySelectorAll('[data-crumb-path]').forEach((crumb) => {
    crumb.addEventListener('click', () => setLibraryFolder(crumb.dataset.crumbPath));
  });
  const more = libraryCrumbTrail.querySelector('[data-crumb-more]');
  if (more) {
    // On the press, and stopped there, so the menu's own close-on-outside-press does not fight this toggle -- same reasoning as the vault switcher.
    more.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      toggleCrumbMenu(more, folderMenuItems(hidden));
    });
  }
}
function renderLibraryCrumbs(chain) {
  if (!libraryCrumbTrail) return;
  libraryCrumbChain = window.__leafSite ? siteCrumbChain() : chain;
  fitLibraryCrumbs();
}
// One menu for the two buttons on the trail: the folders the "…" swallowed, and the vault switcher under the leftmost crumb. Same chrome as the file right-click menu.
const crumbMenu = document.createElement('div');
crumbMenu.className = 'context-menu crumb-menu';
crumbMenu.hidden = true;
crumbMenu.setAttribute('role', 'menu');
appSurface.appendChild(crumbMenu);
let crumbMenuOwner = null;
// Which vault's settings the menu is showing, so a git answer arriving a second later can redraw the panel it belongs to and no other.
let crumbMenuVault = null;
// Changing an already-set repository is deliberately a second step: the paste field stays folded behind a button until this is on, so the common panel is the short one and re-pointing takes a decision. Reset with the panel.
let changeRepoRevealed = false;
// The address each vault pointed at before its last change, so a wrong turn is one click to undo. Kept for the session -- git overwrites the old URL and keeps no copy, which is exactly how one got lost. Keyed by vault id.
const previousRemoteByVault = new Map();
// The sync clients whose folders are really on this machine, as the host found them. Null until the first answer lands, which is not an empty list: nothing is offered while we do not know yet.
let cloudFolders = null;
// The clone field stays folded behind a row, the way changing a repository does: picking a folder is the common case, and pasting an address is a decision worth taking on purpose.
let cloneRevealed = false;
function hideCrumbMenu() {
  if (crumbMenu.hidden) return;
  // Hand focus back to the "…" before hiding, or it would be stranded on a hidden item and keyboard travel would restart from the top of the page.
  const returnFocus = crumbMenu.contains(document.activeElement);
  crumbMenu.hidden = true;
  if (crumbMenuOwner) {
    crumbMenuOwner.setAttribute('aria-expanded', 'false');
    if (returnFocus) leafFocusForKeyboard(crumbMenuOwner);
  }
  crumbMenuOwner = null;
  crumbMenuVault = null;
  changeRepoRevealed = false;
  cloneRevealed = false;
}
// The folders the "…" stands in for; picking one enters it.
function folderMenuItems(hidden) {
  return hidden.map((segment) => ({
    label: segment.name,
    title: segment.path || segment.name,
    icon: FOLDER_ICON_SVG,
    run: () => setLibraryFolder(segment.path),
  }));
}
// The switcher's rows: the whole library as it has always been, then every vault, then New vault…. The rows are told apart by id, so two vaults may share a name — and "Library" is that first row's label, not a reserved word.
function vaultMenuItems() {
  // Ask about every vault, not just the one in use: the menu is where you compare them, and "which of these reach GitHub" is the comparison worth making. Cached after the first look, so this costs once per vault.
  requestKnownVaultStatuses();
  requestCloudFolders();
  const rootIcon = (on, id) => vaultGlyph(on, id);
  const items = [{
    label: 'Library',
    title: 'Everything the library has indexed',
    icon: rootIcon(!activeVaultId, 0),
    selected: !activeVaultId,
    // Tagged so a status answer can flip this row's glyph in place instead of rebuilding the whole menu -- see refreshSwitcherGlyphs.
    vaultId: 0,
    run: () => switchVault(0),
  }];
  for (const vault of leafVaults) {
    if (!vault || !vault.id) continue;
    items.push({
      label: vault.name || vault.rootPath,
      title: vault.rootPath || '',
      icon: rootIcon(vault.id === activeVaultId, vault.id),
      selected: vault.id === activeVaultId,
      vaultId: vault.id,
      run: () => switchVault(vault.id),
      // The row's own button: everything you can do to this vault, in one place. Visible, because a menu you have to right-click is a menu nobody finds.
      edit: () => {
        crumbMenuVault = vault;
        changeRepoRevealed = false;
        // Ask now rather than when a button is pressed: reading a repository is disk work, and the panel should already know the answer by the time anyone has read down to it.
        send({ command: 'getVaultGit', id: vault.id });
        showCrumbMenu(crumbMenuOwner, editVaultMenuItems(vault));
      },
    });
  }
  items.push('separator');
  items.push({
    label: 'New vault…',
    title: 'Choose a folder to use as a library root',
    icon: MENU_PLUS_SVG,
    run: () => send({ command: 'createVault' }),
  });
  pushCloneRow(items);
  return items;
}
// The expanded "change repository" panel: names where the vault points now, takes a new address, and saves only on Save. Nothing here reaches GitHub -- it sets the address; sending files is a separate Sync -- so a wrong paste can be Canceled, and the address it replaced is remembered to put back.
function pushChangeRepoPanel(items, vault, repo) {
  const current = repo.remoteUrl || repo.remote || '';
  items.push({ note: `Now pointing at: ${current}` });
  items.push({ note: 'Paste a new address and press Save. This only changes where it points — your files are sent when you Sync, not now.' });
  const closePanel = () => {
    changeRepoRevealed = false;
    showCrumbMenu(crumbMenuOwner, editVaultMenuItems(vault));
  };
  const saveRepo = () => {
    const field = crumbMenu.querySelector('.repo-url-field');
    const url = field ? field.value.trim() : '';
    if (url && url !== current) {
      if (current) previousRemoteByVault.set(vault.id, current);
      send({ command: 'linkVaultRemote', id: vault.id, url });
    }
    closePanel();
  };
  items.push({
    input: '',
    fieldClass: 'repo-url-field',
    commitOnBlur: false,
    onEnter: saveRepo,
    onEscape: closePanel,
    placeholder: 'Paste the repository address',
  });
  items.push({
    buttons: [
      {
        label: 'Cancel',
        keepOpen: true,
        run: closePanel,
      },
      {
        label: 'Save',
        icon: MENU_CHECK_SVG,
        primary: true,
        keepOpen: true,
        run: saveRepo,
      },
    ],
  });
  // The one it pointed at before the last change, offered back. Fills the field rather than saving straight away, so putting it back is still a decision you watch happen.
  const previous = previousRemoteByVault.get(vault.id);
  if (previous && previous !== current) {
    items.push({
      label: `Put back ${previous}`,
      keepOpen: true,
      run: () => {
        const field = crumbMenu.querySelector('.repo-url-field');
        if (field) {
          field.value = previous;
          field.focus();
        }
      },
    });
  }
}
// One vault's edit panel, shown in place of the switcher's list: its name, the folder it points at, and the way to forget it. Reached from the row's button. The vault's standing with GitHub. Every branch of this is a state the machine is actually in -- git missing, a repo already here, a repo one folder down -- and each says what it is before offering what to do about it.
function vaultGitItems(vault) {
  const items = ['separator', { heading: 'GitHub' }];
  const state = vaultGitByVault.get(vault.id);
  if (!state) {
    items.push({ note: 'Checking this folder…' });
    return items;
  }
  if (!state.tooling.git) {
    // The one hard requirement. Everything else this panel does is a wrapper around a git that is already installed and already knows the user.
    items.push({ note: 'Syncing needs git, which is not installed.' });
    items.push({
      label: 'Install git ↗',
      run: () => send({ command: 'openExternal', url: 'https://git-scm.com/downloads' }),
    });
    return items;
  }
  const repo = state.repo;
  const busy = Boolean(state.busy);
  if (repo.atRoot) {
    items.push({ note: repoSummary(repo) });
    if (repo.remote) {
      items.push({
        label: busy ? SYNC_WORKING : 'Sync',
        icon: SYNC_ICON_SVG,
        disabled: busy,
        keepOpen: true,
      run: () => send({ command: 'syncVault', id: vault.id }),
      });
      // Re-pointing stays folded behind a button so the everyday panel is just "Sync" and a change takes a deliberate press, not a fat-finger.
      if (!changeRepoRevealed) {
        items.push({
          label: 'Change repo…',
          keepOpen: true,
          run: () => {
            changeRepoRevealed = true;
            showCrumbMenu(crumbMenuOwner, editVaultMenuItems(vault));
            const field = crumbMenu.querySelector('.repo-url-field');
            if (field) field.focus();
          },
        });
      } else {
        pushChangeRepoPanel(items, vault, repo);
      }
    } else {
      // A repository with nowhere to push. The same two routes as a fresh one.
      pushCreateRoutes(items, vault, state, busy);
    }
  } else {
    if (repo.outer) {
      items.push({ note: `This folder sits inside ${repo.outer}. A repository here is separate from it.` });
    }
    if (repo.nested && repo.nested.length) {
      items.push({
        note: `Already repositories, and left alone: ${repo.nested.join(', ')}`,
      });
    }
    pushCreateRoutes(items, vault, state, busy);
  }
  // Two things git needs that only bite at the moment of committing or pushing, which is too late to be told about them.
  if (!state.tooling.identity) {
    items.push({ note: 'git does not know who you are yet. Put your name and email here and it will — git keeps them for this machine.', danger: true });
    pushIdentityFields(items, vault, busy);
  }
  if (!state.tooling.credentialHelper) {
    // A sentence and a door, never a button: every git this app spawns has its prompts shut off and no console to hold a conversation in, and `gh auth login` is a conversation.
    items.push({ note: 'git has no way to sign in to GitHub. Install GitHub CLI and run gh auth login, or a credential manager.', danger: true });
  }
  // The door stands for a sign-in that was refused too, not only for a missing helper: a helper holding a token GitHub no longer accepts fails exactly like no helper at all, and the outcome line below says "sign in above", which has to be true.
  if (!state.tooling.credentialHelper || state.message === 'failed:signin') {
    items.push({
      label: 'How to sign in ↗',
      title: 'Opens GitHub’s own page on letting git remember your sign-in.',
      run: () => send({
        command: 'openExternal',
        url: 'https://docs.github.com/get-started/git-basics/caching-your-github-credentials-in-git',
      }),
    });
  }
  const outcome = syncOutcomeText(state);
  if (outcome) items.push({ note: outcome, danger: Boolean(state.error) });
  return items;
}
// The one dead end the app can fix itself. Two fields and a button, writing git's settings for this whole machine -- which is where the warning above is read from, so a press that works is a press that clears it. Neither field commits on its own: nothing is set until Set is pressed, and an empty one is refused by the host rather than here, so pressing it always says something.
function pushIdentityFields(items, vault, busy) {
  const setIdentity = () => {
    const name = crumbMenu.querySelector('.git-name-field');
    const email = crumbMenu.querySelector('.git-email-field');
    send({
      command: 'setGitIdentity',
      id: vault.id,
      name: name ? name.value.trim() : '',
      email: email ? email.value.trim() : '',
    });
    // Redraw now rather than waiting to be told to. The panel refuses to rebuild while one of its own fields has focus -- the guard that saves a half-typed name -- and the press leaves focus in a field, so both the busy mark and the answer would be skipped and the note would sit there after a press that worked.
    showCrumbMenu(crumbMenuOwner, editVaultMenuItems(vault));
  };
  items.push({
    input: '',
    fieldClass: 'git-name-field',
    onEnter: setIdentity,
    placeholder: 'Your name',
  });
  items.push({
    input: '',
    fieldClass: 'git-email-field',
    onEnter: setIdentity,
    placeholder: 'you@example.com',
  });
  items.push({
    label: busy ? SYNC_WORKING : 'Set who I am',
    disabled: busy,
    keepOpen: true,
    run: setIdentity,
  });
}
// The two ways to get a repository onto GitHub. `gh` is one click because it already holds a token; without it the browser does the authenticated part and hands back a URL, which needs no token here at all.
function pushCreateRoutes(items, vault, state, busy) {
  if (state.tooling.gh) {
    items.push({
      label: busy ? SYNC_WORKING : 'Create a private repo',
      icon: SYNC_ICON_SVG,
      disabled: busy,
      keepOpen: true,
      run: () => send({ command: 'createVaultRepo', id: vault.id }),
    });
  }
  items.push({
    label: 'Create it on GitHub ↗',
    title: 'Opens GitHub with the name filled in. Copy the address it gives you and paste it below.',
    // The row's own words send the reader to a browser and back to the field below it, so the press must not take that field away.
    keepOpen: true,
    run: () => send({
      command: 'openExternal',
      url: `https://github.com/new?name=${encodeURIComponent(state.suggested)}&visibility=private`,
    }),
  });
  items.push({
    input: '',
    placeholder: 'Paste the repository address',
    commit: (url) => {
      if (url) send({ command: 'linkVaultRemote', id: vault.id, url });
    },
  });
}
// Where the repository stands, in one line. Zero counts are left out; "0 behind" is noise on a repository that is up to date.
function repoSummary(repo) {
  const parts = [repo.remote || 'A repository here, with nowhere to push'];
  if (repo.branch) parts.push(repo.branch);
  const waiting = [];
  if (repo.changed) waiting.push(`${repo.changed} changed`);
  if (repo.ahead) waiting.push(`${repo.ahead} to push`);
  if (repo.behind) waiting.push(`${repo.behind} to pull`);
  if (!waiting.length && repo.remote) waiting.push('up to date');
  return parts.join(' · ') + (waiting.length ? ' — ' + waiting.join(', ') : '');
}
// The host reports an outcome as a short tag it can build without a translator; the words are chosen here, where the rest of them live.
function syncOutcomeText(state) {
  const message = state.message;
  if (!message) return '';
  // A failure git's own words named a cause for arrives as a tag like any other outcome, and the words go here. Untagged is git's own line, handed over as it stands: a network that is down or a remote that has moved ahead has no button in this panel, and pointing at one would send you to press the wrong thing.
  if (state.error) {
    if (message === 'failed:signin') return 'GitHub refused the push because nothing is signed in. Sign in above, then Sync again.';
    if (message === 'failed:identity') return 'git had nothing to commit as, because it does not know who you are. Fill in your name and email above, press Set, then Sync again.';
    return message;
  }
  if (message === 'identity-set') return 'git knows who you are now.';
  if (message === 'created') return 'Created on GitHub and pushed.';
  if (message === 'linked') return 'Repository set. Choose Sync to send your files to it.';
  if (message === 'local-only') return 'This folder is a repository now. Make one on GitHub and paste its address.';
  if (message.startsWith('synced:')) {
    const committed = Number(message.split(':')[1] || 0);
    if (!committed) return 'Nothing to send.';
    // Naming the destination is most of the reassurance: it is the part nobody can check at a glance, and the part that is wrong when something is wrong.
    const remote = state.repo && state.repo.remote;
    return remote
      ? `Pushed ${committed} to ${remote}.`
      : `Pushed ${committed} changed.`;
  }
  return message;
}
// Redraw the panel in place when it is the one this state belongs to. Anything else and the state is filed for the next time it is opened.
function refreshVaultGitPanel(id) {
  if (!crumbMenuVault || crumbMenuVault.id !== id || crumbMenu.hidden) return;
  // Not while someone is typing in it. `gh auth status` reaches the network, so its answer arrives a beat after the panel opens -- right as a name or an address is being entered. Rebuilding then would destroy the field mid-word, and destroying a focused field fires its blur, committing the half-typed value. The state is already filed; redraw once the field is left.
  const active = document.activeElement;
  if (active && active.classList.contains('crumb-menu-input') && crumbMenu.contains(active)) return;
  showCrumbMenu(crumbMenuOwner, editVaultMenuItems(crumbMenuVault));
}
// A status answer only changes a row's glyph (box vs cloud). Rebuilding the whole menu for that tears down every row, so a click landing mid-rebuild hits a node already gone: the button that "only works sometimes". Swap just the glyph in place instead. Skipped while the settings panel owns the menu (crumbMenuVault set), which has no such rows.
function refreshSwitcherGlyphs() {
  if (crumbMenu.hidden || !crumbMenuOwner || !crumbMenuOwner.classList.contains('library-vault-switch') || crumbMenuVault) return;
  for (const item of crumbMenu.querySelectorAll('.crumb-menu-item[data-vault-id]')) {
    const id = Number(item.dataset.vaultId);
    setVaultGlyph(item, vaultGlyph(id === 0 ? !activeVaultId : id === activeVaultId, id));
  }
}
// The header's sync button: shown only when this vault has a remote and work that has not reached it -- uncommitted changes plus unpushed commits, both answerable from disk. Whether the *remote* has moved needs a fetch, and a reader that talks to GitHub on every save is doing something nobody asked for; behind-counts belong in the panel, where you have asked. Pushing a repository that is nearly up to date can be over in under a tenth of a second. A spinner that lives for one frame reads as a glitch, not as work, so the turn is held for long enough to be seen -- the growl is what actually reports the outcome, and it wants something to arrive after.
const SYNC_MIN_SPIN_MS = 700;
const SYNC_FADE_MS = 260;
let syncSpinUntil = 0;
let syncSpinTimer = 0;
let syncFadeTimer = 0;
// Held from the click until the host reports how it went. Without it the turn stops the moment anything else redraws the button -- a watcher tick mid-push is enough -- and a spinner that pauses reads as a failure, which is the one thing it must not say while the push is still running.
let syncInFlight = false;
function renderVaultSyncButton() {
  if (!librarySyncButton) return;
  const state = vaultGitByVault.get(activeVaultId);
  const repo = state && state.repo;
  const waiting = repo && repo.atRoot && repo.remote ? (repo.changed || 0) + (repo.ahead || 0) : 0;
  const held = Math.max(0, syncSpinUntil - performance.now());
  const spinning = syncInFlight || Boolean(state && state.busy) || held > 0;
  // The button owes the eye the rest of the turn even once the work is done, so come back and redraw when the hold runs out.
  if (syncSpinTimer) clearTimeout(syncSpinTimer);
  syncSpinTimer = held > 0 ? setTimeout(renderVaultSyncButton, held + 20) : 0;

  if (!activeVaultId || (!waiting && !spinning)) {
    // Gone, but not blinked out: it fades while still turning, so the last thing seen is the work finishing rather than the button vanishing mid-thought. A failure leaves `waiting` above zero, so this is only ever the happy way out -- after an error the button stays where it is, ready to go again.
    if (!librarySyncButton.hidden && !syncFadeTimer) {
      librarySyncButton.classList.add('is-leaving');
      syncFadeTimer = setTimeout(() => {
        syncFadeTimer = 0;
        librarySyncButton.hidden = true;
        librarySyncButton.classList.remove('is-leaving', 'is-busy');
      }, SYNC_FADE_MS);
    }
    return;
  }
  if (syncFadeTimer) {
    clearTimeout(syncFadeTimer);
    syncFadeTimer = 0;
  }
  librarySyncButton.classList.remove('is-leaving');
  librarySyncButton.hidden = false;
  librarySyncButton.disabled = spinning;
  librarySyncButton.classList.toggle('is-busy', spinning);
  const count = librarySyncButton.querySelector('.library-sync-count');
  if (count) count.textContent = spinning ? '' : String(waiting);
  const label = spinning
    ? SYNC_WORKING
    : `Sync ${waiting} to GitHub`;
  librarySyncButton.title = label;
  librarySyncButton.setAttribute('aria-label', label);
}
if (librarySyncButton) {
  librarySyncButton.addEventListener('click', () => {
    if (!activeVaultId) return;
    syncInFlight = true;
    syncSpinUntil = performance.now() + SYNC_MIN_SPIN_MS;
    renderVaultSyncButton();
    send({ command: 'syncVault', id: activeVaultId });
  });
}
// The header's own reading: the folder's state without what-is-installed, which is the expensive half. Merged into whatever the panel already knew. Where the active vault's repository stands. Called from both ways the page learns which vault is active, because they share no path: a switch arrives through `leafSetVaults`, but a cold launch reads `__leafVaults` off the window and never calls it. Hooked to the callback alone, this would only ever fire when you changed vaults.
function requestActiveVaultStatus() {
  renderVaultSyncButton();
  if (activeVaultId) send({ command: 'getVaultStatus', id: activeVaultId });
}
window.leafSetVaultStatus = (id, repo) => {
  if (typeof id !== 'number' || !repo) return;
  const previous = vaultGitByVault.get(id);
  // Only the folder's state. Saying `busy: false` here would end the spin from a watcher tick that happened to land mid-push, stuttering the turn -- a job is over when the job says so, not when a file moves.
  vaultGitByVault.set(id, Object.assign({}, previous || { id, tooling: {} }, { repo }));
  renderVaultSyncButton();
  renderLibraryVaultSwitch();
  refreshSwitcherGlyphs();
  refreshVaultGitPanel(id);
};
window.leafSetVaultGit = (state) => {
  if (!state || typeof state.id !== 'number') return;
  // A whole state with nothing running is the end of whatever was: this is the only thing that stops the turn.
  if (!state.busy) syncInFlight = false;
  vaultGitByVault.set(state.id, state);
  renderVaultSyncButton();
  refreshVaultGitPanel(state.id);
  // Anything the user pressed a button for says how it went, whether or not the panel is open -- the header's button can start a sync with the panel shut, and a failure there must not be silent. Reading the folder carries no message, so opening the panel does not growl at anyone.
  if (state.message) {
    leafToast(syncOutcomeText(state), state.error ? 'error' : 'ok');
  }
};
window.leafVaultGitBusy = (id) => {
  const state = vaultGitByVault.get(id);
  if (!state) return;
  // Keep everything known and only raise the flag, so the panel dims its buttons rather than emptying while the work runs.
  vaultGitByVault.set(id, Object.assign({}, state, { busy: true, message: null, error: false }));
  renderVaultSyncButton();
  refreshVaultGitPanel(id);
};
// Where each remote vault's copy stands, by vault id. Filed as it arrives, so opening the panel has nothing to wait on.
const vaultRemoteByVault = new Map();
window.leafSetVaultRemote = (state) => {
  if (!state || !state.id) return;
  vaultRemoteByVault.set(state.id, state);
  refreshVaultGitPanel(state.id);
};
// How long ago, in the words somebody would use. Minutes up to an hour, then hours, then days -- a timestamp is a thing to work out, and this line is read at a glance or not at all.
function sinceInWords(seconds) {
  const ago = Math.max(0, Math.floor(Date.now() / 1000) - Number(seconds || 0));
  if (ago < 90) return 'just now';
  const minutes = Math.round(ago / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
// Who a vault whose files live somewhere else is signed in as, and the way out. Drawn where the GitHub rows are drawn, in the same note-then-button shape, and drawn at all only for a vault that has somebody to be signed in as -- a folder on this machine has nobody, so it gets no row rather than one that cannot work. The host decides which those are; nothing here holds a list of kinds.
function vaultRemoteItems(vault) {
  if (!vault || (!vault.signsIn && !vault.account)) return [];
  const items = ['separator', { heading: 'Account' }];
  if (vault.account) {
    items.push({ note: `Signed in as ${vault.account}` });
    const copy = vaultRemoteByVault.get(vault.id);
    const busy = Boolean(copy && copy.busy);
    if (copy && copy.refreshedAt) items.push({ note: `Last refreshed ${sinceInWords(copy.refreshedAt)}` });
    // Being offline is a line and not a warning: the files were copied down, so it changes what is fresh rather than what you can read.
    if (copy && copy.offline) items.push({ note: 'Offline — reading the copy on this machine. It will catch up when the network comes back.' });
    if (copy && copy.resting) items.push({ note: 'Not asking for now, because the service kept refusing. Refresh to try again.' });
    items.push({
      label: busy ? 'Refreshing…' : 'Refresh',
      icon: SYNC_ICON_SVG,
      disabled: busy,
      keepOpen: true,
      run: () => send({ command: 'refreshVault', id: vault.id }),
    });
    if (copy && copy.message) items.push({ note: copy.message, danger: Boolean(copy.error) });
    items.push({
      label: 'Sign out',
      title: 'Forgets the sign-in. The copied files stay, and go on reading.',
      keepOpen: true,
      run: () => send({ command: 'signOutVault', id: vault.id }),
    });
  } else {
    items.push({ note: 'Not signed in, so this vault is not being kept up to date.' });
    items.push({
      label: 'Sign in ↗',
      title: 'Opens the service in your browser. Nothing is typed into Leaftext.',
      keepOpen: true,
      run: () => send({ command: 'signInVault', id: vault.id }),
    });
  }
  return items;
}
function editVaultMenuItems(vault) {
  return [
    {
      heading: `Editing ${vault.name || ''}`,
    },
    {
      // Commits on Enter or on leaving the field; Escape abandons it.
      input: vault.name || '',
      placeholder: 'Vault name',
      commit: (name) => {
        if (name && name !== vault.name) send({ command: 'renameVault', id: vault.id, name });
      },
    },
    {
      label: 'Change folder…',
      title: vault.rootPath || '',
      icon: FOLDER_ICON_SVG,
      run: () => send({ command: 'changeVaultFolder', id: vault.id }),
    },
    {
      label: 'Remove vault',
      title: 'Forgets the vault. The folder and its files are left alone.',
      icon: MENU_TRASH_SVG,
      danger: true,
      run: () => send({ command: 'removeVault', id: vault.id }),
    },
    ...vaultRemoteItems(vault),
    ...vaultGitItems(vault),
    'separator',
    {
      label: 'Back',
      icon: BACK_ARROW_SVG,
      // Redraws in place like the git rows: closing first clears crumbMenuOwner, and the redraw below is handed it.
      keepOpen: true,
      // Back to the list, so the panel is no longer up: clear the mark or a stale status answer would still think it is.
      run: () => {
        crumbMenuVault = null;
        showCrumbMenu(crumbMenuOwner, vaultMenuItems());
      },
    },
  ];
}
// Whether this vault has somewhere to push. A repository with no remote is a pile of commits on one disk, which is not what a cloud promises.
function vaultSyncs(id) {
  const state = id ? vaultGitByVault.get(id) : null;
  const repo = state && state.repo;
  return Boolean(repo && repo.atRoot && repo.remote);
}
// One spelling of a path, so two ways of writing the same folder compare equal: Windows takes either slash and does not care about case.
function samePathKey(path) {
  return String(path || '').split('\\').join('/').replace(/\/+$/, '').toLowerCase();
}
// Whether saving in this vault reaches a cloud because of where it sits: it is one of the sync clients' folders, or inside one. Saving there is Dropbox's business as much as ours, so the row says cloud.
function vaultIsInACloudFolder(id) {
  if (!id || !cloudFolders || !cloudFolders.length) return false;
  const vault = leafVaults.find((entry) => entry && entry.id === id);
  const path = samePathKey(vault && vault.rootPath);
  if (!path) return false;
  return cloudFolders.some((folder) => {
    const root = samePathKey(folder.path);
    return root && (path === root || path.startsWith(`${root}/`));
  });
}
// The mark a vault wears: a cloud when saving in it reaches somewhere else — a repository it pushes to, or a folder a sync client keeps — and a box when the files only live here. One cloud, not an open and a closed one -- open/closed says which vault you are standing in, and a cloud is about where the thing lives. The tick still marks the current row.
function vaultGlyph(current, id) {
  // The whole library has no folder and no vault behind it: it is this machine, drive roots and all.
  if (!id) return COMPUTER_ICON_SVG;
  if (vaultSyncs(id) || vaultIsInACloudFolder(id)) return CLOUD_ICON_SVG;
  return current ? PACKAGE_OPEN_ICON_SVG : PACKAGE_ICON_SVG;
}
// An icon is a masked span, not a drawing. Both callers looked for an `svg`, found none, and swapped nothing — which is why a vault on GitHub kept its box.
function setVaultGlyph(host, markup) {
  const glyph = host && host.querySelector('.lt-icon');
  if (glyph) glyph.outerHTML = markup;
}
// Ask what is on this machine. The host registers anything new as a vault and answers with the folders, which is what puts a cloud on their rows. Asked again when the switcher opens, so a client installed while the app is running is found without a restart.
function requestCloudFolders() {
  send({ command: 'getCloudFolders' });
}
// Cloning: paste an address, then pick where it lands. The folder picked is the parent — git makes the repository's own folder in it and removes it again if the clone fails, so a failure leaves nothing to tidy up.
function pushCloneRow(items) {
  if (!cloneRevealed) {
    items.push({
      label: 'Clone a repository…',
      title: 'Paste a git address; the clone becomes a vault',
      icon: SYNC_ICON_SVG,
      keepOpen: true,
      run: () => {
        cloneRevealed = true;
        showCrumbMenu(crumbMenuOwner, vaultMenuItems());
      },
    });
    return;
  }
  const startClone = () => {
    const field = crumbMenu.querySelector('.clone-url-field');
    const url = field ? field.value.trim() : '';
    cloneRevealed = false;
    if (url) send({ command: 'cloneVault', url });
    hideCrumbMenu();
  };
  const closePanel = () => {
    cloneRevealed = false;
    showCrumbMenu(crumbMenuOwner, vaultMenuItems());
  };
  items.push({ note: 'Paste the address, then choose the folder to clone into. Leaftext holds no sign-in of its own — your git already knows how to reach a private repository.' });
  items.push({
    input: '',
    fieldClass: 'clone-url-field',
    commitOnBlur: false,
    onEnter: startClone,
    onEscape: closePanel,
    placeholder: 'https://github.com/owner/repo.git',
  });
  items.push({
    buttons: [
      { label: 'Cancel', keepOpen: true, run: closePanel },
      { label: 'Clone', icon: MENU_CHECK_SVG, primary: true, keepOpen: true, run: startClone },
    ],
  });
}
window.leafSetCloudFolders = (folders) => {
  cloudFolders = Array.isArray(folders) ? folders : [];
  // The switcher's glyphs and the pane's own introduction both turn on this answer — the pane through renderLibrary, which the switcher's redraw is part of. A menu already open is left standing: its glyphs are swapped where they are rather than rebuilt under someone's cursor.
  renderLibrary();
  refreshSwitcherGlyphs();
};
// Ask about any vault we have not looked at yet. Bounded by the number of vaults and answered off the event loop, so opening the menu never waits on git.
function requestKnownVaultStatuses() {
  for (const vault of leafVaults) {
    if (!vaultGitByVault.has(vault.id)) send({ command: 'getVaultStatus', id: vault.id });
  }
}
// Picking an entry lands on its root — including the one already active, which is how the top of a deep trail stays one click away.
function switchVault(id) {
  if (id === activeVaultId) {
    setLibraryFolder('');
    return;
  }
  send({ command: 'setActiveVault', id });
}
// What the buttons on the trail do: a second click on the one that opened the menu closes it again. Only they toggle — a click *inside* the menu that swaps its contents (a row's edit button, or Back) calls showCrumbMenu directly, because closing there is exactly the bug of the button appearing to do nothing.
function toggleCrumbMenu(button, items) {
  if (!crumbMenu.hidden && crumbMenuOwner === button) {
    hideCrumbMenu();
    return;
  }
  showCrumbMenu(button, items);
}
function showCrumbMenu(button, items) {
  // Rebuilt in place when the menu swaps to another set of rows, so hiding (which drops the owner and pulls focus back to the crumb) is skipped.
  const reopening = crumbMenuOwner === button && !crumbMenu.hidden;
  if (!reopening) hideCrumbMenu();
  if (!items.length) return;
  crumbMenuOwner = button;
  crumbMenu.textContent = '';
  let firstFocusable = null;
  for (const entry of items) {
    if (entry === 'separator') {
      const separator = document.createElement('div');
      separator.className = 'context-menu-separator';
      separator.setAttribute('role', 'separator');
      crumbMenu.appendChild(separator);
      continue;
    }
    if (entry.heading) {
      const heading = document.createElement('div');
      heading.className = 'crumb-menu-heading';
      heading.textContent = entry.heading;
      crumbMenu.appendChild(heading);
      continue;
    }
    // A line of explanation rather than something to press: what the repository is, or what is stopping it. Not a disabled button, which would suggest there is a way to press it.
    if (entry.note) {
      const note = document.createElement('div');
      note.className = entry.danger ? 'crumb-menu-note is-danger' : 'crumb-menu-note';
      note.textContent = entry.note;
      crumbMenu.appendChild(note);
      continue;
    }
    if (entry.input !== undefined) {
      const field = document.createElement('input');
      field.type = 'text';
      field.className = 'crumb-menu-input';
      if (entry.fieldClass) field.classList.add(entry.fieldClass);
      field.value = entry.input;
      field.spellcheck = false;
      field.setAttribute('autocomplete', 'off');
      field.placeholder = entry.placeholder || '';
      field.setAttribute('aria-label', entry.placeholder || '');
      let settled = false;
      const commit = () => {
        if (settled || !entry.commit) return;
        settled = true;
        entry.commit(field.value.trim());
      };
      field.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          // A field with its own Save button (the repository address) hands Enter to that button's action, so nothing is saved until Save is pressed and nothing changes just because the field was left.
          if (entry.onEnter) entry.onEnter();
          else {
            commit();
            hideCrumbMenu();
          }
        } else if (event.key === 'Escape') {
          event.preventDefault();
          settled = true;
          if (entry.onEscape) entry.onEscape();
          else hideCrumbMenu();
        }
      });
      // Only commit-on-leave when the field *is* its own commit. An address field waits for Save, so wandering off it must not change the repository.
      if (entry.commit && entry.commitOnBlur !== false) field.addEventListener('blur', commit);
      crumbMenu.appendChild(field);
      firstFocusable = firstFocusable || field;
      continue;
    }
    // A row of buttons that sit side by side rather than stacked -- a Save next to its Cancel, where stacking them reads as two separate choices instead of the pair they are.
    if (entry.buttons) {
      const bar = document.createElement('div');
      bar.className = 'crumb-menu-actions';
      for (const button of entry.buttons) {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'context-menu-item crumb-menu-item crumb-menu-action'
          + (button.primary ? ' is-primary' : '');
        action.setAttribute('role', 'menuitem');
        action.innerHTML = `${button.icon || ''}<span class="crumb-menu-label"></span>`;
        action.querySelector('.crumb-menu-label').textContent = button.label;
        action.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          event.preventDefault();
          if (!button.keepOpen) hideCrumbMenu();
          button.run();
        });
        bar.appendChild(action);
        firstFocusable = firstFocusable || action;
      }
      crumbMenu.appendChild(bar);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'crumb-menu-row';
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'context-menu-item crumb-menu-item'
      + (entry.selected ? ' is-selected' : '')
      + (entry.danger ? ' is-danger' : '');
    item.setAttribute('role', 'menuitem');
    if (entry.title) item.title = entry.title;
    // The icon and the tick are ours; only the label is user text, so it goes in as text rather than markup.
    item.innerHTML = `${entry.icon || ''}<span class="crumb-menu-label"></span>${entry.selected ? MENU_CHECK_SVG : ''}`;
    item.querySelector('.crumb-menu-label').textContent = entry.label;
    if (entry.vaultId !== undefined) item.dataset.vaultId = String(entry.vaultId);
    if (entry.disabled) item.disabled = true;
    // Act on the press, not on the full click. A click only fires when press and release land on the same element, so a redraw slipping in between -- and this menu redraws itself whenever git answers, which is exactly while it is open -- swallows the click and the button does nothing. Pressing fires the instant the button is touched, before any redraw can replace it.
    item.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      // Most rows are a destination, so the menu gets out of the way. The git rows are work done in place -- closing the panel would take away the only thing that reports how it went.
      if (!entry.keepOpen) hideCrumbMenu();
      entry.run();
    });
    row.appendChild(item);
    if (entry.edit) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'crumb-menu-edit';
      edit.innerHTML = MENU_SETTINGS_SVG;
      const label = `Edit ${entry.label}`;
      edit.title = label;
      edit.setAttribute('aria-label', label);
      // Not a switch: this opens the panel for that row, and the press must not reach the row underneath it. On the press for the same reason as above.
      edit.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        event.preventDefault();
        entry.edit();
      });
      row.appendChild(edit);
    }
    crumbMenu.appendChild(row);
    firstFocusable = firstFocusable || item;
  }
  button.setAttribute('aria-expanded', 'true');
  // Under the crumb it belongs to, by 4px, and inside the window like every other floating thing.
  const anchor = button.getBoundingClientRect();
  leafPlaceFloating(crumbMenu, anchor.left, anchor.bottom + 4);
  // Only claim focus when the menu is first opened. An in-place redraw -- a swap to the settings panel, a git answer landing, a reveal -- leaves focus where it is, so nothing yanks the cursor out of a field mid-word or drags it into the name box unasked. Callers that want the cursor somewhere on a redraw (the change-repo reveal) place it themselves.
  if (firstFocusable && !reopening) leafFocusForKeyboard(firstFocusable);
}
// Close on a press outside the menu, matching how the rows act: the openers and the rows stop this from firing on their own press, so what reaches here is only ever a press somewhere else. On press (not click) so a redraw that just replaced the pressed row cannot leave a stray click to close what it opened.
window.addEventListener('pointerdown', (event) => {
  if (!crumbMenu.contains(event.target)) hideCrumbMenu();
});
// Leaving the window closes a list and never the settings panel: a list is a menu, one press from coming back, while the panel holds an address field and rows that send the reader to a browser to fetch what goes in it. crumbMenuVault is set for the panel and null for a list; Back, a press outside and Escape are the ways out.
window.addEventListener('blur', () => { if (!crumbMenuVault) hideCrumbMenu(); });
leafOnEscape(hideCrumbMenu);
// The band's width changes with a divider drag, a window resize, and the pane opening — all of which change how much of the path fits. One rAF-throttled refit covers every case.
let crumbFitFrame = 0;
function scheduleCrumbFit() {
  if (crumbFitFrame) return;
  crumbFitFrame = requestAnimationFrame(() => {
    crumbFitFrame = 0;
    fitLibraryCrumbs();
  });
}
// Every pane-width change calls scheduleCrumbFit itself (the divider drag and applyPaneLayout) — a ResizeObserver here is unreliable in the web view, which delivers its first observation and nothing after. Keep one anyway, on the band rather than the trail (the band's width comes from the pane, so a refit can't feed back into what it measures), for the widths nothing else announces: a zoom change, or a font arriving late and re-measuring every crumb.
if (typeof ResizeObserver !== 'undefined' && libraryCrumbTrail && libraryCrumbTrail.parentElement) {
  new ResizeObserver(scheduleCrumbFit).observe(libraryCrumbTrail.parentElement);
}
window.addEventListener('resize', scheduleCrumbFit);
// The switcher's own button, left of the trail. Its label names the root you are in, so hovering it says what changing would change.
function renderLibraryVaultSwitch() {
  if (!libraryVaultSwitch) return;
  // The button shows the vault you are in, so it wears that vault's mark. The caret leads and stays; the glyph after it is the one replaced, found by class rather than by position.
  setVaultGlyph(libraryVaultSwitch, vaultGlyph(true, activeVaultId));
  const label = `Switch vault (in ${libraryRootLabel()})`;
  libraryVaultSwitch.title = label;
  libraryVaultSwitch.setAttribute('aria-label', label);
}
function renderHomeVaultSwitch() {
  const homeVaultSwitch = app.querySelector('.home-vault-switch');
  if (!homeVaultSwitch) return;
  setVaultGlyph(homeVaultSwitch, vaultGlyph(true, activeVaultId));
  const label = `Switch vault (in ${libraryRootLabel()})`;
  homeVaultSwitch.title = label;
  homeVaultSwitch.setAttribute('aria-label', label);
}
function bindVaultSwitch(button, retire) {
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    if (retire) retireHint('libraryVault');
    // The list that opens has New vault… in it, so the introduction has said its piece whether or not a folder is picked from it.
    retireLibraryIntro();
    crumbMenuVault = null;
    toggleCrumbMenu(button, vaultMenuItems());
  });
}
if (libraryVaultSwitch) {
  // Nothing on screen says a caret and a mark is how you get somewhere else, so the first launch with the pane open points at it once. The words say what pressing it does, not what is behind it: the drives, the cloud folders and the word "vault" are all things to meet after the press. First registered, and so the first hint anybody meets.
  registerHint('libraryVault', () => libraryVaultSwitch, 'Pick which folder the list below shows.');
  // On the press, and stopping it there: the menu's own close-on-outside-press listens for the same event, so a click-based toggle here would let that listener close the menu on the way down and this reopen it on the way up.
  bindVaultSwitch(libraryVaultSwitch, true);
}
// Search reads the vault's text, so without a vault there is nothing for it to read. The field is hidden rather than left to return nothing — a box that looks like it works and does not is worse than no box.
function renderLibrarySearchability() {
  const searchable = Boolean(activeVaultId);
  libraryPane.dataset.searchable = String(searchable);
  if (!searchable && librarySearchQuery) {
    // Leaving a vault with a query up would strand its results on screen.
    librarySearch.value = '';
    runLibrarySearch('');
  }
}
// What the pane last drew, so a read that describes what is already on screen can leave it alone. Writing innerHTML destroys every row, and a row destroyed between a press and its release takes the click with it — the watcher re-reads this folder for any change under the vault, and most of those change nothing here.
let libraryTreeHtml = null;
// Draw the rows, and say whether anything actually moved.
function setLibraryTreeHtml(html) {
  if (html === libraryTreeHtml) return false;
  libraryTreeHtml = html;
  libraryTree.innerHTML = html;
  return true;
}
// How many files the folder holds that the app cannot open. Only this file writes it and only this file reads it, so it stays here rather than joining the shared state.
let librarySkippedFiles = 0;
// An empty pane with no reason for being empty reads as lost files. One skipped file needs its own wording, or it says "1 files".
function libraryEmptyText() {
  if (librarySkippedFiles === 1) {
    return 'Nothing to read in this folder. 1 file lives here, but it is not a kind Leaftext opens.';
  }
  if (librarySkippedFiles > 1) {
    return `Nothing to read in this folder. ${librarySkippedFiles} files live here, but none is a kind Leaftext opens.`;
  }
  return 'Nothing to read in this folder.';
}
// The name the introduction is retired under. It joins the bubbles' met list rather than growing a second record of what a reader has been shown, and registers no hint of its own: this is a box, not a bubble.
const VAULT_INTRO_HINT = 'vaultIntro';
// Four things have to be true. The vault button's own bubble has been met, so this is not the second thing said at once. The cloud folder answer has arrived — until it does, every vault looks like one nobody chose. Every vault there is sits inside one of those folders, which is the only way to tell one the reader made from one that registered itself, the store keeping no record of either. And this box has not been met already. Never in a browser: both hosts refuse the command behind its button.
function libraryIntroShows() {
  if (window.__leafSite || window.__leafEmbedded) return false;
  if (!hintIsMet('libraryVault') || hintIsMet(VAULT_INTRO_HINT)) return false;
  if (!cloudFolders) return false;
  return !leafVaults.some((vault) => vault && vault.id && !vaultIsInACloudFolder(vault.id));
}
function libraryIntroHtml() {
  if (!libraryIntroShows()) return '';
  return '<div class="library-intro"><b class="library-intro-title">A vault is one folder of notes.</b><p class="library-intro-text">Point Leaftext at yours and search reads all of it, the map draws how the notes link, and this pane lists it.</p><button type="button" class="library-intro-action">Add your notes folder</button></div>';
}
// Met, and never drawn again: a folder was picked, or the menu offering one was opened. The pane is redrawn here rather than left to the next read, because the box is standing on screen at the moment either happens.
function retireLibraryIntro() {
  if (hintIsMet(VAULT_INTRO_HINT)) return;
  retireHint(VAULT_INTRO_HINT);
  renderLibrary();
}
function renderLibrary() {
  renderLibraryVaultSwitch();
  renderLibrarySearchability();
  renderLibraryCrumbs(libraryChain);
  if (libraryError) {
    return setLibraryTreeHtml(`<p class="library-empty">${escapeText(libraryError.message || '')}</p>`);
  }
  // Still render the rows when the folder is empty: that is exactly where the way back out matters most.
  const empty = libraryEntries.length
    ? ''
    : `<p class="library-empty">${escapeText(libraryEmptyText())}</p>`;
  if (!setLibraryTreeHtml(libraryIntroHtml() + renderProject(libraryEntries) + empty)) return false;
  bindLibraryRows();
  return true;
}
// One folder, read off the disk by the host: where it is, the trail down to it, and its contents. This is the only thing that fills the pane.
window.leafSetLibraryFolder = (payload) => {
  const next = payload || {};
  libraryError = null;
  libraryProjectPath = typeof next.path === 'string' ? next.path : '';
  libraryChain = Array.isArray(next.chain) ? next.chain : [];
  libraryEntries = Array.isArray(next.entries) ? next.entries : [];
  libraryRootName = typeof next.rootName === 'string' ? next.rootName : '';
  // A host that never learned to count leaves the line exactly as it has always read.
  librarySkippedFiles = Number.isFinite(next.skippedFiles) ? next.skippedFiles : 0;
  // The trail changed, so it has to be laid out again.
  libraryCrumbFitKey = null;
  // A read that drew the same rows has nothing new to scroll to, and scrolling forces a layout.
  if (renderLibrary() && librarySelectedPath) scrollSelectedLibraryRowIntoView();
  // Search covers the folder on screen, so moving changes the result set.
  if (librarySearchQuery) runLibrarySearch(librarySearch.value);
};
// The vault registry, pushed by the host after a vault is added or switched to. The files for the new root arrive separately.
window.leafSetVaults = (payload) => {
  const next = payload || {};
  const previous = activeVaultId;
  leafVaults = Array.isArray(next.vaults) ? next.vaults : [];
  activeVaultId = Number.isFinite(next.active) ? next.active : 0;
  // Whichever vault is now current, find out where its repository stands. This is also how the button is right on the first paint: startup sends the vault list like everything else does, so there is no separate opening move.
  requestActiveVaultStatus();
  // And read the rest now too, in the background, so their marks are already known by the time the switcher is opened -- the menu then has nothing to wait on and nothing to redraw under a click.
  requestKnownVaultStatuses();
  if (activeVaultId !== previous) {
    // A new root: the folder the list was in belonged to the old one, and its files are about to be replaced.
    libraryProjectPath = '';
    libraryEntries = [];
    libraryChain = [];
    libraryError = null;
    persistLibraryState();
    // A different root means a different graph, so whatever is drawn is about somewhere else now. It does not mean *no* graph: leaving a vault must not throw the reader out of the map, so the open document answers for it.
    refreshGraphForScope();
  }
  // The leftmost crumb reads the root's name, so the trail lays out again.
  libraryCrumbFitKey = null;
  renderLibrary();
  // The start screen's favorites are the vault you are in, so a registry that moved leaves them saying the vault you left. Any push means a change worth redrawing: switching, adding, renaming, repointing or removing all end here.
  if (homeScreenIsShowing()) {
    if (crumbMenuOwner && crumbMenuOwner.classList.contains('home-vault-switch')) hideCrumbMenu();
    renderState();
  }
  renderHomeVaultSwitch();
  // A vault's own panel is drawn off its row, so a row that just moved -- signing out is the one that does -- leaves the panel saying what was true before it.
  if (crumbMenuVault) {
    const fresh = leafVaults.find((entry) => entry && entry.id === crumbMenuVault.id);
    if (fresh) {
      crumbMenuVault = fresh;
      if (!crumbMenu.hidden) showCrumbMenu(crumbMenuOwner, editVaultMenuItems(fresh));
    }
  }
};
