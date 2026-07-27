function renderState() {
  const state = currentState || { recent: [], tabs: [], active: null, document: null };
  disconnectMinimapPreviewObservers();
  disconnectReaderReflowObserver();
  cancelReaderScrollSettle();
  readerAnchorBlocks = null;
  // Any full render shows the reading view, so we're no longer in the code view.
  codeViewActive = false;
  document.documentElement.dataset.codeView = 'false';
  renderTabs(state);
  if (state.document) {
    document.title = window.leafLocale.t('titles.document', { title: state.document.title });
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
    decorateBlockquoteLines();
    buildDocumentOutline();
    decorateCodeBlocks();
    applySpeedReaderToDocument();
    // The caret waits for the reveal below: focus() does nothing on a hidden
    // element, so a commit's caret would be dropped rather than restored.
    bindReadingEditor(state.document, { deferCaret: true });
    // One style pass and one layout, for the finished document.
    if (readerLayout) readerLayout.style.removeProperty('display');
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
    // the code view was scrolled to. This wins over the reset-to-top the
    // host's Reset intent would otherwise run, and doesn't depend on the racy
    // fraction hand-off.
    if (pendingViewAtTop) {
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
      window.requestAnimationFrame(() => {
        if (!scrollReadingToSrcOffset(srcOffset)) {
          resetReaderScrollToContentStart();
          return;
        }
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
  document.title = window.leafLocale.t('titles.app');
  app.className = 'reader-shell empty';
  // No document, no rail — and the shell's column collapses with it.
  setMinimapMarkup('');
  updateEditingChrome();
  const recent = state.recent || [];
  app.innerHTML = `
    <section class="empty-state">
      <p class="kicker">${escapeText(window.leafLocale.t('empty.kicker'))}</p>
      <h1>${escapeText(window.leafLocale.t('empty.title'))}</h1>
      <p class="empty-subtitle">${escapeText(window.leafLocale.t('empty.subtitle'))}</p>
      <p class="empty-description">${escapeText(window.leafLocale.t(emptyDescriptionKey))}</p>
      <button type="button" class="primary-open">${escapeText(window.leafLocale.t('actions.chooseFile'))}</button>
      ${recent.length ? `<div class="recent"><h2>${escapeText(window.leafLocale.t('recent.headingWithCount', { count: window.leafLocale.formatNumber(recent.length) }))}</h2><ol>${recent.map((path) => `<li><button type="button" title="${escapeAttr(window.leafLocale.t('recent.openTitle', { path }))}" data-path="${escapeAttr(path)}" data-reveal-path="${escapeAttr(path)}">${escapeText(path)}</button></li>`).join('')}</ol></div>` : `<p class="empty-help">${escapeText(window.leafLocale.t('empty.noRecent'))}</p>`}
    </section>`;
  app.querySelector('.primary-open').addEventListener('click', () => send({ command: 'open' }));
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
