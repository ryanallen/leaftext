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
// The folder holding `filePath`, or '' when it has no parent worth showing.
// A string operation, because that is all it takes — the old version walked a
// whole in-memory tree to answer the same question.
function parentFolderOf(filePath) {
  const cut = Math.max((filePath || '').lastIndexOf('/'), (filePath || '').lastIndexOf('\\'));
  return cut > 0 ? filePath.slice(0, cut) : '';
}
function scrollSelectedLibraryRowIntoView() {
  const row = libraryTree.querySelector('.library-file.is-selected');
  // Centered so a deeply nested file lands away from the app bar and bottom edge.
  if (row) row.scrollIntoView({ block: 'center' });
}
// Carry out a pending reveal: move the pane into the open document's folder so
// its row is on screen. Already there means nothing to load — just re-render for
// the highlight.
function revealSelectedInLibrary() {
  if (!libraryRevealPending || !librarySelectedPath) return false;
  libraryRevealPending = false;
  const folder = parentFolderOf(librarySelectedPath);
  if (folder && folder !== libraryProjectPath) {
    setLibraryFolder(folder);
    return true;
  }
  renderLibrary();
  scrollSelectedLibraryRowIntoView();
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
// A Markdown file row: the leaf mark, then the file name, truncated.
function fileRowHtml(node) {
  const label = fileDisplayName(node);
  const isSelected = librarySelectedPath && node.path === librarySelectedPath;
  const selected = isSelected ? ' is-selected' : '';
  const current = isSelected ? ' aria-current="true"' : '';
  return `<button type="button" class="library-file${selected}"${current} data-open-path="${escapeAttr(node.path)}" data-reveal-path="${escapeAttr(node.path)}" title="${escapeAttr(node.path)}">${LEAF_FILE_ICON}<span class="library-file-label">${escapeText(label)}</span></button>`;
}
// The rows for the folder we're inside — already ordered by the host, folders
// first. Walking back out is the breadcrumb's job, so no "up" row here.
function renderProject(entries) {
  const rows = [];
  for (const node of entries || []) {
    if (node.kind === 'folder') {
      rows.push(`<button type="button" class="library-nav-folder" data-nav-into="${escapeAttr(node.path)}" title="${escapeAttr(node.name)}">${FOLDER_ICON_SVG}<span class="library-file-label">${escapeText(node.name)}</span><span class="library-nav-chevron" aria-hidden="true">›</span></button>`);
    } else {
      rows.push(fileRowHtml(node));
    }
  }
  return `<div class="library-project">${rows.join('')}</div>`;
}
// Enter a folder (or, from a crumb, step back out to one). '' is the top: the
// active vault's folder, or the drive roots. The host reads it and calls back —
// nothing is known about a folder here until it has been opened.
function setLibraryFolder(path) {
  libraryProjectPath = path || '';
  persistLibraryState();
  send({ command: 'getFolder', path: libraryProjectPath });
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
// The leftmost crumb keeps its place at the head of the trail; what changed is
// what it does. It is already the top — the whole library, or the vault you are
// in — so there is nothing above it to walk to, and clicking it opens the
// switcher instead.
function crumbSegments(chain) {
  return [{ path: '', name: libraryRootLabel(), switcher: true }]
    .concat(chain.map((node) => ({ path: node.path, name: node.name || node.path })));
}
// The chain the trail is currently drawing, kept so a resize can refit without
// re-walking the tree.
let libraryCrumbChain = [];
const CRUMB_SEP_HTML = '<span class="library-crumb-sep" aria-hidden="true">›</span>';
function crumbHtml(segment, current) {
  if (segment.switcher) {
    const label = escapeAttr(window.leafLocale.t('library.vaults.switch', { name: segment.name }));
    // At the root this crumb is also where you are, but it stays a button: its
    // job is the menu, not navigation.
    const here = current ? ' is-current' : '';
    const marker = current ? ' aria-current="true"' : '';
    return `<button type="button" class="library-crumb library-crumb-switcher${here}"${marker} data-crumb-switcher="1" title="${label}" aria-label="${label}" aria-haspopup="menu" aria-expanded="false"><span class="library-crumb-name">${escapeText(segment.name)}</span><span class="library-crumb-caret" aria-hidden="true">▾</span></button>`;
  }
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
  bindCrumbTrailButtons(hidden);
}
// The trail's folder links and its two menu buttons, wired after any rebuild.
function bindCrumbTrailButtons(hidden) {
  libraryCrumbTrail.querySelectorAll('[data-crumb-path]').forEach((crumb) => {
    crumb.addEventListener('click', () => setLibraryFolder(crumb.dataset.crumbPath));
  });
  const switcher = libraryCrumbTrail.querySelector('[data-crumb-switcher]');
  if (switcher) {
    switcher.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleCrumbMenu(switcher, vaultMenuItems());
    });
  }
  const more = libraryCrumbTrail.querySelector('[data-crumb-more]');
  if (more) {
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleCrumbMenu(more, folderMenuItems(hidden));
    });
  }
}
function renderLibraryCrumbs(chain) {
  if (!libraryCrumbTrail) return;
  if (libraryView === 'graph') {
    hideCrumbMenu();
    // The graph has no folder path, but the switcher stays put: it is where you
    // change vaults, and losing it here would strand you in one.
    const root = crumbSegments([])[0];
    libraryCrumbTrail.innerHTML = crumbHtml(root, false) + CRUMB_SEP_HTML
      + `<span class="library-crumb is-current">${escapeText(window.leafLocale.t('library.view.graph'))}</span>`;
    bindCrumbTrailButtons([]);
    // The graph took the band over; the next file-list render starts from scratch.
    libraryCrumbFitKey = null;
    return;
  }
  libraryCrumbChain = chain;
  fitLibraryCrumbs();
}
// One menu for the two buttons on the trail: the folders the "…" swallowed, and
// the vault switcher under the leftmost crumb. Same chrome as the file
// right-click menu.
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
// The folders the "…" stands in for; picking one enters it.
function folderMenuItems(hidden) {
  return hidden.map((segment) => ({
    label: segment.name,
    title: segment.path || segment.name,
    icon: FOLDER_ICON_SVG,
    run: () => setLibraryFolder(segment.path),
  }));
}
// The switcher's rows: the whole library as it has always been, then every
// vault, then New vault…. The rows are told apart by id, so two vaults may share
// a name — and "Library" is that first row's label, not a reserved word.
function vaultMenuItems() {
  const items = [{
    label: window.leafLocale.t('library.title'),
    title: window.leafLocale.t('library.vaults.all'),
    icon: FOLDER_ICON_SVG,
    selected: !activeVaultId,
    run: () => switchVault(0),
  }];
  for (const vault of leafVaults) {
    if (!vault || !vault.id) continue;
    items.push({
      label: vault.name || vault.rootPath,
      title: vault.rootPath || '',
      icon: FOLDER_ICON_SVG,
      selected: vault.id === activeVaultId,
      run: () => switchVault(vault.id),
      // The row's own button: everything you can do to this vault, in one
      // place. Visible, because a menu you have to right-click is a menu
      // nobody finds.
      edit: () => showCrumbMenu(crumbMenuOwner, editVaultMenuItems(vault)),
    });
  }
  items.push('separator');
  items.push({
    label: window.leafLocale.t('library.vaults.new'),
    title: window.leafLocale.t('library.vaults.new.help'),
    icon: MENU_PLUS_SVG,
    run: () => send({ command: 'createVault' }),
  });
  return items;
}
// One vault's edit panel, shown in place of the switcher's list: its name, the
// folder it points at, and the way to forget it. Reached from the row's button.
function editVaultMenuItems(vault) {
  return [
    {
      heading: window.leafLocale.t('library.vaults.editing', { name: vault.name || '' }),
    },
    {
      // Commits on Enter or on leaving the field; Escape abandons it.
      input: vault.name || '',
      placeholder: window.leafLocale.t('library.vaults.name'),
      commit: (name) => {
        if (name && name !== vault.name) send({ command: 'renameVault', id: vault.id, name });
      },
    },
    {
      label: window.leafLocale.t('library.vaults.changeFolder'),
      title: vault.rootPath || '',
      icon: FOLDER_ICON_SVG,
      run: () => send({ command: 'changeVaultFolder', id: vault.id }),
    },
    {
      label: window.leafLocale.t('library.vaults.remove'),
      title: window.leafLocale.t('library.vaults.remove.help'),
      icon: MENU_TRASH_SVG,
      danger: true,
      run: () => send({ command: 'removeVault', id: vault.id }),
    },
    'separator',
    {
      label: window.leafLocale.t('library.vaults.back'),
      icon: MENU_BACK_SVG,
      run: () => showCrumbMenu(crumbMenuOwner, vaultMenuItems()),
    },
  ];
}
// Picking an entry lands on its root — including the one already active, which
// is how the top of a deep trail stays one click away.
function switchVault(id) {
  if (id === activeVaultId) {
    setLibraryFolder('');
    return;
  }
  send({ command: 'setActiveVault', id });
}
// What the buttons on the trail do: a second click on the one that opened the
// menu closes it again. Only they toggle — a click *inside* the menu that swaps
// its contents (a row's edit button, or Back) calls showCrumbMenu directly,
// because closing there is exactly the bug of the button appearing to do nothing.
function toggleCrumbMenu(button, items) {
  if (!crumbMenu.hidden && crumbMenuOwner === button) {
    hideCrumbMenu();
    return;
  }
  showCrumbMenu(button, items);
}
function showCrumbMenu(button, items) {
  // Rebuilt in place when the menu swaps to another set of rows, so hiding
  // (which drops the owner and pulls focus back to the crumb) is skipped.
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
    if (entry.input !== undefined) {
      const field = document.createElement('input');
      field.type = 'text';
      field.className = 'crumb-menu-input';
      field.value = entry.input;
      field.spellcheck = false;
      field.setAttribute('autocomplete', 'off');
      field.placeholder = entry.placeholder || '';
      field.setAttribute('aria-label', entry.placeholder || '');
      let settled = false;
      const commit = () => {
        if (settled) return;
        settled = true;
        entry.commit(field.value.trim());
      };
      field.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          hideCrumbMenu();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          settled = true;
          hideCrumbMenu();
        }
      });
      field.addEventListener('blur', commit);
      crumbMenu.appendChild(field);
      firstFocusable = firstFocusable || field;
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
    // The icon and the tick are ours; only the label is user text, so it goes in
    // as text rather than markup.
    item.innerHTML = `${entry.icon || ''}<span class="crumb-menu-label"></span>${entry.selected ? MENU_CHECK_SVG : ''}`;
    item.querySelector('.crumb-menu-label').textContent = entry.label;
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      hideCrumbMenu();
      entry.run();
    });
    row.appendChild(item);
    if (entry.edit) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'crumb-menu-edit';
      edit.innerHTML = MENU_EDIT_SVG;
      const label = window.leafLocale.t('library.vaults.edit', { name: entry.label });
      edit.title = label;
      edit.setAttribute('aria-label', label);
      // Not a switch: this opens the panel for that row, and the click must not
      // reach the row underneath it.
      edit.addEventListener('click', (event) => {
        event.stopPropagation();
        entry.edit();
      });
      row.appendChild(edit);
    }
    crumbMenu.appendChild(row);
    firstFocusable = firstFocusable || item;
  }
  button.setAttribute('aria-expanded', 'true');
  crumbMenu.hidden = false;
  const anchor = button.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - crumbMenu.offsetWidth - 8));
  const top = Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - crumbMenu.offsetHeight - 8));
  crumbMenu.style.left = left + 'px';
  crumbMenu.style.top = top + 'px';
  if (firstFocusable) firstFocusable.focus();
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
  renderLibraryGraphToggle();
  renderLibraryCrumbs(libraryChain);
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
  if (!libraryEntries.length) {
    libraryTree.innerHTML = `<p class="library-empty">${escapeText(window.leafLocale.t('library.folderEmpty'))}</p>`;
    return;
  }
  libraryTree.innerHTML = renderProject(libraryEntries);
  bindLibraryRows();
}
// One folder, read off the disk by the host: where it is, the trail down to it,
// and its contents. This is the only thing that fills the pane.
window.leafSetLibraryFolder = (payload) => {
  const next = payload || {};
  libraryError = null;
  libraryProjectPath = typeof next.path === 'string' ? next.path : '';
  libraryChain = Array.isArray(next.chain) ? next.chain : [];
  libraryEntries = Array.isArray(next.entries) ? next.entries : [];
  // The trail changed, so it has to be laid out again.
  libraryCrumbFitKey = null;
  // Without a vault the graph's root is this folder, so moving re-roots it.
  if (!activeVaultId) refreshGraphForScope();
  renderLibrary();
  if (librarySelectedPath) scrollSelectedLibraryRowIntoView();
  // Search covers the folder on screen, so moving changes the result set.
  if (librarySearchQuery) runLibrarySearch(librarySearch.value);
};
// What is left of the indexer's channel to the pane: its scan progress, and its
// errors. The files are not its business any more — they are read off the disk.
window.leafSetLibraryState = (state) => {
  const next = state || {};
  if (next.error) {
    libraryError = next.error;
    renderLibrary();
    return;
  }
  if (next.progress) {
    applyScanProgress(next.progress);
  }
  // The indexer just came online. If the graph view is open but has no data yet
  // — e.g. the app launched straight into it before the reader thread was ready
  // and the first request was dropped — ask again.
  if (libraryView === 'graph' && !graphData) {
    graphRequested = false;
    showGraph();
  }
};
window.leafSetScanProgress = (progress) => {
  applyScanProgress(progress);
};
// The vault registry, pushed by the host after a vault is added or switched to.
// The files for the new root arrive separately.
window.leafSetVaults = (payload) => {
  const next = payload || {};
  const previous = activeVaultId;
  leafVaults = Array.isArray(next.vaults) ? next.vaults : [];
  activeVaultId = Number.isFinite(next.active) ? next.active : 0;
  if (activeVaultId !== previous) {
    // A new root: the folder the list was in belonged to the old one, and its
    // files are about to be replaced.
    libraryProjectPath = '';
    libraryEntries = [];
    libraryChain = [];
    libraryError = null;
    persistLibraryState();
    // A different root means a different graph.
    refreshGraphForScope();
  }
  // The leftmost crumb reads the root's name, so the trail lays out again.
  libraryCrumbFitKey = null;
  renderLibrary();
};

