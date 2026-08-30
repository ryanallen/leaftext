// The snippet() markers from the backend are control characters (STX/ETX) that cannot occur in normal Markdown, so we can escape the whole untrusted snippet for the DOM first and only then swap the markers for <mark> tags.
let librarySearchTimer = 0;
let librarySearchHits = null;
let librarySearchError = null;
let librarySearchLoading = false;
// Whether the host cut the list at its cap, so the count can say so.
let librarySearchTruncated = false;
// More rows are coming for this same query: the vault is still being read. The ring stays up, an answer adds rows under what is drawn rather than replacing it, and the count says "so far". A payload that does not mention it is finished — a host that never streams says so by saying nothing.
let librarySearchPartial = false;
// Which query the drawn rows answer. Rows are only added to when the next answer is for the same question; anything else replaces them.
let librarySearchHitsQuery = '';
// The filter read back in words, and any field name the vault has never set. Shown under the box so a mistyped field is visible instead of silently matching nothing. Empty for a query of plain words, which needs no explaining.
let librarySearchUnderstood = '';
let librarySearchUnknownFields = [];
// Folders under the vault the read did not go into because they hold generated files. The count line says how many and carries their names, because a vault that quietly read three quarters of itself is worse than one that read all of it slowly.
let librarySearchSkipped = [];
// The vault's field names and the values each holds, pushed once when its text is read. What the completion menu offers; empty until a vault is open.
let filterHintFields = [];
// What the completion menu is offering under the search box, and which row is picked.
let filterMenuItems = [];
let filterMenuIndex = 0;

