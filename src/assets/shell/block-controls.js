// ---------------------------------------------------------------------------
// The reading view's block gutter: Medium's plus and Obsidian's grab handle, in the page's left margin.
//
// The block under the pointer (or holding the caret) gets a handle to drag it by, and an empty line also gets a plus that writes a new block onto it. Both act through the same source ranges the editors already use, so this is a view onto the buffer rather than a second model of the document — and it is why one gutter serves every format instead of one per renderer.
//
// The plus is for empty lines only. Beside a line that already says something it would be offering to write over it. The space between two blocks counts as one: hovering it offers the plus for a line that isn't there yet, and choosing something writes the break and the block together.
//
// What each format is offered is decided by what its ranges cover. Markdown and XML ranges are whole blocks and whole elements, so both reorder and insert are exact. JSON and YAML ranges cover a *value* inside a labeled structure, so moving one would leave its key behind and splicing between two would land outside the syntax that gives it meaning — those get no gutter, only the click-to-edit they already had.
// ---------------------------------------------------------------------------

// How wide the handle-plus pair is, matched to `.block-gutter` in reading.css. The pair is shifted this far into the margin, so the plus lands just left of the text the way Medium's does.
const BLOCK_TOOLS_WIDTH = 62;

// What the plus offers, per format.
//
// `blank` opens an empty block of that kind and writes nothing until the first keystroke — see BLANK_BLOCK_SPECS. The rest have no line to type on, so they splice `text` as source; `caret` asks for one inside it, and is absent for the blocks that edit as raw source and have no caret to take until clicked. None of them writes a word the document then has to carry.
const MARKDOWN_INSERTS = [
  { id: 'text', label: 'Text', icon: `<span class="lt-icon lt-icon-text"></span>`, blank: 'text' },
  { id: 'heading', label: 'Heading', icon: `<span class="lt-icon lt-icon-heading"></span>`, blank: 'heading' },
  { id: 'list', label: 'List', icon: `<span class="lt-icon lt-icon-list"></span>`, blank: 'list' },
  { id: 'quote', label: 'Quote', icon: `<span class="lt-icon lt-icon-quote"></span>`, blank: 'quote' },
  { id: 'code', label: 'Code block', icon: `<span class="lt-icon lt-icon-code-view"></span>`, text: '```\n\n```' },
  {
    id: 'table',
    label: 'Table',
    icon: `<span class="lt-icon lt-icon-table"></span>`,
    text: '|  |  |\n| --- | --- |\n|  |  |',
    caret: 'start',
  },
  // No source of its own: an image is a file or an address, so the row asks which before it writes anything. See openBlockImageBox.
  { id: 'image', label: 'Image', icon: `<span class="lt-icon lt-icon-image"></span>`, ask: 'image' },
  // Nothing to write until a diagram has been drawn: the sheet opens, and Save hands back one mermaid block. See openBlockFlowSheet.
  { id: 'flow', label: 'Flowchart', icon: `<span class="lt-icon lt-icon-workflow"></span>`, ask: 'flow' },
  { id: 'divider', label: 'Divider', icon: `<span class="lt-icon lt-icon-divider"></span>`, text: '---' },
];

// XML has no schema we know, so the only element worth offering is another one like the block you clicked — its own tag, emptied. A comment is legal anywhere.
function xmlInserts(target) {
  const options = [];
  const tag = xmlBlockTagName(target);
  if (tag) {
    options.push({
      id: 'element',
      label: '<' + tag + '> element',
      icon: `<span class="lt-icon lt-icon-code-view"></span>`,
      text: '<' + tag + '></' + tag + '>',
    });
  }
  options.push({ id: 'comment', label: 'Comment', icon: `<span class="lt-icon lt-icon-comment"></span>`, text: '<!-- note -->' });
  return options;
}

// The tag a block's source opens with. Read from the source rather than the DOM: the reading view renders an XML element as whatever HTML suits it, so the DOM tag name is the renderer's choice, not the document's.
function xmlBlockTagName(el) {
  const start = Number(el.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const match = /^<\s*([A-Za-z_][\w.:-]*)/.exec(sliceSourceBytes(currentDocumentSource, start, end));
  return match ? match[1] : null;
}

// Reordering is exact only where a block's range is the whole block. See the header: Markdown and XML qualify, the data formats do not.
function blockGutterFormatAllowed() {
  return (
    currentDocumentFormat === 'markdown' ||
    currentDocumentFormat === 'xml' ||
    currentDocumentFormat === 'eml'
  );
}

// A message qualifies for the paragraphs of one plain-text body and nothing else. A header value's range is a value inside a labeled line — JSON's case exactly — so moving one would leave `Subject: ` behind; a heading, an HTML body and an attachment list are not a run of anything.
function blockGutterTargetAllowed(el) {
  return currentDocumentFormat !== 'eml' || (!!el && el.dataset.blockKind === 'email_paragraph');
}

// A line with nothing on it. This is the only place the plus is offered: beside a line that already says something it would be offering to write over it, and the empty line below is what Enter is for. Text is not the only content — a rule, an image or a table says something without a word in it.
function blockIsEmpty(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'hr' || tag === 'img') return false;
  if (el.querySelector && el.querySelector('img, svg, hr, table, video, iframe, input')) return false;
  return !el.textContent.trim();
}

