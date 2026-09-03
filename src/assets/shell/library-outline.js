// The open document's headings, in the pane's one box: the six depths measured once, then the rows drawn a window at a time.
//
// Its own fragment because `library.js` is at the ceiling a hand-written file is held to. It loads straight after that file, so the pane's elements, the row binding and the reading position are all there by the time anything here runs.

// The frame the outline is waiting on. Measuring the row heights and drawing the window is layout, and it is not a cost a document open may carry: every row at once was 5ms at sixty headings and 329ms at the app's own worst case.
let libraryOutlineFrame = 0;
const libraryOutlineScroll = libraryOutline.parentElement;
let libraryOutlineSource = null;
let libraryOutlineOffsets = [0];
let libraryOutlineShallowest = 1;
let libraryOutlineWindowStart = -1;
let libraryOutlineWindowEnd = -1;
// Whether the outline is what the box should be holding at all. A document with fewer than two headings has none, so the files stay.
function libraryOutlineShowing() {
  return libraryOutlineOpen && readDocumentOutlineRows().length > 0;
}
// Draw the headings on the frame after the document has painted, never inside its render.
function scheduleLibraryOutline() {
  if (libraryOutlineFrame) return;
  libraryOutlineFrame = window.requestAnimationFrame(() => {
    libraryOutlineFrame = 0;
    renderLibraryOutline();
  });
}
// The folder the back row returns to, by the name the reader last saw at the end of the trail.
function libraryOutlineFolderName() {
  const here = libraryChain[libraryChain.length - 1];
  return (here && here.name) || libraryRootLabel();
}
// The row above the headings: the pane's own back row, pointing at the file list rather than at a folder.
function outlineBackRowHtml() {
  const name = libraryOutlineFolderName();
  const label = `Back to ${name}`;
  return `<button type="button" class="library-nav-folder library-nav-up" data-close-outline="1" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${BACK_ARROW_SVG}<span class="library-file-label">${escapeText(name)}</span></button>`;
}
// One heading. Its step in is measured from the shallowest heading this document has rather than from `h1`, so a note whose sections are all `##` is not drawn indented under nothing.
function outlineRowHtml(row, shallowest, current) {
  const depth = Math.min(Math.max(row.level - shallowest, 0), 5);
  const selected = current ? ' is-selected' : '';
  const aria = current ? ' aria-current="true"' : '';
  return `<button type="button" class="library-outline-row library-outline-depth-${depth}${selected}"${aria} data-outline-section="${escapeAttr(row.id)}" title="${escapeAttr(row.text)}"><span class="library-file-label">${escapeText(row.text)}</span></button>`;
}
function outlineNoteHtml(count) {
  return `<div class="library-outline-note"><span class="library-outline-note-label">On this page</span><span class="library-outline-count">${formatCountLabel(count, 'heading', 'headings')}</span></div>`;
}
// One sample of each of the six depths, measured once. A row is one line at a height its depth decides, so every row's place is arithmetic over those six and no row has to be mounted to be placed.
function measureLibraryOutline(rows) {
  libraryOutlineShallowest = rows.reduce((least, row) => Math.min(least, row.level), rows[0].level);
  const samples = Array.from({ length: 6 }, (_, depth) => outlineRowHtml({ level: libraryOutlineShallowest + depth, id: '', text: 'Measure' }, libraryOutlineShallowest, false)).join('');
  libraryOutline.innerHTML = `${outlineBackRowHtml()}${outlineNoteHtml(rows.length)}<div class="library-project" data-outline-window="1">${samples}</div>`;
  renderLibraryLists();
  const measured = Array.from(libraryOutline.querySelectorAll('.library-outline-row'), (row) => {
    const box = row.getBoundingClientRect();
    const margin = Number.parseFloat(getComputedStyle(row).marginBottom) || 0;
    return box.height + margin;
  });
  const firstMeasured = measured.find((height) => height > 0) || 24;
  const heights = measured.map((height) => height || firstMeasured);
  libraryOutlineOffsets = [0];
  for (const row of rows) {
    const depth = Math.min(Math.max(row.level - libraryOutlineShallowest, 0), 5);
    libraryOutlineOffsets.push(libraryOutlineOffsets[libraryOutlineOffsets.length - 1] + heights[depth]);
  }
  libraryOutlineSource = rows;
  libraryOutlineWindowStart = -1;
  libraryOutlineWindowEnd = -1;
}
function outlineIndexAtOffset(offset) {
  let low = 0;
  let high = libraryOutlineOffsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (libraryOutlineOffsets[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}
// Only the rows in the pane, with a pane's worth either side so a wheel or a key crosses a boundary before blank space can appear. The padding above and below stands in for the rest, which is what keeps the scrollbar measuring the whole document.
function drawLibraryOutlineWindow(rows, force) {
  const windowBox = libraryOutline.querySelector('[data-outline-window]');
  if (!windowBox) return;
  const paneHeight = libraryOutlineScroll.clientHeight || libraryOutlineScroll.getBoundingClientRect().height || libraryOutlineOffsets[rows.length];
  const rowsTop = windowBox.offsetTop || 0;
  const visibleTop = Math.max(0, libraryOutlineScroll.scrollTop - rowsTop);
  const start = outlineIndexAtOffset(Math.max(0, visibleTop - paneHeight));
  const end = Math.min(rows.length, outlineIndexAtOffset(visibleTop + paneHeight * 2) + 1);
  if (!force && start === libraryOutlineWindowStart && end === libraryOutlineWindowEnd) {
    lightLibraryOutlineSection(readerSectionAtReadingLine());
    return;
  }
  libraryOutlineWindowStart = start;
  libraryOutlineWindowEnd = end;
  const current = readerSectionAtReadingLine();
  windowBox.innerHTML = rows.slice(start, end).map((row, at) => outlineRowHtml(row, libraryOutlineShallowest, row.id === current).replace(' data-outline-section=', ` data-outline-index="${start + at}" data-outline-section=`)).join('');
  windowBox.style.setProperty('padding-top', `${libraryOutlineOffsets[start]}px`);
  windowBox.style.setProperty('padding-bottom', `${libraryOutlineOffsets[rows.length] - libraryOutlineOffsets[end]}px`);
  bindLibraryOutlineRows(force);
}
function renderLibraryOutline() {
  const rows = readDocumentOutlineRows();
  if (!libraryOutlineShowing()) {
    libraryOutline.innerHTML = '';
    libraryOutlineSource = null;
    libraryOutlineOffsets = [0];
    libraryOutlineWindowStart = -1;
    libraryOutlineWindowEnd = -1;
    renderLibraryLists();
    return;
  }
  const changed = rows !== libraryOutlineSource;
  if (changed) measureLibraryOutline(rows);
  drawLibraryOutlineWindow(rows, changed);
  renderLibraryLists();
}
function bindLibraryOutlineRows(bindBack) {
  const back = libraryOutline.querySelector('[data-close-outline]');
  if (back && bindBack) {
    bindLibraryRowPress(back, () => {
      libraryOutlineOpen = false;
      renderLibraryLists();
    });
  }
  for (const button of libraryOutline.querySelectorAll('[data-outline-section]')) {
    // The jump the document's own heading links already make, so a section is reached one way and the host learns no new command.
    bindLibraryRowPress(button, () => {
      send({ command: 'openLink', href: '#' + encodeURIComponent(button.dataset.outlineSection), scroll_anchor: currentScrollAnchor() });
    });
    button.addEventListener('keydown', (event) => {
      const index = Number(button.dataset.outlineIndex);
      const rows = readDocumentOutlineRows();
      const paneHeight = libraryOutlineScroll.clientHeight || libraryOutlineOffsets[rows.length];
      let target = index;
      if (event.key === 'ArrowUp') target -= 1;
      else if (event.key === 'ArrowDown') target += 1;
      else if (event.key === 'PageUp') target = outlineIndexAtOffset(Math.max(0, libraryOutlineOffsets[index] - paneHeight));
      else if (event.key === 'PageDown') target = outlineIndexAtOffset(libraryOutlineOffsets[index] + paneHeight);
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = rows.length - 1;
      else return;
      event.preventDefault();
      target = Math.min(Math.max(target, 0), rows.length - 1);
      libraryOutlineScroll.scrollTop = libraryOutlineOffsets[target];
      drawLibraryOutlineWindow(rows, false);
      const focused = Array.from(libraryOutline.querySelectorAll('[data-outline-index]')).find((row) => Number(row.dataset.outlineIndex) === target);
      if (focused) focused.focus();
    });
  }
}
// The folder the back row names arrives from the host after the document does, so the row is drawn before there is a folder to name. Only its label is put right: rebuilding the rows for it would pay the whole list's layout a second time.
function refreshLibraryOutlineBackRow() {
  const back = libraryOutline.querySelector('[data-close-outline]');
  if (!back) return;
  const name = libraryOutlineFolderName();
  back.setAttribute('title', `Back to ${name}`);
  back.setAttribute('aria-label', `Back to ${name}`);
  const label = back.querySelector('.library-file-label');
  if (label) label.textContent = name;
}
// Move the mark to the row for the section being read. A class moved rather than the list redrawn: the rows only change when the document does.
function lightLibraryOutlineSection(section) {
  if (libraryOutline.hidden) return;
  for (const row of libraryOutline.querySelectorAll('.library-outline-row')) {
    const mine = row.dataset.outlineSection === section;
    row.classList.toggle('is-selected', mine);
    if (mine) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
  }
}
libraryOutlineScroll.addEventListener('scroll', () => {
  if (libraryOutlineShowing()) scheduleLibraryOutline();
}, { passive: true });
