// Find inside the open document — one bar over both views.
//
// Monaco's own find widget is not in the vendored bundle (see scripts/bundle-monaco.mjs) and our generated theme maps none of its colors, so it would arrive in Monaco's own defaults; two bars behaving differently in two views is also two keyboard paths to learn. So this is one bar, and underneath it the source view uses Monaco's searching (`findMatches`, decorations, `executeEdits`) while the reading view searches the text on the page.
//
// A replace in the reading view is a source splice on the editBlock path, never a DOM edit: the buffer in Rust is the document, and the page is a picture of it.

const findBar = document.getElementById('findBar');
const findInput = document.getElementById('findInput');
const findCount = document.getElementById('findCount');
const findReplaceRow = document.getElementById('findReplaceRow');
const findReplaceInput = document.getElementById('findReplaceInput');
const findReplaceToggle = document.getElementById('findReplaceToggle');
const findSelectAllButton = document.getElementById('findSelectAll');
const findFlagButtons = {
  matchCase: document.getElementById('findMatchCase'),
  wholeWord: document.getElementById('findWholeWord'),
  regex: document.getElementById('findRegex'),
  scoped: document.getElementById('findInSelection'),
};

// How Monaco decides where a word ends, for the whole-word toggle. Its own default list, written out because nothing in the bundle exposes it.
const FIND_WORD_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?';
// The two highlights the stylesheet paints: every match, and the one you are on.
const FIND_HIGHLIGHT_ALL = 'leaf-find-match';
const FIND_HIGHLIGHT_CURRENT = 'leaf-find-current';
// Past this the count is a number nobody reads and drawing every match costs more than the answer is worth. Monaco's own widget stops counting at 999 too.
const FIND_MATCH_CAP = 999;

let findOpen = false;
let findFlags = { matchCase: false, wholeWord: false, regex: false, scoped: false };
// The matches, in document order. Reading view: `{ start, end }` into the flattened page text. Source view: Monaco ranges.
let findMatches = [];
let findCurrent = -1;
let findTruncated = false;
let findInvalidPattern = false;
// The page's visible text as one string, and the map back to the text nodes it came from — a match found in a string has to become a DOM range before it can be drawn or replaced. It is a picture of the page rather than of the query, so it is kept until something redraws: a letter typed in the field changes what counts as a match, never what the page says.
let findFlatText = '';
let findTextNodes = [];
// The same records again, keyed on the text node, so asking where a node sits in the flat string is a read rather than a walk.
let findNodeRecords = new Map();
let findTextValid = false;
// What "find in selection" narrows to: a DOM range in the reading view, a Monaco range in the source view. Captured when the toggle goes on, off the kept range below.
let findScopeRange = null;
// The last thing the reader highlighted in the page. The toggle cannot read the selection when it is pressed — opening the bar focuses the field, and that collapses the page's own selection — so the highlight is kept as it is made and the toggle reads this instead.
let findKeptRange = null;
// The range the bar itself drew the current match with, where the web view has no highlight API and drawing means selecting it. Without this the keeper would record it and the reader's highlight would become whichever match they stepped onto. Held and compared rather than flagged around the call, because `selectionchange` arrives on a later task and a flag raised around it is already down by then.
let findPaintedRange = null;
let findMonacoScope = null;
let findMonacoDecorations = null;
// The document can be re-rendered under an open bar (an edit lands, a live reload), and every range it holds then points at nodes that are gone.
let findRenderObserver = null;

function findInSourceView() {
  return codeViewActive && !!monacoEditor;
}

// ---- the pattern ----------------------------------------------------------

// One regular expression for the reading view, built from the field and the toggles. A plain query is escaped, so `.` finds a period.
function findPattern(global) {
  findInvalidPattern = false;
  const query = findInput.value;
  if (!query) return null;
  let source = findFlags.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (findFlags.wholeWord) source = `(?<!\\w)(?:${source})(?!\\w)`;
  try {
    return new RegExp(source, (global ? 'g' : '') + (findFlags.matchCase ? '' : 'i'));
  } catch (error) {
    findInvalidPattern = true;
    return null;
  }
}

// ---- the reading view: the text on the page ------------------------------

function findRenderedBody() {
  return app.querySelector('.document-body');
}

// Something redrew the page, so the flattening is a picture of a page that is gone and the next search rebuilds before it reads.
function forgetRenderedText() {
  findTextValid = false;
}

