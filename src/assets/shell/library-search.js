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
  // Matched by one of the note's other names: the row still says the file, so the
  // name that actually matched has to be on it or the row reads as a mystery.
  const alias = (hit && hit.alias) || '';
  const also = alias ? `<span class="library-hit-alias">${escapeText(alias)}</span>` : '';
  return `<button type="button" class="library-hit" data-open-path="${escapeAttr(path)}" data-anchor="${escapeAttr(anchor)}" data-line="${escapeAttr(String(line))}" title="${escapeAttr(path)}"><span class="library-hit-title">${escapeText(stripDocumentExt(title) || title)}${also}</span><span class="library-hit-snippet">${highlightSnippet(hit && hit.snippet)}</span></button>`;
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
  const note = searchNoteHtml();
  const hits = librarySearchHits || [];
  if (!hits.length) {
    librarySearchResults.innerHTML = note + `<p class="library-empty">No matches.</p>`;
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
  librarySearchResults.innerHTML = note + countLine + hits.map(searchHitHtml).join('');
  bindSearchHits();
}
// What the box made of what was typed. A plain word query says nothing — it would
// only repeat the field back — so this appears the moment there is syntax in it,
// and names a field the vault has never set rather than leaving an empty list to
// be read as "nothing matches".
function searchNoteHtml() {
  const parts = [];
  if (librarySearchUnderstood) {
    parts.push(`<span class="library-search-read">${escapeText(librarySearchUnderstood)}</span>`);
  }
  const unknown = librarySearchUnknownFields || [];
  if (unknown.length) {
    const names = unknown.map((name) => `“${name}”`).join(', ');
    const label = unknown.length > 1 ? 'No fields called' : 'No field called';
    parts.push(`<span class="library-search-unknown">${escapeText(`${label} ${names}`)}</span>`);
  }
  return parts.length ? `<p class="library-search-note">${parts.join('')}</p>` : '';
}
function runLibrarySearch(value) {
  const query = (value || '').trim();
  librarySearchQuery = query;
  if (!query) {
    librarySearchHits = null;
    librarySearchError = null;
    librarySearchLoading = false;
    librarySearchUnderstood = '';
    librarySearchUnknownFields = [];
    renderLibrarySearch();
    return;
  }
  librarySearchLoading = true;
  librarySearchError = null;
  renderLibrarySearch();
  send({ command: 'search', query, today: localDateStamp() });
}
// The reader's own date, so `due:<friday` means their Friday. The host cannot
// ask the machine this without another crate, and the page has it for free.
function localDateStamp() {
  const now = new Date();
  const pad = (part) => String(part).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
librarySearch.addEventListener('input', () => {
  const value = librarySearch.value;
  if (librarySearchTimer) clearTimeout(librarySearchTimer);
  librarySearchTimer = window.setTimeout(() => runLibrarySearch(value), SEARCH_DEBOUNCE_MS);
});
// The completion menu takes the arrows, Enter and the first Escape; only then does
// Escape clear the field and return to the tree.
librarySearch.addEventListener('keydown', (event) => {
  if (filterMenuKeydown(event)) return;
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
    librarySearchUnderstood = typeof data.understood === 'string' ? data.understood : '';
    librarySearchUnknownFields = Array.isArray(data.unknownFields) ? data.unknownFields : [];
  }
  renderLibrarySearch();
};
// What the box can offer as you type: the vault's own field names and the
// values each is known to hold, plus the three built-in names that are not
// frontmatter at all. Pushed once per vault read, so a keystroke costs nothing.
window.leafSetFilterHints = (payload) => {
  const data = payload || {};
  filterHintFields = Array.isArray(data.fields) ? data.fields : [];
};
// The run of non-whitespace the caret is in — the piece a completion replaces.
function filterTokenAt() {
  const text = librarySearch.value || '';
  const caret =
    typeof librarySearch.selectionStart === 'number' ? librarySearch.selectionStart : text.length;
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
  let end = caret;
  while (end < text.length && !/\s/.test(text[end])) end += 1;
  return { text: text.slice(start, end), start, end };
}
// The names a filter can use that are not somebody's frontmatter, with what each
// one holds. `ext:` reads the one table of formats rather than a second list.
function filterBuiltinNames() {
  return [
    { name: 'in', values: [] },
    { name: 'ext', values: window.__leafDocumentExts || [] },
    { name: 'task', values: ['open', 'done'] },
  ];
}
// What to offer for the token being typed: a value when the token already names a
// field, a field name otherwise. Capped, because a menu longer than the pane is a
// list nobody reads.
function filterSuggestions(token) {
  const FILTER_MENU_CAP = 8;
  const bare = token.replace(/^-/, '');
  const named = bare.indexOf(':');
  const known = filterHintFields.concat(filterBuiltinNames());
  if (named >= 0) {
    const name = bare.slice(0, named);
    // Past any comparison, so `due:<fri` completes on `fri`.
    const typed = bare.slice(named + 1).replace(/^(<=|>=|<|>)/, '');
    const field = known.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (!field) return [];
    const head = token.slice(0, token.length - typed.length);
    return (field.values || [])
      .filter((value) => value.toLowerCase().startsWith(typed.toLowerCase()))
      .slice(0, FILTER_MENU_CAP)
      .map((value) => ({ label: value, insert: head + (/\s/.test(value) ? `"${value}"` : value) }));
  }
  if (!bare) return [];
  const head = token.slice(0, token.length - bare.length);
  return known
    .filter((entry) => entry.name.toLowerCase().startsWith(bare.toLowerCase()))
    .slice(0, FILTER_MENU_CAP)
    .map((entry) => ({ label: `${entry.name}:`, insert: `${head}${entry.name}:` }));
}
function renderFilterMenu() {
  if (!filterMenuItems.length) {
    filterMenu.hidden = true;
    filterMenu.innerHTML = '';
    return;
  }
  filterMenu.innerHTML = filterMenuItems
    .map((item, index) => {
      const picked = index === filterMenuIndex ? ' is-active' : '';
      return `<button type="button" class="filter-menu-item${picked}" role="option" aria-selected="${index === filterMenuIndex}" data-filter-pick="${escapeAttr(String(index))}">${escapeText(item.label)}</button>`;
    })
    .join('');
  // Under the box, and placed from it: the menu lives outside the header, which clips at its own height.
  const box = librarySearch.getBoundingClientRect();
  const pane = filterMenu.offsetParent || document.body;
  const origin = pane.getBoundingClientRect();
  filterMenu.style.left = `${box.left - origin.left}px`;
  filterMenu.style.top = `${box.bottom - origin.top}px`;
  filterMenu.style.minWidth = `${box.width}px`;
  filterMenu.hidden = false;
  filterMenu.querySelectorAll('[data-filter-pick]').forEach((button) => {
    button.addEventListener('mousedown', (event) => {
      // Before the blur, or the box loses focus and the menu closes under the click.
      event.preventDefault();
      applyFilterPick(Number(button.dataset.filterPick) || 0);
    });
  });
}
function closeFilterMenu() {
  filterMenuItems = [];
  filterMenuIndex = 0;
  renderFilterMenu();
}
function openFilterMenu() {
  const token = filterTokenAt();
  filterMenuItems = token.text ? filterSuggestions(token.text) : [];
  filterMenuIndex = 0;
  renderFilterMenu();
}
function applyFilterPick(index) {
  const item = filterMenuItems[index];
  if (!item) return;
  const input = librarySearch;
  const token = filterTokenAt();
  const text = input.value || '';
  input.value = text.slice(0, token.start) + item.insert + text.slice(token.end);
  const caret = token.start + item.insert.length;
  input.setSelectionRange(caret, caret);
  closeFilterMenu();
  // Runs the filter, and brings the menu back for the value a picked field wants next.
  input.dispatchEvent(new Event('input'));
}
// Arrow keys walk the menu, Enter takes one, Escape closes it without touching the
// box — Escape only clears the field when there is no menu to dismiss first.
function filterMenuKeydown(event) {
  if (!filterMenuItems.length) return false;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    filterMenuIndex = (filterMenuIndex + step + filterMenuItems.length) % filterMenuItems.length;
    renderFilterMenu();
    return true;
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    applyFilterPick(filterMenuIndex);
    return true;
  }
  if (event.key === 'Escape') {
    event.stopPropagation();
    closeFilterMenu();
    return true;
  }
  return false;
}
librarySearch.addEventListener('input', () => openFilterMenu());
librarySearch.addEventListener('blur', () => closeFilterMenu());
// Paint the pane from the seeded settings, then ask for the folder on screen.
renderLibrary();
applyPaneLayout();
send({ command: 'getFolder', path: libraryProjectPath });
const LEAF_VERSION = typeof window.__leafVersion === 'string' ? window.__leafVersion : null;
