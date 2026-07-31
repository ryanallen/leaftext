// ---- Code view: sticky headings ---------------------------------------------
// The Markdown heading you are reading under, pinned at the top of the source. A
// deeper heading stacks below it; one at the same level or above replaces it, so
// the rows read as the trail down to where you are.
//
// Ours rather than Monaco's: its stickyScroll contribution is not in the vendored
// bundle (it wants a symbol provider and a language service we do not ship), and
// drawing the rows ourselves is what lets them sit ABOVE the page's edge fade
// rather than under its wash. Monaco's own colorizer draws the line, so a row is
// the line it stands for.

// How many rows may stack. Past this the trail costs more room than it tells.
const STICKY_MAX_ROWS = 5;
// A rescan walks every line of the buffer, so no keystroke may trigger one.
const STICKY_RESCAN_MS = 400;

let stickyMonaco = null;
// The positioned box (carries the dissolve below it) and the clipped rows inside
// it — the rows slide up out of the box as a section ends, so the box clips.
let stickyHost = null;
let stickyRowsHost = null;
// Every heading's section: the heading's own line, the last line it owns, and its
// level. Document order, so the nesting chain is a forward walk.
let stickySections = null;
// What is on screen already, so a scroll that changes nothing redraws nothing.
let stickyRendered = '';
let stickySubs = [];
let stickyRescanTimer = 0;

// Every ATX heading in the buffer, with the span of lines it owns: up to the next
// heading at its level or above. Fenced code and front matter are skipped — a `#`
// in either is not a heading.
function markdownHeadingSections(model) {
  const lines = model.getLinesContent();
  const heads = [];
  let index = 0;
  if (/^---\s*$/.test(lines[0] || '')) {
    for (let i = 1; i < lines.length; i += 1) {
      if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
        index = i + 1;
        break;
      }
    }
  }
  let fence = '';
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    const rail = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (rail && rail[1][0] === fence[0] && rail[1].length >= fence.length) fence = '';
      continue;
    }
    if (rail) {
      fence = rail[1];
      continue;
    }
    const head = line.match(/^ {0,3}(#{1,6})(\s|$)/);
    if (head) heads.push({ start: index + 1, level: head[1].length });
  }
  // Close each section at the first later heading that is its equal or its senior;
  // a stack does it in one pass, whatever the nesting.
  const sections = heads.map((head) => ({
    start: head.start,
    end: lines.length,
    level: head.level,
  }));
  const open = [];
  sections.forEach((section, i) => {
    while (open.length && sections[open[open.length - 1]].level >= section.level) {
      sections[open.pop()].end = section.start - 1;
    }
    open.push(i);
  });
  return sections;
}

// Which sections are sticky right now, and how far the stack is pushed up.
//
// Each row owns a slot: row 0 the first line-height under the top edge, row 1 the
// next. A section is in the stack when its heading has scrolled past its slot and
// its last line has not. When that last line is *inside* the slot the section is
// on its way out, so the stack slides up by how far it has come — which is what
// makes the swap read as one heading pushing the other off rather than a blink.
function stickyRowsNow() {
  const lineHeight = monacoEditor.getOption(stickyMonaco.editor.EditorOption.lineHeight);
  const scrollTop = monacoEditor.getScrollTop();
  const visible = monacoEditor.getVisibleRanges();
  const topLine = visible && visible.length ? visible[0].startLineNumber : 1;
  const limit = topLine + STICKY_MAX_ROWS;
  const rows = [];
  let shift = 0;
  for (const section of stickySections) {
    if (section.start > limit) break;
    if (section.end < topLine) continue;
    const slotTop = rows.length * lineHeight;
    const startBottom = monacoEditor.getBottomForLineNumber(section.start) - scrollTop;
    const endTop = monacoEditor.getTopForLineNumber(section.end) - scrollTop;
    const endBottom = monacoEditor.getBottomForLineNumber(section.end) - scrollTop;
    if (slotTop > endTop && slotTop <= endBottom) {
      rows.push(section.start);
      shift = Math.min(0, endBottom - (slotTop + lineHeight));
      break;
    }
    // Its heading is still on screen below the stack, so nothing deeper can be
    // sticky either.
    if (slotTop + lineHeight <= startBottom) break;
    rows.push(section.start);
    if (rows.length === STICKY_MAX_ROWS) break;
  }
  return { rows, shift, lineHeight };
}

function hideStickyHeadings() {
  if (!stickyHost || stickyHost.hidden) return;
  stickyHost.hidden = true;
  stickyRowsHost.innerHTML = '';
  stickyRendered = '';
}