// Whether the plus may write a block onto this line, replacing what is there. A quote whose only content was a footnote is drawn with nothing in it and still holds that footnote's line in the source, so the emptiest-looking line in the note is the one line the plus must not overwrite. Clicking it still opens it.
function blockAcceptsInsert(el) {
  return el.dataset.holdsFootnote !== 'true' && blockIsEmpty(el);
}

// One entry for a message: a body has paragraphs in it and nothing else a reader could add without rewriting the envelope.
const EMAIL_INSERTS = [
  { id: 'text', label: 'Text', icon: `<span class="lt-icon lt-icon-text"></span>`, blank: 'text' },
];
function blockInsertOptions(target) {
  if (currentDocumentFormat === 'markdown') return MARKDOWN_INSERTS;
  if (currentDocumentFormat === 'xml') return xmlInserts(target);
  if (currentDocumentFormat === 'eml') return EMAIL_INSERTS;
  return [];
}

// The gutter is rebuilt with the document (renderState replaces the reader's markup wholesale), so these hold only the current render's.
let blockGutter = null;
let blockGutterGrip = null;
let blockGutterAdd = null;
let blockGutterRow = null;
let blockGutterTarget = null;
let blockGutterExpanded = false;
// The block an open insert row belongs to, held so closing the row can put back what opening it hid. Not the same as blockGutterTarget, which the pointer moves.
let blockInsertHost = null;
// The line that isn't there yet: the space between two blocks, or under the last one. Hovering it aims the plus at that space, and picking something writes the line break along with the block — so adding below anything is one click instead of an Enter first. `{ after, before }`, either end null at the document's.
let blockGutterGap = null;
// The clickable overlay over the space the plus is aimed at, so starting a line there needs no button. See openBlockGapLine for why it is an overlay.
let blockGapLine = null;
// The block holding the caret. The plus never stands on the line you are typing — there is nothing to add to a line you are already writing. It moves to the line below, where one press saves this line and starts the next.
let blockCaretBlock = null;
let blockDrag = null;

// True while the focus is heading into the gutter rather than out of the page. The block keeps its unsaved text then: the insert is about to commit it itself, in the right order, and a blur commit here would re-render the page out from under the row you are reaching for.
function blockGutterHoldsFocus(node) {
  return !!(blockGutter && node && blockGutter.contains(node));
}

// True while a block holds the caret: it keeps the controls when the pointer leaves, and no other gap is offered a click-to-insert line. Hover still moves the gutter between blocks — freezing it leaves an open document impossible to reorder.
function blockGutterFollowsCaret() {
  return !!(blockCaretBlock && blockCaretBlock.isConnected);
}

// A gap narrower than this is the ordinary space between two paragraphs seen edge-on, not somewhere anybody means to point.
const BLOCK_GAP_MIN = 10;
// How far under the last block its trailing line sits, in the page's bottom pad.
const BLOCK_TRAIL_DROP = 16;

function hideBlockGutter() {
  if (blockDrag) return;
  blockGutterTarget = null;
  blockGutterGap = null;
  closeBlockGapLine();
  collapseBlockInsertRow();
  if (blockGutter) blockGutter.hidden = true;
}

// Make the space under the block being typed in clickable. An overlay laid over the gap, NOT a box in the flow: a real element there re-lays out the page every time the gutter moves, and a page that grows and shrinks a line while somebody is mid-sentence is the whole of the jumping. This one costs no layout at all.
function openBlockGapLine(gap) {
  if (blockGapLine && sameBlockGap(blockGapLine.__gap, gap)) return;
  closeBlockGapLine();
  const layout = app.querySelector('.reader-layout');
  if (!layout || !gap.after) return;
  const line = document.createElement('div');
  line.className = 'block-gap-line';
  line.setAttribute('aria-hidden', 'true');
  line.__gap = gap;
  // Clicking the space is the other way of saying it: body text, starting here, with whatever is being typed above saved on the way — no Enter, no clicking out first.
  line.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const host = gap.after;
    hideBlockGutter();
    openLineBelow(host);
  });
  layout.appendChild(line);
  blockGapLine = line;
  positionBlockGapLine();
}

// The same space: the two things it stands between, whatever they are.
function sameBlockGap(a, b) {
  return !!a && !!b && a.above === b.above && a.below === b.below;
}

// Where the line goes, in client coordinates. Measured from `above` and `below` — whatever actually stands there, the outline and the pager included — so a line is never offered across something the page drew rather than the document.
//
// Under the last thing on the page there is no gap, only page, so rather than point at the middle of the emptiness work out where the new line will really be: one margin down, one line tall. Pointing at the emptiness lands the caret somewhere else.
function blockGapSpan(gap) {
  const { above, below } = gap;
  if (!above) {
    const bottom = below.getBoundingClientRect().top;
    return { top: bottom - BLOCK_TRAIL_DROP * 2, bottom };
  }
  const top = above.getBoundingClientRect().bottom;
  if (below) return { top, bottom: below.getBoundingClientRect().top };
  const body = app.querySelector('.document-body');
  const margin = parseFloat(window.getComputedStyle(above).marginBottom) || 0;
  const line = (body && parseFloat(window.getComputedStyle(body).lineHeight)) || BLOCK_TRAIL_DROP * 2;
  return { top: top + margin, bottom: top + margin + line };
}