// Flatten the page's text, keeping where each piece came from — once per redraw, not once per letter. On a megabyte document the walk is a third of what a keystroke costs, and nothing between two letters has moved the page.
function collectRenderedText() {
  if (findTextValid) return;
  findFlatText = '';
  findTextNodes = [];
  findNodeRecords = new Map();
  const body = findRenderedBody();
  // No page to flatten yet: nothing to keep either, so the next call looks again.
  if (!body) return;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue || '';
    if (!text) continue;
    const record = { node, start: findFlatText.length, end: findFlatText.length + text.length };
    findTextNodes.push(record);
    findNodeRecords.set(node, record);
    findFlatText += text;
  }
  findTextValid = true;
}

// The piece of text holding flat offset `at`. On a boundary either neighbor is the same DOM position, so whichever the search lands on is right.
function findNodeAt(at) {
  let low = 0;
  let high = findTextNodes.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = findTextNodes[middle];
    if (at < entry.start) high = middle - 1;
    else if (at > entry.end) low = middle + 1;
    else return entry;
  }
  return null;
}

function findRangeFor(match) {
  const from = findNodeAt(match.start);
  const to = findNodeAt(match.end);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, match.start - from.start);
  range.setEnd(to.node, match.end - to.start);
  return range;
}

// The first or last piece of text inside a subtree, as the flattening recorded it. An element end of the selection points at a child rather than at a letter, so this is what turns it into one.
function findEdgeRecord(node, last) {
  if (!node) return null;
  if (node.nodeType === 3) return findNodeRecords.get(node) || null;
  const children = node.childNodes;
  if (!children || !children.length) return null;
  for (let step = 0; step < children.length; step += 1) {
    const record = findEdgeRecord(children[last ? children.length - 1 - step : step], last);
    if (record) return record;
  }
  return null;
}

// Where one end of the captured selection sits in the flat text: a text node is its record plus the offset, an element is the edge of the child the offset points at.
function findFlatPoint(container, offset, atEnd) {
  if (!container) return null;
  if (container.nodeType === 3) {
    const record = findNodeRecords.get(container);
    return record ? Math.min(record.start + offset, record.end) : null;
  }
  const children = container.childNodes;
  if (!children) return null;
  const record = findEdgeRecord(children[atEnd ? offset - 1 : offset], atEnd);
  return record ? (atEnd ? record.end : record.start) : null;
}

// "Find in selection" as a pair of places in the flat text, read once a search: a candidate is then two integers compared rather than a DOM range built and asked. Null where either end is somewhere the flattening never walked, and the loop asks the DOM the way it always did.
function findScopeFlatBounds() {
  if (!findScopeRange) return null;
  const low = findFlatPoint(findScopeRange.startContainer, findScopeRange.startOffset, false);
  const high = findFlatPoint(findScopeRange.endContainer, findScopeRange.endOffset, true);
  if (low === null || high === null || high < low) return null;
  return { low, high };
}

// Whether two ranges name the same piece of the page. Both ends compared rather than the ranges themselves, because the bar hands its painted range to the selection and gets a different object back.
function findSameRange(one, other) {
  return (
    !!one &&
    !!other &&
    one.startContainer === other.startContainer &&
    one.startOffset === other.startOffset &&
    one.endContainer === other.endContainer &&
    one.endOffset === other.endOffset
  );
}

// Only matches inside the range "find in selection" captured.
function findWithinScope(range) {
  if (!range) return false;
  try {
    return (
      findScopeRange.comparePoint(range.startContainer, range.startOffset) >= 0 &&
      findScopeRange.comparePoint(range.endContainer, range.endOffset) <= 0
    );
  } catch (error) {
    return false;
  }
}

function collectRenderedMatches() {
  collectRenderedText();
  const pattern = findPattern(true);
  const found = [];
  findTruncated = false;
  if (!pattern) return found;
  // Where the selection sits, read once for the whole search. A range built per candidate cannot be bounded by the cap, because a candidate the selection rejects never counts toward it — the document's occurrence count rather than 999, which is a dropped frame a letter on a megabyte.
  const scope = findScopeFlatBounds();
  for (let match = pattern.exec(findFlatText); match; match = pattern.exec(findFlatText)) {
    // An expression that can match nothing would spin here forever.
    if (match[0] === '') {
      pattern.lastIndex += 1;
      continue;
    }
    const hit = { start: match.index, end: match.index + match[0].length };
    const kept = !findScopeRange
      ? true
      : scope
        ? hit.start >= scope.low && hit.end <= scope.high
        : findWithinScope(findRangeFor(hit));
    if (kept) found.push(hit);
    if (found.length >= FIND_MATCH_CAP) {
      findTruncated = true;
      break;
    }
  }
  return found;
}