function renderStickyHeadings() {
  if (!stickyHost || !monacoEditor || !stickyMonaco) return;
  const model = monacoEditor.getModel();
  if (!model || !stickySections || !stickySections.length) {
    hideStickyHeadings();
    return;
  }
  const state = stickyRowsNow();
  if (!state.rows.length || !state.lineHeight) {
    hideStickyHeadings();
    return;
  }
  // Geometry is Monaco's, read back rather than restated, so the rows land on the
  // same columns the real lines do — gutter width included, which grows with the
  // line count.
  const info = monacoEditor.getLayoutInfo();
  const font = monacoEditor.getOption(stickyMonaco.editor.EditorOption.fontInfo);
  const key = [
    state.rows.join(','),
    state.shift,
    state.lineHeight,
    info.lineNumbersLeft,
    info.lineNumbersWidth,
    info.contentLeft,
    font.fontFamily,
    font.fontSize,
  ].join('|');
  if (key === stickyRendered) return;
  stickyRendered = key;
  stickyHost.hidden = false;
  stickyHost.style.height = `${Math.max(0, state.rows.length * state.lineHeight + state.shift)}px`;
  stickyHost.style.fontFamily = font.fontFamily;
  stickyHost.style.fontSize = `${font.fontSize}px`;
  stickyHost.style.letterSpacing = `${font.letterSpacing}px`;
  stickyRowsHost.innerHTML = state.rows
    .map((line, slot) => {
      const top = slot * state.lineHeight + state.shift;
      return (
        `<div class="code-sticky-row" data-sticky-line="${line}" data-sticky-slot="${slot}"` +
        ` style="top:${top}px;height:${state.lineHeight}px;line-height:${state.lineHeight}px">` +
        `<span class="code-sticky-number" style="left:${info.lineNumbersLeft}px;width:${info.lineNumbersWidth}px">${line}</span>` +
        `<span class="code-sticky-text" style="left:${info.contentLeft}px">` +
        stickyMonaco.editor.colorizeModelLine(model, line) +
        '</span></div>'
      );
    })
    .join('');
}

// Clicking a row takes you to its heading, landing it exactly where the row was
// standing — so the thing you clicked does not move.
function onStickyRowMouseDown(event) {
  const row = event.target.closest && event.target.closest('.code-sticky-row');
  if (!row || !monacoEditor || !stickyMonaco) return;
  event.preventDefault();
  const line = Number(row.dataset.stickyLine);
  const slot = Number(row.dataset.stickySlot);
  if (!Number.isFinite(line)) return;
  const lineHeight = monacoEditor.getOption(stickyMonaco.editor.EditorOption.lineHeight);
  monacoEditor.setScrollTop(
    Math.max(0, monacoEditor.getTopForLineNumber(line) - (Number.isFinite(slot) ? slot : 0) * lineHeight)
  );
  monacoEditor.focus();
}

function scheduleStickyRescan() {
  if (stickyRescanTimer) clearTimeout(stickyRescanTimer);
  stickyRescanTimer = setTimeout(() => {
    stickyRescanTimer = 0;
    const model = monacoEditor && monacoEditor.getModel();
    if (!model || !stickyHost) return;
    stickySections = markdownHeadingSections(model);
    stickyRendered = '';
    renderStickyHeadings();
  }, STICKY_RESCAN_MS);
}

// A theme swap rewrites what the colorizer's classes mean, so the rows have to be
// colored again — the row set has not changed, so nothing else would redraw them.
function restyleStickyHeadings() {
  if (!stickyHost) return;
  stickyRendered = '';
  renderStickyHeadings();
}

// Called by createMonacoEditor once the editor is up, and undone by
// disposeMonacoEditor. Markdown only: the other formats have no headings, and
// their blocks are values, not a trail you can be lost in.
function setupStickyHeadings(monaco) {
  const model = monacoEditor && monacoEditor.getModel();
  if (!model || model.getLanguageId() !== 'markdown') return;
  stickyMonaco = monaco;
  stickyHost = document.createElement('div');
  stickyHost.className = 'code-sticky';
  stickyHost.hidden = true;
  stickyHost.setAttribute('aria-hidden', 'true');
  stickyRowsHost = document.createElement('div');
  stickyRowsHost.className = 'code-sticky-rows';
  stickyHost.appendChild(stickyRowsHost);
  // A sibling of the editor, not a child: the rows have to out-paint the page's
  // edge fade, which is outside the editor entirely.
  app.appendChild(stickyHost);
  stickyRowsHost.addEventListener('mousedown', onStickyRowMouseDown);
  stickySections = markdownHeadingSections(model);
  stickySubs = [
    monacoEditor.onDidScrollChange(renderStickyHeadings),
    monacoEditor.onDidLayoutChange(renderStickyHeadings),
    monacoEditor.onDidChangeModelContent(scheduleStickyRescan),
  ];
  renderStickyHeadings();
}

function teardownStickyHeadings() {
  stickySubs.forEach((sub) => sub.dispose());
  stickySubs = [];
  if (stickyRescanTimer) {
    clearTimeout(stickyRescanTimer);
    stickyRescanTimer = 0;
  }
  if (stickyHost) stickyHost.remove();
  stickyHost = null;
  stickyRowsHost = null;
  stickySections = null;
  stickyRendered = '';
  stickyMonaco = null;
}
