// Named vault filters live beside the search box, while their result takes the document surface.
let savedViews = [];
let savedViewRows = [];
let savedViewNaming = false;
const savedViewsElement = document.getElementById('savedViews');
const saveViewButton = document.getElementById('saveViewButton');

function drawSavedViews() {
  if (!savedViewsElement) return;
  const available = Boolean(activeVaultId);
  savedViewsElement.hidden = !available;
  if (!available) return;
  const rows = savedViews.map((view) => `<div class="saved-view-row"><button type="button" class="saved-view-open" data-view-id="${view.id}">${escapeText(view.name)}</button><button type="button" class="saved-view-delete" data-view-id="${view.id}" aria-label="Delete ${escapeText(view.name)}"><span class="lt-icon lt-icon-close"></span></button></div>`).join('');
  const editor = savedViewNaming ? `<input class="saved-view-name" type="text" value="${escapeText(librarySearch.value.trim())}" aria-label="View name">` : '';
  savedViewsElement.innerHTML = `<p class="saved-views-title">Views</p>${editor}${rows}`;
  savedViewsElement.querySelectorAll('.saved-view-open').forEach((button) => button.addEventListener('click', () => send({ command: 'runView', id: Number(button.dataset.viewId) })));
  savedViewsElement.querySelectorAll('.saved-view-delete').forEach((button) => button.addEventListener('click', () => send({ command: 'deleteView', id: Number(button.dataset.viewId) })));
  const input = savedViewsElement.querySelector('.saved-view-name');
  if (input) {
    input.focus();
    input.select();
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { savedViewNaming = false; drawSavedViews(); }
      if (event.key === 'Enter' && input.value.trim()) { savedViewNaming = false; send({ command: 'saveView', name: input.value.trim(), query: librarySearch.value.trim() }); }
    });
  }
}

function updateSaveViewButton() {
  if (!saveViewButton) return;
  saveViewButton.hidden = !activeVaultId || !librarySearch.value.trim();
}

function beginSavedView() {
  if (!activeVaultId || !librarySearch.value.trim()) return;
  savedViewNaming = true;
  drawSavedViews();
}

if (saveViewButton) saveViewButton.addEventListener('click', beginSavedView);
librarySearch.addEventListener('input', updateSaveViewButton);
window.leafSetSavedViews = (views) => { savedViews = Array.isArray(views) ? views : []; drawSavedViews(); };
window.leafSetSavedViewResults = (results) => {
  savedViewRows = Array.isArray(results && results.rows) ? results.rows : [];
  librarySearch.value = '';
  runLibrarySearch('');
  libraryTree.innerHTML = `<section class="saved-view-surface"><p class="saved-views-title">Saved view</p>${savedViewRows.map((row) => `<button type="button" class="library-hit" data-open-path="${escapeText(row.absPath)}">${escapeText(row.title)}</button>`).join('')}${results && results.truncated ? '<p class="library-empty">First 1,000 documents — narrow the filter to see the rest.</p>' : ''}</section>`;
  libraryTree.querySelectorAll('[data-open-path]').forEach((row) => bindLibraryRowPress(row, () => send({ command: 'open', path: row.dataset.openPath })));
};
window.leafSavedViewWriteRefused = (message) => { if (message) console.warn(message); };
drawSavedViews();
updateSaveViewButton();