function positionBlockGapLine() {
  const line = blockGapLine;
  const layout = app.querySelector('.reader-layout');
  const body = app.querySelector('.document-body');
  if (!line || !layout || !body || !blockGapStanding(line.__gap)) return;
  const layoutRect = layout.getBoundingClientRect();
  const bodyRect = body.getBoundingClientRect();
  const span = blockGapSpan(line.__gap);
  // Clickable from the thing above down to the foot of the new line: the margin over the line belongs to the line, and aiming for a bare gap is fiddly.
  const top = Math.min(span.top, line.__gap.above.getBoundingClientRect().bottom);
  line.style.left = bodyRect.left - layoutRect.left + 'px';
  line.style.width = bodyRect.width + 'px';
  line.style.top = top - layoutRect.top + 'px';
  line.style.height = Math.max(BLOCK_GAP_MIN, span.bottom - top) + 'px';
}

// Whether the space still exists: both ends still on the page, and something above to measure from.
function blockGapStanding(gap) {
  if (!gap || !gap.above || !gap.above.isConnected) return false;
  return !gap.below || gap.below.isConnected;
}

// Start a new line under `after`. A block mid-edit saves first and reopens the new line on the far side of its re-render — the same two ways Enter at the end of a block already goes.
function openLineBelow(after, specId) {
  if (!after) return;
  if (after.__lineBelow) {
    after.__lineBelow(specId);
    return;
  }
  const start = Number(after.dataset.srcStart);
  const end = Number(after.dataset.srcEnd);
  // A block holding no source of its own has to own the splice (above). Opening a line under one from out here would be undone by its own save a moment later.
  if (!Number.isFinite(start) || !Number.isFinite(end) || end === start) return;
  if (after.__editingActive) {
    const text = blockDomToMarkdown(after);
    after.__editingActive = false;
    if (text !== after.__editBaseline) {
      sendBlockSplice(after, start, end, text);
      setPendingCaret({ srcStart: start, insertBelow: true, blockSpec: specId });
      return;
    }
  }
  openInsertBlockAfter(after, specId);
}

// The same, above the first block: the break goes after the new line instead.
function openLineAbove(before, specId) {
  const at = before && Number(before.dataset.srcStart);
  if (!Number.isFinite(at)) return;
  openInsertBlock(at, {
    spec: BLANK_BLOCK_SPECS[specId] || PLAIN_LINE_SPEC,
    separator: '',
    suffix: currentDocumentFormat === 'markdown' ? '\n\n' : '\n',
    place: (host) => before.insertAdjacentElement('beforebegin', host),
  });
}

function closeBlockGapLine() {
  if (blockGapLine) blockGapLine.remove();
  blockGapLine = null;
}

function collapseBlockInsertRow() {
  blockGutterExpanded = false;
  blockImageWrite = null;
  if (blockGutterRow) {
    blockGutterRow.hidden = true;
    blockGutterRow.textContent = '';
  }
  if (blockGutter) blockGutter.classList.remove('is-expanded');
  if (blockInsertHost) {
    blockInsertHost.classList.remove('is-insert-open');
    blockInsertHost = null;
  }
}

// Point the gutter at `el`. An open insert row pins the gutter where it is: the row's own buttons are what the pointer is heading for, and moving the gutter out from under it would be the click that never lands.
function aimBlockGutter(el, fromMargin) {
  if (blockDrag || blockGutterExpanded) return;
  // The line being typed in gets its plus below, so a new line is one click away. Not from the margin: over there the hand is reaching for the handle.
  if (!fromMargin && el && el === blockCaretBlock && !blockIsEmpty(el)) {
    aimBlockGutterBelow(el);
    return;
  }
  if (!el || el === blockGutterTarget) {
    if (el) positionBlockGutter();
    return;
  }
  blockGutterTarget = el;
  blockGutterGap = null;
  closeBlockGapLine();
  const canMove = !!blockSiblingRun(el);
  const canInsert = blockAcceptsInsert(el) && blockInsertOptions(el).length > 0;
  blockGutterGrip.hidden = !canMove;
  blockGutterAdd.hidden = !canInsert;
  labelBlockAdd(false);
  // Nothing to offer on this block, so nothing to show beside it.
  blockGutter.hidden = !canMove && !canInsert;
  positionBlockGutter();
}

// Everything standing in the body, whether the document put it there or the page did. The outline and the pager hold no source range, but they take up room — a gap measured as though they were not there lays a click-to-insert line across the outline, so the click that should open it starts a new line instead.
function blockGutterOccupants() {
  const body = app.querySelector('.document-body');
  if (!body) return [];
  return Array.from(body.children)
    .map(unwrapTableLane)
    .flatMap(unwrapEmailBody)
    .filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom > rect.top;
    });
}

// A message is the one document whose blocks are not all children of the body: its paragraphs stand inside the body section. Where that section holds no range of its own there is nothing to offer beside it and everything to offer beside what is in it — without this the margin finds the section, which has nothing, and the last paragraph has no space under it.
function unwrapEmailBody(el) {
  const wraps = el.classList && el.classList.contains('email-body') && !blockHasRange(el);
  return wraps ? Array.from(el.children) : [el];
}