function clearRenderedHighlights() {
  if (window.CSS && CSS.highlights) {
    CSS.highlights.delete(FIND_HIGHLIGHT_ALL);
    CSS.highlights.delete(FIND_HIGHLIGHT_CURRENT);
  }
}

// Draw with the CSS Custom Highlight API: no DOM mutation, so nothing the editing layer measures moves and there is no reflow. Where the web view does not have it (it landed in Safari 17.2), the current match goes into the page's own selection instead — visible everywhere, and still no mutation. Wrapping matches in `<mark>` is the one thing this must not do: `blockDomToMarkdown` would serialize the tags straight back into the file on the next commit.
function paintRenderedMatches() {
  if (!window.CSS || !CSS.highlights || typeof Highlight !== 'function') {
    const match = findMatches[findCurrent];
    const range = match ? findRangeFor(match) : null;
    const selection = window.getSelection();
    if (range && selection) {
      findPaintedRange = range;
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return;
  }
  const all = new Highlight();
  const current = new Highlight();
  findMatches.forEach((match, index) => {
    const range = findRangeFor(match);
    if (!range) return;
    if (index === findCurrent) current.add(range);
    else all.add(range);
  });
  CSS.highlights.set(FIND_HIGHLIGHT_ALL, all);
  CSS.highlights.set(FIND_HIGHLIGHT_CURRENT, current);
}

// Bring the current match into the reader, a third of the way down rather than flush against an edge.
function revealRenderedMatch() {
  const match = findMatches[findCurrent];
  const range = match ? findRangeFor(match) : null;
  if (!range) return;
  const rect = range.getBoundingClientRect();
  const view = app.getBoundingClientRect();
  const barHeight =
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-bar-height')) || 0;
  const top = view.top + barHeight;
  if (rect.top >= top && rect.bottom <= view.bottom) return;
  app.scrollTop += rect.top - top - (view.height - barHeight) / 3;
}

// ---- the source view: Monaco's own searching ------------------------------

function collectSourceMatches() {
  findTruncated = false;
  findInvalidPattern = false;
  const model = monacoEditor.getModel();
  if (!model || !findInput.value) return [];
  // Monaco answers an unparseable expression with no matches; the bar says which it is, so a half-typed `(` reads as unfinished rather than as absent.
  if (findFlags.regex && !findPattern(false)) return [];
  const found = model.findMatches(
    findInput.value,
    findMonacoScope || false,
    findFlags.regex,
    findFlags.matchCase,
    findFlags.wholeWord ? FIND_WORD_SEPARATORS : null,
    false,
    FIND_MATCH_CAP + 1
  );
  if (found.length > FIND_MATCH_CAP) {
    findTruncated = true;
    found.length = FIND_MATCH_CAP;
  }
  return found.map((one) => one.range);
}

function paintSourceMatches() {
  if (!monacoEditor) return;
  const decorations = findMatches.map((range, index) => ({
    range,
    options: { className: index === findCurrent ? FIND_HIGHLIGHT_CURRENT : FIND_HIGHLIGHT_ALL },
  }));
  if (findMonacoDecorations) findMonacoDecorations.set(decorations);
  else findMonacoDecorations = monacoEditor.createDecorationsCollection(decorations);
}

function clearSourceMatches() {
  if (!findMonacoDecorations) return;
  findMonacoDecorations.clear();
  findMonacoDecorations = null;
}

function revealSourceMatch() {
  const range = findMatches[findCurrent];
  if (!range || !monacoEditor) return;
  monacoEditor.setSelection(range);
  monacoEditor.revealRangeInCenterIfOutsideViewport(range);
}

// ---- the bar -------------------------------------------------------------

function findCountText() {
  if (findInvalidPattern) return 'Bad expression';
  if (!findInput.value) return '';
  if (!findMatches.length) return 'No results';
  const total = findTruncated ? `${FIND_MATCH_CAP}+` : String(findMatches.length);
  return `${findCurrent + 1} of ${total}`;
}

// Recompute from the field and the toggles, keeping the cursor on the match nearest where it was so the count does not jump about while a query is typed.
function refreshFind({ keepCurrent = true } = {}) {
  if (!findOpen) return;
  const previous = findMatches[findCurrent] || null;
  findMatches = findInSourceView() ? collectSourceMatches() : collectRenderedMatches();
  if (!findMatches.length) findCurrent = -1;
  else if (!keepCurrent || !previous) findCurrent = 0;
  else findCurrent = Math.min(findNearest(previous), findMatches.length - 1);
  findCount.textContent = findCountText();
  if (findInSourceView()) paintSourceMatches();
  else paintRenderedMatches();
}

// The first match at or after where the cursor was.
function findNearest(previous) {
  const place = (match) =>
    match.startLineNumber ? match.startLineNumber * 1e6 + match.startColumn : match.start;
  const was = place(previous);
  const at = findMatches.findIndex((match) => place(match) >= was);
  return at < 0 ? findMatches.length - 1 : at;
}

function findStep(delta) {
  if (!findMatches.length) return;
  findCurrent = (findCurrent + delta + findMatches.length) % findMatches.length;
  findCount.textContent = findCountText();
  if (findInSourceView()) {
    paintSourceMatches();
    revealSourceMatch();
  } else {
    paintRenderedMatches();
    revealRenderedMatch();
  }
}

// A short single-line selection is what the field opens with, the way every find bar does: asking for the word just highlighted is the common case.
function findSeedFromSelection() {
  let selected = '';
  if (findInSourceView()) {
    const range = monacoEditor.getSelection();
    const model = monacoEditor.getModel();
    if (range && model && !range.isEmpty() && range.startLineNumber === range.endLineNumber) {
      selected = model.getValueInRange(range);
    }
  } else {
    const selection = window.getSelection();
    if (selection && selection.rangeCount && !selection.isCollapsed) selected = selection.toString();
  }
  selected = selected.replace(/\s+/g, ' ').trim();
  if (selected && selected.length <= 120) findInput.value = selected;
}

function openFindBar({ replacing = false } = {}) {
  const opening = !findOpen;
  findOpen = true;
  findBar.hidden = false;
  if (replacing) setFindReplaceRow(true);
  if (opening) {
    findSeedFromSelection();
    watchFindRender();
  }
  // No cursors to put anywhere in the reading view.
  findSelectAllButton.disabled = !findInSourceView();
  findInput.focus();
  findInput.select();
  refreshFind({ keepCurrent: false });
  findStep(0);
}

function closeFindBar() {
  if (!findOpen) return;
  findOpen = false;
  findBar.hidden = true;
  findMatches = [];
  findCurrent = -1;
  findScopeRange = null;
  findMonacoScope = null;
  findPaintedRange = null;
  setFindFlag('scoped', false);
  clearRenderedHighlights();
  clearSourceMatches();
  unwatchFindRender();
  // Hand the keyboard back to the document rather than leaving it on a hidden field.
  if (findInSourceView()) monacoEditor.focus();
  else findInput.blur();
}

function setFindReplaceRow(open) {
  findReplaceRow.hidden = !open;
  findReplaceToggle.setAttribute('aria-pressed', open ? 'true' : 'false');
}

function setFindFlag(name, on) {
  findFlags[name] = on;
  const button = findFlagButtons[name];
  if (button) button.setAttribute('aria-pressed', on ? 'true' : 'false');
}

// The reading view narrows to the kept highlight rather than to the selection as it stands, for the reason above it. The source view still reads live, because Monaco keeps its selection across a focus change.
function captureFindScope() {
  if (findInSourceView()) {
    const range = monacoEditor.getSelection();
    findMonacoScope = range && !range.isEmpty() ? range : null;
    return !!findMonacoScope;
  }
  // A redraw leaves the kept range attached to the page but collapsed onto nothing, which is the same non-selection a live read refuses — so the reader gets the growl rather than the bar answering "No results" over a range pointing nowhere.
  if (!findKeptRange || findKeptRange.collapsed) return false;
  findScopeRange = findKeptRange.cloneRange();
  return true;
}

function toggleFindFlag(name) {
  const next = !findFlags[name];
  if (name === 'scoped') {
    if (next && !captureFindScope()) {
      leafToast('Select some text first, then find inside it.');
      return;
    }
    if (!next) {
      findScopeRange = null;
      findMonacoScope = null;
    }
  }
  setFindFlag(name, next);
  refreshFind({ keepCurrent: false });
  findStep(0);
}

// A re-render replaces the page under the bar, so the matches are recomputed rather than trusted.
//
// The flattening is forgotten the moment a mutation is seen rather than inside the deferred refresh: a letter typed in that 50 ms would otherwise search a page that has already been replaced. Nothing the bar itself does trips this — the bar is a sibling of the reader, not inside it.
function watchFindRender() {
  if (findRenderObserver || typeof MutationObserver !== 'function') return;
  // Whatever redrew while the bar was shut went unwatched, so the bar opens on a fresh flattening.
  forgetRenderedText();
  let queued = 0;
  findRenderObserver = new MutationObserver(() => {
    forgetRenderedText();
    if (queued) return;
    queued = window.setTimeout(() => {
      queued = 0;
      if (findOpen && !findInSourceView()) refreshFind();
    }, 50);
  });
  // Words typed into the page are a `characterData` change and nothing else, so a watch on the child list alone would leave the flattening describing a paragraph that has since been retyped — and a match's offset into a node that has grown shorter is a range the browser refuses outright.
  findRenderObserver.observe(app, { childList: true, characterData: true, subtree: true });
}

function unwatchFindRender() {
  if (!findRenderObserver) return;
  findRenderObserver.disconnect();
  findRenderObserver = null;
}

// ---- replacing -----------------------------------------------------------

function replaceInSource(all) {
  if (!codeUnlocked) {
    growlLockedForReading();
    return;
  }
  const edits = (all ? findMatches : findMatches.slice(findCurrent, findCurrent + 1)).map((range) => ({
    range,
    text: findReplaceInput.value,
    forceMoveMarkers: true,
  }));
  if (!edits.length) return;
  // One call, so one undo puts every replacement back.
  monacoEditor.executeEdits('leaf-find', edits);
  refreshFind({ keepCurrent: !all });
  findStep(0);
}

// Which editable block each match sits in. Every match is grouped, not only the ones being replaced: a match's number *within its block* is what points at the occurrence to splice, so the ones left alone still have to be counted.
function findRenderedGroups(wanted) {
  const chosen = new Set(wanted);
  const groups = new Map();
  for (let index = 0; index < findMatches.length; index += 1) {
    const range = findRangeFor(findMatches[index]);
    const node = range && range.startContainer;
    const element = node && (node.nodeType === 1 ? node : node.parentElement);
    const block = element && element.closest('[data-src-start]');
    const { start, end } = rangeOf(block, 'block');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      // Nothing to splice through: a match outside any block's source range.
      if (chosen.has(index)) return null;
      continue;
    }
    const key = `${start}:${end}`;
    const group = groups.get(key) || { start, end, ranks: [], total: 0 };
    if (chosen.has(index)) group.ranks.push(group.total);
    group.total += 1;
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.ranks.length).sort((a, b) => a.start - b.start);
}

