// Which document was rendered last, so the fade below runs when the document
// changes and not when an inline edit commits. Only this fragment reads it, which is
// why it is not in state.js. `var` and not `let`: theme.js runs renderState() as it
// loads, which reaches the home-screen branch that clears this — and a `let` is in
// its dead zone until the line declaring it runs, so even the write would throw.
var lastRenderedDocumentPath = null;
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
function renderState() {
  const state = currentState || { recent: [], tabs: [], active: null, document: null };
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
  const recent = state.recent || [];
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
      ${recent.length ? `<div class="recent"><h2>Recent (${escapeText(formatCount(recent.length))})</h2><ol>${recent.map((path) => `<li><button type="button" title="Open ${escapeAttr(path)}" data-path="${escapeAttr(path)}" data-reveal-path="${escapeAttr(path)}">${escapeText(path)}</button></li>`).join('')}</ol></div>` : `<p class="empty-help">Files you open show up here, so you can pick up where you left off.</p>`}
      <!-- In the template, not filled in later: this screen is rebuilt on every
           home render, so an element found once at load is gone by the second. -->
      <p class="empty-version">${LEAF_VERSION ? `v${escapeText(LEAF_VERSION)}` : ''}</p>
    </section>`;
  app.querySelector('.primary-open').addEventListener('click', () => send({ command: 'open' }));
  app.querySelector('.primary-new').addEventListener('click', () => send({ command: 'newDocument' }));
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
