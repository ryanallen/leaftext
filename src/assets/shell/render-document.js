// Which document was rendered last, so the fade below runs when the document
// changes and not when an inline edit commits. Only this fragment reads it, which is
// why it is not in state.js. `var` and not `let`: theme.js runs renderState() as it
// loads, which reaches the home-screen branch that clears this — and a `let` is in
// its dead zone until the line declaring it runs, so even the write would throw.
var lastRenderedDocumentPath = null;
// How many rows a start-screen list shows once the columns have folded. Five keeps the headline, both lists and both buttons on one screen, and the rest is one press away in the sheet. `var` for the reason above: the first render happens before this fragment has run, and it reads this.
var HOME_FOLDED_ROWS = 5;
// The fourth bottom sheet, and its own state. `var` for the same reason again.
var homeSheet = document.getElementById('homeSheet');
var homeSheetBackdrop = document.getElementById('homeSheetBackdrop');
var homeSheetBody = document.getElementById('homeSheetBody');
var homeSheetTitle = document.getElementById('homeSheetTitle');
var homeSheetClose = document.getElementById('homeSheetClose');
var homeSheetShowing = null;
var homeSheetLastFocus = null;
// How long a dropped favorite stays on screen before it really goes. The host is
// told at once, so nothing is riding on this timer but the chance to change your
// mind — and a row you can still see is a row you can still press.
var HOME_UNDO_MS = 30000;
// Kept paths that have been dropped and are still drawn: path to its timer. Read
// through `homeIsDropping` — theme.js runs the first render before this line does,
// and a `var` is undefined until then.
var homeDropping = new Map();
function homeIsDropping(path) {
  return !!homeDropping && homeDropping.has(String(path));
}
// The class comes off again so a document at rest carries no animation. Guarded on
// the target: animation events bubble, and a rendered document animates things of
// its own — a table's edge bands finishing their scroll strip the fade off the page
// mid-way without it. A render that supersedes an unfinished one needs no undoing;
// the innerHTML below throws the whole layout away, listener included.
function fadeDocumentIn(layout) {
  layout.classList.add('is-arriving');
  const settled = (event) => {
    if (event.target !== layout) return;
    layout.removeEventListener('animationend', settled);
    layout.classList.remove('is-arriving');
  };
  layout.addEventListener('animationend', settled);
}
// The header's plus, for the home screen's New document button. A function, not
// a const: theme.js runs renderState() as it loads, long before this fragment.
function newIconSvg() {
  return `<span class="lt-icon lt-icon-new"></span>`;
}
// Split a path into what a row shows: the file's name without its extension, and
// the folder holding it. A path that is only a name has no folder line.
function homeRowParts(path) {
  const raw = String(path == null ? '' : path);
  const base = raw.split(/[\\/]/).pop() || raw;
  const above = raw.slice(0, raw.length - base.length);
  // A trailing separator belongs to the split, not the folder — unless it is the
  // whole of it, which is a file sitting at a root.
  const folder = above.replace(/[\\/]+$/, '') || above;
  return { name: stripDocumentExt(base) || base, folder };
}
// One row for either home list, so both draw the same thing. The row carries the
// path twice: `data-path` opens it and `data-reveal-path` is what the right-click
// menu finds a start-screen row by. `kind` is a kept path's own — a recent is always
// a document, so it wears no heart and passes none.
//
// A kept row is a wrapper holding two buttons rather than one button holding a
// button, which is not markup: the same shape a tab already uses for its own heart.
function homeRowMarkup(path, kind) {
  const { name, folder } = homeRowParts(path);
  const attr = escapeAttr(String(path == null ? '' : path));
  const under = folder ? `<span class="home-row-folder">${escapeText(folder)}</span>` : '';
  // The menu reads this attribute to tell a folder's items from a file's, and the
  // click below reads it to open the pane rather than a document.
  const folderAttr = kind === 'folder' ? ` data-folder-path="${attr}"` : '';
  // The heart the tab strip already wears, and it does the same job: the column is
  // called Favorites, so what the mark owes is that the row is kept — and pressing
  // it is how a row leaves without opening the file you were trying not to open.
  const going = kind ? homeIsDropping(path) : false;
  const mark = going ? 'Keep this one after all' : 'Unfavorite';
  // A row on its way out says so where it usually says its path: what is about to
  // happen matters more than where the file is, and the sentence names the way back.
  const said = going ? 'Dropped. This goes in a moment — press the heart to keep it.' : `Open ${attr}`;
  const open = `<button type="button" class="home-row-open" title="${going ? escapeAttr(said) : said}" data-path="${attr}"><span class="home-row-name">${escapeText(name)}</span>${under}</button>`;
  const heart = kind
    ? `<button type="button" class="home-row-heart" data-home-unfavorite="${attr}" data-home-kind="${escapeAttr(kind)}" aria-label="${mark}" title="${going ? escapeAttr(said) : mark}"><span class="lt-icon lt-icon-favorite-${going ? 'off' : 'on'}"></span></button>`
    : '';
  return `<span class="home-row${going ? ' is-going' : ''}" data-reveal-path="${attr}"${folderAttr}>${heart}${open}</span>`;
}
// The kept paths, split by the vault each was marked inside. In a vault that is
// the one you are in and nothing else; outside every vault it is all of them at
// once, since there is no current one to prefer.
function homeFavoriteGroups(favorites) {
  if (activeVaultId) {
    const mine = favorites.filter((favorite) => favorite && favorite.vaultId === activeVaultId);
    return mine.length ? [{ name: libraryRootLabel(), entries: mine }] : [];
  }
  const groups = [];
  const byVault = new Map();
  for (const favorite of favorites) {
    if (!favorite) continue;
    const id = favorite.vaultId == null ? null : favorite.vaultId;
    if (!byVault.has(id)) {
      const vault = id == null ? null : leafVaults.find((one) => one && one.id === id);
      // A file on the desktop belongs to no vault and is still a file you kept.
      const group = { name: vault ? vault.name : 'Outside a vault', entries: [] };
      byVault.set(id, group);
      groups.push(group);
    }
    byVault.get(id).entries.push(favorite);
  }
  return groups;
}
// The kept list as the screen draws it: what the store holds, plus every row that
// has been dropped and is still on its way out, back where it was.
function homeFavoritesDrawn(favorites) {
  if (!homeDropping || !homeDropping.size) return favorites;
  const drawn = favorites.slice();
  for (const dropped of homeDropping.values()) {
    drawn.splice(Math.min(dropped.at, drawn.length), 0, dropped.favorite);
  }
  return drawn;
}
// What one start-screen list is, said once: its name, how many it holds, how many it
// draws, its rows, and the line to draw instead when it has none. The column and the
// sheet both build from this, so a list is never a second list to learn.
function homeList(which, state) {
  if (which === 'favorites') {
    const groups = homeFavoriteGroups(homeFavoritesDrawn(state.favorites || []));
    // A label is only ever there to tell one group from another, so a single group
    // carries none.
    const labeled = groups.length > 1;
    return {
      title: 'Favorites',
      // What the list will be, not what is on screen: a row on its way out is not
      // one of them any more, and the count must not jump back down when it goes.
      count: groups.reduce(
        (sum, group) => sum + group.entries.filter((favorite) => !homeIsDropping(favorite.path)).length,
        0,
      ),
      drawn: groups.reduce((sum, group) => sum + group.entries.length, 0),
      rows: groups
        .map(
          (group) =>
            (labeled ? `<li class="home-list-group">${escapeText(group.name)}</li>` : '') +
            group.entries.map((favorite) => `<li>${homeRowMarkup(favorite.path, favorite.kind)}</li>`).join(''),
        )
        .join(''),
    };
  }
  const recent = state.recent || [];
  return {
    title: 'Recent',
    count: recent.length,
    drawn: recent.length,
    rows: recent.map((path) => `<li>${homeRowMarkup(path)}</li>`).join(''),
    help: 'Files you open show up here, so you can pick up where you left off.',
  };
}
// The rows in a scroll box under a soft edge. The same box in the column and in the
// sheet — same bar, same fades — so what is read in one is what was read in the other.
function homeListBox(rows) {
  return `<div class="home-list-box"><div class="home-list-scroll leaf-scroll"><ol>${rows}</ol></div><div class="home-list-fade" aria-hidden="true"></div></div>`;
}
// How long the bar stays up after the list stops moving.
var HOME_SCROLL_REST_MS = 700;
// The bar and the soft edges both answer the scroll rather than the pointer: the bar
// is up while the list is moving and gone shortly after, and an edge is drawn only
// where there really is more list past it.
function watchHomeList(box) {
  const scroll = box.querySelector('.home-list-scroll');
  if (!scroll) return;
  let resting = 0;
  const edges = () => {
    box.classList.toggle('has-above', scroll.scrollTop > 1);
    box.classList.toggle('has-below', scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 1);
  };
  scroll.addEventListener('scroll', () => {
    box.classList.add('is-scrolling');
    clearTimeout(resting);
    resting = setTimeout(() => box.classList.remove('is-scrolling'), HOME_SCROLL_REST_MS);
    edges();
  });
  edges();
}
function watchHomeLists(root) {
  root.querySelectorAll('.home-list-box').forEach(watchHomeList);
}
// One column: a heading carrying its count, then the box — or, with nothing in it, a
// line saying what would put something there. The Show all button is drawn whenever
// the list is longer than the folded layout can hold; the stylesheet hides it wide,
// where the box scrolls instead. Only ever a column of a pair: with nothing kept the
// screen is the plain list above instead.
function homeColumnMarkup(which, state) {
  const list = homeList(which, state);
  const heading = list.count ? `${escapeText(list.title)} (${escapeText(formatCount(list.count))})` : escapeText(list.title);
  // Empty is nothing left to draw, which is not the same as a count of none: the
  // last kept row can be on its way out and still be on screen, and still pressable.
  if (!list.drawn) {
    return `<section class="home-list"><h2>${heading}</h2><p class="empty-help">${escapeText(list.help || '')}</p></section>`;
  }
  const showAll =
    list.drawn > HOME_FOLDED_ROWS
      ? `<button type="button" class="home-showall" data-home-list="${escapeAttr(which)}">Show all ${escapeText(formatCount(list.drawn))}</button>`
      : '';
  return `<section class="home-list"><h2>${heading}</h2>${homeListBox(list.rows)}${showAll}</section>`;
}
// Both lists, side by side. Neither asks the host for anything: recents and kept
// paths already ride the payload every render reads.
//
// With nothing kept there is no second column at all: a box saying how to keep a file
// is an advertisement on the screen somebody sees most, and the heart is on every tab
// under the pointer. And one list is not half a pair — it is the plain Recent list
// this screen carried before there was a pair, whole paths on one line each, in the
// writing's own column under a rule.
function homeListsMarkup(state) {
  if (!homeList('favorites', state).drawn) {
    const recent = state.recent || [];
    return recent.length
      ? `<div class="recent"><h2>Recent (${escapeText(formatCount(recent.length))})</h2><ol>${recent.map((path) => `<li><button type="button" title="Open ${escapeAttr(path)}" data-path="${escapeAttr(path)}" data-reveal-path="${escapeAttr(path)}">${escapeText(path)}</button></li>`).join('')}</ol></div>`
      : `<p class="empty-help">Files you open show up here, so you can pick up where you left off.</p>`;
  }
  return `<div class="home-list-grid">${homeColumnMarkup('recent', state)}${homeColumnMarkup('favorites', state)}</div>`;
}
// A kept folder is not a document: it opens the library pane at that folder, which
// is the one place a folder can be looked at.
function openHomeFolder(path) {
  if (libraryIsClosed()) toggleLibrary();
  setLibraryFolder(path);
}
// Every row in a home list, wherever it is drawn. Rebound on each render because the
// screen is rebuilt whole, and again for the sheet's own copy of the same rows.
function bindHomeRows(root) {
  root.querySelectorAll('[data-path]').forEach((button) => {
    button.addEventListener('click', () => {
      closeHomeSheet();
      // The folder mark is on the row, not on the button inside it.
      const row = button.closest('.home-row');
      if (row && row.hasAttribute('data-folder-path')) {
        openHomeFolder(button.dataset.path);
        return;
      }
      send({ command: 'openRecent', path: button.dataset.path });
    });
  });
  root.querySelectorAll('[data-home-unfavorite]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      pressHomeHeart(button.dataset.homeUnfavorite, button.dataset.homeKind);
    });
  });
}
// The heart on a kept row. Pressing it drops the file at once — the host is told,
// and a crash between here and the wait ending must not put it back — but the row
// stays on screen, dimmed, so the press can be taken back. Pressing it again inside
// the wait re-marks the file and puts the row back the way it was.
function pressHomeHeart(path, kind) {
  const key = String(path || '');
  if (!key) return;
  const dropped = homeDropping.get(key);
  if (dropped) {
    clearTimeout(dropped.timer);
    homeDropping.delete(key);
    // Flips the page's own copy and redraws before the host answers, exactly as the
    // tab's heart does — so the row fills back in under the pointer.
    toggleFavorite(key, kind);
    renderState();
    return;
  }
  const kept = currentFavorites();
  const at = kept.findIndex((favorite) => favorite && favorite.path === key);
  if (at < 0) return;
  homeDropping.set(key, {
    at,
    favorite: kept[at],
    timer: setTimeout(() => endHomeDrop(key), HOME_UNDO_MS),
  });
  toggleFavorite(key, kind);
  renderState();
}
// The wait is over. The row dissolves and the ones under it close the gap, and only
// then does it leave the markup — a row that vanished on the frame the timer fired
// would take the rows below up with it in one jump.
function endHomeDrop(key) {
  const dropped = homeDropping.get(key);
  if (!dropped) return;
  homeDropping.delete(key);
  const going = app.querySelectorAll('.home-row.is-going');
  let leaving = null;
  going.forEach((row) => {
    if (row.getAttribute('data-reveal-path') === key) leaving = row;
  });
  const li = leaving && leaving.parentElement;
  if (!li) {
    renderState();
    return;
  }
  li.classList.add('is-leaving');
  const settled = () => {
    li.removeEventListener('transitionend', settled);
    renderState();
  };
  li.addEventListener('transitionend', settled);
}
function onHomeSheetKey(event) {
  if (event.key === 'Escape') closeHomeSheet();
}
// The folded list, given the window. On the pattern the other three sheets share, so
// the grip, the scrim, the drag and the Escape are all the ones already here.
function openHomeSheet(which) {
  const list = homeList(which, currentState || {});
  homeSheetShowing = which;
  homeSheetTitle.textContent = list.count ? `${list.title} (${formatCount(list.count)})` : list.title;
  homeSheet.setAttribute('aria-label', list.title);
  homeSheetBody.innerHTML = homeListBox(list.rows);
  bindHomeRows(homeSheetBody);
  watchHomeLists(homeSheetBody);
  if (homeSheet.hidden) homeSheetLastFocus = document.activeElement;
  homeSheetBackdrop.hidden = false;
  homeSheet.hidden = false;
  requestAnimationFrame(() => {
    homeSheetBackdrop.classList.add('open');
    // Flush again: a sheet parked part-way down by a drag stays there until it is
    // closed, and whatever opens it next means to be read.
    resetSheetDrag(homeSheet);
    homeSheet.classList.add('open');
  });
  document.addEventListener('keydown', onHomeSheetKey);
  leafFocusForKeyboard(homeSheetClose);
}
function closeHomeSheet() {
  if (!homeSheet || homeSheet.hidden) return;
  homeSheetShowing = null;
  homeSheetBackdrop.classList.remove('open');
  homeSheet.classList.remove('open');
  document.removeEventListener('keydown', onHomeSheetKey);
  const hide = () => {
    homeSheet.hidden = true;
    homeSheetBackdrop.hidden = true;
    homeSheet.removeEventListener('transitionend', hide);
  };
  homeSheet.addEventListener('transitionend', hide);
  setTimeout(hide, 320);
  leafFocusForKeyboard(homeSheetLastFocus);
}
if (homeSheet) {
  makeSheetDraggable(homeSheet, homeSheet.querySelector('.leaf-sheet-grip'), closeHomeSheet);
  homeSheetClose.addEventListener('click', closeHomeSheet);
  homeSheetBackdrop.addEventListener('click', closeHomeSheet);
}
function renderState() {
  const state = currentState || { recent: [], favorites: [], tabs: [], active: null, document: null };
  disconnectMinimapPreviewObservers();
  disconnectReaderReflowObserver();
  cancelReaderScrollSettle();
  // The full-window diagram lives inside `app`, so the render below would take it
  // away with nothing knowing — including the Escape handler still listening.
  closeDiagramOverlay();
  readerAnchorBlocks = null;
  // Any full render shows the reading view, so we're no longer in the code view.
  codeViewActive = false;
  disposeMonacoEditor();
  document.documentElement.dataset.codeView = 'false';
  renderTabs(state);
  if (state.document) {
    document.title = `${state.document.title} - Leaftext`;
    const renderedPath = state.document.path || activeDocumentPath();
    const arriving = renderedPath !== lastRenderedDocumentPath;
    lastRenderedDocumentPath = renderedPath;
    app.className = 'reader-shell has-document';
    const minimapHtml = renderDocumentMinimap(state.document.minimap);
    const layoutClass = minimapHtml ? 'reader-layout' : 'reader-layout reader-layout-no-minimap';
    // Carry the scroll origin onto the fresh body — losing it shifts the layout
    // by the origin and the anchor restore lands off by exactly that.
    const previousBody = app.querySelector('.document-body');
    const previousScrollOrigin = previousBody ? previousBody.style.getPropertyValue('--reader-scroll-origin') : '';
    // Hidden, then revealed already decorated: mutating a laid-out document makes
    // every insertion invalidate everything after it. None of the passes below read
    // geometry, so having none yet costs nothing.
    app.innerHTML = `<div class="${layoutClass}" style="display:none">${state.document.html}</div>`;
    const readerLayout = app.firstElementChild;
    setMinimapMarkup(minimapHtml);
    if (previousScrollOrigin) {
      const freshBody = app.querySelector('.document-body');
      if (freshBody) freshBody.style.setProperty('--reader-scroll-origin', previousScrollOrigin);
    }
    // Fresh epoch per render, so a reopened document never shows a cached image.
    localImageEpoch += 1;
    stampLocalImages();
    laneWideTables();
    decorateBlockquoteLines();
    buildDocumentOutline();
    decorateCodeBlocks();
    // Only on arrival: a re-render after a commit or a live reload would growl again about a note the reader was already told about.
    if (arriving) applyFrontmatterAsks(readerLayout);
    applySpeedReaderToDocument();
    // The caret waits for the reveal below: focus() does nothing on a hidden
    // element, so a commit's caret would be dropped rather than restored.
    bindReadingEditor(state.document, { deferCaret: true });
    // One style pass and one layout, for the finished document.
    if (readerLayout) {
      readerLayout.style.removeProperty('display');
      if (arriving) fadeDocumentIn(readerLayout);
    }
    // Past this line the document has geometry, so anything that measures it, or
    // renders by measuring text, or wants focus, is safe.
    placeDeferredReadingCaret();
    bindDocumentLinks();
    requestDocumentPager(state.document.path || activeDocumentPath());
    bindDocumentMinimap();
    renderMermaidDiagrams();
    renderMathElements();
    observeReaderReflow();
    scheduleMinimapPreviewUpdate();
    // Returning from the code view: land on the block holding the source line
    // the code view was scrolled to. This wins over the reset-to-top the host's
    // Reset intent would otherwise run.
    const exactRestore = takeExactViewRestore(state.document.path || activeDocumentPath());
    if (exactRestore) {
      // The code view never moved, so take the pixel back rather than re-derive it
      // from a block — that rounds backwards and walks up over repeated toggles.
      pendingViewAtTop = false;
      pendingReadingSrcOffset = null;
      pendingViewScrollFraction = null;
      resetReaderScrollOnNextRender = false;
      window.requestAnimationFrame(() => {
        setReaderScrollTop(exactRestore.readerScrollTop);
        recordReaderLanded();
        readerScrollAnchor = captureReaderScrollAnchor();
        updateMinimapViewport();
      });
    } else if (pendingViewAtTop) {
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
      // Keep the fraction only as this landing's fallback; a later unrelated
      // render must not inherit it and scroll a fresh document part-way down.
      const fallbackFraction = pendingViewScrollFraction;
      pendingViewScrollFraction = null;
      window.requestAnimationFrame(() => {
        if (!scrollReadingToSrcOffset(srcOffset)) {
          pendingViewScrollFraction = fallbackFraction;
          resetReaderScrollToContentStart();
          return;
        }
        recordReaderLanded();
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
  // Back to the home screen, so the next document is an arrival even if it is the
  // one just closed.
  lastRenderedDocumentPath = null;
  document.title = 'Leaftext';
  app.className = 'reader-shell empty';
  // No document, no rail — and the shell's column collapses with it.
  setMinimapMarkup('');
  updateEditingChrome();
  app.innerHTML = `
    <section class="empty-state">
      <p class="kicker">Leaftext</p>
      <h1>Refine your mind.</h1>
      <p class="empty-subtitle">Your thoughts, secure and free.</p>
      <p class="empty-description">${escapeText(emptyDescription)}</p>
      <div class="empty-actions">
        <button type="button" class="primary-open">Choose file</button>
        <button type="button" class="primary-new">${newIconSvg()}New document</button>
      </div>
      ${homeListsMarkup(state)}
      <!-- In the template, not filled in later: this screen is rebuilt on every
           home render, so an element found once at load is gone by the second. -->
      <p class="empty-version">${LEAF_VERSION ? `v${escapeText(LEAF_VERSION)}` : ''}</p>
    </section>`;
  app.querySelector('.primary-open').addEventListener('click', () => send({ command: 'open' }));
  app.querySelector('.primary-new').addEventListener('click', () => send({ command: 'newDocument' }));
  bindHomeRows(app);
  watchHomeLists(app);
  app.querySelectorAll('[data-home-list]').forEach((button) => {
    button.addEventListener('click', () => openHomeSheet(button.dataset.homeList));
  });
  // A list that changed under an open sheet — a file kept from its own right-click
  // menu — has to change in the sheet too, or the two disagree about one list.
  if (homeSheetShowing) openHomeSheet(homeSheetShowing);
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
