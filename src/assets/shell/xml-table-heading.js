// Typing on a column heading of a table an XML document draws. A heading is in no part of the file — it is the element or attribute name put through a lookup and sentence-cased — so there is nothing to hold its drawn words against and the caret cannot open onto them. Pressing one puts the tag the file actually holds under the caret instead, and committing renames that element in every record of the run as one splice over the run's own bytes.
//
// Its own fragment rather than more of reading-edits.js, which is at the ceiling a hand-written file is held to.

// A legal XML name, matched the way the gutter's new-row option matches one.
const XML_HEADING_NAME = /^[A-Za-z_][\w.:-]*$/;

// Every element range the column under `th` was drawn from, in document order — the cell's own where one element drew it, and a span each where several folded into one. A column drawn from a value inside a tag, or one no record turned out to hold an element for, has none, and that is what keeps its heading shut.
//
// The column is counted rather than looked up by row: the renderer writes one cell per column per record, including the ones a record is short of, so every `heads.length`-th cell from this heading's place is this column's.
function xmlHeadingColumnRanges(th) {
  const table = th.closest ? th.closest('table') : null;
  if (!table) return [];
  const heads = [...table.querySelectorAll('th')];
  const at = heads.indexOf(th);
  if (at < 0) return [];
  const cells = [...table.querySelectorAll('td')];
  const ranges = [];
  for (let i = at; i < cells.length; i += heads.length) {
    const cell = cells[i];
    if (!cell) continue;
    const holders =
      hasRangeOf(cell, 'cell') ? [cell] : [...cell.querySelectorAll('[data-cell-start]')];
    for (const holder of holders) {
      const { start, end } = rangeOf(holder, 'cell');
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) ranges.push({ start, end });
    }
  }
  return ranges;
}

// The tag a range opens with, read off the file's own bytes rather than the DOM: what the page drew is the renderer's choice and this is the document's.
function xmlHeadingTagName(range) {
  const src = sliceSourceBytes(range.start, range.end);
  const open = /^[ \t]*<([^\s/>!?][^\s/>]*)/.exec(src);
  return open ? open[1] : null;
}

// The run's own bytes with every one of `ranges` renamed to `name` and nothing else touched — spacing, comments, entity spellings and attribute order come back identical by construction, because the bytes are the run's rather than anything composed here. Null where any range is not an element the whole way, which is the same proof a cell spends.
function xmlColumnRenameEdit(table, ranges, name) {
  const { start, end } = rangeOf(table, 'block');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !ranges.length) return null;
  const run = sliceSourceBytes(start, end);
  const spots = [];
  for (const range of ranges) {
    if (range.start < start || range.end > end) return null;
    // The buffer counts bytes and a string counts characters, so the place in the run is the length of what stands before it rather than the difference of two offsets.
    const from = sliceSourceBytes(start, range.start).length;
    const element = sliceSourceBytes(range.start, range.end);
    const open = /^[ \t]*<([^\s/>!?][^\s/>]*)/.exec(element);
    if (!open) return null;
    const closer = new RegExp('</' + open[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*>[ \\t]*$').exec(element);
    if (!closer) return null;
    spots.push({ at: from + open[0].length - open[1].length, was: open[1].length });
    spots.push({ at: from + closer.index + 2, was: open[1].length });
  }
  // Back to front, so an earlier splice never moves a later one's place.
  spots.sort((a, b) => b.at - a.at);
  let text = run;
  for (const spot of spots) text = text.slice(0, spot.at) + name + text.slice(spot.at + spot.was);
  return { start, end, text };
}

// Hand the heading back to the page, wearing the label it was drawn with.
function closeXmlTableHeading(th) {
  th.removeAttribute('contenteditable');
  th.removeAttribute('spellcheck');
  if (th.__headingLabel != null) th.textContent = th.__headingLabel;
  th.__headingLabel = null;
  th.__headingName = null;
}

// Open the heading onto the tag the file holds. The words changing under the caret are the whole signal: nothing is drawn around an open block, the label is in no part of the file, and the lookup that made it will not invert.
function openXmlTableHeading(th) {
  if (blockIsEditingHost(th)) return;
  const ranges = xmlHeadingColumnRanges(th);
  if (!ranges.length) return;
  const name = xmlHeadingTagName(ranges[0]);
  if (!name) return;
  th.__headingLabel = th.textContent;
  th.__headingName = name;
  th.textContent = name;
  th.setAttribute('contenteditable', 'true');
  th.setAttribute('spellcheck', 'false');
  th.focus({ preventScroll: true });
  placeCaretInBlock(th, name.length);
}

// Wire one heading: press to open, leave to commit. Leaving on the name it opened with writes nothing, so a press that turned out to be a misread costs the reader a click and no more.
function wireXmlTableHeading(th) {
  th.addEventListener('pointerup', (event) => {
    if (event.button !== 0) return;
    openXmlTableHeading(th);
  });
  th.addEventListener('input', () => raiseTypingChrome());
  th.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      th.blur();
    } else if (event.key === 'Escape') {
      // The name it opened with is what says a commit is wanted; dropped, the leave writes nothing.
      event.preventDefault();
      th.__headingName = null;
      th.blur();
    }
  });
  th.addEventListener('focusout', () => {
    const was = th.__headingName;
    const typed = th.textContent.trim();
    const table = th.closest ? th.closest('table') : null;
    const ranges = xmlHeadingColumnRanges(th);
    closeXmlTableHeading(th);
    if (!was || typed === was) return;
    if (!XML_HEADING_NAME.test(typed)) {
      leafToast('A tag name starts with a letter or an underscore and carries no spaces.');
      return;
    }
    const edit = table ? xmlColumnRenameEdit(table, ranges, typed) : null;
    if (!edit) return;
    sendEditCommand({ command: 'editBlock', start: edit.start, end: edit.end, text: edit.text });
  });
}

// The headings of every table on the page with a column to rename. Called from the pass that wires the cells, because a heading is decided by the same ranges they are.
function wireXmlTableHeadings(body) {
  body.querySelectorAll('table th').forEach((th) => {
    if (!xmlHeadingColumnRanges(th).length) return;
    th.classList.add('leaf-editable');
    wireXmlTableHeading(th);
  });
}