// The lane a wide table sits in belongs to the reader, not the document — the block is the table inside it, and everything here works on blocks.
function unwrapTableLane(el) {
  return el.classList && el.classList.contains('table-lane') ? el.firstElementChild || el : el;
}

// Whether the gutter has anything to say about this element at all. A range, even an empty one, means the document put it here; no range means the page did.
function blockHasRange(el) {
  return !!(el.dataset && el.dataset.srcStart != null && el.dataset.srcEnd != null);
}

// A block a new line can be written beside. A zero-length range is a block that exists only in the DOM — a blank line waiting for its first keystroke — with no offset in the buffer to write at.
function blockHasSource(el) {
  return blockHasRange(el) && Number(el.dataset.srcEnd) > Number(el.dataset.srcStart);
}

// The nearest block with source, searching out from `index` in one direction.
function nearestSourceBlock(occupants, index, step) {
  for (let i = index; i >= 0 && i < occupants.length; i += step) {
    if (blockHasSource(occupants[i])) return occupants[i];
  }
  return null;
}

// Point the gutter at the space the pointer is in rather than at a block. Only the plus: there is nothing here to drag.
function aimBlockGutterAtGap(clientY, fromMargin) {
  if (blockDrag || blockGutterExpanded) return;
  const occupants = blockGutterOccupants();
  let aboveIndex = -1;
  for (let i = 0; i < occupants.length; i += 1) {
    const rect = occupants[i].getBoundingClientRect();
    // Level with something, even out in the margin: that is its line, not a gap. Something the page drew has nothing to offer, and nothing may be laid over it — an overlay across the outline stops the outline opening.
    if (clientY >= rect.top && clientY <= rect.bottom) {
      if (blockHasRange(occupants[i])) aimBlockGutter(occupants[i], fromMargin);
      else hideBlockGutter();
      return;
    }
    if (rect.bottom < clientY) aboveIndex = i;
    else break;
  }
  // The space itself is bounded by its real neighbors; the new line is written beside the nearest block that has a range to write at, which may be further out.
  const gap = {
    above: aboveIndex >= 0 ? occupants[aboveIndex] : null,
    below: occupants[aboveIndex + 1] || null,
    after: nearestSourceBlock(occupants, aboveIndex, -1),
    before: nearestSourceBlock(occupants, aboveIndex + 1, 1),
  };
  if (!gap.above && !gap.below) return;
  const span = blockGapSpan(gap);
  if (gap.above && gap.below && span.bottom - span.top < BLOCK_GAP_MIN) {
    const nearer = clientY - span.top < span.bottom - clientY ? gap.above : gap.below;
    if (blockHasRange(nearer)) aimBlockGutter(nearer, fromMargin);
    else hideBlockGutter();
    return;
  }
  // Mid-edit the only space on offer is the one below the line being typed: a click-to-insert line over any other gap turns a click at those words into a blank line.
  if (blockGutterFollowsCaret()) return;
  aimBlockGutterAtSpace(gap);
}

// The space below the line being typed in: the plus waits there, so pressing it saves this line and starts the next in one go.
function aimBlockGutterBelow(el) {
  // Off the same list the gutter works over rather than off the page: a message's paragraphs stand inside its body section, so the element beside the last one is outside the body altogether.
  const occupants = blockGutterOccupants();
  const at = occupants.indexOf(el);
  if (at >= 0) {
    aimBlockGutterAtSpace({
      above: el,
      below: occupants[at + 1] || null,
      after: el,
      before: nearestSourceBlock(occupants, at + 1, 1),
    });
    return;
  }
  // A line that is not in that list yet — a blank one waiting for its first keystroke — is still on the page, so it is walked there.
  let below = el.nextElementSibling;
  while (below && below.getBoundingClientRect().bottom <= below.getBoundingClientRect().top) {
    below = below.nextElementSibling;
  }
  let before = below;
  while (before && !blockHasSource(before)) before = before.nextElementSibling;
  aimBlockGutterAtSpace({ above: el, below: below || null, after: el, before: before || null });
}

// Point the gutter at the space between two blocks, and make that space clickable. Only the plus: there is nothing here to drag.
function aimBlockGutterAtSpace(gap) {
  if (sameBlockGap(blockGutterGap, gap)) {
    positionBlockGutter();
    return;
  }
  if (!gap.after && !gap.before) {
    hideBlockGutter();
    return;
  }
  if (!blockInsertOptions(gap.after || gap.before).length) {
    hideBlockGutter();
    return;
  }
  blockGutterTarget = null;
  blockGutterGap = gap;
  openBlockGapLine(gap);
  blockGutterGrip.hidden = true;
  blockGutterAdd.hidden = false;
  labelBlockAdd(frontmatterCanStart(gap));
  blockGutter.hidden = false;
  positionBlockGutter();
}

// What the plus says it does. Above everything on a note with no field block it starts one, so it says so rather than reading as the insert menu it is not.
function labelBlockAdd(startsFrontmatter) {
  const what = startsFrontmatter ? 'Add frontmatter' : 'Insert a block';
  blockGutterAdd.title = what;
  blockGutterAdd.setAttribute('aria-label', what);
}