// Rewrite one block's source, replacing the occurrences the page found in it. `null` when the block's source holds fewer than the page shows — formatting split one (`**dh**arma`), so the numbering cannot be trusted and nothing is spliced.
function findRewriteBlock(group, replacement) {
  const pattern = findPattern(true);
  if (!pattern) return null;
  const wanted = new Set(group.ranks);
  let seen = 0;
  const rewritten = sliceSourceBytes(currentDocumentSource, group.start, group.end).replace(
    pattern,
    (whole) => {
      const rank = seen;
      seen += 1;
      return wanted.has(rank) ? replacement : whole;
    }
  );
  return seen === group.total ? rewritten : null;
}

function replaceInReading(all) {
  if (currentDocumentFormat !== 'markdown') {
    leafToast('Replace works in Markdown. Open the source view for this file.');
    return;
  }
  if (!readingUnlocked) {
    leafToast('The page is locked. Click the padlock in the toolbar to edit it.');
    return;
  }
  const wanted = all ? findMatches.map((match, index) => index) : findCurrent >= 0 ? [findCurrent] : [];
  if (!wanted.length) return;
  const groups = findRenderedGroups(wanted);
  if (!groups) {
    leafToast('That match is not in an editable block. Replace it in the source view.');
    return;
  }
  const total = utf8ByteLength(currentDocumentSource);
  let next = '';
  let cursor = 0;
  let refused = 0;
  for (const group of groups) {
    const rewritten = findRewriteBlock(group, findReplaceInput.value);
    if (rewritten == null) {
      refused += group.ranks.length;
      continue;
    }
    next += sliceSourceBytes(currentDocumentSource, cursor, group.start);
    next += rewritten;
    cursor = group.end;
  }
  if (!cursor) {
    leafToast('Formatting splits that match. Replace it in the source view.');
    return;
  }
  next += sliceSourceBytes(currentDocumentSource, cursor, total);
  // One splice over the whole document, so one undo puts every replacement back.
  sendEditCommand({ command: 'editBlock', start: 0, end: total, text: next });
  if (refused) {
    leafToast(
      `${formatCountLabel(refused, 'match is', 'matches are')} split by formatting — replace those in the source view.`
    );
  }
}

