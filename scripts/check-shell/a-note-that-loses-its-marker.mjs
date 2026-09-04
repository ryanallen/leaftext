// A note whose last marker goes must lose its own line in the same send.
//
// The two halves live in two places, so every check here reads the buffer the send would leave rather than counting the pieces it was written in: what matters is the file, not how many ranges said it.

import { check, fakeElement, record } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  /** A page drawn from `pieces`, each one a block of source with a blank line between it and the next: `markup` draws a paragraph the page is showing, `note` draws a note's own line at the foot. Every block wears the range the renderer would stamp on it. */
  const notePage = (name, pieces) => {
    const body = fakeElement(name + '-body');
    body.className = 'document-body';
    const blocks = [];
    let at = 0;
    let source = '';
    pieces.forEach((piece, index) => {
      if (index) {
        source += '\n\n';
        at += 2;
      }
      const el = fakeElement(name + '-block-' + index);
      if (piece.note) {
        el.tagName = 'DIV';
        el.className = 'footnote-definition';
        el.setAttribute('id', piece.note);
        el.dataset.blockKind = 'footnote_definition';
      } else {
        el.tagName = 'P';
        el.dataset.blockKind = 'paragraph';
        el.innerHTML = piece.markup;
      }
      el.dataset.srcStart = String(at);
      el.dataset.srcEnd = String(at + piece.source.length);
      body.appendChild(el);
      blocks.push(el);
      source += piece.source;
      at += piece.source.length;
    });
    // A file ends in a newline, which is what makes the last note's delete walk back over the blank line in front of it.
    source += '\n';
    return { body, source, blocks };
  };

  /** The line ending every document here is written with, spelled once so a check can say what a file reads as without a run of escapes in the middle of the claim. */
  const NEWLINE = String.fromCharCode(10);

  /** A marker as the renderer draws one: a superscript wearing the note's own name. */
  const marker = (label) => '<sup class="footnote-reference" id="fnref-' + label + '">1</sup>';

  /** Hand the page one message through the edit door and answer every edit that reached the wire. */
  const sendThrough = (page, message) => {
    const readingApp = booted.document.getElementById('app');
    const wasQuery = readingApp.querySelector;
    const wasIpc = booted.ipc;
    const posted = [];
    try {
      readingApp.querySelector = (selector) => (String(selector) === '.document-body' ? page.body : wasQuery.call(readingApp, selector));
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
      booted.window.leafBlocksResynced({ source: page.source });
      booted.sendEditCommand(message);
    } finally {
      readingApp.querySelector = wasQuery;
      booted.ipc = wasIpc;
    }
    return posted.filter((one) => String(one.command).startsWith('edit'));
  };

  /** The ranges a send carries, whichever command it is. */
  const rangesOf = (edit) => (edit.command === 'editBlocks' ? edit.blocks : [{ start: edit.start, end: edit.end, text: edit.text }]);

  /** The file a send leaves behind, and a refusal wherever the host would refuse the list instead of writing it. */
  const bufferAfter = (source, edit, what) => {
    const ranges = rangesOf(edit);
    let previous = 0;
    let built = '';
    for (const range of ranges) {
      if (range.start < previous || range.end < range.start || range.end > source.length) {
        throw new Error(what + ' sent ranges the host refuses: ' + JSON.stringify(ranges));
      }
      built += source.slice(previous, range.start) + range.text;
      previous = range.end;
    }
    return built + source.slice(previous);
  };

  /** The one edit a send made, or a failure naming what actually went out. */
  const oneEdit = (edits, what) => {
    if (edits.length !== 1) throw new Error(what + ' went up as ' + edits.length + ' edits: ' + JSON.stringify(edits));
    return edits[0];
  };

  /** A note and the sentence it hangs off, with the note's own line at the foot of the file. */
  const oneNotePage = (name, markup, source) =>
    notePage(name, [
      { markup, source },
      { note: 'one', source: '[^one]: The first note.' },
    ]);

  /** The whole range one drawn block occupies. */
  const spanOf = (block) => ({ start: Number(block.dataset.srcStart), end: Number(block.dataset.srcEnd) });

  check('a block holding the only reference to a note takes the note with it', () => {
    const page = oneNotePage('lone-note', 'First sentence with a note.' + marker('one'), 'First sentence with a note.[^one]');
    const edits = sendThrough(page, { command: 'editBlock', ...spanOf(page.blocks[0]), text: '' });
    const edit = oneEdit(edits, 'emptying the only block pointing at a note');
    if (edit.command !== 'editBlocks') throw new Error('the sweep sent ' + edit.command + ' rather than one editBlocks');
    const written = bufferAfter(page.source, edit, 'emptying the block');
    if (written.includes('[^one]')) throw new Error('the buffer kept a half of the note: ' + JSON.stringify(written));
    if (written.trim() !== '') throw new Error('the buffer became ' + JSON.stringify(written));
  });

  check('a note referenced twice keeps its line when one reference goes', () => {
    const page = notePage('twice-noted', [
      { markup: 'First sentence.' + marker('one'), source: 'First sentence.[^one]' },
      { markup: 'Second sentence.' + marker('one'), source: 'Second sentence.[^one]' },
      { note: 'one', source: '[^one]: The only note.' },
    ]);
    const edits = sendThrough(page, { command: 'editBlock', ...spanOf(page.blocks[0]), text: 'First sentence.' });
    const edit = oneEdit(edits, 'deleting one of two references');
    const written = bufferAfter(page.source, edit, 'deleting one of two references');
    if (!written.includes('[^one]: The only note.')) throw new Error('a note still pointed at was taken away: ' + JSON.stringify(written));
    if (!written.includes('Second sentence.[^one]')) throw new Error('the surviving reference went too: ' + JSON.stringify(written));
  });

  check('one send that orphans two notes writes ranges that ascend and do not overlap', () => {
    const page = notePage('two-orphans', [
      { markup: 'First sentence.' + marker('one'), source: 'First sentence.[^one]' },
      { markup: 'Second sentence.' + marker('two'), source: 'Second sentence.[^two]' },
      { note: 'one', source: '[^one]: The first note.' },
      { note: 'two', source: '[^two]: The second note.' },
    ]);
    const edits = sendThrough(page, {
      command: 'editBlocks',
      blocks: [
        { ...spanOf(page.blocks[0]), text: 'First sentence.' },
        { ...spanOf(page.blocks[1]), text: 'Second sentence.' },
      ],
    });
    const edit = oneEdit(edits, 'orphaning two notes at once');
    const ranges = rangesOf(edit);
    let previous = 0;
    for (const range of ranges) {
      if (range.start < previous) throw new Error('the send overlapped itself: ' + JSON.stringify(ranges));
      previous = range.end;
    }
    // Written out rather than counted: bufferAfter refuses the list the host would refuse, and the file it leaves is the whole claim. Both notes go, and the blank line that separated the pair from the sentences goes with them rather than being left hanging off the end.
    const written = bufferAfter(page.source, edit, 'orphaning two notes at once');
    const wanted = ['First sentence.', '', 'Second sentence.'].join(NEWLINE);
    if (written !== wanted) throw new Error('the buffer became ' + JSON.stringify(written) + ' rather than ' + JSON.stringify(wanted));
  });

  check('a live splice sweeps nothing, so a marker half-deleted keeps its note', () => {
    const page = oneNotePage('mid-word', 'First sentence with a note.' + marker('one'), 'First sentence with a note.[^one]');
    const edits = sendThrough(page, {
      command: 'editBlock',
      ...spanOf(page.blocks[0]),
      text: 'First sentence with a note.',
      live: true,
    });
    const edit = oneEdit(edits, 'a live splice');
    if (edit.command !== 'editBlock') throw new Error('a live splice was rewritten into ' + edit.command);
    const written = bufferAfter(page.source, edit, 'a live splice');
    if (!written.includes('[^one]: The first note.')) throw new Error('a pause mid-word took the note away: ' + JSON.stringify(written));
  });

  check('a send that writes the reference back leaves the note alone', () => {
    // Replace All's own shape: the page's marker is inside the block being rewritten, and the text going out still carries it.
    const page = oneNotePage('replace-all', 'First sentence with a note.' + marker('one'), 'First sentence with a note.[^one]');
    const edits = sendThrough(page, {
      command: 'editBlocks',
      blocks: [{ ...spanOf(page.blocks[0]), text: 'A rewritten sentence.[^one]' }],
    });
    const edit = oneEdit(edits, 'a rewrite that keeps the reference');
    const written = bufferAfter(page.source, edit, 'a rewrite that keeps the reference');
    if (!written.includes('[^one]: The first note.')) throw new Error('the note went with a reference that was written back: ' + JSON.stringify(written));
  });

  check('a note written above the block that orphans it is left where it is', () => {
    // Legal Markdown, and the renderer relocates it for drawing. Sending its range with the write would put the list out of order, which the host refuses whole — so the note stays rather than the whole edit being lost.
    const page = notePage('note-above', [
      { note: 'one', source: '[^one]: The note, written first.' },
      { markup: 'The sentence it belongs to.' + marker('one'), source: 'The sentence it belongs to.[^one]' },
    ]);
    const edits = sendThrough(page, { command: 'editBlock', ...spanOf(page.blocks[1]), text: 'The sentence it belongs to.' });
    const edit = oneEdit(edits, 'orphaning a note written above the block');
    const written = bufferAfter(page.source, edit, 'orphaning a note written above the block');
    if (!written.startsWith('[^one]: The note, written first.')) throw new Error('the note above was written out of order: ' + JSON.stringify(written));
  });

  check('a pause that spliced the marker out is answered by the commit that ends the run', () => {
    // The pause writes the block and draws nothing, so by the time the commit arrives the marker is gone from the page and from the page's own buffer both. The run has to carry it, or a marker deleted three pauses ago looks as though it was never there.
    const page = oneNotePage('run-pause', 'First sentence with a note.' + marker('one'), 'First sentence with a note.[^one]');
    const span = spanOf(page.blocks[0]);
    const readingApp = booted.document.getElementById('app');
    const wasQuery = readingApp.querySelector;
    const wasIpc = booted.ipc;
    const posted = [];
    try {
      readingApp.querySelector = (selector) => (String(selector) === '.document-body' ? page.body : wasQuery.call(readingApp, selector));
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
      booted.window.leafBlocksResynced({ source: page.source });
      // The pause: the marker goes out of the block, and the page then moves its own buffer and every range after the splice by exactly what it sent, which is what a live splice does and why nothing has redrawn.
      const paused = { ...span, text: 'First sentence with a note.', inner: false };
      booted.sendEditCommand({ command: 'editBlock', ...span, text: paused.text, live: true });
      page.blocks[0].querySelector('sup.footnote-reference').remove();
      booted.advanceLiveRanges(page.blocks[0], paused);
      // The commit that ends the run, against the block's range as the pause left it.
      const moved = booted.rangeOf(page.blocks[0], 'block');
      booted.sendEditCommand({ command: 'editBlock', start: moved.start, end: moved.end, text: paused.text, continuing: true });
    } finally {
      readingApp.querySelector = wasQuery;
      booted.ipc = wasIpc;
    }
    const edits = posted.filter((one) => String(one.command).startsWith('edit'));
    const commit = edits[edits.length - 1];
    if (!commit || commit.command !== 'editBlocks') throw new Error('the commit that ended the run went up as ' + JSON.stringify(edits));
    if (commit.continuing !== true) throw new Error('the composed send dropped the flag saying it continues a run: ' + JSON.stringify(commit));
    const paused = ['First sentence with a note.', '', '[^one]: The first note.', ''].join('\n');
    const written = bufferAfter(paused, commit, 'the commit that ended the run');
    if (written.includes('[^one]')) throw new Error('the note the run orphaned was left at the foot: ' + JSON.stringify(written));
  });

  check('a marker backspaced away inside a typing run still goes up as one undo', () => {
    const page = oneNotePage('typing-run', 'First sentence with a note.' + marker('one'), 'First sentence with a note.[^one]');
    const edits = sendThrough(page, {
      command: 'editBlock',
      ...spanOf(page.blocks[0]),
      text: 'First sentence with a note.',
      continuing: true,
    });
    const edit = oneEdit(edits, 'a typing run that lost a marker');
    if (edit.command !== 'editBlocks') throw new Error('the commit that ended the run went up as ' + edit.command);
    if (edit.continuing !== true) throw new Error('the composed send dropped the flag saying it continues a run: ' + JSON.stringify(edit));
    // The note is the last line in the file, so its delete runs back into the block above and the pair arrives as one replacement. What is claimed is the file it leaves, not the number of pieces it was written in.
    const written = bufferAfter(page.source, edit, 'a typing run that lost a marker');
    if (written.includes('[^one]')) throw new Error('the buffer kept a half of the note: ' + JSON.stringify(written));
  });

  check('a write narrower than the block leaves the notes around it alone', () => {
    // An edit inside a block — a value between two tags, a heading over a table's column — replaces a range the markers around it sit outside of, and the page is still drawing every one of them. Counting them as gone would take the note away from a marker the sentence still carries.
    const page = notePage('inner-write', [
      { markup: 'One' + marker('one') + ' and two' + marker('two') + '.', source: 'One[^one] and two[^two].' },
      { note: 'one', source: '[^one]: The first note.' },
      { note: 'two', source: '[^two]: The second note.' },
    ]);
    const edits = sendThrough(page, { command: 'editBlock', start: 0, end: 'One[^one]'.length, text: 'One', inner: true });
    const edit = oneEdit(edits, 'a write narrower than the block');
    if (edit.command !== 'editBlock') throw new Error('a write narrower than the block was rewritten into ' + edit.command);
    const written = bufferAfter(page.source, edit, 'a write narrower than the block');
    if (!written.includes('[^one]: The first note.') || !written.includes('[^two]: The second note.')) {
      throw new Error('a note went with a write that replaced neither of the markers around it: ' + JSON.stringify(written));
    }
  });
}