// Place the gutter beside its block: vertically on the block's first line, and horizontally in the left margin. Where the margin is narrower than the tools (a window too narrow for the measure to be centered) they hug the page edge and overlap the first few pixels of text instead of disappearing — a page you can still restructure beats a tidy one you can't.
function positionBlockGutter() {
  const layout = app.querySelector('.reader-layout');
  const body = app.querySelector('.document-body');
  const centerY = blockGutterAnchorY();
  if (!blockGutter || !layout || !body || centerY == null) {
    if (blockGutter) blockGutter.hidden = true;
    return;
  }
  const layoutRect = layout.getBoundingClientRect();
  // A wide table hangs out of the measure in a lane of its own, so the handle rides that block's own left edge — anchored to the body's, it would land on the table's first column instead of in clear air beside it.
  const lane = blockGutterTarget && blockGutterTarget.closest && blockGutterTarget.closest('.table-lane');
  const bodyRect = (lane || body).getBoundingClientRect();
  const margin = Math.max(0, bodyRect.left - layoutRect.left);
  const shift = Math.min(margin, BLOCK_TOOLS_WIDTH + 10);
  blockGutter.style.left = bodyRect.left - layoutRect.left + 'px';
  blockGutter.style.top = centerY - layoutRect.top + 'px';
  blockGutter.style.setProperty('--block-gutter-shift', shift + 'px');
  positionBlockGapLine();
}

// The line the gutter sits on: a block's first line, or the middle of the gap it is offering to fill. Null once whatever it was aimed at has left the page.
function blockGutterAnchorY() {
  if (blockGutterGap) {
    if (!blockGapStanding(blockGutterGap)) return null;
    const span = blockGapSpan(blockGutterGap);
    return (span.top + span.bottom) / 2;
  }
  const target = blockGutterTarget;
  if (!target || !target.isConnected) return null;
  const rect = target.getBoundingClientRect();
  const lineHeight = parseFloat(window.getComputedStyle(target).lineHeight) || rect.height;
  return rect.top + Math.min(lineHeight, rect.height) / 2;
}

// Open the insert row: the plus becomes a cross, and the options fan out to the right of it over the (usually empty) line, the way Medium's does.
function expandBlockInsertRow() {
  const target = blockGutterTarget;
  const gap = blockGutterGap;
  // Which document the options are for: the block itself, or the block the gap hangs off (XML asks it what tag to offer).
  const source = target || (gap && (gap.after || gap.before));
  if (!source || !blockGutterRow) return;
  const options = blockInsertOptions(source);
  if (!options.length) return;
  blockGutterRow.textContent = '';
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'block-insert-option';
    button.title = option.label;
    button.setAttribute('aria-label', option.label);
    button.innerHTML = option.icon;
    const write = (chosen) => (gap ? runGapInsert(gap, chosen) : runBlockInsert(target, chosen));
    button.addEventListener('click', () => {
      if (option.ask === 'image') openBlockImageBox(write);
      else if (option.ask === 'flow') openBlockFlowSheet(write);
      else write(option);
    });
    blockGutterRow.appendChild(button);
  }
  blockGutterRow.hidden = false;
  blockGutterExpanded = true;
  blockGutter.classList.add('is-expanded');
  // The row lies across the line it was opened on. On a blank line that line's wording is a printed placeholder, so it reads as text struck through by the controls; take it away while the row is up. A gap has nothing to hide.
  if (target) {
    blockInsertHost = target;
    target.classList.add('is-insert-open');
  }
}

// What the image option asks before it writes anything: a file off this computer, or an address. Two ways in because a document holds both — a picture beside it in the folder, and one that lives on the web — and neither is a path anyone should have to type into a placeholder by hand.
//
// The picture is never copied anywhere. What goes in the document is where it already is: relative to the document when it sits under it, so the pair survive being moved together, and absolute when it doesn't.
let blockImageWrite = null;
let blockImageToken = 0;

function openBlockImageBox(write) {
  if (!blockGutterRow) return;
  blockImageWrite = write;
  blockImageToken += 1;
  const token = blockImageToken;
  blockGutterRow.textContent = '';

  const choose = document.createElement('button');
  choose.type = 'button';
  choose.className = 'block-insert-choose';
  choose.textContent = 'Choose file';
  choose.addEventListener('click', () => send({ command: 'pickImage', token }));

  const url = document.createElement('input');
  url.type = 'text';
  url.className = 'block-insert-url';
  url.spellcheck = false;
  url.placeholder = 'or paste an image address';
  url.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const address = url.value.trim();
      if (address) writeBlockImage(address, '');
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      collapseBlockInsertRow();
      hideBlockGutter();
    }
  });

  blockGutterRow.appendChild(choose);
  blockGutterRow.appendChild(url);
  url.focus();
}

function writeBlockImage(destination, alt) {
  const write = blockImageWrite;
  blockImageWrite = null;
  if (!write) return;
  write({ id: 'image', text: '![' + alt.replace(/[[\]]/g, '') + '](' + destination + ')' });
}

// The picker's answer. A token from a box that has since closed is dropped: the document may have moved on while the dialog was up.
window.leafImagePicked = (token, destination, alt) => {
  if (token !== blockImageToken || !destination) return;
  writeBlockImage(destination, alt || '');
};