function findReplace(all) {
  if (findInSourceView()) replaceInSource(all);
  else replaceInReading(all);
}

// A cursor on every match: a multiple-cursor edit, which is why it belongs to find rather than sitting beside it. The source view only — the reading view has no cursors to put anywhere.
//
// The lock is asked before any caret is placed: carets in a read-only editor are cursors every keystroke then growls at, which reads as broken rather than as refused.
function findSelectAllOccurrences() {
  if (!findInSourceView() || !findMatches.length) return;
  if (!codeUnlocked) {
    growlLockedForReading();
    return;
  }
  monacoEditor.setSelections(
    findMatches.map((range) => ({
      selectionStartLineNumber: range.startLineNumber,
      selectionStartColumn: range.startColumn,
      positionLineNumber: range.endLineNumber,
      positionColumn: range.endColumn,
    }))
  );
  monacoEditor.focus();
}

// ---- wiring --------------------------------------------------------------

findInput.addEventListener('input', () => refreshFind({ keepCurrent: false }));
findInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (event.altKey) findSelectAllOccurrences();
  else if (event.ctrlKey || event.metaKey) findReplace(true);
  else findStep(event.shiftKey ? -1 : 1);
});
findReplaceInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  findReplace(event.ctrlKey || event.metaKey || event.altKey);
});
document.getElementById('findNext').addEventListener('click', () => findStep(1));
document.getElementById('findPrev').addEventListener('click', () => findStep(-1));
document.getElementById('findClose').addEventListener('click', () => closeFindBar());
findReplaceToggle.addEventListener('click', () => setFindReplaceRow(findReplaceRow.hidden));
document.getElementById('findReplaceOne').addEventListener('click', () => findReplace(false));
document.getElementById('findReplaceAll').addEventListener('click', () => findReplace(true));
findSelectAllButton.addEventListener('click', () => findSelectAllOccurrences());
Object.keys(findFlagButtons).forEach((name) => {
  const button = findFlagButtons[name];
  if (button) button.addEventListener('click', () => toggleFindFlag(name));
});