function highlightSnippet(snippet) {
  return escapeText(snippet || '')
    .split('').join('<mark class="library-hit-mark">')
    .split('').join('</mark>');
}
function searchHitHtml(hit) {
  const path = (hit && hit.absPath) || '';
  const anchor = (hit && hit.anchor) || '';
  // The line carries the row to the match itself; the anchor is the fallback.
  const line = (hit && hit.startLine) || 0;
  // Matched by one of the note's other names: the row still says the file, so the name that actually matched has to be on it or the row reads as a mystery.
  const alias = (hit && hit.alias) || '';
  const also = alias ? `<span class="library-hit-alias">${escapeText(alias)}</span>` : '';
  return `<button type="button" class="library-hit" data-open-path="${escapeAttr(path)}" data-anchor="${escapeAttr(anchor)}" data-line="${escapeAttr(String(line))}" title="${escapeAttr(path)}"><span class="library-hit-title">${documentNameMarkup(path, also)}</span><span class="library-hit-snippet">${highlightSnippet(hit && hit.snippet)}</span></button>`;
}
function bindSearchHits() {
  librarySearchResults.querySelectorAll('[data-open-path]').forEach((button) => {
    // On the press, through the same helper the file rows use, and for the same reason: a vault still being read answers this query about three times a second, every answer rewrites these rows, and a rebuild landing between press and release replaces the button so the click never fires.
    bindLibraryRowPress(button, () => {
      const path = button.dataset.openPath;
      const anchor = button.dataset.anchor || '';
      const line = Number(button.dataset.line) || 0;
      // Open (or focus) the file, then scroll to the match once it renders — to the line it is on, or the heading above it if the line cannot be placed.
      pendingSearchJump = anchor || line ? { path, anchor, line } : null;
      // A hit is a place in the text, so it is worth leaving the map for; the anchor it carries has nothing to scroll to on a canvas.
      graphExitPending = true;
      send({ command: 'openRecent', path });
    });
  });
}
// Fill the results list, and let the pane decide which of its three lists is showing. A non-empty query shows the results (loading, error, no-results, or the ranked hits); an empty one puts back whatever was standing, exactly as it was.
function renderLibrarySearch() {
  const active = !!librarySearchQuery;
  renderLibraryLists();
  if (!active) {
    librarySearchResults.innerHTML = '';
    return;
  }
  if (librarySearchError) {
    const message = (librarySearchError && librarySearchError.message) || 'Search failed.';
    librarySearchResults.innerHTML = `<p class="library-empty">${escapeText(message)}</p>`;
    return;
  }
  const hits = librarySearchHits || [];
  // Nothing drawn yet: the count line is the whole answer, and the ring in it is the only thing saying a vault is being read.
  if (librarySearchLoading && !hits.length) {
    librarySearchResults.innerHTML = searchCountHtml(hits);
    return;
  }
  const note = searchNoteHtml();
  if (!hits.length) {
    librarySearchResults.innerHTML = note + `<p class="library-empty">No matches.</p>`;
    return;
  }
  librarySearchResults.innerHTML = note + searchCountHtml(hits) + hits.map(searchHitHtml).join('');
  bindSearchHits();
}
// The line above the rows: what is drawn, and whether more is coming. One waiting mark for the whole pane — rows from a query the field has moved on from sit under a turning ring rather than under nothing.
function searchCountHtml(hits) {
  const ring = librarySearchLoading
    ? `<span class="lt-spinner library-results-spinner" aria-hidden="true"></span>`
    : '';
  // Rows are counted only where they answer the query in the box. While one is still being read for, what is drawn otherwise belongs to the query before it.
  const answering = librarySearchHitsQuery === librarySearchQuery && hits.length;
  const count = librarySearchLoading && !answering ? 'Searching…' : searchCountText(hits);
  // The names ride on the element's own title, the way a result row already carries its path. No new class, so nothing else on screen moves.
  const names = librarySearchSkipped.length
    ? ` title="${escapeText(librarySearchSkipped.join(', '))}"`
    : '';
  return `<p class="library-results-count"${names}>${ring}${escapeText(count)}</p>`;
}
// A row is a match and one file can hold three, so a cut list says what it was cut to in files, counted off the rows rather than kept as a second copy of the host's cap. While the vault is still being read, both counts say so: the cap is over what has been read, not over the vault.
function searchCountText(hits) {
  if (!librarySearchTruncated) {
    return `${formatCountLabel(hits.length, 'result', 'results')}${librarySearchPartial ? ' so far' : ''}${skippedClause()}`;
  }
  const files = new Set(hits.map((hit) => (hit && hit.absPath) || '')).size;
  const read = librarySearchPartial ? ' read so far' : '';
  return `${formatCountLabel(hits.length, 'result', 'results')} in the first ${formatCountLabel(files, 'file', 'files')}${read}${skippedClause()}`;
}
// Joined to the sentence that already says what was cut, because a vault that read three quarters of itself and said nothing is the worse bug of the two.
function skippedClause() {
  const count = librarySearchSkipped.length;
  if (!count) return '';
  return ` · ${formatCountLabel(count, 'folder', 'folders')} of generated files not read`;
}
// What the box made of what was typed. A plain word query says nothing — it would only repeat the field back — so this appears the moment there is syntax in it, and names a field the vault has never set rather than leaving an empty list to be read as "nothing matches".
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
  updateLibrarySearchClear();
  if (!query) {
    librarySearchHits = null;
    librarySearchHitsQuery = '';
    librarySearchError = null;
    librarySearchLoading = false;
    librarySearchPartial = false;
    librarySearchUnderstood = '';
    librarySearchUnknownFields = [];
    renderLibrarySearch();
    return;
  }
  librarySearchLoading = true;
  // Nothing has answered this one yet, so nothing on screen is part of its answer.
  librarySearchPartial = false;
  librarySearchError = null;
  renderLibrarySearch();
  send({ command: 'search', query, today: localDateStamp() });
}
function updateLibrarySearchClear() {
  librarySearchClear.hidden = !librarySearch.value;
}
function clearLibrarySearch() {
  if (librarySearchTimer) clearTimeout(librarySearchTimer);
  librarySearchTimer = 0;
  closeFilterMenu();
  librarySearch.value = '';
  updateLibrarySearchClear();
  runLibrarySearch('');
  librarySearch.focus();
}
// The reader's own date, so `due:<friday` means their Friday. The host cannot ask the machine this without another crate, and the page has it for free.
function localDateStamp() {
  const now = new Date();
  const pad = (part) => String(part).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
librarySearch.addEventListener('input', () => {
  const value = librarySearch.value;
  updateLibrarySearchClear();
  if (librarySearchTimer) clearTimeout(librarySearchTimer);
  librarySearchTimer = window.setTimeout(() => runLibrarySearch(value), SEARCH_DEBOUNCE_MS);
});
librarySearchClear.addEventListener('click', clearLibrarySearch);
// The completion menu takes the arrows, Enter and the first Escape; only then does Escape clear the field and return to the tree.
librarySearch.addEventListener('keydown', (event) => {
  if (filterMenuKeydown(event)) return;
  if (event.key === 'Escape' && librarySearch.value) {
    event.stopPropagation();
    clearLibrarySearch();
  }
});
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || findOpen || !librarySearchQuery) return;
  event.preventDefault();
  clearLibrarySearch();
});
// Where in the vault a row points, which is what makes two answers to the same query agree about a row they both found.
function searchHitKey(hit) {
  return `${(hit && hit.absPath) || ''}:${(hit && hit.startLine) || 0}:${(hit && hit.snippet) || ''}`;
}
// A vault still being read answers the same query several times, each ranking everything it has read so far. Rows already drawn keep their place and their click target — a list that re-sorted under a reaching hand would be a worse fault than the silence this replaces — so a partial answer only adds what is new underneath. The one re-sort is the final answer, which is also when the ring goes.
function mergeSearchHits(arriving, sameQuery) {
  const drawn = sameQuery ? librarySearchHits || [] : [];
  if (!drawn.length) return arriving;
  const seen = new Set(drawn.map(searchHitKey));
  return drawn.concat(arriving.filter((hit) => !seen.has(searchHitKey(hit))));
}
window.leafSetSearchResults = (payload) => {
  const data = payload || {};
  const query = typeof data.query === 'string' ? data.query : '';
  // Drop stale responses: the input has moved on since this query was sent.
  if (query !== librarySearchQuery) return;
  // A payload that says nothing about it is a finished one: a host that never streams must never leave a ring turning.
  librarySearchPartial = !!data.partial;
  librarySearchLoading = librarySearchPartial;
  if (data.error) {
    librarySearchError = data.error;
    librarySearchHits = null;
    librarySearchTruncated = false;
    librarySearchPartial = false;
    librarySearchLoading = false;
    librarySearchHitsQuery = '';
  } else {
    const arriving = Array.isArray(data.hits) ? data.hits : [];
    librarySearchError = null;
    librarySearchHits = librarySearchPartial
      ? mergeSearchHits(arriving, librarySearchHitsQuery === query)
      : arriving;
    librarySearchHitsQuery = query;
    librarySearchTruncated = !!data.truncated;
    librarySearchUnderstood = typeof data.understood === 'string' ? data.understood : '';
    librarySearchUnknownFields = Array.isArray(data.unknownFields) ? data.unknownFields : [];
    librarySearchSkipped = Array.isArray(data.skipped) ? data.skipped : [];
  }
  renderLibrarySearch();
};
// What the box can offer as you type: the vault's own field names and the values each is known to hold, plus the three built-in names that are not frontmatter at all. Pushed once per vault read, so a keystroke costs nothing.
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
// The names a filter can use that are not somebody's frontmatter, with what each one holds. `ext:` reads the one table of formats rather than a second list.
function filterBuiltinNames() {
  return [
    { name: 'in', values: [] },
    { name: 'ext', values: window.__leafDocumentExts || [] },
    { name: 'task', values: ['open', 'done'] },
  ];
}
// What to offer for the token being typed: a value when the token already names a field, a field name otherwise. Capped, because a menu longer than the pane is a list nobody reads.
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
// Arrow keys walk the menu, Enter takes one, Escape closes it without touching the box — Escape only clears the field when there is no menu to dismiss first.
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
// Paint the pane from the seeded settings, then ask for the folder on screen. The painting goes to the settle pass, which runs it as one prepare, one set of readings and one set of writes at the end of evaluation; the folder is asked for here, because a command is not a page reading.
onSettle({
  prepare: prepareSettledLibraryDraw,
  read: readSettledLibraryDraw,
  apply: applySettledLibraryDraw,
});
send({ command: 'getFolder', path: libraryProjectPath });
const LEAF_VERSION = typeof window.__leafVersion === 'string' ? window.__leafVersion : null;