// Where the buffer ends for the block above the gap. A block being typed in ends wherever its unsaved text ends, so it is saved first and the offset taken from what was written — insert at the old end and the new block would land inside the sentence, or the sentence would be thrown away.
function gapInsertOffsetAfter(after) {
  const start = Number(after.dataset.srcStart);
  const end = Number(after.dataset.srcEnd);
  if (!after.__editingActive || !Number.isFinite(start) || !Number.isFinite(end)) return end;
  const text = blockDomToMarkdown(after);
  after.__editingActive = false;
  if (text === after.__editBaseline) return end;
  sendBlockSplice(after, start, end, text);
  return start + utf8ByteLength(text);
}

// Write a block into the space between two blocks, making the line for it: the source plus the break that separates it from its new neighbor. This is what spares an Enter first — the line and what goes on it arrive as one edit.
function runGapInsert(gap, option) {
  const { after, before } = gap;
  collapseBlockInsertRow();
  hideBlockGutter();
  // A blank line between two blocks in a note and in a message; one line between two elements in a tree.
  const separator = currentDocumentFormat === 'xml' ? '\n' : documentLineEnding().repeat(2);
  // A block to type in rather than source to write: open one on the line below.
  if (option.blank) {
    if (after) openLineBelow(after, option.blank);
    else openLineAbove(before, option.blank);
    return;
  }
  // A block that exists only in the DOM carries its own splice: what was typed into it is not in the buffer yet, so the one edit has to write both.
  if (after && after.__insertBlockWith) {
    after.__insertBlockWith(option);
    return;
  }
  if (after) {
    const at = gapInsertOffsetAfter(after);
    if (!Number.isFinite(at)) return;
    sendEditCommand({ command: 'editBlock', start: at, end: at, text: separator + option.text });
    if (option.caret) {
      setPendingCaret({ srcStart: at + utf8ByteLength(separator) });
    }
    return;
  }
  // Above the first block: the break goes after the new block instead.
  const at = Number(before.dataset.srcStart);
  if (!Number.isFinite(at)) return;
  sendEditCommand({ command: 'editBlock', start: at, end: at, text: option.text + separator });
  if (option.caret) setPendingCaret({ srcStart: at });
}

// Write an option's source onto `target`'s line, which is the empty line the plus was pressed on — so the block takes that line rather than landing on either side of it. The caret follows it in, with a placeholder left selected so the first keystroke replaces it.
function runBlockInsert(target, option) {
  const start = Number(target.dataset.srcStart);
  const end = Number(target.dataset.srcEnd);
  collapseBlockInsertRow();
  hideBlockGutter();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  // This line is empty and about to be a different kind of empty line. Nothing is written: the block swaps for one of the chosen kind, still waiting on its first word.
  if (option.blank) {
    if (target.__becomeBlock) target.__becomeBlock(option.blank);
    else openLineAbove(target, option.blank);
    return;
  }
  // A block that exists only in the DOM (a blank line, a new document's title) owns its own splice: it has to carry whatever was typed into it along with the new block, since none of it is in the buffer yet.
  if (target.__insertBlockWith) {
    target.__insertBlockWith(option);
    return;
  }
  // The plus is only offered on an empty line, and replacing the range is only safe there. Checked again here rather than trusted: a drifted button is a paragraph overwritten.
  if (!blockAcceptsInsert(target)) return;
  sendEditCommand({ command: 'editBlock', start, end, text: option.text });
  if (option.caret) setPendingCaret({ srcStart: start });
}

// The run of siblings a block can move within: the blocks sharing its parent, in document order. The ranges come back from the shared test (`blockRunRanges`), which refuses a run the host would refuse.
function blockSiblingRun(target) {
  if (!blockGutterFormatAllowed() || !blockGutterTargetAllowed(target)) return null;
  // A laned table's siblings are the body's, not the lane's one child.
  const lane = target.parentElement;
  const parent = lane && lane.classList.contains('table-lane') ? lane.parentElement : lane;
  if (!parent) return null;
  // A zero-length range is a block that exists only in the DOM — a blank line waiting for its first keystroke. It holds no text to drag and contributes no source, so it is left out of the run rather than allowed to invalidate it; `target` then fails the membership test below and gets no handle.
  const elements = Array.from(parent.children).map(unwrapTableLane).filter(blockHasSource);
  if (elements.length < 2 || !elements.includes(target)) return null;
  const ranges = blockRunRanges(elements);
  return ranges ? { elements, ranges } : null;
}

// Where the block would land: the first neighbor whose middle the pointer has passed. Measured against positions taken before anything moved, so the blocks sliding aside can't change the answer that decided to slide them.
function blockDropIndex(layoutY) {
  const before = blockDrag.baselines.findIndex((mid) => layoutY < mid);
  return before === -1 ? blockDrag.others.length : before;
}

// One slot: the block plus the space between it and its neighbor. This is what the blocks it passes step by, so each lands exactly where the dragged one was.
function blockSlotHeight(elements, index) {
  const rect = elements[index].getBoundingClientRect();
  const next = elements[index + 1];
  if (next) return next.getBoundingClientRect().top - rect.top;
  const previous = elements[index - 1];
  if (previous) return rect.bottom - previous.getBoundingClientRect().bottom;
  return rect.height;
}

