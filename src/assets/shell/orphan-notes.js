// A note that loses its last marker loses its own line too.
//
// A footnote has two halves in two places: a marker in the sentence, and its own line at the foot of the file. The Annotate button takes both out together; every other way a marker goes — backspacing over it, emptying the block it sat in, deleting a passage across blocks, Replace All rewriting the text around it — would otherwise leave the note's line behind, numbered by the renderer and pointing at nothing.
//
// So the sweep sits at `sendEditCommand`, the one door every reading-view write goes through, and folds the orphaned note's own range into the same send. The same send rather than a second edit: `replace_ranges` records one undo snapshot for however many ranges it carries, so one press of undo brings the sentence and its note back together.
//
// It is in the page rather than in the host because a live splice draws nothing and the page moves its own buffer and range table by exactly what it sent — a host deleting extra bytes of its own would leave that table behind the buffer.
//
// A marker that has gone is found by reading the bytes the write is replacing and comparing them with the text going out, not by looking at what the page is showing: the block being written is a box the reader has been typing in, so its markers went from the page the moment they were deleted. The page is still asked which markers it draws *elsewhere*, which is a different question and the one `unusedFootnoteLabel` already puts to it. Nothing here reaches for the whole document as a string.

// A marker as it is written in the file. A definition's own line opens the same way and is not a reference, so a colon behind the bracket ends the match.
const FOOTNOTE_REFERENCE = /\[\^([^\]\r\n]+)\](?!:)/g;

// Labels a pause in the typing run still standing has already spliced out. A pause writes the block and draws nothing, so by its closing commit the marker is off the page and out of the page's buffer both, and the note would be missed. Emptied by the next edit that is not part of a run.
let markersLostMidRun = new Set();

// The labels a piece of source points at.
function footnoteLabelsIn(text) {
  const found = new Set();
  for (const match of String(text).matchAll(FOOTNOTE_REFERENCE)) found.add(match[1]);
  return found;
}

// The ranges a message is about to replace, each with the text going into it — the two commands that rewrite source through this door, in one shape. Anything else answers null and is left alone.
function editedRangesOf(message) {
  const one = (start, end, text) => ({ start: Number(start), end: Number(end), text: String(text == null ? '' : text) });
  if (message.command === 'editBlock') return [one(message.start, message.end, message.text)];
  if (message.command === 'editBlocks') return (message.blocks || []).map((block) => one(block.start, block.end, block.text));
  return null;
}

// Whether a write replaces this block whole. A narrower range — the inside of a fence, a value between two tags — leaves the markers around it exactly where they are, so a marker in that block still counts as one the document points with.
function editCoversBlock(writes, range) {
  return writes.some((write) => write.start <= range.start && range.end <= write.end);
}

// The labels this write is taking out of the document: what the bytes it replaces point at, minus what the text going out points at.
function markersThisWriteRemoves(writes) {
  const lost = new Set();
  for (const write of writes) {
    const going = footnoteLabelsIn(write.text);
    for (const label of footnoteLabelsIn(sliceSourceBytes(write.start, write.end))) {
      if (!going.has(label)) lost.add(label);
    }
  }
  return lost;
}

// The labels still pointed at by a marker the page is drawing somewhere this write does not replace.
function markersLeftOnThePage(writes) {
  const kept = new Set();
  const body = app.querySelector('.document-body');
  if (!body) return kept;
  body.querySelectorAll('sup.footnote-reference').forEach((mark) => {
    const label = footnoteNameOf(mark);
    if (!label) return;
    const block = mark.closest('[data-src-start]');
    const range = block ? rangeOf(block, 'block') : { start: NaN, end: NaN };
    const replaced = Number.isFinite(range.start) && Number.isFinite(range.end) && editCoversBlock(writes, range);
    if (!replaced) kept.add(label);
  });
  return kept;
}

// The notes a write leaves with nothing pointing at them, as the ranges that would delete them.
function orphanedNoteDeletions(writes, lost) {
  if (!lost.size) return [];
  const kept = markersLeftOnThePage(writes);
  // Every range this composes has to start at or after the last one the write already carries, or the host refuses the list whole.
  const after = writes.reduce((furthest, write) => Math.max(furthest, write.end), 0);
  const cuts = [];
  lost.forEach((label) => {
    if (kept.has(label)) return;
    const note = footnoteDefinitionFor(label);
    if (!note) return;
    const span = rangeOf(note, 'block');
    // A definition written above the block that orphaned it is left alone rather than sent out of order, the same guard taking a note off with the button already carries.
    if (!Number.isFinite(span.start) || !Number.isFinite(span.end) || span.start < after) return;
    cuts.push(blockDeleteRange(span.start, span.end));
  });
  return mergeNoteDeletions(cuts, after);
}

// Two notes orphaned by one send, written as ranges the host will take. Each definition's delete swallows the blank line in front of it, so the second runs back past where the first ended — and `replace_ranges` refuses a list where one range starts before the one in front of it has finished. Both are deletions, so merging the pair writes exactly what the two would have.
//
// A merged range is asked for its own separator again, because two ranges that reach the end of the file together take the blank line in front of the pair, which neither of them could see alone. The answer is then held to `after`: a walk back over blank lines can reach into the write in front of it, and those bytes are the write's to keep.
function mergeNoteDeletions(cuts, after) {
  const merged = [];
  for (const cut of [...cuts].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = merged[merged.length - 1];
    if (last && cut.start <= last.end) {
      last.end = Math.max(last.end, cut.end);
      continue;
    }
    merged.push({ start: cut.start, end: cut.end });
  }
  const held = [];
  for (const cut of merged) {
    const span = blockDeleteRange(cut.start, cut.end);
    const start = Math.max(span.start, after, held.length ? held[held.length - 1].end : 0);
    if (span.end > start) held.push({ start, end: span.end });
  }
  return held;
}

// The message the edit door should send: the one it was handed, or an `editBlocks` carrying that write and the notes it orphaned.
//
// A live splice is only remembered, never swept — the reader is still typing, and a marker half-deleted mid-word is not a marker that has gone. A send waiting on a token is left alone too: the sheet and the picker hold something open until the host answers that number, `editBlocks` has nowhere to carry it, and both of them write into a fence or insert a block rather than taking a marker away.
function withOrphanedNotesRemoved(message) {
  if (!message || message.autosave || message.token != null) return message;
  const writes = editedRangesOf(message);
  if (!writes || !writes.length) return message;
  if (writes.some((write) => !Number.isFinite(write.start) || !Number.isFinite(write.end))) return message;
  if (message.live) {
    if (!message.continuing) markersLostMidRun = new Set();
    for (const label of markersThisWriteRemoves(writes)) markersLostMidRun.add(label);
    return message;
  }
  const lost = markersThisWriteRemoves(writes);
  // The run's own pauses have already written their part of this edit, so whatever they took out is this commit's to answer for.
  if (message.continuing) for (const label of markersLostMidRun) lost.add(label);
  markersLostMidRun = new Set();
  const cuts = orphanedNoteDeletions(writes, lost);
  if (!cuts.length) return message;
  const blocks = foldTouchingBlocks([...writes, ...cuts.map((cut) => ({ start: cut.start, end: cut.end, text: '' }))]);
  return { command: 'editBlocks', blocks, continuing: message.continuing === true };
}
