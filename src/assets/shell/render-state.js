// Run a blocking view render. The real stall on a big payload is the render itself, so a heavy payload pops the spinner and yields two frames — one for rAF callbacks, one so the compositor actually paints it — before blocking.
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
function deliverWorkspacePayload(state, action, detail) {
  if (action === 'reload') window.leafReloadDocument(state);
  else if (action === 'switch') window.leafSwitchTab(state, detail);
  else if (action === 'cachedSwitch') window.leafSwitchTabCached(state, detail && detail.anchor, detail && detail.key);
  else window.leafSetState(state);
}
function failWorkspacePayload(error) {
  console.error('reading view: the document payload would not load', error);
  clearReaderLoading();
  window.leafShowError('The document could not be opened.');
}
window.leafLoadWorkspace = (url, action, detail) => {
  fetch(url)
    .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
    .then((state) => deliverWorkspacePayload(state, action, detail))
    .catch(failWorkspacePayload);
};
function acceptWorkspaceSharedBuffer(event) {
  const buffer = event.getBuffer();
  try {
    const state = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer)));
    const route = event.additionalData || {};
    deliverWorkspacePayload(state, route.action, route.detail);
  } catch (error) {
    failWorkspacePayload(error);
  } finally {
    window.chrome.webview.releaseBuffer(buffer);
  }
}
if (window.chrome && window.chrome.webview && window.chrome.webview.addEventListener) {
  window.chrome.webview.addEventListener('sharedbufferreceived', acceptWorkspaceSharedBuffer);
}
window.leafSetState = (state) => {
  currentState = state || { recent: [], favorites: [], tabs: [], active: null, document: null };
  // Only the gestures that meant "leave the map" close it. Opening a file from the pane while reading the map is a change of subject, not a change of view — the graph stays up and moves its highlight to what you opened.
  if (graphExitPending) {
    graphExitPending = false;
    closeGraphView();
  }
  if (!currentState.document) {
    // No document, no views. The three of them are three ways of showing one thing, and the home screen is not that thing — which is why the bar hides here. Without this, closing the last tab leaves the map on screen with nothing left to leave it by.
    closeGraphView();
    homeMessage = pickHomeMessage();
  }
  runViewRender(currentState.document && currentState.document.html, () => {
    resetReaderScrollOnNextRender = true;
    renderState();
    // Opening a file lands on it; the home screen (no active tab) clears the highlight and leaves the Project/Tree position as the user last saved it. Fly the graph to it only when the active document actually changed, so a plain state refresh of the same file doesn't yank a panned-away view back.
    const openedPath = activeDocumentPath();
    followFileInLibrary(openedPath, !!openedPath && openedPath !== librarySelectedPath);
    // A search result was clicked: once its document is the active one, jump to the matching heading. One-shot — cleared whether or not it applied this render.
    if (pendingSearchJump) {
      const jump = pendingSearchJump;
      pendingSearchJump = null;
      // Land on the line the match is on, not the heading above it, or a hit near the foot of a long section opens at the top of that section. The heading is the fallback, for a document whose source the page does not hold (only Markdown carries block ranges).
      const landed =
        activeDocumentPath() === jump.path &&
        jump.line > 1 &&
        documentSourceLength() > 0 &&
        scrollReadingToSrcOffset(byteOffsetAtLineIndex(documentSourceBytes(), jump.line - 1));
      if (!landed && jump.anchor && activeDocumentPath() === jump.path) {
        window.leafScrollToFragment('#' + jump.anchor);
      }
    }
  });
};
window.leafSetFavorites = (favorites) => {
  currentState.favorites = Array.isArray(favorites) ? favorites : [];
  renderTabs(currentState);
};
// Re-render the active document after a live reload without scrolling to the top: capture the position, re-render, restore it (clamped if the document shrank).
window.leafReloadDocument = (state) => {
  // A source-block commit leaves an above-edit anchor; prefer it over the top-visible capture, which would target the momentarily zero-height block.
  const anchor = pendingEditAnchor || captureReaderScrollAnchor();
  pendingEditAnchor = null;
  currentState = state || currentState || { recent: [], favorites: [], tabs: [], active: null, document: null };
  runViewRender(currentState.document && currentState.document.html, () => {
    resetReaderScrollOnNextRender = false;
    renderState();
    // A reload arriving while the reader is off screen has nothing to capture, and its null must not stand in for the place the reader still holds.
    readerScrollAnchor = anchor || readerScrollAnchor;
    window.requestAnimationFrame(() => {
      restoreReaderScrollAnchor(anchor);
      refreshReaderScrollAnchor();
      updateMinimapViewport();
    });
  });
};
// Re-render the document the page already has, staying where the reader is. For the page's own re-renders — the reading padlock — where the text did not change and the only reason to rebuild is that the blocks bind differently. renderState() replaces the document body, and the scroll goes with it.
function renderStateKeepingPlace() {
  const anchor = captureReaderScrollAnchor();
  // Nothing on screen to hold onto — a document still arriving. Let the render land wherever it was already going to.
  if (!anchor) {
    renderState();
    return;
  }
  resetReaderScrollOnNextRender = false;
  renderState();
  readerScrollAnchor = anchor;
  // Restored before the paint, so the toggle never flashes at the top for a frame, and again next frame once the fresh document has settled.
  restoreReaderScrollAnchor(anchor);
  updateMinimapViewport();
  window.requestAnimationFrame(() => {
    restoreReaderScrollAnchor(anchor);
    refreshReaderScrollAnchor();
    updateMinimapViewport();
  });
}
// Switch to another tab and land where it was last left. `anchor` is a content anchor that survives the re-render, null the first time (starts at the top). Skips the reset-to-top that leafSetState runs so a tab click never jumps up.
window.leafSwitchTab = (state, anchor) => {
  const outgoing = takeCurrentReaderRender();
  const target = keptReaderRender;
  currentState = state || { recent: [], favorites: [], tabs: [], active: null, document: null };
  if (!currentState.document) {
    homeMessage = pickHomeMessage();
  }
  runViewRender(currentState.document && currentState.document.html, () => {
    resetReaderScrollOnNextRender = false;
    if (!restoreKeptReaderRender(currentState, target)) renderState(true);
    keptReaderRender = outgoing;
    finishTabSwitch(anchor);
  });
};
function finishTabSwitch(anchor) {
  // Switching to a tab is "going to" that file: reveal and select it, and in graph mode fly to its node when the switch changed the active document.
  const switchedPath = activeDocumentPath();
  followFileInLibrary(switchedPath, !!switchedPath && switchedPath !== librarySelectedPath);
  if (!anchor) {
    resetReaderScrollToContentStart();
    return;
  }
  readerScrollAnchor = anchor;
  // Restore synchronously, before the browser paints the freshly rendered document, so switching tabs never flashes at the top for a frame.
  restoreReaderScrollAnchor(anchor);
  updateMinimapViewport();
  // Re-apply after layout settles; renderState's reflow observer keeps re-pinning the anchor as images above it decode and grow, so the landing doesn't drift.
  window.requestAnimationFrame(() => {
    restoreReaderScrollAnchor(anchor);
    refreshReaderScrollAnchor();
    updateMinimapViewport();
  });
}
window.leafSwitchTabCached = (state, anchor, key) => {
  const outgoing = takeCurrentReaderRender();
  const target = keptReaderRender;
  currentState = state || { recent: [], favorites: [], tabs: [], active: null, document: null };
  if (restoreKeptReaderRenderByKey(currentState, target, key)) {
    keptReaderRender = outgoing;
    finishTabSwitch(anchor);
    clearReaderLoading();
    return;
  }
  keptReaderRender = outgoing;
  renderTabs(currentState);
  send({
    command: 'switchTab',
    index: currentState.active,
    scroll_anchor: anchor || { section: null, block: 0, offsetY: 0 },
    code_scroll: null,
    forceFull: true,
  });
};
// Tabs and recents with no document attached. A tab opened straight into the code view renders from the code view's own payload, so the state script never runs for it — without this it would have no entry in the strip and nothing for the page to call the active document.
window.leafSetWorkspace = (state) => {
  const next = state || {};
  currentState = Object.assign({}, currentState || {}, {
    recent: next.recent || [],
    favorites: next.favorites || [],
    tabs: next.tabs || [],
    active: next.active == null ? null : next.active,
  });
  renderTabs(currentState);
  followFileInLibrary(activeDocumentPath(), false);
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
    // Record where we landed as the reader anchor, or the ResizeObserver's scheduleReaderLayoutUpdate would re-pin the pre-jump position and yank the page back. Re-pin next frame too so the landing converges on the target.
    refreshReaderScrollAnchor();
    updateMinimapViewport();
    window.requestAnimationFrame(() => {
      restoreReaderScrollAnchor(readerScrollAnchor);
      refreshReaderScrollAnchor();
      updateMinimapViewport();
    });
  });
};
// What the reader can see, for the ask pipe. Rust cannot answer it: a visit's anchor is written only when the reader leaves a document, so the live position is the page's alone. A function rather than a string in Rust, so check-shell calls it and a renamed element fails the suite instead of the next ask.
window.leafReaderState = () => {
  const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
  const selected = selection ? String(selection) : '';
  return {
    scrollTop: Math.round(app.scrollTop || 0),
    scrollHeight: Math.round(app.scrollHeight || 0),
    viewportHeight: Math.round(app.clientHeight || 0),
    // Where in the document, not how many pixels down: the anchor a history step carries, so it survives a re-render.
    anchor: captureReaderScrollAnchor(),
    codeView: !!codeViewActive,
    panels: {
      library: !!libraryShell && !libraryShell.classList.contains('library-closed'),
      map: !!graphViewOpen,
      findBar: !!findBar && !findBar.hidden,
      glossary: !!glossarySheet && !glossarySheet.hidden,
      homeList: !!homeSheet && !homeSheet.hidden,
    },
    // Long enough to tell which text it is, short enough not to send a page back.
    selection: selected ? selected.slice(0, 500) : null,
    // Off the spinner the page already arms and clears, so the answer is the page's rather than a guessed sleep at the other end.
    renderInFlight: !!readerLoading && !readerLoading.hidden,
  };
};
window.leafRestoreScrollAnchor = (anchor) => {
  if (!anchor) {
    return;
  }
  readerScrollAnchor = anchor;
  window.requestAnimationFrame(() => {
    restoreReaderScrollAnchor(anchor);
    refreshReaderScrollAnchor();
    updateMinimapViewport();
  });
};
// All filename rows use this rule, so their visible label cannot drift from the format table the host publishes.
function documentNameParts(path) {
  const name = String(path == null ? '' : path).split(/[\\/]/).pop() || '';
  const match = name.match(DOCUMENT_NAME_RE);
  return match ? { stem: name.slice(0, -match[0].length), extension: match[1].toUpperCase() } : { stem: name, extension: '' };
}
function documentNameMarkup(path, stemTail) {
  const { stem, extension } = documentNameParts(path);
  const badge = extension ? `<span class="file-type-badge">${escapeText(extension)}</span>` : '';
  return `<span class="file-name-stem">${escapeText(stem)}${stemTail || ''}</span>${badge}`;
}
// The favorites the host last sent, and whether one of them is this file.
function currentFavorites() {
  return (currentState && currentState.favorites) || [];
}
function isFavoritePath(path) {
  return !!path && currentFavorites().some((favorite) => favorite.path === path);
}
// Mark or unmark, showing it immediately: the page flips its own copy and redraws, so the heart fills under the pointer rather than a beat later, and the host's next payload is it agreeing. The vault is the host's to work out — the page only ever compares paths.
function toggleFavorite(path, kind) {
  if (!path) return;
  const favorites = currentFavorites();
  currentState.favorites = isFavoritePath(path)
    ? favorites.filter((favorite) => favorite.path !== path)
    : favorites.concat([{ vaultId: null, path, kind: kind || 'document' }]);
  renderTabs(currentState);
  send({ command: 'toggleFavorite', path, kind: kind || 'document' });
}
// Which tab the pointer is standing on, so a redraw can hand its corner controls back. A mark that fades out the instant it is made reads as a press that did nothing. `var` rather than `let` because a fragment ahead of this one renders as it loads, and a `let` read before its own line has run throws the first paint away.
var pointedTabPath = null;
// The markup the strip was last drawn from, so a render that would write the same string back can leave every tab standing. Held here rather than read back off the strip, because a tab drag leaves an inline transform on the elements it moved and the answer wanted is whether this function produced the same string twice. `var` for the same reason as the line above, and `null` until the first draw so even an empty strip is written once.
var lastTabsMarkup = null;
function renderTabs(state) {
  // A site's bar carries the folder trail in this box instead of a strip of tabs, so nothing here may write into it. The trail is what says which document is open, and the document changing is this call — so it is redrawn from here, where a tab label would have been.
  if (window.__leafSite) {
    renderLibraryCrumbs(libraryChain);
    refitAppBar();
    return;
  }
  const tabs = state.tabs || [];
  const active = state.active;
  // The host says which documents have unsaved edits and which have a step to take back or bring forward, which is the only way a tab restored from the last close gets its dot, its Undo and its Redo: all three maps start empty at every launch. Never cleared from here — typing since the last pause has not reached the host yet, so the page is the one that is ahead.
  tabs.forEach((tab) => {
    if (!tab.path) return;
    if (tab.dirty) dirtyByPath.set(tab.path, true);
    if (tab.undoable) undoableByPath.set(tab.path, true);
    if (tab.redoable) redoableByPath.set(tab.path, true);
  });
  const markup = tabs.map((tab, index) => {
    const favorite = isFavoritePath(tab.path);
    const mark = favorite ? 'Unfavorite' : 'Favorite';
    const label = tab.path || tab.title || '';
    const name = String(label).split(/[\\/]/).pop() || '';
    return `<span class="tab${index === active ? ' tab-active' : ''}${isDocumentDirty(tab.path) ? ' tab-modified' : ''}" data-tab-pos="${index}" data-tab-path="${escapeAttr(tab.path || '')}"><button type="button" class="tab-favorite${favorite ? ' is-on' : ''}" data-tab-favorite="${index}" aria-pressed="${favorite}" aria-label="${mark}" title="${mark}"><span class="lt-icon lt-icon-favorite-${favorite ? 'on' : 'off'}"></span></button><button type="button" class="tab-label" data-tab-index="${index}" data-reveal-path="${escapeAttr(tab.path)}" title="${escapeAttr(tab.path)}">${escapeText(name)}</button><span class="tab-dirty-dot" aria-hidden="true"></span><button type="button" class="tab-close" data-tab-close="${index}" aria-label="Close tab" title="Close tab"><span class="lt-icon lt-icon-tab-close"></span></button></span>`;
  }).join('');
  // Nothing in the strip has moved, so leave it alone: the tab under a still hand keeps the element it is already hovering, and the bar is spared a fold that reads the window's layout once per action it tries. The fold behind an unchanged strip measured about forty-five times what building this string costs.
  if (markup === lastTabsMarkup) return;
  lastTabsMarkup = markup;
  // A pure HTML write; the strip's listeners live on the bar itself (below).
  tabBar.innerHTML = markup;
  // The strip is rewritten whole, so the tab under a still hand is a new element that has never been pointed at. Mark it by the file it carries rather than by its place, since a close shifts every position along, and by name rather than by asking what is at the pointer, which would force a layout on every render.
  if (pointedTabPath) {
    Array.from(tabBar.children).forEach((tab) => {
      if (tab.dataset && tab.dataset.tabPath === pointedTabPath) tab.classList.add('is-pointed');
    });
  }
  // A tab opening, closing, or changing title changes what the strip needs — refold so a longer title takes a button rather than getting clipped.
  refitAppBar();
}
tabBar.addEventListener('pointermove', (event) => {
  const tab = event.target.closest ? event.target.closest('.tab') : null;
  pointedTabPath = tab ? tab.dataset.tabPath || null : null;
});
tabBar.addEventListener('pointerleave', () => {
  pointedTabPath = null;
});
// Both corner controls answer the press rather than the click after it. The heart's own arm rewrites the whole strip inside the handler, and a rewrite landing between a press going down and coming up leaves the browser nothing to resolve a click onto — watched: no click is dispatched at all, no arm runs, and the press is spent. Only the primary button, since a click never came from the others.
tabBar.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const close = event.target.closest('[data-tab-close]');
  if (close) {
    event.stopPropagation();
    send({ command: 'closeTab', index: Number(close.dataset.tabClose) });
    return;
  }
  // The heart sits over the first letters of the name, so it answers before the label does — pointing at it is asking for the heart, not the tab.
  const mark = event.target.closest('[data-tab-favorite]');
  if (mark) {
    event.stopPropagation();
    const tab = (currentState.tabs || [])[Number(mark.dataset.tabFavorite)];
    toggleFavorite(tab ? tab.path : null, 'document');
  }
});
// The label answers the click, because a press that begins a drag must not switch tabs.
tabBar.addEventListener('click', (event) => {
  const label = event.target.closest('[data-tab-index]');
  if (!label || suppressTabClick) return;
  const index = Number(label.dataset.tabIndex);
  const wasActive = index === (currentState && currentState.active);
  const tab = (currentState.tabs || [])[index];
  // A real switch renders the other document (which may be slow); show the spinner. Re-clicking the active tab is a host no-op, so skip it there.
  if (!wasActive) beginReaderLoading();
  const command = {
    command: 'switchTab',
    index,
    scroll_anchor: currentScrollAnchor(),
    code_scroll: codeViewActive ? viewScrollFraction() : null,
  };
  if (keptReaderRender && tab && keptReaderRender.path === tab.path && keptReaderRender.key) command.renderKey = keptReaderRender.key;
  send(command);
  // Reveal even when this is already the active tab (no state round-trip from the host): clicking a file's tab snaps the library back to it, and in graph mode flies the camera to that node and zooms in. Clicking the tab you are already on is a deliberate resync — force the graph to rebuild so it can't stay stuck on a stale scene in memory.
  followFileInLibrary(tab ? tab.path || null : null, true, wasActive);
});
tabBar.addEventListener('pointerdown', (event) => {
  const tabEl = event.target.closest('.tab');
  if (!tabEl || event.button !== 0 || event.target.closest('.tab-close, .tab-favorite')) return;
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