// The block lifted off the page and carried by the pointer. A copy, because the original stays in the flow holding its space — that is what makes the gap the neighbors open the same size as the thing about to fill it.
function startBlockGhost() {
  const ghost = document.createElement('div');
  ghost.className = 'block-drag-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  const copy = blockDrag.target.cloneNode(true);
  copy.removeAttribute('contenteditable');
  copy.removeAttribute('id');
  for (const el of copy.querySelectorAll('[id]')) el.removeAttribute('id');
  ghost.appendChild(copy);
  ghost.style.left = blockDrag.left + 'px';
  ghost.style.width = blockDrag.width + 'px';
  blockDrag.layout.appendChild(ghost);
  blockDrag.ghost = ghost;
}

// Open the gap where the block would land: everything between its old slot and the new one steps one slot the other way. A transform, so nothing reflows — a page of blocks re-laid-out on every pointer move stutters.
function slideBlocksAside() {
  const { others, from, to, span } = blockDrag;
  others.forEach((el, index) => {
    let shift = 0;
    if (index >= from && index < to) shift = -span;
    else if (index < from && index >= to) shift = span;
    el.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
  });
}

function beginBlockDrag(event) {
  const target = blockGutterTarget;
  const run = target && blockSiblingRun(target);
  const layout = app.querySelector('.reader-layout');
  if (!run || !layout) return;
  const from = run.elements.indexOf(target);
  const others = run.elements.filter((el) => el !== target);
  const layoutRect = layout.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  blockDrag = {
    target,
    layout,
    ranges: run.ranges,
    from,
    others,
    baselines: others.map((el) => {
      const box = el.getBoundingClientRect();
      return box.top + box.height / 2 - layoutRect.top;
    }),
    span: blockSlotHeight(run.elements, from),
    // Layout-relative, like the gutter's: the layout scrolls with the blocks, so measuring against it means a scroll mid-drag moves nothing out of step.
    left: rect.left - layoutRect.left,
    width: rect.width,
    grabOffset: event.clientY - rect.top,
    to: from,
    pointerId: event.pointerId,
    startY: event.clientY,
    moved: false,
  };
  event.preventDefault();
  leafHoldPointer(event.currentTarget, event.pointerId);
}

function moveBlockDrag(event) {
  if (!blockDrag || event.pointerId !== blockDrag.pointerId) return;
  if (!blockDrag.moved) {
    if (Math.abs(event.clientY - blockDrag.startY) < 4) return;
    blockDrag.moved = true;
    blockDrag.target.classList.add('is-block-dragging');
    document.body.classList.add('is-block-dragging');
    if (blockGutter) blockGutter.classList.add('is-dragging');
    startBlockGhost();
  }
  const layoutY = event.clientY - blockDrag.layout.getBoundingClientRect().top;
  blockDrag.ghost.style.top = layoutY - blockDrag.grabOffset + 'px';
  blockDrag.to = blockDropIndex(layoutY);
  slideBlocksAside();
}

