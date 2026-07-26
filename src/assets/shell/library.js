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
// Slide the narrow-window sheet away. A no-op when there is no sheet up, so
// callers don't have to check which layout they are in.
function closeLibrarySheet() {
  if (!librarySheetOpen) return;
  librarySheetOpen = false;
  applyPaneLayout();
}
function applyPaneLayout() {
  const closed = libraryIsClosed();
  // Too narrow for a pane beside the page, so the library becomes a sheet over
  // it. Grid-wise it stays closed — the sheet is out of flow — and widening the
  // window drops it, since a pane that fits should never be an overlay.
  const narrow = libraryTooNarrow();
  if (!narrow) librarySheetOpen = false;
  libraryShell.classList.toggle('library-narrow', narrow);
  libraryShell.classList.toggle('library-overlay', narrow && librarySheetOpen);
  libraryOpen.setAttribute('aria-expanded', narrow && librarySheetOpen ? 'true' : 'false');
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
// → closed. On a too-narrow window it slides the sheet in and out instead —
// a transient view state, so nothing about it is persisted.
function toggleLibrary() {
  if (libraryTooNarrow()) {
    librarySheetOpen = !librarySheetOpen;
    applyPaneLayout();
    return;
  }
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
  return stripDocumentExt(node && node.name) || (node && (node.title || node.path)) || '';
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
    button.addEventListener('click', () => {
      send({ command: 'openRecent', path: button.dataset.openPath });
      // Picking a document is the sheet's whole purpose, so it gets out of the
      // way — the page it just opened is behind it.
      closeLibrarySheet();
    });
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

