// A block that will not open, a table with one cell in it, and the shape an edit is sent in.

import { join } from 'node:path';
import vm from 'node:vm';
import {
  check,
  fakeElement,
  record,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;
  const { sourceSpliceSince, rangesAfterCommit } = booted;

  // Half a message opens and half of it does not, and nothing on the page said which — the same fault the padlock had. A press on a shut part says why; a press on one that opens says nothing, because it is about to open.
  check('a part of a message that cannot open says why when it is pressed', () => {
    const { wireEmailClosedParts } = booted;
    const said = [];
    const wasToast = booted.leafToast;
    // A stand-in body that records the one listener, so a press can be raised at it.
    let press = null;
    const body = {
      addEventListener: (type, handler) => {
        if (type === 'pointerdown') press = handler;
      },
    };
    // `closest` answers for whichever ancestors this element is said to have.
    const at = (...held) => ({ closest: (selector) => (held.includes(selector) ? {} : null) });
    try {
      booted.leafToast = (message) => said.push(message);
      wireEmailClosedParts(body);
      if (!press) throw new Error('nothing listens for a press on the page');

      press({ target: at('.email-body') });
      if (said.length !== 1 || !said[0].includes('source view')) {
        throw new Error(`a packed body did not say where to edit it: ${JSON.stringify(said)}`);
      }
      press({ target: at('.email-headers') });
      if (said.length !== 2 || !said[1].includes('source view')) {
        throw new Error(`a coded header did not say where to edit it: ${JSON.stringify(said)}`);
      }
      // A part that opens answers for itself, and the attachment list is files rather than words.
      press({ target: at('[data-src-start]', '.email-body') });
      press({ target: at('.email-attachments') });
      if (said.length !== 2) throw new Error(`a part that opens was growled at: ${JSON.stringify(said)}`);
    } finally {
      booted.leafToast = wasToast;
    }
  });

  // The data half of the same fault: a JSON or YAML block with no proven range is drawn exactly like the ones beside it that open, so a press on one must not answer with nothing at all and read as the page being broken. A press on a block that opens still says nothing, because it is about to open.
  check('a data block that cannot open says why when it is pressed', () => {
    const { wireDataClosedParts } = booted;
    const said = [];
    const wasToast = booted.leafToast;
    let press = null;
    const body = {
      addEventListener: (type, handler) => {
        if (type === 'pointerdown') press = handler;
      },
    };
    // `closest` answers for whichever ancestors this element is said to have; a block answers with its own kind.
    const at = (held, kind) => ({
      closest: (selector) => (held.includes(selector) ? (selector === '[data-block-id]' ? { dataset: { blockKind: kind } } : {}) : null),
    });
    try {
      booted.leafToast = (message) => said.push(message);
      wireDataClosedParts(body);
      if (!press) throw new Error('nothing listens for a press on the page');

      press({ target: at(['[data-block-id]'], 'data_field') });
      if (said.length !== 1 || !said[0].includes('source view')) {
        throw new Error(`a value nothing could place did not say where to edit it: ${JSON.stringify(said)}`);
      }
      // A list and a table could not be placed for a different reason — where they end — so they say that instead.
      press({ target: at(['[data-block-id]'], 'data_list') });
      if (said.length !== 2 || !said[1].includes('where this ends')) {
        throw new Error(`a list did not say why it could not open: ${JSON.stringify(said)}`);
      }

      // A heading is a key's name as often as it is a value, so it says where its words came from rather than claiming how a value is spelled.
      press({ target: at(['[data-block-id]'], 'data_heading') });
      if (said.length !== 3 || !said[2].includes('comes from the file')) {
        throw new Error(`a heading was told it was a value: ${JSON.stringify(said)}`);
      }

      // A block that opens answers for itself, the big heading over a file with no title of its own opens the rename box, and a press on nothing at all is not a block.
      press({ target: at(['[data-src-start]', '[data-block-id]'], 'data_field') });
      press({ target: at(['[data-borrowed-title]', '[data-block-id]'], 'data_heading') });
      press({ target: at([], null) });
      if (said.length !== 3) throw new Error(`a block that answers was growled at: ${JSON.stringify(said)}`);
      // And the page wires it: a data document reaching the reading editor gets the same answer, or the lines above are a function nothing ever calls.
      const read = (expression) => vm.runInContext(expression, booted);
      const inApp = read('app');
      const wasQuery = inApp.querySelector;
      const wasUnlocked = read('readingUnlocked');
      let bound = null;
      const page = {
        addEventListener: (type, handler) => {
          if (type === 'pointerdown') bound = handler;
        },
        querySelectorAll: () => [],
        querySelector: () => null,
      };
      try {
        read('readingUnlocked = true;');
        inApp.querySelector = (selector) => (selector === '.document-body' ? page : wasQuery(selector));
        booted.bindReadingEditor({ format: 'yaml', blocks: [], source: 'title: |\n  words\n' }, { deferCaret: true });
        if (!bound) throw new Error('a data document reaching the reading editor listens for no press');
        said.length = 0;
        bound({ target: at(['[data-block-id]'], 'data_heading') });
        if (said.length !== 1) throw new Error(`the page wired no answer for a block that cannot open: ${JSON.stringify(said)}`);
      } finally {
        inApp.querySelector = wasQuery;
        read(`readingUnlocked = ${wasUnlocked};`);
        read("currentDocumentFormat = 'markdown'; currentDocumentSource = ''; currentDocumentBindsAnything = true;");
      }
    } finally {
      booted.leafToast = wasToast;
    }
  });

  // The gutter works over the blocks standing in the page, and a message is the first document whose blocks are not all children of it — its paragraphs stand inside the body section. Two symptoms fell out of the one line: the gutter vanished the moment the pointer left the words for the margin, and the last paragraph never had a space under it for the plus.
  check('the gutter sees a message’s paragraphs, not the section around them', () => {
    const { blockGutterOccupants, aimBlockGutterBelow } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const inApp = read('app');
    const wasQuery = inApp.querySelector;
    const wasSpace = booted.aimBlockGutterAtSpace;
    // A block with height, so the occupant filter keeps it.
    const block = (name, held = [], classes = [], range = true) => ({
      name,
      children: held,
      dataset: range ? { srcStart: '0', srcEnd: '4' } : {},
      classList: { contains: (one) => classes.includes(one) },
      getBoundingClientRect: () => ({ top: 0, bottom: 10 }),
    });
    const stand = (children) => {
      inApp.querySelector = (selector) =>
        selector === '.document-body' ? { children } : wasQuery.call(inApp, selector);
    };
    try {
      const first = block('first');
      const last = block('last');
      const after = block('after');
      // A plain-text body: the section holds no range of its own, and the paragraphs inside it are the blocks.
      stand([block('heading'), block('section', [first, last], ['email-body'], false), after]);
      const held = blockGutterOccupants().map((el) => el.name);
      if (held.join() !== 'heading,first,last,after') {
        throw new Error(`the gutter saw ${JSON.stringify(held)}`);
      }

      // The last paragraph of a body now has something under it, which is where the plus waits.
      let space = null;
      booted.aimBlockGutterAtSpace = (given) => {
        space = given;
      };
      aimBlockGutterBelow(last);
      if (!space || space.above !== last || space.below !== after) {
        throw new Error('the last paragraph of a body was offered no space below it');
      }

      // An HTML body carries its own range, so it stays one block and nothing inside it is offered anything.
      stand([block('section', [block('inside')], ['email-body'])]);
      if (blockGutterOccupants().map((el) => el.name).join() !== 'section') {
        throw new Error('a body that is one editable block was taken apart');
      }

      // A note is untouched: nothing in it claims that class, so every block is its own.
      stand([block('one'), block('two')]);
      if (blockGutterOccupants().map((el) => el.name).join() !== 'one,two') {
        throw new Error('a note’s own blocks changed');
      }
    } finally {
      inApp.querySelector = wasQuery;
      booted.aimBlockGutterAtSpace = wasSpace;
    }
  });

  // A table is written back by re-serializing the whole thing, and the dashes line under the header is what carries each column's alignment. Deleting across two cells can take a whole cell out, and a changed column count is when that line is rebuilt instead of copied — a wrong rebuild un-centers a column with nothing on screen to show for it.
  check('a rebuilt dashes line keeps each column aligned', () => {
    const { tableDelimiterCells, tableDelimiterRow } = booted;
    const column = (align) => ({ getAttribute: (name) => (name === 'align' ? align : null) });
    const is = (got, want) => {
      if (got !== want) throw new Error(`got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
    };

    is(tableDelimiterCells([column(null)]), '| --- |');
    is(tableDelimiterCells([column('left')]), '| :--- |');
    is(tableDelimiterCells([column('center')]), '| :---: |');
    is(tableDelimiterCells([column('right')]), '| ---: |');
    is(tableDelimiterCells([column('CENTER')]), '| :---: |'); // the attribute's case is not ours
    is(
      tableDelimiterCells([column(null), column('center'), column('right')]),
      '| --- | :---: | ---: |',
    );
    // A table with no usable source range takes the rebuilt row, alignment and all.
    is(tableDelimiterRow({ dataset: {} }, [column('right'), column(null)]), '| ---: | --- |');
  });

  // Typing one character into a cell must not rebuild every row of the table, or a table lined up by hand loses its columns. What stops that is finding the one cell that moved and sending only that; anything else — a column gained, two cells changed at once — has to fall back to the whole-table rewrite, and reporting a fallback as a one-cell edit would write the wrong bytes.
  check('a table sends the one cell that changed, and nothing when more did', () => {
    const { tableCellTexts, tableCellChange, tableCellPosition } = booted;
    const cell = (text, checked) => ({
      childNodes: text ? [{ nodeType: 3, nodeValue: text }] : [],
      querySelector: () => (checked === undefined ? null : { checked }),
    });
    const row = (...cells) => {
      const tr = { tagName: 'TR', children: cells };
      cells.forEach((one) => {
        one.parentElement = tr;
      });
      return tr;
    };
    const table = (head, ...body) => {
      const drawn = fakeElement('cell-change-table');
      drawn.tagName = 'TABLE';
      drawn.dataset.blockKind = 'table';
      const thead = fakeElement('cell-change-head');
      thead.tagName = 'THEAD';
      thead.appendChild(head);
      const tbody = fakeElement('cell-change-body');
      tbody.tagName = 'TBODY';
      body.forEach((one) => tbody.appendChild(one));
      drawn.appendChild(thead);
      drawn.appendChild(tbody);
      return drawn;
    };
    const same = (got, want) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        throw new Error(`got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
      }
    };

    const head = row(cell('item'), cell('cost'));
    const box = cell('', true);
    const drawn = table(head, row(cell('apple'), cell('1')), row(box, cell('a | b')));
    // A checkbox-only cell writes its live state, and a pipe in a cell is escaped so it cannot be read as a column.
    same(tableCellTexts(drawn), [
      ['item', 'cost'],
      ['apple', '1'],
      ['[x]', 'a \\| b'],
    ]);

    const before = tableCellTexts(drawn);
    same(tableCellChange(before, before), null); // nothing typed, nothing sent
    same(tableCellChange(before, [['item', 'price'], ['apple', '1'], ['[x]', 'a \\| b']]), {
      row: 0,
      column: 1,
      columns: 2,
      text: 'price',
    });
    // Two cells at once, a column gained, a row gained: all of them the whole-table rewrite's.
    same(tableCellChange(before, [['id', 'price'], ['apple', '1'], ['[x]', 'a \\| b']]), null);
    same(tableCellChange(before, [['item', 'cost', 'vat'], ['apple', '1'], ['[x]', 'a \\| b']]), null);
    same(tableCellChange(before, [['item', 'cost'], ['apple', '1']]), null);

    // A checkbox knows its own cell without a baseline to diff against; the head row is row 0.
    same(tableCellPosition(drawn, box), { row: 2, column: 0, columns: 2, text: '[x]' });
    same(tableCellPosition(drawn, head.children[1]), { row: 0, column: 1, columns: 2, text: 'cost' });
    same(tableCellPosition(drawn, cell('loose')), null);
  });

  check('a save before a block move shifts the ranges it moved', () => {
    // Dragging a block after typing in one sends two edits: the save, then the move against the buffer the save wrote. Ranges that drift here reorder the wrong text, so the host refuses a list that is not sorted and disjoint.
    const ranges = [
      [0, 10],
      [12, 20],
      [22, 30],
    ];
    const same = (got, want) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        throw new Error(`got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
      }
    };
    const sorted = (got) => {
      let previousEnd = -1;
      for (const [start, end] of got) {
        if (start < previousEnd || end < start) throw new Error(`out of order: ${JSON.stringify(got)}`);
        previousEnd = end;
      }
    };

    same(rangesAfterCommit(ranges, null), ranges); // nothing was typed
    // The middle block grew by 5: it keeps its start, and the one after it slides.
    const grown = rangesAfterCommit(ranges, { start: 12, end: 20, delta: 5 });
    same(grown, [
      [0, 10],
      [12, 25],
      [27, 35],
    ]);
    sorted(grown);
    // And shrank by 6.
    const shrunk = rangesAfterCommit(ranges, { start: 12, end: 20, delta: -6 });
    same(shrunk, [
      [0, 10],
      [12, 14],
      [16, 24],
    ]);
    sorted(shrunk);
    // A block edited outside the run counts too: one below it leaves the run alone, one above it slides the whole run.
    same(rangesAfterCommit(ranges, { start: 40, end: 44, delta: 9 }), ranges);
    const pushed = rangesAfterCommit([[12, 20]], { start: 0, end: 10, delta: 3 });
    same(pushed, [[15, 23]]);
  });

  check('an edit is described as the part that changed', () => {
    const apply = (previous, next) => {
      const splice = sourceSpliceSince(previous, next);
      const rebuilt =
        previous.slice(0, splice.start) +
        splice.inserted +
        previous.slice(splice.start + splice.removed);
      if (rebuilt !== next) {
        throw new Error(
          `splice of ${JSON.stringify(previous)} -> ${JSON.stringify(next)} rebuilt ` +
            `${JSON.stringify(rebuilt)} (${JSON.stringify(splice)})`
        );
      }
      if (splice.length !== next.length) {
        throw new Error(`splice reported length ${splice.length}, text is ${next.length}`);
      }
    };

    apply('hello', 'hello world'); // appended
    apply('hello world', 'hello'); // trimmed
    apply('one two three', 'one TWO three'); // replaced in the middle
    apply('same', 'same'); // untouched
    apply('', 'first words'); // from empty
    apply('all of it', ''); // to empty
    apply('a\nb\nc\n', 'a\nB\nc\n'); // across lines
    apply('café note', 'café notes'); // accented
    apply('emoji 😀 here', 'emoji 😀 there'); // after a surrogate pair
    apply('emoji 😀 here', 'emoji 🎉 here'); // replacing one
    apply('repeat repeat', 'repeat repeat repeat'); // ambiguous, repeated text
  });

  check('a surrogate pair is never split in half', () => {
    const splice = sourceSpliceSince('x😀y', 'x😀z');
    const head = splice.start > 0 ? 'x😀z'.charCodeAt(splice.start - 1) : 0;
    if (head >= 0xd800 && head <= 0xdbff) {
      throw new Error(`splice starts after a lone high surrogate at ${splice.start}`);
    }
  });
}
