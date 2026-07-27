// The snippet() markers from the backend are control characters (STX/ETX) that
// cannot occur in normal Markdown, so we can escape the whole untrusted snippet
// for the DOM first and only then swap the markers for <mark> tags.
function highlightSnippet(snippet) {
  return escapeText(snippet || '')
    .split('').join('<mark class="library-hit-mark">')
    .split('').join('</mark>');
}
function searchHitHtml(hit) {
  const path = (hit && hit.absPath) || '';
  const title = (hit && hit.title) || path;
  const anchor = (hit && hit.anchor) || '';
  return `<button type="button" class="library-hit" data-open-path="${escapeAttr(path)}" data-anchor="${escapeAttr(anchor)}" title="${escapeAttr(path)}"><span class="library-hit-title">${escapeText(stripDocumentExt(title) || title)}</span><span class="library-hit-snippet">${highlightSnippet(hit && hit.snippet)}</span></button>`;
}
function bindSearchHits() {
  librarySearchResults.querySelectorAll('[data-open-path]').forEach((button) => {
    button.addEventListener('click', () => {
      const path = button.dataset.openPath;
      const anchor = button.dataset.anchor || '';
      // Open (or focus) the file, then scroll to the matching heading once it
      // renders. Files with no heading above the match open at the top.
      pendingSearchJump = anchor ? { path, anchor } : null;
      // A hit is a place in the text, so it is worth leaving the map for; the
      // anchor it carries has nothing to scroll to on a canvas.
      graphExitPending = true;
      send({ command: 'openRecent', path });
    });
  });
}
// Swap between the tree and the search results. A non-empty query shows the
// results pane (loading, error, no-results, or the ranked hits); an empty query
// restores the tree exactly as it was, including the active view and filters.
function renderLibrarySearch() {
  const active = !!librarySearchQuery;
  // A query replaces the file list with its results; clearing it puts the list
  // back. The graph is on the page now, so it is none of this function's
  // business.
  librarySearchResults.hidden = !active;
  libraryTree.hidden = active;
  if (!active) {
    librarySearchResults.innerHTML = '';
    return;
  }
  if (librarySearchError) {
    const message = (librarySearchError && librarySearchError.message) || window.leafLocale.t('library.search.error');
    librarySearchResults.innerHTML = `<p class="library-empty">${escapeText(message)}</p>`;
    return;
  }
  if (librarySearchLoading && !librarySearchHits) {
    librarySearchResults.innerHTML = `<p class="library-empty">${escapeText(window.leafLocale.t('library.search.loading'))}</p>`;
    return;
  }
  const hits = librarySearchHits || [];
  if (!hits.length) {
    librarySearchResults.innerHTML = `<p class="library-empty">${escapeText(window.leafLocale.t('library.search.noResults'))}</p>`;
    return;
  }
  const count = window.leafLocale.formatNumber(hits.length);
  const countLine = `<p class="library-results-count">${escapeText(window.leafLocale.t('library.search.count', { count }))}</p>`;
  librarySearchResults.innerHTML = countLine + hits.map(searchHitHtml).join('');
  bindSearchHits();
}
function runLibrarySearch(value) {
  const query = (value || '').trim();
  librarySearchQuery = query;
  if (!query) {
    librarySearchHits = null;
    librarySearchError = null;
    librarySearchLoading = false;
    renderLibrarySearch();
    return;
  }
  librarySearchLoading = true;
  librarySearchError = null;
  renderLibrarySearch();
  send({ command: 'search', query, scope: librarySearchScopePaths() });
}
// The document paths to restrict a search to, or null for the whole library. The
// file list narrows to the folder it is inside (the root narrows to nothing) and
// the graph to the nodes it drew; a set too large to bind also searches all.
function librarySearchScopePaths() {
  let paths;
  if (libraryProjectPath) {
    // The documents on screen. Only this folder, not the ones under it: the pane
    // reads one folder at a time and has never looked inside the rest.
    paths = (libraryEntries || []).filter((node) => node.kind === 'file').map((node) => node.path);
  } else {
    return null;
  }
  return paths.length > SEARCH_SCOPE_CAP ? null : paths;
}
librarySearch.addEventListener('input', () => {
  const value = librarySearch.value;
  if (librarySearchTimer) clearTimeout(librarySearchTimer);
  librarySearchTimer = window.setTimeout(() => runLibrarySearch(value), SEARCH_DEBOUNCE_MS);
});
// Escape clears the field and returns to the tree immediately.
librarySearch.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && librarySearch.value) {
    event.stopPropagation();
    librarySearch.value = '';
    if (librarySearchTimer) clearTimeout(librarySearchTimer);
    runLibrarySearch('');
  }
});
window.leafSetSearchResults = (payload) => {
  const data = payload || {};
  const query = typeof data.query === 'string' ? data.query : '';
  // Drop stale responses: the input has moved on since this query was sent.
  if (query !== librarySearchQuery) return;
  librarySearchLoading = false;
  if (data.error) {
    librarySearchError = data.error;
    librarySearchHits = null;
  } else {
    librarySearchError = null;
    librarySearchHits = Array.isArray(data.hits) ? data.hits : [];
  }
  renderLibrarySearch();
};
// Paint the pane from the seeded settings, then ask for the tree. The host owns
// indexing and starts the rescan itself, so there's no JS-initiated crawl on boot.
renderLibrary();
applyPaneLayout();
send({ command: 'getFolder', path: libraryProjectPath });
// Updates. The check compares the running version against the latest GitHub
// release; if a newer one publishes this platform's installer, the page downloads
// it and streams it to the host, which writes, hashes, and stages it. The button
// then offers a restart. Every failure is reported in the panel — a check that
// found nothing must not look like one that never ran.
//
// The download lives here rather than in Rust because the web view already has
// an OS-maintained TLS stack; the host owns everything that decides whether the
// bytes are allowed to run.
const settingsAlertDot = document.getElementById('settingsAlertDot');
const settingsUpdate = document.getElementById('settingsUpdate');
const settingsUpdateLabel = document.getElementById('settingsUpdateLabel');
const settingsUpdateFill = document.getElementById('settingsUpdateFill');
const settingsUpdateSpinner = document.getElementById('settingsUpdateSpinner');
const settingsCheck = document.getElementById('settingsCheck');
const settingsCheckLabel = document.getElementById('settingsCheckLabel');
const settingsCheckSpinner = document.getElementById('settingsCheckSpinner');
const LEAF_VERSION = typeof window.__leafVersion === 'string' ? window.__leafVersion : null;
