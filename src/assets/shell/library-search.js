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
// The vault's field names and the values each holds, pushed when its text is read — which the host starts as the reader arrives in the vault — and again whenever a note's frontmatter moves. What the completion menu offers; empty until a vault is open, and emptied by the host as one is left.
let filterHintFields = [];
// What the completion menu is offering under the search box, and which row is picked.
let filterMenuItems = [];
let filterMenuIndex = 0;

function highlightSnippet(snippet) {
  return escapeText(snippet || '')
    .split('').join('<mark class="library-hit-mark">')
    .split('').join('</mark>');
}
// The button for one match, built once and kept. The map below hands the same element back on every later answer, so the listener bound here, the focus ring resting on it and a press half-way through it all outlive the answers arriving underneath.
function buildSearchHitRow(hit) {
  const button = document.createElement('button');
  button.setAttribute('type', 'button');
  button.className = 'library-hit';
  // On the press, through the same helper the file rows use: the row lives on now, but the two kinds sit in one list and a file row bound on the click beside a search row bound on the press is exactly how the swallowed click came back.
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
  updateSearchHitRow(button, hit);
  return button;
}
// What a row says, rewritten only where the match behind it moved. The key pins the path, the line and the snippet, so a kept row can differ only in the name that matched and in where the jump lands.
function updateSearchHitRow(button, hit) {
  const path = (hit && hit.absPath) || '';
  const anchor = (hit && hit.anchor) || '';
  // The line carries the row to the match itself; the anchor is the fallback.
  const line = (hit && hit.startLine) || 0;
  // Matched by one of the note's other names: the row still says the file, so the name that actually matched has to be on it or the row reads as a mystery.
  const alias = (hit && hit.alias) || '';
  const snippet = (hit && hit.snippet) || '';
  button.dataset.openPath = path;
  button.dataset.anchor = anchor;
  button.dataset.line = String(line);
  const drawn = button.leafSearchRow;
  if (drawn && drawn.path === path && drawn.alias === alias && drawn.snippet === snippet) return;
  button.leafSearchRow = { path, alias, snippet };
  button.setAttribute('title', path);
  const also = alias ? `<span class="library-hit-alias">${escapeText(alias)}</span>` : '';
  button.innerHTML = `<span class="library-hit-title">${documentNameMarkup(path, also)}</span><span class="library-hit-snippet">${highlightSnippet(snippet)}</span>`;
}
// Which element is drawn for which match, keyed the way `mergeSearchHits` decides two answers are describing the same one. A table this fragment owns rather than a key written back onto the element, which would be bytes re-parsed on every answer; this fragment is its only writer, so it stays out of state.js.
let librarySearchRowElements = new Map();
// Every write of the whole list drops the rows it had, so the map can never hand back an element that is no longer on the page. A cleared query, a vault left, a failure, a list with nothing drawn yet and an answer with no matches all come through here. A changed query does not: the pane keeps the last query's rows under the turning ring rather than covering them, so those elements never leave and handing them back is right.
function writeSearchResults(html) {
  librarySearchRowElements.clear();
  librarySearchResults.innerHTML = html;
}
// Fill the results list, and let the pane decide which of its three lists is showing. A non-empty query shows the results (loading, error, no-results, or the ranked hits); an empty one puts back whatever was standing, exactly as it was.
function renderLibrarySearch() {
  const active = !!librarySearchQuery;
  renderLibraryLists();
  if (!active) {
    writeSearchResults('');
    return;
  }
  if (librarySearchError) {
    const message = (librarySearchError && librarySearchError.message) || 'Search failed.';
    writeSearchResults(`<p class="library-empty">${escapeText(message)}</p>`);
    return;
  }
  const hits = librarySearchHits || [];
  // Nothing drawn yet: the count line and its ring, and under them the shape of the rows that are coming. Only here — the moment one real row exists, whether it is this query's first batch or the query before it, that row is the better answer and the branches below keep it.
  if (librarySearchLoading && !hits.length) {
    writeSearchResults(searchCountHtml(hits) + searchWaitingRowsHtml());
    return;
  }
  const note = searchNoteHtml();
  if (!hits.length) {
    writeSearchResults(note + `<p class="library-empty">No matches.</p>`);
    return;
  }
  drawSearchRows(note + searchCountHtml(hits), hits);
}
// The rows drawn against the ones already standing. A vault still being read answers this query once per fifty documents and every answer carries the rows before it, so reassigning the list destroyed hundreds of rows that had not moved — each with its listener, and one of them possibly holding the focus ring or a press. The head above them is two short elements that nothing presses, so it goes on being written whole.
function drawSearchRows(headHtml, hits) {
  const list = librarySearchResults;
  const drawn = librarySearchRowElements;
  const next = new Map();
  const rows = hits.map((hit) => {
    const key = searchHitKey(hit);
    const kept = drawn.get(key);
    if (kept) updateSearchHitRow(kept, hit);
    const row = kept || buildSearchHitRow(hit);
    next.set(key, row);
    return row;
  });
  librarySearchRowElements = next;
  // Out goes everything this answer does not carry: the rows it dropped, and the note and count line, which are rewritten whole.
  const keeping = new Set(rows);
  for (const node of Array.from(list.childNodes)) {
    if (!keeping.has(node)) node.remove();
  }
  // The head is built off the page and moved in, then each row is put where the answer wants it — and a row already standing there is left alone, because taking an element off the page and putting it back is what drops the focus ring resting on it.
  const head = document.createElement('div');
  head.innerHTML = headHtml;
  const wanted = Array.from(head.childNodes).concat(rows);
  wanted.forEach((node, at) => {
    if (list.childNodes[at] === node) return;
    list.insertBefore(node, list.childNodes[at] || null);
  });
}
// Three rows' worth of the shape a result has — a name and the two lines of matched words under it — so the pane holds what is coming rather than one word. Decoration: it is not a target, and nothing reads it out.
const SEARCH_WAITING_ROWS = 3;
function searchWaitingRowsHtml() {
  const row = '<span class="library-hit library-hit-waiting"><span class="lt-skeleton library-hit-waiting-title"></span><span class="lt-skeleton library-hit-waiting-line"></span><span class="lt-skeleton library-hit-waiting-line library-hit-waiting-line-short"></span></span>';
  return `<span aria-hidden="true">${row.repeat(SEARCH_WAITING_ROWS)}</span>`;
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
function mergeSearchHits(arriving, sameQuery, fileLimit) {
  const drawn = sameQuery ? librarySearchHits || [] : [];
  if (!drawn.length) return arriving;
  const seen = new Set(drawn.map(searchHitKey));
  return holdToFileLimit(drawn.concat(arriving.filter((hit) => !seen.has(searchHitKey(hit)))), fileLimit);
}
// The merged list stops where one host answer stops. Each answer is already cut to this many documents, so adding them together drew a list no answer could hold — a watched search climbed to 507 rows before the finishing answer replaced them with 150. Rows are kept in the order they were drawn and a document that is in keeps every row it has, so nothing on screen moves and no later slice can add a fifty-first document. An answer that names no ceiling is merged whole, which is what a host that does not stream is asking for.
function holdToFileLimit(hits, fileLimit) {
  if (!(fileLimit > 0)) return hits;
  const paths = new Set();
  return hits.filter((hit) => {
    const path = (hit && hit.absPath) || '';
    if (paths.has(path)) return true;
    if (paths.size >= fileLimit) return false;
    paths.add(path);
    return true;
  });
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
    // The document ceiling this answer was cut at, which is what holds the merged list to one answer's worth while the vault is still being read. The final answer is the whole vault's and replaces the list, so it needs none.
    const fileLimit = Number(data.fileLimit) || 0;
    librarySearchError = null;
    librarySearchHits = librarySearchPartial
      ? mergeSearchHits(arriving, librarySearchHitsQuery === query, fileLimit)
      : arriving;
    librarySearchHitsQuery = query;
    librarySearchTruncated = !!data.truncated;
    librarySearchUnderstood = typeof data.understood === 'string' ? data.understood : '';
    librarySearchUnknownFields = Array.isArray(data.unknownFields) ? data.unknownFields : [];
    librarySearchSkipped = Array.isArray(data.skipped) ? data.skipped : [];
  }
  renderLibrarySearch();
};
// What the box can offer as you type: the vault's own field names and the values each is known to hold, plus the three built-in names that are not frontmatter at all. Walked on the host's worker and pushed whole, so a keystroke costs nothing and a field written a moment ago is already here. It can arrive after the first search has been typed, which is what the redraw below is for.
window.leafSetFilterHints = (payload) => {
  const data = payload || {};
  filterHintFields = Array.isArray(data.fields) ? data.fields : [];
  // The vault can finish being read after the first search is already typed, so the token under the caret is offered the names that just arrived rather than waiting for another keystroke to reopen the menu.
  if (document.activeElement === librarySearch) openFilterMenu();
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
