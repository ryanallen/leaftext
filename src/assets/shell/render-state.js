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
  // Only the gestures that meant "leave the map" close it. Opening a file from
  // the pane while reading the map is a change of subject, not a change of
  // view — the graph stays up and moves its highlight to what you opened.
  if (graphExitPending) {
    graphExitPending = false;
    closeGraphView();
  }
  if (!currentState.document) {
    // No document, no views. The three of them are three ways of showing one
    // thing, and the home screen is not that thing — which is why the bar hides
    // here. Closing the last tab with the map up left it on screen with nothing
    // left to leave it by.
    closeGraphView();
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
// Tabs and recents with no document attached. A tab opened straight into the
// code view renders from the code view's own payload, so the state script never
// runs for it — without this it would have no entry in the strip and nothing
// for the page to call the active document.
window.leafSetWorkspace = (state) => {
  const next = state || {};
  currentState = Object.assign({}, currentState || {}, {
    recent: next.recent || [],
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
}
// Every extension the app reads. Mirrors the table in `src/format.rs`, which is
// the source of truth — the page can't import it, so keep the two in step.
const DOCUMENT_EXTS = 'md|markdown|mdown|xml|json|yaml|yml';
/** A bare file name ending in a document extension. */
const DOCUMENT_NAME_RE = new RegExp(`\\.(${DOCUMENT_EXTS})$`, 'i');
/** An href pointing at a document, fragment or query allowed. */
const DOCUMENT_HREF_RE = new RegExp(`\\.(${DOCUMENT_EXTS})(?:[#?].*)?$`, 'i');
// Tabs and the library both show the file name (basename, minus the document
// extension), not the document's heading title. Falls back to the title, then the
// raw path. Every format loses its extension, so tabs read alike.
function stripDocumentExt(name) {
  return (name || '').replace(DOCUMENT_NAME_RE, '');
}
function tabDisplayName(tab) {
  const base = (tab.path || '').split(/[\\/]/).pop() || '';
  return stripDocumentExt(base) || tab.title || tab.path || '';
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
  // A tab opening, closing, or changing title changes what the strip needs —
  // refold so a longer title takes a button rather than getting clipped.
  refitAppBar();
}
