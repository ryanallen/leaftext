// A table on the whole window. This is deliberately a reader in phase 1: it copies the rendered table, never the buffer, so closing it cannot write anything.
function tableSheetOverlayElement() {
  return app ? app.querySelector('.table-sheet-overlay') : null;
}

function closeTableSheet() {
  const overlay = tableSheetOverlayElement();
  if (!overlay) return;
  // A term is only ever raised from a word inside this table, so it leaves with it rather than standing over a page it never came from. Before the removal, so the focus the term hands back is a link about to go and the opener below has the last word.
  dismissGlossary();
  const opener = overlay.__tableSheetOpener;
  const scrim = overlay.__tableSheetScrim;
  overlay.remove();
  if (scrim) scrim.remove();
  leafFocusForKeyboard(opener);
}

function tableSheetGrid(table) {
  const grid = document.createElement('div');
  // `document-body` as well, because the theme's link color and a glossary word's dotted underline are only written behind that class.
  grid.className = 'table-sheet-grid document-body';
  const copy = table.cloneNode(true);
  copy.classList.add('table-sheet-table');
  copy.removeAttribute('contenteditable');
  copy.querySelectorAll('[contenteditable], [id]').forEach((element) => {
    element.removeAttribute('contenteditable');
    element.removeAttribute('id');
  });
  grid.appendChild(copy);
  return grid;
}

function scrollTableSheetHorizontally(event) {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey || !event.deltaY) return;
  const grid = event.currentTarget;
  if (!grid || grid.scrollWidth <= grid.clientWidth) return;
  const end = grid.scrollWidth - grid.clientWidth;
  grid.scrollLeft = Math.max(0, Math.min(end, grid.scrollLeft + event.deltaY));
  event.preventDefault();
}

function openTableSheet(table, opener) {
  if (!app || !table || !tableWysiwygSafe(table)) return;
  closeTableSheet();
  const scrim = document.createElement('div');
  scrim.className = 'lt-backdrop';
  scrim.addEventListener('click', closeTableSheet);
  const overlay = document.createElement('section');
  overlay.className = 'table-sheet-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Table, full window');
  overlay.__tableSheetOpener = opener || null;
  overlay.__tableSheetScrim = scrim;
  const head = document.createElement('header');
  head.className = 'table-sheet-head';
  const title = document.createElement('h2');
  title.className = 'table-sheet-title';
  title.textContent = 'Table';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'leaf-sheet-close table-sheet-close';
  close.title = 'Close — or press Escape';
  close.setAttribute('aria-label', 'Close the full-window table');
  close.innerHTML = `<span class="lt-icon lt-icon-close"></span>`;
  close.addEventListener('click', closeTableSheet);
  head.append(title, close);
  const grid = tableSheetGrid(table);
  grid.addEventListener('wheel', scrollTableSheetHorizontally, { passive: false });
  overlay.append(head, grid);
  app.append(scrim, overlay);
  if (window.__leafFrameless || window.__leafMacFrame) dragWindowFrom(head);
  window.requestAnimationFrame(() => {
    scrim.classList.add('open');
    overlay.classList.add('open');
  });
}

function bindTableSheet() {
  if (!app || currentDocumentFormat !== 'markdown') return;
  app.querySelectorAll('.table-lane > table[data-block-kind="table"]').forEach((table) => {
    if (!tableWysiwygSafe(table)) return;
    const lane = table.parentElement;
    if (!lane || lane.querySelector(':scope > .table-sheet-open')) return;
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.className = 'table-sheet-open';
    opener.title = 'Open table on the whole window';
    opener.setAttribute('aria-label', 'Open table on the whole window');
    opener.innerHTML = `<span class="lt-icon lt-icon-expand"></span>`;
    opener.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTableSheet(table, opener);
    });
    lane.appendChild(opener);
  });
}

function onTableSheetKey(event) {
  if (event.key !== 'Escape' || !tableSheetOverlayElement()) return;
  // A term raised over the table takes Escape first. This hears the key in the capture phase and the term's own listener waits in the bubble phase, so without the yield Escape closes the table underneath and strands the term over the bare document.
  if (!glossarySheet.hidden) return;
  event.preventDefault();
  event.stopPropagation();
  closeTableSheet();
}
document.addEventListener('keydown', onTableSheetKey, true);
