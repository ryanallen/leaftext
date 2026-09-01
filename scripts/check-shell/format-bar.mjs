// The format bar over a selection, and saving while the words are still being typed.

import vm from 'node:vm';
import {
  check,
  fakeElement,
  record,
  source,
  typingStand,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;
  const { fencedCodeInnerSpan } = booted;
  const { withPageTimers, raiseWindowEvent, pressWindowKey, saveKeyPress, typedBlock, openTyping, restTyping } = typingStand(booted);

  check('the format bar steps heading levels and stops at both ends', () => {
    const { steppedHeadingLevel, blockFormatChanges } = booted;
    const BIGGER = -1;
    const SMALLER = 1;
    const is = (got, want, what) => {
      if (got !== want) throw new Error(`${what}: got ${got}, wanted ${want}`);
    };

    is(steppedHeadingLevel(6, BIGGER), 5, 'h6 bigger'); // one level, not a jump
    is(steppedHeadingLevel(2, BIGGER), 1, 'h2 bigger'); // h1 is reachable
    is(steppedHeadingLevel(1, SMALLER), 2, 'h1 smaller');
    is(steppedHeadingLevel(1, BIGGER), 0, 'h1 bigger'); // nothing above `#`
    is(steppedHeadingLevel(6, SMALLER), 0, 'h6 smaller'); // nothing below `######`
    is(steppedHeadingLevel(0, BIGGER), 2, 'text bigger'); // body text steps in at `##`
    is(steppedHeadingLevel(0, SMALLER), 0, 'text smaller'); // nothing to shrink

    // What grays out. A button with nowhere to go must be the disabled one.
    const bigger = { step: BIGGER };
    const smaller = { step: SMALLER };
    const text = {};
    const quote = { quote: true };
    is(blockFormatChanges(bigger, 'heading', 1), false, 'bigger at h1');
    is(blockFormatChanges(smaller, 'heading', 6), false, 'smaller at h6');
    is(blockFormatChanges(bigger, 'heading', 6), true, 'bigger at h6');
    is(blockFormatChanges(text, 'paragraph', 0), false, 'text on a paragraph');
    is(blockFormatChanges(text, 'heading', 2), true, 'text on a heading');
    is(blockFormatChanges(quote, 'blockquote', 0), false, 'quote on a quote');
    is(blockFormatChanges(quote, 'paragraph', 0), true, 'quote on a paragraph');

    // The marker each press writes. Null means write nothing at all — a freshly typed line commits through this, so a bad marker there writes the words twice.
    const { blockFormatMarker } = booted;
    is(blockFormatMarker(bigger, 6), '##### ', 'h6 bigger marker');
    is(blockFormatMarker(bigger, 2), '# ', 'h2 bigger marker');
    is(blockFormatMarker(bigger, 1), null, 'h1 bigger marker');
    is(blockFormatMarker(smaller, 6), null, 'h6 smaller marker');
    is(blockFormatMarker(bigger, 0), '## ', 'text bigger marker');
    is(blockFormatMarker(text, 2), '', 'text marker');
    is(blockFormatMarker(quote, 0), '> ', 'quote marker');
  });

  check('a fenced code block offers its inside and never its fences', () => {
    // The reader edits the inside only, so the fences cannot be typed away. The span is spliced verbatim: a wrong end writes code over a fence.
    const inside = (src) => {
      const span = fencedCodeInnerSpan(src);
      return span ? src.slice(span.from, span.to) : null;
    };
    const keeps = (src, want) => {
      const got = inside(src);
      if (got !== want) throw new Error(`${JSON.stringify(src)} -> ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
      // Replacing the span must leave both fences standing.
      if (got !== null) {
        const span = fencedCodeInnerSpan(src);
        const rebuilt = src.slice(0, span.from) + 'X' + src.slice(span.to);
        if (!/^[ \t]*(`{3,}|~{3,})/.test(rebuilt) || !/(`{3,}|~{3,})[ \t]*$/.test(rebuilt)) {
          throw new Error(`rewriting ${JSON.stringify(src)} broke a fence: ${JSON.stringify(rebuilt)}`);
        }
      }
    };

    keeps('```\ncode\n```', 'code');
    keeps('```rust\nlet x = 1;\n```', 'let x = 1;'); // the language stays on the fence
    keeps('```\n\n```', ''); // what the insert row writes: one empty line
    keeps('```\na\nb\n```', 'a\nb'); // several lines
    keeps('```\ncode\n\n```', 'code\n'); // a trailing blank line is code
    keeps('~~~\ncode\n~~~', 'code'); // tildes
    keeps('````\n```\n````', '```'); // a fence inside a longer fence
    keeps('  ```\n  code\n  ```', '  code'); // indented, inside a list
    keeps('```\ncafé 😀\n```', 'café 😀'); // multi-byte, where the offsets matter
    keeps('    indented code', null); // no fences to hide
    keeps('```\nunterminated', null); // no end to trust
    keeps('```\n```', null); // no line inside to edit
  });

  // Clearing the text out of a paragraph or a heading must not write the leftovers into the file — a bare `##`, or the literal text `<br>` that Chromium leaves in an emptied contenteditable. So an empty serialization is a delete of the whole line, and the range it deletes has to swallow one blank line too: a mapped range stops short of the separator (`trim_block_end`), so splicing the range alone stacks the blank lines from both sides.
  check('a block typed empty is taken away, and takes one blank line with it', () => {
    const { blockSerializationEmpty, blockDeleteRange, commitBlockEdit } = booted;

    // What counts as nothing left. The `<br>` and the hashes are what the serializer writes for an empty block, not text somebody typed.
    const empty = (text, kind, want) => {
      if (blockSerializationEmpty(text, kind) !== want) {
        throw new Error(`${JSON.stringify(text)} as a ${kind}: got ${!want}`);
      }
    };
    empty('', 'paragraph', true);
    empty('<br>', 'paragraph', true);
    empty('<br/>', 'paragraph', true);
    empty('<br><br>', 'paragraph', true); // however many it leaves
    empty('  ', 'paragraph', true);
    empty('##', 'heading', true);
    empty('## ', 'heading', true);
    empty('###### <br>', 'heading', true);
    empty('still here', 'paragraph', false);
    empty('## Named', 'heading', false);
    empty('#', 'paragraph', false); // a paragraph whose text is one hash is text

    // The range, over the real buffer. Deleting it must leave the neighbors one blank line apart, and never two. The offsets are UTF-8 bytes, so the cut is made on bytes.
    const leaves = (source, start, end, want) => {
      booted.setDocumentSource(source);
      const span = blockDeleteRange(start, end);
      const bytes = Buffer.from(source, 'utf8');
      const got = Buffer.concat([bytes.subarray(0, span.start), bytes.subarray(span.end)]).toString('utf8');
      if (got !== want) throw new Error(`${JSON.stringify(source)} minus [${start},${end}) -> ${JSON.stringify(got)}`);
    };
    leaves('A\n\nB\n\nC', 3, 4, 'A\n\nC'); // the middle one
    leaves('A\n\nB\n\nC', 0, 1, 'B\n\nC'); // the first one
    leaves('A\n\nB\n\nC', 6, 7, 'A\n\nB'); // the last one takes the run before it
    leaves('A\n\nB\n', 3, 4, 'A'); // and so does one with only a trailing newline after it
    leaves('B\n', 0, 1, ''); // the only block leaves an empty buffer
    leaves('A\n\n\n\nB', 0, 1, 'B'); // an extra blank line somebody left goes with it
    leaves('# T\n\ncafé 😀\n\nZ', 5, 16, '# T\n\nZ'); // multi-byte, where the offsets matter
    // The shape the picture menu's own Delete hands over: a paragraph holding nothing but a picture, which is the only kind of picture that row is offered on.
    leaves('# T\n\n![Shot](imgs/shot.png)\n\nZ', 5, 27, '# T\n\nZ');
    leaves('![Shot](imgs/shot.png)\n\nZ', 0, 22, 'Z'); // the picture the note opens with
    leaves('Z\n\n![Shot](imgs/shot.png)\n', 3, 25, 'Z'); // and the picture it ends with

    // And the commit itself: what reaches the host.
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    const block = (kind, tag, start, end) => ({
      tagName: tag,
      isConnected: true,
      dataset: { blockKind: kind, srcStart: String(start), srcEnd: String(end) },
      childNodes: [],
      textContent: '',
      previousElementSibling: null,
      nextElementSibling: null,
    });
    const edits = () => posted.filter((message) => message.command === 'editBlock');
    try {
      const source = '# Title\n\nA paragraph.\n\n```\ncode\n```\n';
      booted.window.leafBlocksResynced({ source });

      // The paragraph, emptied: its own range plus the blank line under it, replaced by nothing.
      posted.length = 0;
      commitBlockEdit(block('paragraph', 'P', 9, 21), '<br>');
      const gone = edits();
      if (gone.length !== 1) throw new Error(`emptying a paragraph sent ${gone.length} edits`);
      if (gone[0].text !== '') throw new Error(`it wrote ${JSON.stringify(gone[0].text)}`);
      const after = source.slice(0, gone[0].start) + source.slice(gone[0].end);
      if (after !== '# Title\n\n```\ncode\n```\n') throw new Error(`the buffer became ${JSON.stringify(after)}`);
      if (after.includes('<br>')) throw new Error('the leftover break was written into the file');

      // The heading, emptied: no bare hashes left behind.
      posted.length = 0;
      commitBlockEdit(block('heading', 'H1', 0, 7), '# ');
      const headingGone = edits();
      if (headingGone.length !== 1) throw new Error(`emptying a heading sent ${headingGone.length} edits`);
      const withoutHeading = source.slice(0, headingGone[0].start) + source.slice(headingGone[0].end);
      if (withoutHeading !== 'A paragraph.\n\n```\ncode\n```\n') {
        throw new Error(`the buffer became ${JSON.stringify(withoutHeading)}`);
      }
      if (/#/.test(withoutHeading)) throw new Error('the hashes were written into the file');

      // Emptying the inside of a fence leaves an empty fence, not a missing one: the raw-source editor commits a range narrower than its block, and empty there means empty code.
      posted.length = 0;
      const fence = block('code_block', 'PRE', 23, 34);
      commitBlockEdit(fence, '', { start: 27, end: 31 });
      const inner = edits();
      if (inner.length !== 1) throw new Error(`emptying a fence sent ${inner.length} edits`);
      if (inner[0].start !== 27 || inner[0].end !== 31) {
        throw new Error(`the fence's own range was widened to [${inner[0].start},${inner[0].end})`);
      }
      const emptyFence = source.slice(0, 27) + source.slice(31);
      if (!emptyFence.includes('```\n\n```')) throw new Error(`the fence went: ${JSON.stringify(emptyFence)}`);

      // A narrower range on a paragraph is refused the same way — the guard is the range, not only the kind.
      posted.length = 0;
      commitBlockEdit(block('paragraph', 'P', 9, 21), '', { start: 9, end: 15 });
      if (edits()[0].end !== 15) throw new Error('a partial paragraph commit was turned into a delete');

      // The only block in a document: the buffer empties, and no caret is claimed — bindReadingEditor opens the blank pair instead.
      posted.length = 0;
      vm.runInContext('pendingCaret = null;', booted);
      booted.window.leafBlocksResynced({ source: 'Alone\n' });
      commitBlockEdit(block('paragraph', 'P', 0, 5), '<br>');
      const only = edits();
      if (only.length !== 1 || only[0].start !== 0 || only[0].end !== 6) {
        throw new Error(`the only block deleted [${only[0].start},${only[0].end})`);
      }
      if (vm.runInContext('pendingCaret', booted) !== null) {
        throw new Error('a caret was claimed in a document with nothing left to put it in');
      }
    } finally {
      booted.ipc = wasIpc;
      booted.window.leafBlocksResynced({ source: '' });
      vm.runInContext('pendingCaret = null;', booted);
    }
  });


  // Typing under the caret does not raise the dirty flag, so a save gated on that flag refuses outright when the typing is the only edit, and with an earlier edit behind it writes the file WITHOUT the words on screen. The commit goes first and the write follows it, which is the order held here.
  check('Ctrl+S while typing writes the typed words, and writes them before it saves', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      const source = '# Title\n\nA paragraph.\n';
      openTyping(source);
      const block = typedBlock({ start: 9, end: 21, typed: 'A paragraph, typed on.', baseline: 'A paragraph.' });
      booted.document.activeElement = block;
      withPageTimers((drain) => {
        pressWindowKey(saveKeyPress());
        drain();
      });
      const commands = posted.map((message) => message.command);
      if (commands.indexOf('editBlock') !== 0) {
        throw new Error(`the save sent ${JSON.stringify(commands)} rather than committing first`);
      }
      if (commands.indexOf('saveDocument') !== 1) {
        throw new Error(`nothing was saved: ${JSON.stringify(commands)}`);
      }
      const edit = posted[0];
      if (edit.start !== 9 || edit.end !== 21) {
        throw new Error(`the commit covered [${edit.start},${edit.end}) rather than the block`);
      }
      const written = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
      if (written !== '# Title\n\nA paragraph, typed on.\n') {
        throw new Error(`the file would have become ${JSON.stringify(written)}`);
      }
      // And the session is closed behind it, so the click-out that follows does not write the same words a second time.
      if (block.__editingActive) throw new Error('the block was left holding an open session');
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // Every editor commits through the same path, so this is the same fix in a document spelled another way — and the one that would damage a file if the range were wrong: an element's commit splices BETWEEN its tags, never over them.
  check('Ctrl+S while typing on an element’s words writes them between the tags', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      const source = '<doc>\n<p>The words.</p>\n</doc>\n';
      openTyping(source, 'xml');
      // The span bindEditableBlocks stamps on the element: the bytes between `<p>` and `</p>`.
      const start = source.indexOf('The words.');
      const block = typedBlock({
        start: source.indexOf('<p>'),
        end: source.indexOf('</p>') + 4,
        typed: 'The words, typed on.',
        baseline: 'The words.',
        innerSpan: { start, end: start + 'The words.'.length },
      });
      booted.document.activeElement = block;
      withPageTimers((drain) => {
        pressWindowKey(saveKeyPress());
        drain();
      });
      const edit = posted.find((message) => message.command === 'editBlock');
      if (!edit) throw new Error('typing on an element was never committed');
      const written = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
      if (written !== '<doc>\n<p>The words, typed on.</p>\n</doc>\n') {
        throw new Error(`the file would have become ${JSON.stringify(written)}`);
      }
      if (posted.map((message) => message.command).indexOf('saveDocument') !== 1) {
        throw new Error('the element’s words were not saved after being committed');
      }
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // The commit re-renders the whole page, and a caret still inside the committed block is dropped by that render unless the block claims it — which is saving mid-sentence putting the reader out of the words they are typing.
  check('after a mid-typing save the caret is back in the same block at the same place', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    const wasRange = booted.document.createRange;
    try {
      openTyping('# Title\n\nA paragraph.\n');
      const block = typedBlock({ start: 9, end: 21, typed: 'A paragraph, typed on.', baseline: 'A paragraph.' });
      booted.document.activeElement = block;
      // Where the caret sits inside the block, measured the way the page measures it: the text before it.
      const caretAt = 14;
      booted.getSelection = () => ({
        rangeCount: 1,
        isCollapsed: true,
        getRangeAt: () => ({ startContainer: block.childNodes[0], startOffset: caretAt }),
      });
      booted.document.createRange = () => {
        let upTo = 0;
        return {
          selectNodeContents() {},
          setStart() {},
          setEnd: (_container, offset) => {
            upTo = offset;
          },
          collapse() {},
          cloneContents: () => ({ textContent: 'x'.repeat(upTo) }),
        };
      };
      withPageTimers((drain) => {
        pressWindowKey(saveKeyPress());
        drain();
      });
      const caret = vm.runInContext('pendingCaret', booted);
      if (!caret) throw new Error('the caret was dumped out of the block it was typed in');
      if (caret.srcStart !== 9) throw new Error(`the caret landed on the block at ${caret.srcStart}`);
      if (caret.textOffset !== caretAt) {
        throw new Error(`the caret came back at ${caret.textOffset} rather than ${caretAt}`);
      }
      if (caret.path !== 'notes.md') throw new Error('the caret was not stamped with its own document');
    } finally {
      booted.ipc = wasIpc;
      booted.document.createRange = wasRange;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // Undo pressed mid-typing has to commit the typing first, or it steps back the edit BEFORE it — leaving the words on screen and taking away something the reader had finished with.
  check('Undo pressed mid-typing puts the block back to before the typing began', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      openTyping('# Title\n\nA paragraph.\n');
      const block = typedBlock({ start: 9, end: 21, typed: 'A paragraph, typed on.', baseline: 'A paragraph.' });
      booted.document.activeElement = block;
      withPageTimers((drain) => {
        booted.undoLastEdit();
        drain();
      });
      const commands = posted.map((message) => message.command);
      if (commands.indexOf('editBlock') !== 0 || commands.indexOf('undoEdit') !== 1) {
        throw new Error(`undo sent ${JSON.stringify(commands)} rather than committing and then stepping back`);
      }
      if (posted[0].text !== 'A paragraph, typed on.') {
        throw new Error(`the commit undo landed on wrote ${JSON.stringify(posted[0].text)}`);
      }

      // And with nothing typed, undo is the plain one it has always been: the baseline commits nothing.
      posted.length = 0;
      const quiet = typedBlock({ start: 9, end: 21, typed: 'A paragraph.', baseline: 'A paragraph.' });
      booted.document.activeElement = quiet;
      withPageTimers((drain) => {
        booted.undoLastEdit();
        drain();
      });
      if (posted.some((message) => message.command === 'editBlock')) {
        throw new Error('a block sitting at its baseline wrote an edit on its way to the undo');
      }
      if (!posted.some((message) => message.command === 'undoEdit')) {
        throw new Error('undo stopped reaching the host once it committed first');
      }
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // The dot, Save and Undo all waited for the click-out, so a page with words typed on it read as saved and offered nothing to take them back with. They answer the first keystroke now — a promise phase 1's commit-first is what makes good on — and typing taken back to where it started has to put them out again, or a document nobody changed reads as edited for ever.
  check('one keystroke lights the dot, and taking the typing back puts it out', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      // Every kind of document commits through the same two editors, so the dot has to light in each of them the same way.
      for (const [format, source, typed, baseline] of [
        ['markdown', '# Title\n\nA paragraph.\n', 'A paragraph, typed on.', 'A paragraph.'],
        ['xml', '<doc>\n<p>The words.</p>\n</doc>\n', 'The words, typed on.', 'The words.'],
        ['eml', 'From: a@b.c\n\nThe message.\n', 'The message, typed on.', 'The message.'],
      ]) {
        posted.length = 0;
        openTyping(source, format);
        const block = typedBlock({
          start: source.indexOf(baseline),
          end: source.indexOf(baseline) + baseline.length,
          typed,
          baseline,
        });
        booted.wireMarkdownEditable(block);
        booted.document.activeElement = block;
        const fire = (type, event) => {
          for (const handler of [...(block.listeners.get(type) || [])]) handler(event);
        };

        // The first keystroke, and nothing on the wire behind it: the promise is local until an action makes good on it.
        fire('input', {});
        if (!booted.isDocumentDirty('notes.md')) throw new Error(`${format}: a keystroke left the dot out`);
        if (vm.runInContext("undoableByPath.get('notes.md')", booted) !== true) {
          throw new Error(`${format}: a keystroke offered nothing to undo`);
        }
        if (posted.length) throw new Error(`${format}: a keystroke reached the host: ${JSON.stringify(posted)}`);

        // Taken back to the words it started with, and clicked out of. Nothing is written, and the three go back to the host's own answer.
        block.childNodes[0].nodeValue = baseline;
        block.textContent = baseline;
        withPageTimers((drain) => {
          fire('focusout', { relatedTarget: null });
          booted.document.activeElement = null;
          raiseWindowEvent('focusout', { relatedTarget: null });
          drain();
        });
        if (posted.length) throw new Error(`${format}: typing taken back still wrote ${JSON.stringify(posted)}`);
        if (booted.isDocumentDirty('notes.md')) {
          throw new Error(`${format}: the file was untouched and the dot stayed lit`);
        }
        if (vm.runInContext("undoableByPath.get('notes.md')", booted) === true) {
          throw new Error(`${format}: Undo was left offered with nothing to undo`);
        }
      }

      // A document that was already dirty keeps its dot when a typing session on top of it writes nothing: what is put back is the host's answer, not "clean".
      posted.length = 0;
      openTyping('# Title\n\nA paragraph.\n');
      booted.window.leafBlocksResynced({ source: '# Title\n\nA paragraph.\n', dirty: true, canUndo: true });
      const block = typedBlock({ start: 9, end: 21, typed: 'A paragraph.', baseline: 'A paragraph.' });
      booted.wireMarkdownEditable(block);
      booted.document.activeElement = block;
      for (const handler of [...(block.listeners.get('input') || [])]) handler({});
      withPageTimers((drain) => {
        booted.document.activeElement = null;
        raiseWindowEvent('focusout', { relatedTarget: null });
        drain();
      });
      if (!booted.isDocumentDirty('notes.md')) {
        throw new Error('an edit made before the typing was reported as saved');
      }
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // Typing reaches the document at every pause, so an edit arriving from anywhere else mid-typing does not redraw the page over words nothing holds. Nothing redraws at a pause either, which leaves the page's own map of where every block's bytes are as the only thing keeping the next splice honest — and a map that lags writes the wrong bytes, so the shift is held here rather than left to be found.
  check('a pause in the typing writes into the document, and moves the map with it', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      const source = '# Title\n\nA\n\nAfter it.\n';
      openTyping(source);
      const block = typedBlock({ start: 9, end: 10, typed: 'A paragraph.', baseline: 'A' });
      // The block after it, whose stamped range describes the buffer before the splice.
      const after = typedBlock({ start: 12, end: 21, typed: 'After it.', baseline: 'After it.' });
      const app = vm.runInContext('app', booted);
      const wasQuery = app.querySelector;
      const body = Object.assign(fakeElement('document-body'), {
        querySelectorAll: (selector) => (String(selector) === '[data-src-start]' ? [block, after] : []),
      });
      app.querySelector = (selector) => (String(selector) === '.document-body' ? body : wasQuery(selector));

      booted.sendLiveBlockEdit(block);
      const live = posted.filter((message) => message.command === 'editBlock');
      if (live.length !== 1) throw new Error(`the pause sent ${live.length} edits`);
      if (live[0].live !== true) throw new Error('the pause asked for a re-render under the caret');
      if (live[0].continuing) throw new Error('the first splice of a run recorded no undo point');
      const written = source.slice(0, live[0].start) + live[0].text + source.slice(live[0].end);
      if (written !== '# Title\n\nA paragraph.\n\nAfter it.\n') {
        throw new Error(`the document became ${JSON.stringify(written)}`);
      }

      // The map moved with it: the typed block grew, the block after it shifted by the same, and the source the page slices from is the spliced one.
      const at = (el) => booted.rangeOf(el, 'block');
      if (at(block).end !== 21) throw new Error(`the typed block ends at ${at(block).end}`);
      if (at(after).start !== 23 || at(after).end !== 32) {
        throw new Error(`the block after it is at [${at(after).start},${at(after).end})`);
      }
      if (vm.runInContext('sliceSourceBytes(0, documentSourceLength())', booted) !== written) {
        throw new Error('the page kept slicing the document it had before the pause');
      }
      // And what the shifted range names in the shifted source is still that block.
      if (written.slice(at(after).start, at(after).end) !== 'After it.') {
        throw new Error('the shifted range no longer covers the block it belongs to');
      }

      // A second pause continues the run, so the whole run is one undo step — and it splices over what the first pause wrote, not over what it replaced.
      posted.length = 0;
      block.childNodes[0].nodeValue = 'A paragraph, longer.';
      block.textContent = 'A paragraph, longer.';
      booted.sendLiveBlockEdit(block);
      const second = posted.filter((message) => message.command === 'editBlock');
      if (second.length !== 1 || second[0].continuing !== true) {
        throw new Error('a later pause in the same run started a second undo step');
      }
      if (second[0].start !== 9 || second[0].end !== 21) {
        throw new Error(`the second pause spliced [${second[0].start},${second[0].end})`);
      }
      if (written.slice(0, 9) + second[0].text + written.slice(21) !== '# Title\n\nA paragraph, longer.\n\nAfter it.\n') {
        throw new Error('the second pause wrote over the wrong bytes');
      }

      // Nothing new since the last pause is nothing to send.
      posted.length = 0;
      booted.sendLiveBlockEdit(block);
      if (posted.length) throw new Error('a pause with nothing typed in it still wrote to the document');

      // A note's table waits for the click-out: its commit writes one cell rather than a range, so nothing here can say how long the buffer's table became.
      posted.length = 0;
      const table = typedBlock({ kind: 'table', tag: 'TABLE', start: 9, end: 21, typed: 'x', baseline: 'y' });
      booted.sendLiveBlockEdit(table);
      if (posted.length) throw new Error('a table wrote a range splice it cannot measure');
    } finally {
      booted.ipc = wasIpc;
      restTyping();
    }
  });

  // The other reader that holds a range over time rather than reading one: a drag names its blocks as byte ranges, and the move splices exactly those. The grab and the drop are seconds apart, and the gutter holds the focus in between, so a pause in the typing lands right there — a run kept from the grab would carry the blocks around a document whose bytes had moved under it.
  check('a block dropped after a pause in the typing moves the bytes the pause left behind', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      const source = '# Title\n\nA\n\nAfter it.\n';
      openTyping(source);
      const typing = typedBlock({ start: 9, end: 10, typed: 'A paragraph.', baseline: 'A' });
      const after = typedBlock({ start: 12, end: 21, typed: 'After it.', baseline: 'After it.' });
      const app = vm.runInContext('app', booted);
      const wasQuery = app.querySelector;
      const body = Object.assign(fakeElement('document-body'), {
        querySelectorAll: (selector) => (String(selector) === '[data-src-start]' ? [typing, after] : []),
      });
      app.querySelector = (selector) => (String(selector) === '.document-body' ? body : wasQuery(selector));
      // Grabbed while the words were still only on screen, so the run it was grabbed on is the one the buffer no longer has.
      booted.__dragRun = [typing, after];
      vm.runInContext(
        'blockDrag = { target: __dragRun[0], elements: __dragRun, others: [__dragRun[1]], from: 0, to: 1, moved: true };',
        booted,
      );
      // The pause, mid-drag: the typed block grows by eleven bytes and the one under it moves by the same.
      booted.sendLiveBlockEdit(typing);
      posted.length = 0;
      // Nothing has the caret at the drop, so the move is the only thing sent.
      booted.document.activeElement = null;
      booted.endBlockDrag(true);
      const moves = posted.filter((message) => message.command === 'moveBlock');
      if (moves.length !== 1) throw new Error(`the drop sent ${moves.length} moves`);
      if (JSON.stringify(moves[0].ranges) !== JSON.stringify([[9, 21], [23, 32]])) {
        throw new Error(`the drop moved ${JSON.stringify(moves[0].ranges)}, which is where the blocks were before the pause`);
      }
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // The block after the typed one is what the shift is for, and the raw-source editor is the reader most easily caught by a stale one: the bytes it opens are worked out on the press, since anything worked out when it was wired is from before any pause could move them.
  check('a raw-source block opens the bytes it is stamped with now, not when it was wired', () => {
    const source = '# Title\n\nA\n\n```\ncode\n```\n';
    openTyping(source);
    const fence = typedBlock({ kind: 'code_block', tag: 'PRE', start: 12, end: 23, typed: '', baseline: '' });
    booted.wireSourceEditable(fence);
    // A pause in the block above wrote eleven more bytes, and the shift moved this block's stamp with them.
    const grown = '# Title\n\nA paragraph.\n\n```\ncode\n```\n';
    vm.runInContext(`setDocumentSource(${JSON.stringify(grown)});`, booted);
    fence.dataset.srcStart = String(grown.indexOf('```'));
    fence.dataset.srcEnd = String(grown.length - 1);
    try {
      fence.__startSourceEdit();
      if (fence.textContent !== 'code') {
        throw new Error(`the block opened ${JSON.stringify(fence.textContent)} rather than the code it is showing`);
      }
    } finally {
      restTyping();
    }
  });

  // A field box swallows every key so the page's own shortcuts cannot fire under a caret in a text field — which meant mid-field Ctrl+S reached nothing at all, and a field typed and saved wrote the file without it. The save is the one key let out, and the write it triggers has to have raised the dot by the time the save reads it.
  check('a field box lets the save key out, and a field write raises the dot itself', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      openTyping('---\ntags: one\n---\n');
      const box = booted.frontmatterInput({ value: 'one', label: 'tags', commit: () => true });
      const keydown = (box.listeners.get('keydown') || [])[0];
      if (!keydown) throw new Error('the field box wired no keys at all');
      const press = (key, ctrl) => {
        let stopped = false;
        keydown({
          key,
          ctrlKey: !!ctrl,
          metaKey: false,
          altKey: false,
          preventDefault() {},
          stopPropagation() {
            stopped = true;
          },
        });
        return stopped;
      };
      if (press('s', true)) throw new Error('the save key was swallowed inside a field box');
      if (press('S', true)) throw new Error('the save key held down with shift was swallowed');
      // Every other key is still the box's own, or the page's shortcuts fire under a caret in a text field.
      for (const key of ['s', 'a', 'Enter', 'Escape', 'z']) {
        if (!press(key, key === 'z')) throw new Error(`${key} escaped the field box`);
      }

      // And the write itself: the dot and the undo are up the moment it is sent, so the save reading them a tick later finds something to write.
      posted.length = 0;
      booted.sendFieldEdit('tags', 'two');
      if (!posted.some((message) => message.command === 'setField')) {
        throw new Error('the field never reached the host');
      }
      if (!booted.isDocumentDirty('notes.md')) throw new Error('a field write left the document reading as saved');
      if (vm.runInContext("undoableByPath.get('notes.md')", booted) !== true) {
        throw new Error('a field write left nothing to undo');
      }
    } finally {
      booted.ipc = wasIpc;
      restTyping();
    }
  });

  // A browser writes its own tags when the reader presses bold or strikethrough, and this app's serializer reads a different set — so the fold is what stands between what the browser made and what gets written to the file. It walks a wrapper's nodes into a replacement and swaps the wrapper out, which the stand-in page has to be able to do.

  check('the fold turns a browser\u2019s own tags into the ones the file is written with', () => {
    const { normalizeInlineFormatting } = booted;
    const block = fakeElement('fold-block');
    block.innerHTML = 'keep <strike>struck</strike> and <u>underlined</u> and <s>also struck</s>';
    normalizeInlineFormatting(block);
    // Struck-through words keep their meaning under the tag the serializer reads, and the words inside come with the tag.
    if (block.querySelectorAll('del').length !== 2) throw new Error(`the fold left ${block.querySelectorAll('del').length} tags the serializer reads rather than two`);
    if (block.querySelector('strike') || block.querySelector('s')) throw new Error('a browser\u2019s own struck-through tag survived the fold');
    // Underline has no Markdown, so it keeps only its words — and the words are what a fold that dropped them would lose silently.
    if (block.querySelector('u')) throw new Error('the underline survived the fold');
    if (block.textContent !== 'keep struck and underlined and also struck') throw new Error(`the fold lost words: ${JSON.stringify(block.textContent)}`);
    if (block.querySelectorAll('del')[0].textContent !== 'struck') throw new Error('the words inside the first struck tag did not come with it');
    // A browser writes the same three as a styled span too, and the fold reads those off the style rather than the tag.
    const styled = fakeElement('fold-styled');
    styled.innerHTML = '<span style="font-weight: bold">heavy</span><span style="font-style: italic">leaning</span>';
    normalizeInlineFormatting(styled);
    if (!styled.querySelector('strong') || !styled.querySelector('em')) throw new Error(`a styled span was not folded to its own tag: ${styled.innerHTML}`);
    if (styled.textContent !== 'heavyleaning') throw new Error('folding a styled span lost its words');
  });

  const pressCodeOn = (markup, source, edgeBoundary = false) => {
    const { applyInlineFormat, blockDomToSource, commitBlockEdit } = booted;
    const block = fakeElement('code-format-block');
    block.tagName = 'P';
    block.dataset = { blockKind: 'paragraph', srcStart: '0', srcEnd: String(Buffer.byteLength(source)) };
    block.innerHTML = markup;
    block.__editBaseline = source;
    const wrapped = block.querySelector('em') || block.querySelector('strong') || block.querySelector('del') || block.querySelector('a');
    const words = wrapped ? wrapped.childNodes.find((node) => node.nodeType === 3) : block.childNodes.find((node) => node.nodeType === 3);
    const textNodes = (root) => {
      const found = [];
      const walk = (node) => {
        if (node.nodeType === 3) found.push(node);
        else for (const child of node.childNodes || []) walk(child);
      };
      walk(root);
      return found;
    };
    const contains = (root, wanted) => root === wanted || (root.childNodes || []).some((child) => contains(child, wanted));
    const visibleOffset = (container, offset) => {
      let count = 0;
      const walk = (node) => {
        if (node === container) {
          if (node.nodeType === 3) count += Math.min(offset, node.nodeValue.length);
          else for (const child of (node.childNodes || []).slice(0, offset)) count += child.textContent.length;
          return true;
        }
        if (node.nodeType === 3) {
          count += node.nodeValue.length;
          return false;
        }
        for (const child of node.childNodes || []) if (walk(child)) return true;
        return false;
      };
      walk(block);
      return count;
    };
    const makeRange = () => {
      const range = {
        startContainer: block,
        startOffset: 0,
        endContainer: block,
        endOffset: 0,
        setStart(container, offset) {
          this.startContainer = container;
          this.startOffset = offset;
        },
        setEnd(container, offset) {
          this.endContainer = container;
          this.endOffset = offset;
        },
        selectNodeContents(node) {
          this.setStart(node, 0);
          this.setEnd(node, (node.childNodes || []).length);
        },
        cloneContents() {
          return { textContent: block.textContent.slice(visibleOffset(this.startContainer, this.startOffset), visibleOffset(this.endContainer, this.endOffset)) };
        },
        cloneRange() {
          const copy = makeRange();
          copy.setStart(this.startContainer, this.startOffset);
          copy.setEnd(this.endContainer, this.endOffset);
          return copy;
        },
        toString() {
          return block.textContent.slice(visibleOffset(this.startContainer, this.startOffset), visibleOffset(this.endContainer, this.endOffset));
        },
        deleteContents() {
          if (this.startContainer !== this.endContainer || this.startContainer.nodeType !== 3) throw new Error('the normalized code selection did not stay in one run of words');
          const node = this.startContainer;
          node.nodeValue = node.nodeValue.slice(0, this.startOffset) + node.nodeValue.slice(this.endOffset);
          node.textContent = node.nodeValue;
          this.endOffset = this.startOffset;
        },
        insertNode(node) {
          const holder = this.startContainer.nodeType === 3 ? this.startContainer.parentElement : this.startContainer;
          const reference = this.startContainer.nodeType === 3 ? this.startContainer : holder.childNodes[this.startOffset] || null;
          holder.insertBefore(node, reference);
          if (reference && reference.nodeType === 3 && !reference.nodeValue) holder.removeChild(reference);
        },
      };
      return range;
    };
    const selection = {
      ranges: [],
      get rangeCount() {
        return this.ranges.length;
      },
      getRangeAt(index) {
        return this.ranges[index];
      },
      removeAllRanges() {
        this.ranges.length = 0;
      },
      addRange(range) {
        this.ranges.push(range);
      },
    };
    const initial = makeRange();
    if (edgeBoundary && wrapped) {
      initial.setStart(block, block.childNodes.indexOf(wrapped));
      initial.setEnd(words, words.nodeValue.length);
    } else {
      initial.setStart(words, 0);
      initial.setEnd(words, words.nodeValue.length);
    }
    selection.addRange(initial);
    const wasSelection = booted.getSelection;
    const wasRange = booted.document.createRange;
    const wasWalker = booted.document.createTreeWalker;
    const posted = [];
    const wasIpc = booted.ipc;
    try {
      block.contains = (node) => contains(block, node);
      booted.getSelection = () => selection;
      booted.document.createRange = makeRange;
      booted.document.createTreeWalker = (root) => {
        const nodes = textNodes(root);
        let at = 0;
        return { nextNode: () => nodes[at++] || null };
      };
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
      booted.__codeFormatBlock = block;
      booted.__codeFormatRange = initial.cloneRange();
      vm.runInContext('selectionToolbarBlock = __codeFormatBlock; selectionToolbarRange = __codeFormatRange;', booted);
      applyInlineFormat({ tag: 'code' });
      const markdown = blockDomToSource(block);
      commitBlockEdit(block, markdown);
      return { block, markdown, selected: selection.getRangeAt(0).toString(), edit: posted.find((message) => message.command === 'editBlock') };
    } finally {
      booted.getSelection = wasSelection;
      booted.document.createRange = wasRange;
      booted.document.createTreeWalker = wasWalker;
      booted.ipc = wasIpc;
      delete booted.__codeFormatBlock;
      delete booted.__codeFormatRange;
      vm.runInContext('selectionToolbarBlock = null; selectionToolbarRange = null;', booted);
    }
  };

  check('code keeps an italic word when the saved selection begins outside its wrapper', () => {
    const source = 'before*words*after';
    const result = pressCodeOn('before<em>words</em>after', source, true);
    if (result.block.innerHTML !== 'before<em><code>words</code></em>after') throw new Error(`the page became ${result.block.innerHTML}`);
    if (result.selected !== 'words') throw new Error(`the code press selected ${JSON.stringify(result.selected)}`);
    if (result.markdown !== 'before*`words`*after') throw new Error(`the block serialized as ${JSON.stringify(result.markdown)}`);
    if (!result.edit || result.edit.start !== 0 || result.edit.end !== source.length) throw new Error('the code press did not commit over the whole block');
    const written = source.slice(0, result.edit.start) + result.edit.text + source.slice(result.edit.end);
    if (written !== 'before*`words`*after') throw new Error(`the buffer became ${JSON.stringify(written)}`);
  });

  check('code keeps every outer format and a selection already on text nodes', () => {
    const cases = [
      { name: 'italic', markup: '<em>words</em>', source: '*words*', want: '*`words`*' },
      { name: 'bold', markup: '<strong>words</strong>', source: '**words**', want: '**`words`**' },
      { name: 'strikethrough', markup: '<del>words</del>', source: '~~words~~', want: '~~`words`~~' },
      { name: 'link', markup: '<a href="#place">words</a>', source: '[words](#place)', want: '[`words`](#place)' },
      { name: 'plain words', markup: 'words', source: 'words', want: '`words`' },
    ];
    for (const one of cases) {
      const result = pressCodeOn(one.markup, one.source);
      if (result.markdown !== one.want) throw new Error(`${one.name} became ${JSON.stringify(result.markdown)}`);
      if (result.selected !== 'words') throw new Error(`${one.name} left ${JSON.stringify(result.selected)} selected`);
      if (!result.edit || result.edit.text !== one.want) throw new Error(`${one.name} did not commit its nested code`);
    }
  });

  // Pressing a format button a second time takes the wrapper away and leaves the same words selected, so a third press lands on them again. The order is the whole of it: the selection goes on while the phrase is still a run of its own, because the join keeps the first run and drops the rest, so a selection put on after it names a run that is gone.

  check('taking a format off selects the phrase before the runs are joined, in every sentence position', () => {
    const { unwrapSelectionAncestor } = booted;
    const wasSelection = booted.getSelection;
    try {
      const ranges = [];
      booted.getSelection = () => ({
        rangeCount: 1,
        removeAllRanges: () => ranges.splice(0, ranges.length),
        addRange: (range) => ranges.push(range),
      });
      // The four places a phrase can sit in a sentence, each with where its own run stands in the holder at the moment the holder is asked to join the runs up.
      const positions = [
        { name: 'with words on both sides', markup: 'before<em>words</em>after', words: 'beforewordsafter', at: 1 },
        { name: 'with words only in front', markup: 'before<em>words</em>', words: 'beforewords', at: 1 },
        { name: 'with words only after', markup: '<em>words</em>after', words: 'wordsafter', at: 0 },
        { name: 'with no words beside it', markup: '<em>words</em>', words: 'words', at: 0 },
      ];
      for (const position of positions) {
        ranges.length = 0;
        const block = fakeElement(`unwrap-${position.words}`);
        block.innerHTML = position.markup;
        // What the holder was holding when it was asked to join, kept rather than read afterwards: the stand-in range does not follow a boundary through a join, and a real browser moves both ranges onto the surviving run at the phrase's own character offsets.
        const joinRuns = block.normalize.bind(block);
        let onJoin = null;
        block.normalize = () => {
          const live = ranges[0];
          onJoin = {
            selected: ranges.length,
            container: live && live.startContainer,
            start: live && live.startOffset,
            end: live && live.endOffset,
            remembered: vm.runInContext('selectionToolbarRange', booted),
            run: block.childNodes[position.at] && block.childNodes[position.at].nodeValue,
          };
          joinRuns();
        };
        unwrapSelectionAncestor(block.querySelector('em'));
        if (!onJoin) throw new Error(`${position.name}: the holder was never asked to join the runs up`);
        if (onJoin.selected !== 1) throw new Error(`${position.name}: the words were not selected before the join`);
        if (onJoin.container !== block) throw new Error(`${position.name}: the selection went somewhere other than the holder the words are in`);
        if (onJoin.start !== position.at || onJoin.end !== position.at + 1) throw new Error(`${position.name}: the selection came across ${onJoin.start} to ${onJoin.end} rather than the phrase alone`);
        if (onJoin.run !== 'words') throw new Error(`${position.name}: the run the selection named held ${JSON.stringify(onJoin.run)} rather than the phrase`);
        // The remembered copy the bar reads back is around the phrase too, so the press after this one lands on the same words rather than on nothing.
        if (!onJoin.remembered) throw new Error(`${position.name}: nothing was remembered for the bar to read back`);
        if (onJoin.remembered.startContainer !== block || onJoin.remembered.startOffset !== position.at || onJoin.remembered.endOffset !== position.at + 1) throw new Error(`${position.name}: the remembered copy was not around the phrase`);
        // And the join still happens: the wrapper is gone, every word survives, and the holder is left with one run rather than three sitting side by side.
        if (block.querySelector('em')) throw new Error(`${position.name}: the wrapper stayed after the format was taken off`);
        if (block.textContent !== position.words) throw new Error(`${position.name}: taking the format off landed as ${JSON.stringify(block.textContent)}`);
        if (block.childNodes.length !== 1) throw new Error(`${position.name}: the holder was left holding ${block.childNodes.length} nodes rather than one run of words`);
      }
      // A wrapper holding a tag as well as words hands both over in the order they were written, and the two ends bracket the pair rather than one of them.
      const mixed = fakeElement('unwrap-mixed');
      mixed.innerHTML = '<a href="#x">go <b>now</b></a>';
      unwrapSelectionAncestor(mixed.querySelector('a'));
      if (mixed.querySelector('a')) throw new Error('the link stayed after it was taken off');
      if (!mixed.querySelector('b') || mixed.textContent !== 'go now') throw new Error(`taking the link off landed as ${mixed.innerHTML}`);
      if (mixed.childNodes.length !== 2) throw new Error(`taking the link off left ${mixed.childNodes.length} nodes rather than the words and the tag`);
      // A wrapper with nothing in it still gets the join, so the paragraph is not left holding the two runs the wrapper stood between.
      ranges.length = 0;
      const empty = fakeElement('unwrap-empty');
      empty.innerHTML = 'before<em></em>after';
      unwrapSelectionAncestor(empty.querySelector('em'));
      if (empty.querySelector('em')) throw new Error('an empty wrapper stayed after the format was taken off');
      if (empty.childNodes.length !== 1) throw new Error(`an empty wrapper left ${empty.childNodes.length} runs of words rather than one`);
      if (ranges.length !== 0) throw new Error('an empty wrapper put a selection on nothing');
    } finally {
      booted.getSelection = wasSelection;
    }
  });
}
