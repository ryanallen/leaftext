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
  // The line carries the row to the match itself; the anchor is the fallback.
  const line = (hit && hit.startLine) || 0;
  return `<button type="button" class="library-hit" data-open-path="${escapeAttr(path)}" data-anchor="${escapeAttr(anchor)}" data-line="${escapeAttr(String(line))}" title="${escapeAttr(path)}"><span class="library-hit-title">${escapeText(stripDocumentExt(title) || title)}</span><span class="library-hit-snippet">${highlightSnippet(hit && hit.snippet)}</span></button>`;
}
function bindSearchHits() {
  librarySearchResults.querySelectorAll('[data-open-path]').forEach((button) => {
    button.addEventListener('click', () => {
      const path = button.dataset.openPath;
      const anchor = button.dataset.anchor || '';
      const line = Number(button.dataset.line) || 0;
      // Open (or focus) the file, then scroll to the match once it renders — to
      // the line it is on, or the heading above it if the line cannot be placed.
      pendingSearchJump = anchor || line ? { path, anchor, line } : null;
      // A hit is a place in the text, so it is worth leaving the map for; the
      // anchor it carries has nothing to scroll to on a canvas.
      graphExitPending = true;
      send({ command: 'openRecent', path });
    });
  });
}
// Swap between the tree and the search results. A non-empty query shows the
// results pane (loading, error, no-results, or the ranked hits); an empty query
// puts the file list back exactly as it was.
function renderLibrarySearch() {
  const active = !!librarySearchQuery;
  librarySearchResults.hidden = !active;
  libraryTree.hidden = active;
  if (!active) {
    librarySearchResults.innerHTML = '';
    return;
  }
  if (librarySearchError) {
    const message = (librarySearchError && librarySearchError.message) || 'Search failed.';
    librarySearchResults.innerHTML = `<p class="library-empty">${escapeText(message)}</p>`;
    return;
  }
  if (librarySearchLoading && !librarySearchHits) {
    librarySearchResults.innerHTML = `<p class="library-empty">Searching…</p>`;
    return;
  }
  const hits = librarySearchHits || [];
  if (!hits.length) {
    librarySearchResults.innerHTML = `<p class="library-empty">No matches.</p>`;
    return;
  }
  // A row is a match and one file can hold three, so a cut list says what it was
  // cut to in files, counted off the rows rather than kept as a second copy of the
  // host's cap.
  const files = new Set(hits.map((hit) => (hit && hit.absPath) || '')).size;
  const count = librarySearchTruncated
    ? `${formatCount(hits.length)} results in the first ${formatCount(files)} files`
    : `${formatCount(hits.length)} results`;
  const countLine = `<p class="library-results-count">${escapeText(count)}</p>`;
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
// The folder on screen, sent as the search's scope — null at the root, or when
// the set is over SEARCH_SCOPE_CAP. Advisory: the host searches the whole active
// vault and ignores it.
function librarySearchScopePaths() {
  let paths;
  if (libraryProjectPath) {
    // The documents on screen. Only this folder, not the ones under it: the pane
    // reads one folder at a time.
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
    librarySearchTruncated = false;
  } else {
    librarySearchError = null;
    librarySearchHits = Array.isArray(data.hits) ? data.hits : [];
    librarySearchTruncated = !!data.truncated;
  }
  renderLibrarySearch();
};
// Paint the pane from the seeded settings, then ask for the folder on screen.
renderLibrary();
applyPaneLayout();
send({ command: 'getFolder', path: libraryProjectPath });
const LEAF_VERSION = typeof window.__leafVersion === 'string' ? window.__leafVersion : null;