// The reader's highlight, kept as it is made. On the document rather than started with the bar, because the highlight is made before Ctrl+F is pressed and pressing it is what takes the highlight away.
//
// A collapsed range inside the find bar is the field taking the caret at open, so the kept range stands; anything else collapsed is the reader clearing their highlight, so it goes and the toggle growls again.
document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  if (range && !selection.isCollapsed) {
    if (findSameRange(range, findPaintedRange)) return;
    findKeptRange = range.cloneRange();
    return;
  }
  if (range && findBar.contains(range.startContainer)) return;
  findKeptRange = null;
});

// Ctrl+F opens it over whichever view is on screen, Ctrl+H opens it with the replace row down, and Escape closes it from anywhere — including from inside Monaco, which has no find widget of its own to answer either key.
window.addEventListener('keydown', (event) => {
  const key = (event.key || '').toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (key === 'f' || key === 'h')) {
    if (!activeDocumentPath()) return;
    event.preventDefault();
    openFindBar({ replacing: key === 'h' });
    return;
  }
  if (!findOpen) return;
  if (key === 'escape') {
    event.preventDefault();
    closeFindBar();
    return;
  }
  // The toggles' own keys, only while the bar has the keyboard.
  if (!event.altKey || event.ctrlKey || event.metaKey) return;
  if (!findBar.contains(document.activeElement)) return;
  const flag = { c: 'matchCase', w: 'wholeWord', r: 'regex', l: 'scoped' }[key];
  if (!flag) return;
  event.preventDefault();
  toggleFindFlag(flag);
});