// Save the line being typed in, on the way to moving a block. At the drop and not the grab: an edit re-renders the page, and a re-render mid-drag rebuilds the gutter out from under the block being carried, so typing then dragging does nothing.
function commitBeforeBlockMove() {
  const active = document.activeElement;
  if (!active || !active.__editingActive || !active.dataset) return null;
  const start = Number(active.dataset.srcStart);
  const end = Number(active.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const text = blockDomToMarkdown(active);
  active.__editingActive = false;
  if (text === active.__editBaseline) return null;
  sendBlockSplice(active, start, end, text);
  return { start, end, delta: utf8ByteLength(text) - (end - start) };
}

// The run's ranges in the buffer the save just wrote: the saved block takes its new length and everything past it slides by the same delta. Exact, not estimated — a drifted range list shreds a file, which is what move_blocks refuses.
function rangesAfterCommit(ranges, saved) {
  if (!saved) return ranges;
  return ranges.map(([start, end]) => {
    if (start === saved.start && end === saved.end) return [start, end + saved.delta];
    if (start >= saved.end) return [start + saved.delta, end + saved.delta];
    return [start, end];
  });
}

function endBlockDrag(commit) {
  if (!blockDrag) return;
  const drag = blockDrag;
  blockDrag = null;
  if (drag.ghost) drag.ghost.remove();
  for (const el of drag.others) el.style.transform = '';
  drag.target.classList.remove('is-block-dragging');
  document.body.classList.remove('is-block-dragging');
  if (blockGutter) blockGutter.classList.remove('is-dragging');
  if (!drag.moved || !commit || drag.to === drag.from) {
    hideBlockGutter();
    return;
  }
  const ranges = rangesAfterCommit(drag.ranges, commitBeforeBlockMove());
  sendEditCommand({ command: 'moveBlock', ranges, from: drag.from, to: drag.to });
  hideBlockGutter();
}

// Build the gutter for the render that just landed, and wire it to the document body. One gutter for the whole page, moved to whichever block is being pointed at — a control per block would be one more element per block on a document that may hold fifty thousand of them.
function bindBlockControls() {
  blockGutter = null;
  blockGutterGrip = null;
  blockGutterAdd = null;
  blockGutterRow = null;
  blockGutterTarget = null;
  blockGutterGap = null;
  blockGapLine = null;
  blockCaretBlock = null;
  blockGutterExpanded = false;
  blockImageWrite = null;
  blockDrag = null;
  const layout = app.querySelector('.reader-layout');
  const body = app.querySelector('.document-body');
  if (!layout || !body) return;
  if (!readerEditingAllowed() || !blockGutterFormatAllowed()) return;

  blockGutter = document.createElement('div');
  blockGutter.className = 'block-gutter';
  blockGutter.hidden = true;
  blockGutter.innerHTML = `<div class="block-gutter-tools">
      <button type="button" class="block-grip" title="Drag to reorder" aria-label="Drag to reorder this block"><span class="lt-icon lt-icon-grip"></span></button>
      <button type="button" class="block-add" title="Insert a block" aria-label="Insert a block"><span class="block-add-open"><span class="lt-icon lt-icon-new"></span></span><span class="block-add-close"><span class="lt-icon lt-icon-close"></span></span></button>
    </div><div class="block-insert-row" hidden></div>`;
  blockGutterGrip = blockGutter.querySelector('.block-grip');
  blockGutterAdd = blockGutter.querySelector('.block-add');
  blockGutterRow = blockGutter.querySelector('.block-insert-row');
  layout.appendChild(blockGutter);

  blockGutterGrip.addEventListener('pointerdown', (event) => {
    if (event.button === 0) beginBlockDrag(event);
  });
  blockGutterGrip.addEventListener('pointermove', moveBlockDrag);
  blockGutterGrip.addEventListener('pointerup', () => endBlockDrag(true));
  blockGutterGrip.addEventListener('pointercancel', () => endBlockDrag(false));
  blockGutterAdd.addEventListener('click', () => {
    // The one gap where the plus does something else: a note with no fields has nowhere else a first one could go, and the insert options have nothing to offer above the whole document.
    if (frontmatterCanStart(blockGutterGap)) {
      hideBlockGutter();
      startFrontmatterAtTop();
      return;
    }
    if (blockGutterExpanded) collapseBlockInsertRow();
    else expandBlockInsertRow();
  });
  // Reaching for the gutter must not take the focus off the line being typed: the block keeps its unsaved words until whatever was pressed saves them itself, in the order that keeps the offsets true.
  blockGutter.addEventListener('mousedown', (event) => {
    if (event.target.closest && event.target.closest('input')) return;
    event.preventDefault();
  });

  // Hovering a block aims the gutter at it; the gutter itself counts as its own block, or moving onto the plus would take the gutter away from under you. Hovering the space between blocks aims it at that space instead.
  body.addEventListener('pointermove', (event) => {
    if (blockDrag) return;
    if (blockGutter.contains(event.target)) return;
    const el = event.target.closest ? event.target.closest('[data-src-start]') : null;
    if (el) aimBlockGutter(el);
    else aimBlockGutterAtGap(event.clientY);
  });
  // The margin the controls live in counts as the page too. Without that, reaching them means hovering the words first and then sliding left — a trip out of the gutter and back for every block, when the line the pointer is level with is answer enough.
  layout.addEventListener('pointermove', (event) => {
    if (blockDrag) return;
    if (blockGutter.contains(event.target)) return;
    if (event.target.closest && event.target.closest('.document-body')) return;
    const bodyRect = body.getBoundingClientRect();
    const reach = bodyRect.left - event.clientX;
    const inMargin = reach >= 0 && reach <= BLOCK_TOOLS_WIDTH + 30;
    // The page under the last block is the last block's line too — clicking down there is how you carry on writing, so the plus has to be reachable without first finding the words above it.
    const underPage =
      event.clientY > bodyRect.bottom && event.clientX >= bodyRect.left && event.clientX <= bodyRect.right;
    if (!inMargin && !underPage) return;
    aimBlockGutterAtGap(event.clientY, inMargin);
  });
  layout.addEventListener('pointerleave', () => {
    if (blockGutterExpanded || blockGutterFollowsCaret()) return;
    hideBlockGutter();
  });
  // The caret is the other way of saying "this block": type into one and its controls are there without going looking for them.
  body.addEventListener('focusin', (event) => {
    if (!event.target.closest) return;
    blockCaretBlock = event.target.closest('[data-src-start][contenteditable="true"]');
    aimBlockGutter(event.target.closest('[data-src-start]'));
  });
  body.addEventListener('focusout', (event) => {
    if (blockGutterHoldsFocus(event.relatedTarget)) return;
    if (!blockCaretBlock || blockCaretBlock.contains(event.relatedTarget)) return;
    blockCaretBlock = null;
    if (!blockGutterExpanded) hideBlockGutter();
  });
  // The first word turns a blank line into a line with something on it, which is where the plus stops belonging to it and starts belonging to the one below.
  body.addEventListener('input', () => {
    if (blockCaretBlock && blockGutterTarget === blockCaretBlock) aimBlockGutter(blockCaretBlock);
  });
}

// Escape closes the insert row before anything else takes it — an open row is the most local thing on screen.
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (blockDrag) {
    endBlockDrag(false);
    return;
  }
  if (blockGutterExpanded) collapseBlockInsertRow();
});
document.addEventListener('pointerup', () => endBlockDrag(true));
document.addEventListener('pointercancel', () => endBlockDrag(false));
// A click anywhere but the row closes it, the way every other menu here behaves.
window.addEventListener(
  'click',
  (event) => {
    if (!blockGutterExpanded || !blockGutter) return;
    if (blockGutter.contains(event.target)) return;
    collapseBlockInsertRow();
  },
  true,
);
window.addEventListener('resize', () => {
  if (blockGutterTarget) positionBlockGutter();
});
