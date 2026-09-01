// The plus, the gutter beside a block, and what a new line writes into the file.

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

  // The grab bar is offered where a block's range is the whole block. In a message that is a body paragraph and nothing else: a header value's range is the value inside a labeled line, so dragging one would leave its label behind — the same reason JSON and YAML have no gutter at all.
  check('only a message’s body paragraphs are offered the grab bar', () => {
    const { blockGutterTargetAllowed } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const block = (kind) => ({ dataset: { blockKind: kind } });
    const wasFormat = read('currentDocumentFormat');
    try {
      read("currentDocumentFormat = 'eml';");
      if (!blockGutterTargetAllowed(block('email_paragraph'))) {
        throw new Error('a body paragraph was refused the grab bar');
      }
      for (const kind of ['email_header', 'email_body']) {
        if (blockGutterTargetAllowed(block(kind))) {
          throw new Error(`${kind} was offered a grab bar it cannot be dragged by`);
        }
      }
      if (blockGutterTargetAllowed(null)) throw new Error('nothing at all was offered a grab bar');

      // Every block of a note still qualifies — the rule above is the message's alone.
      read("currentDocumentFormat = 'markdown';");
      if (!blockGutterTargetAllowed(block('paragraph')) || !blockGutterTargetAllowed(block('table'))) {
        throw new Error('a note lost the gutter it already had');
      }
    } finally {
      read(`currentDocumentFormat = ${JSON.stringify(wasFormat)};`);
    }
  });

  // The plus writes a block into a file that is a list of blocks. A message is an envelope with parts in it, so the only thing a reader can add without rewriting it is another paragraph of a body — and the blank line that separates two of them has to be written in that message's own ending, not the browser's.
  check('a message is offered one thing to add, and its blank line is its own', () => {
    const { blockInsertOptions, documentLineEnding } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const wasFormat = read('currentDocumentFormat');
    const wasSource = read('currentDocumentSource');
    try {
      read("currentDocumentFormat = 'eml'; currentDocumentSource = 'Subject: a\\r\\n\\r\\nOne.\\r\\n';");
      const offered = blockInsertOptions(null);
      if (offered.length !== 1 || offered[0].blank !== 'text') {
        throw new Error(`a message was offered ${JSON.stringify(offered.map((one) => one.id))}`);
      }
      if (documentLineEnding() !== '\r\n') throw new Error('a message written with \\r\\n was given \\n');

      // The same message written the other way keeps that.
      read("currentDocumentSource = 'Subject: a\\n\\nOne.\\n';");
      if (documentLineEnding() !== '\n') throw new Error('a message written with \\n was given \\r\\n');

      // A note is unaffected: it gets its whole menu, and its separator was always \n.
      read("currentDocumentFormat = 'markdown';");
      if (blockInsertOptions(null).length < 5) throw new Error('a note lost entries from its plus');
      if (documentLineEnding() !== '\n') throw new Error('a note stopped being written with \\n');
    } finally {
      read(`currentDocumentFormat = ${JSON.stringify(wasFormat)}; currentDocumentSource = ${JSON.stringify(wasSource)};`);
    }
  });

  /** An XML page with a blank line open on it: the page set to that document, the line the plus opened, and every command it sends. `place` is what the gutter does with the host; the line is the block, since these specs ask for no wrapper. */
  function xmlBlankLine(source, dialect, specId, insertAt) {
    const read = (expression) => vm.runInContext(expression, booted);
    const was = {
      format: read('currentDocumentFormat'),
      dialect: read('currentDocumentDialect'),
      source: read('currentDocumentSource'),
      send: booted.ipc.postMessage,
    };
    const sent = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    read(
      `currentDocumentFormat = 'xml'; currentDocumentDialect = ${JSON.stringify(dialect)}; ` +
        `currentDocumentSource = ${JSON.stringify(source)};`,
    );
    let line = null;
    booted.openInsertBlock(insertAt, {
      spec: booted.blankBlockSpec(specId) || booted.PLAIN_LINE_SPEC,
      place: (host) => {
        line = host;
      },
    });
    const raise = (type, event) => {
      for (const handler of line.listeners.get(type) || []) handler(event || {});
    };
    return {
      line,
      sent,
      type: (words) => {
        line.textContent = words;
        raise('input', {});
      },
      enter: () => raise('keydown', { key: 'Enter', preventDefault() {} }),
      away: () => raise('blur', { relatedTarget: null }),
      caret: () => read('pendingCaret'),
      restore: () => {
        booted.ipc.postMessage = was.send;
        read(
          `currentDocumentFormat = ${JSON.stringify(was.format)}; ` +
            `currentDocumentDialect = ${JSON.stringify(was.dialect)}; ` +
            `currentDocumentSource = ${JSON.stringify(was.source)}; pendingCaret = null;`,
        );
      },
    };
  }

  // Neither of the plus's options on an XML page may splice source neither renderer draws, or the click closes the row and changes nothing while the document quietly goes unsaved. The element option opens the same blank line a note's plus opens, and what is typed lands inside the tag.
  check('the element the plus offers on an XML page is a line to type on, and the words land inside the tag', () => {
    const { blockInsertOptions, blockSeparator } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const tei = '<div><head>One</head><p>A line.</p></div>';
    const opened = xmlBlankLine(tei, 'tei', 'element:p', 21);
    try {
      // TEI draws a `<p>` anywhere in a section and refuses a second heading, so beside a heading the clone is the one tag that never appears.
      const offered = blockInsertOptions({ dataset: { srcStart: '5', srcEnd: '21' } });
      const element = offered.find((one) => one.id === 'element');
      if (!element || element.text) {
        throw new Error(`the element option still writes source: ${JSON.stringify(offered)}`);
      }
      if (element.blank !== 'element:p') {
        throw new Error(`the option beside a TEI heading was ${JSON.stringify(element)}`);
      }
      if (blockSeparator() !== '\n') throw new Error('a tree document was given a note’s blank line');

      // The line says what it is for and writes nothing until something is typed on it.
      if (!String(opened.line.dataset.placeholder).includes('<p>')) {
        throw new Error(`the line's wording was ${JSON.stringify(opened.line.dataset.placeholder)}`);
      }
      if (opened.sent.length) throw new Error('opening a line wrote to the document');

      opened.type('The words');
      opened.enter();
      const wrote = opened.sent.filter((one) => one.command === 'editBlock');
      if (wrote.length !== 1 || wrote[0].text !== '\n<p>The words</p>') {
        throw new Error(`the first keystroke committed ${JSON.stringify(wrote)}`);
      }
      if (wrote[0].start !== 21 || wrote[0].end !== 21) {
        throw new Error(`the element landed at ${wrote[0].start}..${wrote[0].end}`);
      }
    } finally {
      opened.restore();
    }
  });

  // Everywhere but TEI the offered element is the clone of the block beside the gap, since an element with words in it draws as prose or a labeled row. What is typed is the document's own text, and Enter carries on in another of the same element rather than the plain Markdown line the chain otherwise falls to.
  check('a typed & arrives escaped inside the element, and Enter opens another one line apart', () => {
    const { blockInsertOptions } = booted;
    const config = '<config><name>Widget</name></config>';
    const opened = xmlBlankLine(config, null, 'element:name', 27);
    try {
      const offered = blockInsertOptions({ dataset: { srcStart: '8', srcEnd: '27' } });
      const element = offered.find((one) => one.id === 'element');
      if (!element || element.blank !== 'element:name') {
        throw new Error(`a generic document was offered ${JSON.stringify(offered)}`);
      }

      opened.type('Bells & <whistles>');
      opened.enter();
      const wrote = opened.sent.filter((one) => one.command === 'editBlock');
      if (wrote.length !== 1 || wrote[0].text !== '\n<name>Bells &amp; &lt;whistles></name>') {
        throw new Error(`what was typed reached the file as ${JSON.stringify(wrote)}`);
      }
      // Enter chains another of the same element, by name, one newline down from where this one landed.
      const caret = opened.caret();
      if (!caret || !caret.insertBelow || caret.blockSpec !== 'element:name') {
        throw new Error(`Enter chained ${JSON.stringify(caret)}`);
      }
      if (caret.srcStart !== 28) throw new Error(`the next line was aimed at ${caret.srcStart}`);
    } finally {
      opened.restore();
    }
  });

  // The menu is the audit's table: each page is offered the kinds the renderer that drew it draws, and no others. A scholarly page has verse and no tables; the heading it writes is a section with its name in it, since that is the only shape drawn as a heading there.
  check('the plus on a scholarly page offers a heading and a verse line, and both are lines to type on', () => {
    const { blockInsertOptions } = booted;
    const tei = '<div><head>One</head><p>A line.</p></div>';
    const heading = xmlBlankLine(tei, 'tei', 'tei:head', tei.length);
    try {
      const offered = blockInsertOptions({ dataset: { srcStart: '5', srcEnd: '21' } });
      const ids = offered.map((one) => one.id).join(',');
      if (ids !== 'element,heading,verse,comment') {
        throw new Error(`a scholarly page was offered ${ids}`);
      }
      // The tag can only ever be `<p>` there, so the entry says what it makes rather than naming markup.
      if (offered[0].label !== 'Text') throw new Error(`the element entry read ${offered[0].label}`);
      if (heading.sent.length) throw new Error('opening a heading wrote to the document');

      heading.type('New part');
      heading.enter();
      const wrote = heading.sent.filter((one) => one.command === 'editBlock');
      if (wrote.length !== 1 || wrote[0].text !== '\n<div><head>New part</head></div>') {
        throw new Error(`Heading committed ${JSON.stringify(wrote)}`);
      }
      // Enter under a heading is the paragraph you write there. A tree document has no plain line to fall to, so an entry that named nothing would write bare words between two elements.
      if (heading.caret().blockSpec !== 'element:p') {
        throw new Error(`Enter under a heading chained ${JSON.stringify(heading.caret())}`);
      }
    } finally {
      heading.restore();
    }

    const verse = xmlBlankLine(tei, 'tei', 'tei:l', tei.length);
    try {
      verse.type('A line of verse');
      verse.enter();
      const wrote = verse.sent.filter((one) => one.command === 'editBlock');
      if (wrote.length !== 1 || wrote[0].text !== '\n<l>A line of verse</l>') {
        throw new Error(`Verse committed ${JSON.stringify(wrote)}`);
      }
      // Verse is lines, so Enter carries on in another one and they join into one quote as they are drawn.
      if (verse.caret().blockSpec !== 'tei:l') {
        throw new Error(`Enter after a verse line chained ${JSON.stringify(verse.caret())}`);
      }
    } finally {
      verse.restore();
    }
  });

  // Every other XML has tables and no verse. A row is offered only beside one, and the clone is taken away exactly there: another record with words straight inside it reads as prose to the grouping, and one of those stops the whole run being a table and scatters it into a stack of headed lists.
  check('the plus beside a table offers a row instead of the clone that would break it', () => {
    const { blockInsertOptions } = booted;
    const sitemap =
      '<urlset><url><loc>https://leaftext.com/</loc></url>' +
      '<url><loc>https://leaftext.com/docs/</loc></url></urlset>';
    const at = sitemap.lastIndexOf('</url>') + '</url>'.length;
    const table = {
      dataset: { srcStart: String(sitemap.indexOf('<url>')), srcEnd: String(at), blockKind: 'table' },
    };
    const row = xmlBlankLine(sitemap, null, 'row:url:loc', at);
    try {
      const beside = blockInsertOptions(table)
        .map((one) => one.id)
        .join(',');
      if (beside !== 'heading,row,comment') throw new Error(`the gap under a table was offered ${beside}`);

      // Away from the table the clone is right and there is no row to add, since a row belongs to a table.
      const field = {
        dataset: {
          srcStart: String(sitemap.indexOf('<loc>')),
          srcEnd: String(sitemap.indexOf('</loc>') + '</loc>'.length),
          blockKind: 'paragraph',
        },
      };
      const elsewhere = blockInsertOptions(field)
        .map((one) => one.id)
        .join(',');
      if (elsewhere !== 'element,heading,comment') {
        throw new Error(`a gap away from the table was offered ${elsewhere}`);
      }

      // A table whose columns are all attributes has no child element to type into, so it is offered no row rather than one that cannot be filled in.
      const attributes = '<urlset><url loc="https://leaftext.com/"/><url loc="https://leaftext.com/docs/"/></urlset>';
      vm.runInContext(`currentDocumentSource = ${JSON.stringify(attributes)};`, booted);
      const bare = blockInsertOptions({
        dataset: {
          srcStart: String(attributes.indexOf('<url ')),
          srcEnd: String(attributes.lastIndexOf('/>') + 2),
          blockKind: 'table',
        },
      })
        .map((one) => one.id)
        .join(',');
      if (bare !== 'heading,comment') throw new Error(`a table of attributes was offered ${bare}`);
      vm.runInContext(`currentDocumentSource = ${JSON.stringify(sitemap)};`, booted);

      // The record's tag and its first column come out of the table's own source, so what lands is another of what is already there.
      row.type('typed');
      row.enter();
      const wrote = row.sent.filter((one) => one.command === 'editBlock');
      if (wrote.length !== 1 || wrote[0].text !== '\n<url><loc>typed</loc></url>') {
        throw new Error(`Row committed ${JSON.stringify(wrote)}`);
      }
      if (wrote[0].start !== at || wrote[0].end !== at) {
        throw new Error(`the row landed at ${wrote[0].start}..${wrote[0].end}`);
      }
      if (row.caret().blockSpec !== 'row:url:loc') {
        throw new Error(`Enter after a row chained ${JSON.stringify(row.caret())}`);
      }
    } finally {
      row.restore();
    }

    const heading = xmlBlankLine(sitemap, null, 'xml:head', at);
    try {
      heading.type('New part');
      heading.enter();
      const wrote = heading.sent.filter((one) => one.command === 'editBlock');
      if (wrote.length !== 1 || wrote[0].text !== '\n<section><head>New part</head></section>') {
        throw new Error(`Heading committed ${JSON.stringify(wrote)}`);
      }
    } finally {
      heading.restore();
    }
  });

  // The other option: a comment is written into the gap as the file's own bytes, one line down from the block above it — and both renderers now draw one, so the click lands something visible instead of changing the document invisibly.
  check('choosing Comment on an XML page writes one line down from the block above', () => {
    const { blockInsertOptions, runGapInsert } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const was = {
      format: read('currentDocumentFormat'),
      dialect: read('currentDocumentDialect'),
      source: read('currentDocumentSource'),
      send: booted.ipc.postMessage,
    };
    const sent = [];
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      read(
        "currentDocumentFormat = 'xml'; currentDocumentDialect = 'tei'; " +
          "currentDocumentSource = '<div><head>One</head><p>A line.</p></div>';",
      );
      const after = { dataset: { srcStart: '5', srcEnd: '21' } };
      const comment = blockInsertOptions(after).find((one) => one.id === 'comment');
      if (!comment) throw new Error('an XML page stopped offering a comment');

      runGapInsert({ after, before: null }, comment);
      const wrote = sent.filter((one) => one.command === 'editBlock');
      if (wrote.length !== 1 || wrote[0].text !== '\n<!-- note -->') {
        throw new Error(`choosing Comment wrote ${JSON.stringify(wrote)}`);
      }
      if (wrote[0].start !== 21 || wrote[0].end !== 21) {
        throw new Error(`the comment landed at ${wrote[0].start}..${wrote[0].end}`);
      }
    } finally {
      booted.ipc.postMessage = was.send;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; ` +
          `currentDocumentDialect = ${JSON.stringify(was.dialect)}; ` +
          `currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // A drawn comment is a block with its own bytes behind it, and every tree block the page cannot type on as it looks opens as source when it is pressed. So this needs no wiring of its own — it needs proving that the comment is inside the rule.
  check('a drawn comment opens its own source when it is pressed', () => {
    const { wireSourceEditable } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const source = '<div><head>One</head><!-- note --><p>A line.</p></div>';
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      const comment = fakeElement('div');
      comment.dataset = { srcStart: '21', srcEnd: '34', blockKind: 'comment' };
      wireSourceEditable(comment);
      const press = (comment.listeners.get('pointerdown') || [])[0];
      if (!press) throw new Error('a drawn comment answers a press with nothing');

      // The row the fold opens by is the one press on a block that already means something: it opens the fold, and the editor stays out of it.
      const row = { closest: (selector) => (selector === 'summary' ? {} : null) };
      press({ target: row, button: 0, preventDefault() {} });
      if (comment.dataset.editingSource === 'true') {
        throw new Error('pressing the fold’s own row opened the editor instead of the fold');
      }

      press({ target: null, button: 0, preventDefault() {} });
      if (comment.dataset.editingSource !== 'true') throw new Error('pressing a comment opened no editor');
      if (comment.textContent !== '<!-- note -->') {
        throw new Error(`the comment opened on ${JSON.stringify(comment.textContent)}`);
      }
    } finally {
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // Half a tree document types on its words and half of it opens the file's markup, and nothing on the page says which — the same fault half a message had, and it takes the same answer. A note's code block is not in it: opening its source is what a code block is, so being told would be noise.
  check('a block of a tree document that cannot be typed on says why when it is pressed', () => {
    const { wireSourceEditable } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const said = [];
    const wasToast = booted.leafToast;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const source = '<div><p>A <hi>word</hi> here.</p></div>';
    const pressOn = (element) => {
      wireSourceEditable(element);
      const press = (element.listeners.get('pointerdown') || [])[0];
      if (!press) throw new Error('a block answers a press with nothing');
      press({ target: null, button: 0, preventDefault() {} });
    };
    try {
      booted.leafToast = (message) => said.push(message);
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      const paragraph = fakeElement('div');
      paragraph.dataset = { srcStart: '5', srcEnd: '33', blockKind: 'paragraph' };
      pressOn(paragraph);
      if (said.length !== 1) throw new Error(`a block that opened markup said ${JSON.stringify(said)}`);
      if (paragraph.dataset.editingSource !== 'true') throw new Error('saying why took the editor away');

      // A note's own source blocks stay quiet.
      read(`currentDocumentFormat = 'markdown'; currentDocumentSource = ${JSON.stringify('```\ncode\n```\n')};`);
      const fence = fakeElement('div');
      fence.dataset = { srcStart: '0', srcEnd: '12', blockKind: 'code_block' };
      pressOn(fence);
      if (said.length !== 1) throw new Error(`a note's code block was told why: ${JSON.stringify(said)}`);
    } finally {
      booted.leafToast = wasToast;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // The whole point of opening a line rather than splicing one: changing your mind costs nothing. Nothing typed, nothing in the file, and the line goes away.
  check('a line opened on an XML page and left alone writes nothing', () => {
    const opened = xmlBlankLine('<div><p>A line.</p></div>', 'tei', 'element:p', 21);
    try {
      opened.away();
      if (opened.sent.length) throw new Error(`an untouched line wrote ${JSON.stringify(opened.sent)}`);
      if (opened.line.isConnected !== false) throw new Error('the empty line stayed on the page');
    } finally {
      opened.restore();
    }
  });

  /** A note with a blank line open on it: the page set to that document, the line the plus opened, and every command it sends. `host` is what the gutter placed and `line` is what you type in — a list asks for a wrapper around its item, so the two are not always the same element, and `__becomeBlock` swaps both for another kind. */
  function noteBlankLine(source, specId, insertAt, { previous = null, keepEmpty = false } = {}) {
    const read = (expression) => vm.runInContext(expression, booted);
    const was = {
      format: read('currentDocumentFormat'),
      source: read('currentDocumentSource'),
      send: booted.ipc.postMessage,
    };
    const sent = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    read(
      `currentDocumentFormat = 'markdown'; currentDocumentSource = ${JSON.stringify(source)}; pendingCaret = null;`,
    );
    let host = null;
    const place = (node) => {
      host = node;
    };
    booted.openInsertBlock(insertAt, {
      spec: booted.blankBlockSpec(specId) || booted.PLAIN_LINE_SPEC,
      place,
      previous,
      keepEmpty,
    });
    const lineIn = () => (host.children.length ? host.children[0] : host);
    const raise = (type, event) => {
      for (const handler of lineIn().listeners.get(type) || []) handler(event || {});
    };
    return {
      get host() {
        return host;
      },
      get line() {
        return lineIn();
      },
      sent,
      wrote: () => sent.filter((one) => one.command === 'editBlock'),
      type: (words) => {
        const line = lineIn();
        line.textContent = words;
        // A note's commit reads the words back off the child nodes rather than the text, so a stand-in holding only the text is a line nothing was typed on.
        line.childNodes = words ? [{ nodeType: 3, nodeValue: words }] : [];
        raise('input', {});
      },
      enter: () => raise('keydown', { key: 'Enter', preventDefault() {} }),
      backspace: () => raise('keydown', { key: 'Backspace', preventDefault() {} }),
      away: () => raise('blur', { relatedTarget: null }),
      caret: () => read('pendingCaret'),
      restore: () => {
        booted.ipc.postMessage = was.send;
        read(
          `currentDocumentFormat = ${JSON.stringify(was.format)}; ` +
            `currentDocumentSource = ${JSON.stringify(was.source)}; pendingCaret = null;`,
        );
      },
    };
  }

  // Everything the plus writes into a note goes through this one commit, and it splices straight into somebody's file: a wrong separator writes a heading into the middle of the paragraph above.
  check('each kind of line a note offers commits its own marker at the offset it was opened at', () => {
    const note = '# Title\n\nA paragraph.\n';
    const at = note.length;
    const kinds = { text: '\n\nTyped', heading: '\n\n## Typed', list: '\n\n- Typed', quote: '\n\n> Typed' };
    for (const [kind, expected] of Object.entries(kinds)) {
      const opened = noteBlankLine(note, kind, at);
      try {
        // A list item has to stand in a list to look like one, so what the gutter placed is the list and the line to type in is inside it.
        if (kind === 'list' && opened.host === opened.line) {
          throw new Error('a list line was opened with no list around it');
        }
        if (kind !== 'list' && opened.host !== opened.line) {
          throw new Error(`a ${kind} line was wrapped in something`);
        }
        if (opened.sent.length) throw new Error(`opening a ${kind} line wrote to the document`);

        opened.type('Typed');
        opened.enter();
        const edits = opened.wrote();
        if (edits.length !== 1 || edits[0].text !== expected) {
          throw new Error(`${kind} committed ${JSON.stringify(edits)}`);
        }
        if (edits[0].start !== at || edits[0].end !== at) {
          throw new Error(`${kind} landed at ${edits[0].start}..${edits[0].end}`);
        }
      } finally {
        opened.restore();
      }
    }
  });

  // The two keys that chain one line to the next, both of them arithmetic over the separator's own length: Enter opens the next line past what this one just wrote, and Backspace on a line with nothing on it dissolves it back into the block above.
  check('Enter opens the next line past the one it wrote, and Backspace on an empty one steps back up', () => {
    const note = '# Title\n\nA paragraph.\n';
    const at = note.length;
    const opened = noteBlankLine(note, 'heading', at);
    try {
      opened.type('New part');
      opened.enter();
      const caret = opened.caret();
      if (!caret || !caret.insertBelow) throw new Error(`Enter chained ${JSON.stringify(caret)}`);
      if (caret.srcStart !== at + 2) throw new Error(`the next line was aimed at ${caret.srcStart}`);
      // A note carries on in a plain line whatever kind this one was: you have finished the heading and are writing under it.
      if (caret.blockSpec) throw new Error(`Enter under a heading opened another ${caret.blockSpec}`);
    } finally {
      opened.restore();
    }

    const above = fakeElement('p');
    above.textContent = 'A paragraph.';
    let took = 0;
    above.focus = () => {
      took += 1;
    };
    const empty = noteBlankLine(note, 'text', at, { previous: above });
    try {
      const host = empty.host;
      empty.backspace();
      if (empty.sent.length) throw new Error(`Backspace on an empty line wrote ${JSON.stringify(empty.sent)}`);
      if (host.isConnected !== false) throw new Error('the empty line stayed on the page');
      if (took !== 1) throw new Error('the block above was not given the caret back');
    } finally {
      empty.restore();
    }
  });

  // Clicking away is the third way the line commits, and the one a reader makes without meaning to. Words typed have to survive it; a line nobody typed on has to leave nothing behind, since the whole point of opening a line rather than splicing one is that changing your mind costs nothing.
  check('clicking away from a new line keeps what was typed and drops the line when nothing was', () => {
    const note = '# Title\n\nA paragraph.\n';
    const at = note.length;
    const typed = noteBlankLine(note, 'quote', at);
    try {
      typed.type('Someone else said this');
      typed.away();
      const edits = typed.wrote();
      if (edits.length !== 1 || edits[0].text !== '\n\n> Someone else said this') {
        throw new Error(`clicking away committed ${JSON.stringify(edits)}`);
      }
      // Not Enter: clicking away is the end of the writing, so nothing opens under it.
      if (typed.caret()) throw new Error(`clicking away chained ${JSON.stringify(typed.caret())}`);
    } finally {
      typed.restore();
    }

    const untouched = noteBlankLine(note, 'text', at);
    try {
      const host = untouched.host;
      untouched.away();
      if (untouched.sent.length) throw new Error(`an untouched line wrote ${JSON.stringify(untouched.sent)}`);
      if (host.isConnected !== false) throw new Error('the empty line stayed on the page');
    } finally {
      untouched.restore();
    }

    // The one exception: an empty document has no other block to click into, so taking its line away would leave nowhere to type.
    const only = noteBlankLine('', 'text', 0, { keepEmpty: true });
    try {
      const host = only.host;
      only.away();
      if (only.sent.length) throw new Error(`the only line on an empty page wrote ${JSON.stringify(only.sent)}`);
      if (host.isConnected === false) throw new Error('the only line on an empty page was taken away');
    } finally {
      only.restore();
    }
  });

  // The format bar over a line that is not in the buffer yet. A splice from out there would land the marker beside the words and the blur behind it would then write them again, so the line's own commit carries the marker — and this is what holds that to one edit.
  check('the format bar on a new line writes the words once, under the marker it picked', () => {
    const note = '# Title\n\nA paragraph.\n';
    const at = note.length;
    const read = (expression) => vm.runInContext(expression, booted);
    const opened = noteBlankLine(note, 'text', at);
    try {
      opened.type('Made a heading');
      booted.blankLineUnderTest = opened.line;
      read('selectionToolbarBlock = blankLineUnderTest;');
      // The bigger H on a plain line steps in at the ordinary section heading, since there is no level above it to step out of.
      booted.applyBlockFormat(read('BLOCK_FORMATS').find((one) => one.id === 'bigger'));
      const edits = opened.wrote();
      if (edits.length !== 1 || edits[0].text !== '\n\n## Made a heading') {
        throw new Error(`the format bar committed ${JSON.stringify(edits)}`);
      }
      if (edits[0].start !== at || edits[0].end !== at) {
        throw new Error(`the format bar landed at ${edits[0].start}..${edits[0].end}`);
      }

      // The words are written now, so the blur that follows the press must not write them a second time.
      opened.away();
      if (opened.wrote().length !== 1) {
        throw new Error(`the words reached the file ${opened.wrote().length} times`);
      }
    } finally {
      read('selectionToolbarBlock = null;');
      delete booted.blankLineUnderTest;
      opened.restore();
    }
  });

  // The other two ways the gutter commits this line, both of them one splice because none of it is in the buffer: the plus pressed on the line itself has to carry the half-written sentence along with the block that was picked, and the plus on the gap below saves the line the way Enter does.
  check('the plus on a half-written line writes both in one edit, and the plus below it saves the line', () => {
    const note = '# Title\n\nA paragraph.\n';
    const at = note.length;
    const carried = noteBlankLine(note, 'text', at);
    try {
      const divider = booted.blockInsertOptions(null).find((one) => one.id === 'divider');
      carried.type('Half a sentence');
      booted.runBlockInsert(carried.line, divider);
      const edits = carried.wrote();
      if (edits.length !== 1 || edits[0].text !== '\n\nHalf a sentence\n\n---') {
        throw new Error(`the plus on a half-written line wrote ${JSON.stringify(edits)}`);
      }
      if (edits[0].start !== at || edits[0].end !== at) {
        throw new Error(`it landed at ${edits[0].start}..${edits[0].end}`);
      }
    } finally {
      carried.restore();
    }

    const below = noteBlankLine(note, 'text', at);
    try {
      const text = booted.blockInsertOptions(null).find((one) => one.id === 'text');
      below.type('A line');
      booted.runGapInsert({ after: below.line, before: null }, text);
      const edits = below.wrote();
      if (edits.length !== 1 || edits[0].text !== '\n\nA line') {
        throw new Error(`the plus in the gap below wrote ${JSON.stringify(edits)}`);
      }
      const caret = below.caret();
      if (!caret || !caret.insertBelow || caret.srcStart !== at + 2) {
        throw new Error(`the gap below chained ${JSON.stringify(caret)}`);
      }
    } finally {
      below.restore();
    }
  });

  /** A note on the page with a block of it standing in, holding the source range the gutter reads. Every block stands in one holder, so a line opened beside one really lands there and the check reads the page order back rather than a word a stub kept. Everything sent while `run` works is handed back. */
  function noteGutter(source, run) {
    const read = (expression) => vm.runInContext(expression, booted);
    const was = {
      format: read('currentDocumentFormat'),
      source: read('currentDocumentSource'),
      send: booted.ipc.postMessage,
    };
    const sent = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    read(
      `currentDocumentFormat = 'markdown'; currentDocumentSource = ${JSON.stringify(source)}; pendingCaret = null;`,
    );
    const holder = fakeElement('documentBody');
    const block = (start, end) => {
      const el = fakeElement('p');
      el.dataset = { blockKind: 'paragraph', srcStart: String(start), srcEnd: String(end) };
      holder.appendChild(el);
      return el;
    };
    // What is standing on either side of a block, so a check asks where the new line landed rather than which word was said.
    const above = (el) => holder.children[holder.children.indexOf(el) - 1] || null;
    const below = (el) => holder.children[holder.children.indexOf(el) + 1] || null;
    try {
      run({ block, holder, above, below, sent, option: (id) => booted.blockInsertOptions(null).find((one) => one.id === id), caret: () => read('pendingCaret') });
    } finally {
      booted.ipc.postMessage = was.send;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; ` +
          `currentDocumentSource = ${JSON.stringify(was.source)}; pendingCaret = null;`,
      );
    }
  }

  // The two ways into everything above: the space between two blocks, and the plus pressed on a line that is already empty. Each opens a line of the kind the option names and writes nothing, so the reader can still change their mind — and where the line goes decides which side of it the blank line is written on.
  check('the plus in the gap and the plus on an empty line each open the kind it names, and write nothing', () => {
    const note = '# Title\n\nA paragraph.\n';
    noteGutter(note, ({ block, above: standingAbove, below: standingBelow, sent, option }) => {
      // Under a block: the line opens after it, at the end of its source — read off the holder the two share, so a line that asked correctly and landed elsewhere is caught.
      const pressed = block(9, 21);
      booted.runGapInsert({ after: pressed, before: null }, option('heading'));
      const opened = standingBelow(pressed);
      if (!opened) throw new Error('the gap under a block left nothing standing after it');
      if (booted.rangeOf(opened, 'block').start !== 21) {
        throw new Error(`the line opened at ${booted.rangeOf(opened, 'block').start}`);
      }
      if (opened.dataset.placeholder !== 'Name this part...') {
        throw new Error(`the gap opened a ${JSON.stringify(opened.dataset.placeholder)}`);
      }
      if (sent.length) throw new Error(`opening a line in the gap wrote ${JSON.stringify(sent)}`);

      // Above the first block there is nothing to hang a blank line off, so the break goes after the new line instead of before it.
      const first = block(0, 7);
      booted.runGapInsert({ after: null, before: first }, option('quote'));
      const line = standingAbove(first);
      if (!line) throw new Error('the gap over the first block left nothing standing before it');
      line.textContent = 'Someone else said this';
      line.childNodes = [{ nodeType: 3, nodeValue: 'Someone else said this' }];
      for (const handler of line.listeners.get('keydown') || []) handler({ key: 'Enter', preventDefault() {} });
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 1 || edits[0].text !== '> Someone else said this\n\n') {
        throw new Error(`the line over the first block committed ${JSON.stringify(edits)}`);
      }
      if (edits[0].start !== 0 || edits[0].end !== 0) {
        throw new Error(`it landed at ${edits[0].start}..${edits[0].end}`);
      }
    });

    // The plus on a line that is already in the file and has nothing on it: the same opener, aimed at that line's own offset.
    noteGutter('# Title\n\n\n\nA paragraph.\n', ({ block, above, sent, option }) => {
      const empty = block(9, 9);
      booted.runBlockInsert(empty, option('list'));
      const opened = above(empty);
      if (!opened) throw new Error('the plus on an empty line left nothing standing before it');
      if (opened.children[0].dataset.placeholder !== 'First of a list...') {
        throw new Error(`the plus on an empty line opened ${JSON.stringify(opened.children[0].dataset.placeholder)}`);
      }
      if (sent.length) throw new Error(`the plus on an empty line wrote ${JSON.stringify(sent)}`);
    });
  });

  // The other five of the plus's nine options have no line to type on: each splices its own source straight into a file nobody has saved, at an offset worked out from the block beside it. A wrong offset writes a table into the middle of the paragraph above it.
  check('each thing the plus writes at once lands in the gap under a block', () => {
    const note = '# Title\n\nA paragraph.\n';
    const end = note.indexOf('A paragraph.') + 'A paragraph.'.length;
    const wants = {
      code: { text: '\n\n```\n\n```', caret: null },
      // The one of the five that asks for a caret, and it lands one separator past the offset — inside what it wrote, not on the blank line in front of it.
      table: { text: '\n\n|  |  |\n| --- | --- |\n|  |  |', caret: end + 2 },
      divider: { text: '\n\n---', caret: null },
    };
    for (const [id, want] of Object.entries(wants)) {
      noteGutter(note, ({ block, holder, sent, option, caret }) => {
        const above = block(9, end);
        booted.runGapInsert({ after: above, before: null }, option(id));
        const edits = sent.filter((one) => one.command === 'editBlock');
        if (edits.length !== 1 || edits[0].text !== want.text) {
          throw new Error(`the ${id} wrote ${JSON.stringify(edits)}`);
        }
        // The end of the block above and a blank line down: a byte short of it eats the last letter of the sentence.
        if (edits[0].start !== end || edits[0].end !== end) {
          throw new Error(`the ${id} landed at ${edits[0].start}..${edits[0].end}`);
        }
        // The source is the whole of what these options are, so nothing is opened to type in beside it.
        if (holder.children.length !== 1) throw new Error(`the ${id} opened a line as well as writing one`);
        const asked = caret();
        if (want.caret === null ? !!asked : !asked || asked.srcStart !== want.caret) {
          throw new Error(`the ${id} asked for a caret at ${JSON.stringify(asked)}`);
        }
      });
    }
  });

  // The offset for that gap is not the block's own end. A block being typed in is saved first and the new one goes past what was written — splice at the stale end and it lands inside the sentence, or the sentence is thrown away.
  check('the gap under a block being typed in saves it before it writes past it', () => {
    const note = '# Title\n\nA paragraph.\n';
    const start = note.indexOf('A paragraph.');
    const stale = start + 'A paragraph.'.length;
    const typed = 'A much longer paragraph than it was.';
    noteGutter(note, ({ block, sent, option }) => {
      const after = block(start, stale);
      after.textContent = typed;
      after.childNodes = [{ nodeType: 3, nodeValue: typed }];
      after.__editingActive = true;
      after.__editBaseline = 'A paragraph.';
      booted.runGapInsert({ after, before: null }, option('divider'));
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 2) throw new Error(`the gap under a block being typed in sent ${JSON.stringify(edits)}`);
      if (edits[0].start !== start || edits[0].end !== stale || edits[0].text !== typed) {
        throw new Error(`it saved the block as ${JSON.stringify(edits[0])}`);
      }
      const past = start + typed.length;
      if (edits[1].start !== past || edits[1].end !== past) {
        throw new Error(`the rule landed at ${edits[1].start}, not past what was just written`);
      }
      if (edits[1].text !== '\n\n---') throw new Error(`the rule wrote ${JSON.stringify(edits[1].text)}`);
    });
  });

  // Above the first block there is nothing to hang a blank line off, so the separator changes ends: the source first and the break after it. The only splice in the gutter written back to front.
  check('the gap above the first block puts the break after what it wrote', () => {
    const note = '# Title\n\nA paragraph.\n';
    noteGutter(note, ({ block, sent, option, caret }) => {
      booted.runGapInsert({ after: null, before: block(0, 7) }, option('code'));
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 1 || edits[0].text !== '```\n\n```\n\n') {
        throw new Error(`the gap above the first block wrote ${JSON.stringify(edits)}`);
      }
      if (edits[0].start !== 0 || edits[0].end !== 0) {
        throw new Error(`it landed at ${edits[0].start}..${edits[0].end}`);
      }
      if (caret()) throw new Error(`a code block up there asked for a caret at ${JSON.stringify(caret())}`);
    });

    // And the caret goes to the block's own start up here rather than a separator past it, since the break is on the far side.
    noteGutter(note, ({ block, option, caret }) => {
      booted.runGapInsert({ after: null, before: block(0, 7) }, option('table'));
      const asked = caret();
      if (!asked || asked.srcStart !== 0) {
        throw new Error(`the table above the first block asked for a caret at ${JSON.stringify(asked)}`);
      }
    });
  });

  // The one splice in the gutter that overwrites rather than adds: the plus pressed on a line already in the file writes over that line's own range. Which is why the refusal is asked again here rather than trusted from the draw — a drifted button is a paragraph deleted.
  check("the plus on an empty line writes over that line's own range", () => {
    const note = '# Title\n\n>\n\nA paragraph.\n';
    const at = note.indexOf('>');
    noteGutter(note, ({ block, sent, option, caret }) => {
      // The ordinary block, holding nothing and saying so: the refusal is read off what the line is really carrying rather than off a query written here.
      const empty = block(at, at + 1);
      empty.dataset.blockKind = 'block_quote';
      booted.runBlockInsert(empty, option('table'));
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 1 || edits[0].text !== '|  |  |\n| --- | --- |\n|  |  |') {
        throw new Error(`the plus on an empty line wrote ${JSON.stringify(edits)}`);
      }
      // Over the line, not beside it: a splice at one point would leave the empty quote standing above the table.
      if (edits[0].start !== at || edits[0].end !== at + 1) {
        throw new Error(`it landed at ${edits[0].start}..${edits[0].end}`);
      }
      const asked = caret();
      if (!asked || asked.srcStart !== at) {
        throw new Error(`the table on an empty line asked for a caret at ${JSON.stringify(asked)}`);
      }
    });

    // What stands between that splice and somebody's sentence.
    noteGutter(note, ({ block, sent, option }) => {
      const start = note.indexOf('A paragraph.');
      const says = block(start, start + 'A paragraph.'.length);
      says.textContent = 'A paragraph.';
      booted.runBlockInsert(says, option('divider'));
      if (sent.some((one) => one.command === 'editBlock')) {
        throw new Error(`the plus wrote over a line that says something: ${JSON.stringify(sent)}`);
      }
    });

    // The other half of the same refusal, and the one this whole file was raised over: a line with no word on it that is carrying a picture. Nothing said it out loud until the block could be asked what it holds.
    noteGutter(note, ({ block, sent, option }) => {
      const start = note.indexOf('A paragraph.');
      const holding = block(start, start + 'A paragraph.'.length);
      holding.appendChild(booted.document.createElement('img'));
      booted.runBlockInsert(holding, option('divider'));
      if (sent.some((one) => one.command === 'editBlock')) {
        throw new Error(`the plus wrote over a line carrying a picture: ${JSON.stringify(sent)}`);
      }
    });
  });

  // The file dialog is built with no parent window, so the app stays clickable under it: the box the picture was headed for can be folded by hand, or swept away by a render, while somebody is still choosing a file. Dropping that answer is right — the line it was aimed at may be gone — and the word is what was missing, without which a reader picks a file and watches the page do nothing.
  check('a picture answered after its box closed says so, and one a newer box replaced stays silent', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const wasToast = booted.leafToast;
    const wrote = [];
    const said = [];
    const write = (option) => wrote.push(option);
    // A fresh row to draw the box into each time, the way every render leaves one, and the token the picker will answer with.
    const openBox = () => {
      booted.__blockRowUnderTest = fakeElement('blockInsertRowUnderTest');
      read('blockGutterRow = __blockRowUnderTest;');
      booted.openBlockImageBox(write);
      return read('blockImageToken');
    };
    try {
      booted.leafToast = (message) => said.push(message);

      // A box still standing when its answer lands: the picture is written, and nothing is said about it.
      booted.leafImagePicked(openBox(), 'shots/leaf.png', 'A leaf');
      if (wrote.length !== 1 || wrote[0].text !== '![A leaf](shots/leaf.png)') {
        throw new Error(`the answer to a standing box wrote ${JSON.stringify(wrote)}`);
      }
      if (said.length) throw new Error(`a picture that landed said ${JSON.stringify(said)}`);

      // Folded by hand under the dialog — the plus, or Escape.
      const folded = openBox();
      booted.collapseBlockInsertRow();
      booted.leafImagePicked(folded, 'shots/leaf.png', 'A leaf');
      if (wrote.length !== 1) throw new Error(`the answer to a folded box wrote ${JSON.stringify(wrote)}`);
      if (said.length !== 1 || !said[0].includes('went nowhere')) {
        throw new Error(`a folded box said ${JSON.stringify(said)}`);
      }

      // Swept away by a render landing in the moment Choose was pressed: the same drop, so the same word.
      said.length = 0;
      const redrawn = openBox();
      booted.bindBlockControls();
      booted.leafImagePicked(redrawn, 'shots/leaf.png', 'A leaf');
      if (wrote.length !== 1) throw new Error(`the answer to a redrawn box wrote ${JSON.stringify(wrote)}`);
      if (said.length !== 1 || !said[0].includes('went nowhere')) {
        throw new Error(`a redrawn box said ${JSON.stringify(said)}`);
      }

      // A newer box has since been opened, so the old answer belongs to somebody who has already moved on: dropped, and no word chases them.
      said.length = 0;
      const old = openBox();
      openBox();
      booted.leafImagePicked(old, 'shots/leaf.png', 'A leaf');
      if (wrote.length !== 1) throw new Error(`a stale answer wrote ${JSON.stringify(wrote)}`);
      if (said.length) throw new Error(`a stale answer said ${JSON.stringify(said)}`);
    } finally {
      booted.collapseBlockInsertRow();
      delete booted.__blockRowUnderTest;
      read('blockGutterRow = null;');
      booted.leafToast = wasToast;
    }
  });

  // The box's other door, and the one that can lose something: an address is typed by hand, so it is the only copy of itself while it sits in that field. The write asks the host to answer and the box holds what was typed until it does — a refusal puts the box back with the address still in it, rather than leaving a reason on screen with nothing left to press.
  check('a typed address waits for the host and comes back into the box when nothing was written', () => {
    const note = '# Title\n\nA paragraph.\n';
    const end = note.indexOf('A paragraph.') + 'A paragraph.'.length;
    const read = (expression) => vm.runInContext(expression, booted);
    const wasToast = booted.leafToast;
    const said = [];
    const REFUSED = 'watch.md was not changed: the file could not be read.';
    // The address field, if a box is standing at all. Read off the row itself rather than kept, because the box that comes back is a second one drawn by the same code.
    const field = () =>
      read('blockGutterRow').children.find((child) => String(child.className || '').includes('block-insert-url'));
    const tokenOf = (sent) => {
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 1 || typeof edits[0].token !== 'number') {
        throw new Error(`a typed address sent ${JSON.stringify(edits)}`);
      }
      return edits[0].token;
    };
    try {
      booted.leafToast = (message) => said.push(message);

      // Refused with the line it was going onto still on the page: the box comes back holding the address, and the host's own sentence is beside it.
      said.length = 0;
      noteGutter(note, ({ block, sent }) => {
        const row = openedInsertRow(block(9, end));
        try {
          row.press('image');
          row.address('https://example.com/leaf.png');
          const token = tokenOf(sent);
          // Nothing is written yet and the box has folded, which is the whole of the fault: what is typed only survives because it is held.
          if (field()) throw new Error('the box was still standing while the host was being asked');
          booted.leafEditAnswered(token, false, REFUSED);
          const back = field();
          if (!back) throw new Error('a refused address drew no box to come back into');
          if (back.value !== 'https://example.com/leaf.png') {
            throw new Error(`the box came back holding ${JSON.stringify(back.value)}`);
          }
          if (said.length !== 1 || !said[0].includes('could not be read')) {
            throw new Error(`a refused address said ${JSON.stringify(said)}`);
          }
        } finally {
          row.done();
        }
      });

      // Refused with the line gone, because a render landed while the host was being asked: there is nowhere to put a box, so the sentence carries the address itself.
      said.length = 0;
      noteGutter(note, ({ block, sent }) => {
        const after = block(9, end);
        const row = openedInsertRow(after);
        try {
          row.press('image');
          row.address('https://example.com/gone.png');
          const token = tokenOf(sent);
          after.isConnected = false;
          booted.leafEditAnswered(token, false, REFUSED);
          if (field()) throw new Error('a box was raised on a line that has gone');
          if (said.length !== 1 || !said[0].includes('https://example.com/gone.png')) {
            throw new Error(`an address with nowhere to go said ${JSON.stringify(said)}`);
          }
        } finally {
          row.done();
        }
      });

      // Landed: the host rendered before it answered, so the box is already folded, the picture is already on the page, and there is nothing to say.
      said.length = 0;
      noteGutter(note, ({ block, sent }) => {
        const row = openedInsertRow(block(9, end));
        try {
          row.press('image');
          row.address('https://example.com/leaf.png');
          booted.leafEditAnswered(tokenOf(sent), true, '');
          if (field()) throw new Error('a picture that landed put its box back');
          if (said.length) throw new Error(`a picture that landed said ${JSON.stringify(said)}`);
        } finally {
          row.done();
        }
      });
    } finally {
      booted.leafToast = wasToast;
    }
  });

  /** The reading layout a rendered document leaves on the app surface, stood up for real. `bindBlockControls` hangs the gutter off `.reader-layout` and refuses without a `.document-body`, and `openBlockGapLine` lays its clickable line into the same layout — so a check pressing either needs both really standing rather than answered by a query. Handed back so a check can read what was appended into it. */
  function standUpReadingLayout() {
    const app = vm.runInContext('app', booted);
    const found = app.querySelector('.reader-layout');
    if (found) return found;
    const layout = booted.document.createElement('div');
    layout.className = 'reader-layout';
    const body = booted.document.createElement('div');
    body.className = 'document-body';
    layout.appendChild(body);
    app.appendChild(layout);
    return layout;
  }

  /** The insert row as the plus really opens it, over the gap under `after` on a note. Every button comes back carrying the closure the app wired it with rather than one written here, which is what makes the two options that ask before they write readable at all: neither one calls that closure, they hand it away. */
  function openedInsertRow(after) {
    const read = (expression) => vm.runInContext(expression, booted);
    const wasUnlocked = read('readingUnlocked');
    read('readingUnlocked = true;');
    standUpReadingLayout();
    booted.bindBlockControls();
    read('blockGutterTarget = null; blockGutterGap = { after: null, before: null };');
    read('blockGutterGap').after = after;
    booted.expandBlockInsertRow();
    const ids = booted.blockInsertOptions(null).map((one) => one.id);
    const inRow = (className) =>
      read('blockGutterRow').children.find((child) => String(child.className || '').includes(className));
    return {
      press: (id) => {
        const button = read('blockGutterRow').children[ids.indexOf(id)];
        if (!button) throw new Error(`the insert row has no ${id}`);
        for (const handler of button.listeners.get('click') || []) handler({});
      },
      // The other way into the picture: an address typed where the box asks for one.
      address: (typed) => {
        const field = inRow('block-insert-url');
        if (!field) throw new Error('the picture box drew no address field');
        field.value = typed;
        for (const handler of field.listeners.get('keydown') || []) handler({ key: 'Enter', preventDefault() {} });
      },
      done: () => {
        booted.collapseBlockInsertRow();
        read(`readingUnlocked = ${JSON.stringify(wasUnlocked)}; blockGutterTarget = null; blockGutterGap = null;`);
        booted.bindBlockControls();
      },
    };
  }

  // The picture is the first of the two options with nothing to write when it is chosen: it hands the insert row's own write closure to a box and is written whenever the answer comes back. Both ways of answering land as the same splice the five immediate ones make.
  check('the picture the box was answered with is written as one image', () => {
    const note = '# Title\n\nA paragraph.\n';
    const end = note.indexOf('A paragraph.') + 'A paragraph.'.length;
    const read = (expression) => vm.runInContext(expression, booted);
    noteGutter(note, ({ block, sent, caret }) => {
      const row = openedInsertRow(block(9, end));
      try {
        row.press('image');
        // Choosing it writes nothing: the box is the whole of what the press does.
        if (sent.some((one) => one.command === 'editBlock')) {
          throw new Error(`choosing a picture wrote ${JSON.stringify(sent)}`);
        }
        booted.leafImagePicked(read('blockImageToken'), 'shots/leaf.png', 'A leaf');
        const edits = sent.filter((one) => one.command === 'editBlock');
        if (edits.length !== 1 || edits[0].text !== '\n\n![A leaf](shots/leaf.png)') {
          throw new Error(`the answered box wrote ${JSON.stringify(edits)}`);
        }
        if (edits[0].start !== end || edits[0].end !== end) {
          throw new Error(`it landed at ${edits[0].start}..${edits[0].end}`);
        }
        // A picture edits as raw source and has no caret to take until it is clicked.
        if (caret()) throw new Error(`a picture asked for a caret at ${JSON.stringify(caret())}`);
      } finally {
        row.done();
      }
    });

    // An address typed into the box rather than a file chosen through the dialog: the same splice, with no alt text to put in the brackets.
    noteGutter(note, ({ block, sent }) => {
      const row = openedInsertRow(block(9, end));
      try {
        row.press('image');
        row.address('https://example.com/leaf.png');
        const edits = sent.filter((one) => one.command === 'editBlock');
        if (edits.length !== 1 || edits[0].text !== '\n\n![](https://example.com/leaf.png)') {
          throw new Error(`a typed address wrote ${JSON.stringify(edits)}`);
        }
      } finally {
        row.done();
      }
    });
  });

  // The answer can come back long after the row it was headed for has gone — the dialog has no parent window, so the app stays clickable under it. Both guards are read here for what they keep out of the file rather than for what they hand back: an answer that lands anyway is a picture spliced at offsets belonging to a document nobody is looking at.
  check('an answer from a box that has closed is dropped', () => {
    const note = '# Title\n\nA paragraph.\n';
    const end = note.indexOf('A paragraph.') + 'A paragraph.'.length;
    const read = (expression) => vm.runInContext(expression, booted);
    const wasToast = booted.leafToast;
    const said = [];
    try {
      booted.leafToast = (message) => said.push(message);

      // Folded by hand under the dialog, or swept away by the render that rebuilds the gutter: the writer itself is let go.
      for (const [how, close] of [
        ['folded by hand', () => booted.collapseBlockInsertRow()],
        ['swept away by a render', () => booted.bindBlockControls()],
      ]) {
        said.length = 0;
        noteGutter(note, ({ block, sent }) => {
          const row = openedInsertRow(block(9, end));
          try {
            row.press('image');
            close();
            booted.leafImagePicked(read('blockImageToken'), 'shots/leaf.png', 'A leaf');
            if (sent.some((one) => one.command === 'editBlock')) {
              throw new Error(`a box ${how} still wrote ${JSON.stringify(sent)}`);
            }
            if (said.length !== 1 || !said[0].includes('went nowhere')) {
              throw new Error(`a box ${how} said ${JSON.stringify(said)}`);
            }
          } finally {
            row.done();
          }
        });
      }

      // A newer box has since been opened, so the older answer belongs to somebody who has already moved on: dropped, and no word chases them. The second box is opened the way a reader opens one, because the first clears the row as it draws and takes that option off the screen.
      said.length = 0;
      noteGutter(note, ({ block, sent }) => {
        const after = block(9, end);
        const row = openedInsertRow(after);
        let again = row;
        try {
          row.press('image');
          const old = read('blockImageToken');
          row.done();
          again = openedInsertRow(after);
          again.press('image');
          booted.leafImagePicked(old, 'shots/leaf.png', 'A leaf');
          if (sent.some((one) => one.command === 'editBlock')) {
            throw new Error(`a stale token still wrote ${JSON.stringify(sent)}`);
          }
          if (said.length) throw new Error(`a stale token said ${JSON.stringify(said)}`);
        } finally {
          again.done();
        }
      });
    } finally {
      booted.leafToast = wasToast;
    }
  });

  // The other option that asks first, and the one held open longest: the sheet stays up across every render for as long as somebody takes to draw, and Save writes one fenced block through the same splice. Driven through the save the sheet was opened with rather than the sheet's own button, which flushes and re-fits a canvas the stand-in page has no size for.
  check("the diagram sheet's Save writes one fenced mermaid block", () => {
    const note = '# Title\n\nA paragraph.\n';
    const end = note.indexOf('A paragraph.') + 'A paragraph.'.length;
    const wasSheet = booted.openFlowSheet;
    noteGutter(note, ({ block, sent, caret }) => {
      const after = block(9, end);
      const row = openedInsertRow(after);
      let save = null;
      booted.openFlowSheet = (opened) => {
        save = opened.save;
      };
      try {
        row.press('flow');
        if (!save) throw new Error('choosing a flowchart opened no sheet');
        if (sent.some((one) => one.command === 'editBlock')) {
          throw new Error(`opening the sheet wrote ${JSON.stringify(sent)}`);
        }
        // A number, not true: the drawing is the only copy there is, so the sheet is told to wait on the host rather than to close on the dispatch.
        const answer = save('graph TD\n  a-->b');
        if (answer === false) throw new Error('the sheet was told its Save had nowhere to land');
        if (typeof answer !== 'number') throw new Error(`the sheet was told to close on the dispatch: ${JSON.stringify(answer)}`);
        const edits = sent.filter((one) => one.command === 'editBlock');
        if (edits.length !== 1 || edits[0].text !== '\n\n```mermaid\ngraph TD\n  a-->b\n```') {
          throw new Error(`Save wrote ${JSON.stringify(edits)}`);
        }
        if (edits[0].token !== answer) throw new Error(`it sent ${JSON.stringify(edits[0].token)} and answered ${JSON.stringify(answer)}`);
        if (edits[0].start !== end || edits[0].end !== end) {
          throw new Error(`it landed at ${edits[0].start}..${edits[0].end}`);
        }
        if (caret()) throw new Error(`a diagram asked for a caret at ${JSON.stringify(caret())}`);

        // What the plus was standing on is asked again at Save, since the sheet outlives every render: a block that has left the page takes the write with it and the sheet is told to stay open.
        after.isConnected = false;
        if (save('graph TD\n  a-->c') !== false) throw new Error('a Save with nowhere to land said it landed');
        if (sent.filter((one) => one.command === 'editBlock').length !== 1) {
          throw new Error('a Save with nowhere to land wrote anyway');
        }
      } finally {
        booted.openFlowSheet = wasSheet;
        row.done();
      }
    });
  });

  // The space above the first block is built and offered the plus, so nothing after it may call that space gone — it measures off the block below, not off something above it. Called gone, the plus is hidden the moment it is drawn and the field block it starts up there can never be started.
  check('the top space stands, and starts a field block', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const below = fakeElement('first');
    below.getBoundingClientRect = () => ({ top: 100, bottom: 140 });
    if (!booted.blockGapStanding({ above: null, below })) {
      throw new Error('the space above the first block is still called gone');
    }
    // The gutter takes its line from the middle of the space blockGapSpan already measures for it: one line up from the block below.
    const was = { format: read('currentDocumentFormat'), unlocked: read('readingUnlocked') };
    const inApp = read('app');
    const wasQuery = inApp.querySelector;
    try {
      read(`currentDocumentFormat = 'markdown'; readingUnlocked = true; blockGutterGap = null;`);
      inApp.querySelector = (selector) => (selector === '.frontmatter' ? null : wasQuery.call(inApp, selector));
      read('blockGutterGap = { above: null, below: null }');
      const gap = read('blockGutterGap');
      gap.below = below;
      const middle = booted.blockGutterAnchorY();
      if (middle !== 84) throw new Error(`the gutter sat at ${middle}, not on the middle of the space`);
      // The label and the press both key on this one answer: above everything, on a note with no field block, the plus starts one.
      if (!booted.frontmatterCanStart(gap)) {
        throw new Error('the plus above everything does not offer to start a field block');
      }
      // With a field block already at the top there is nothing to start, so the plus is the insert menu it reads as.
      inApp.querySelector = (selector) => (selector === '.frontmatter' ? {} : wasQuery.call(inApp, selector));
      if (booted.frontmatterCanStart(gap)) {
        throw new Error('a note that has a field block was offered a second one');
      }
    } finally {
      inApp.querySelector = wasQuery;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; ` +
          `readingUnlocked = ${JSON.stringify(was.unlocked)}; blockGutterGap = null;`,
      );
    }
  });

  // The top space gets a clickable line like any other, so it may not be refused for having no block to write after, and the line's own placing may not reach for a block above that is not there. It is measured from the span's own top, and its click opens a line above the first block through the same opener the plus uses, writing nothing until something is typed in it.
  check('clicking the space above the first block opens a line above it, and writes nothing until it is typed in', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    noteGutter('# Title\n\nA paragraph.\n', ({ block, above, sent }) => {
      const first = block(0, 7);
      first.getBoundingClientRect = () => ({ top: 100, bottom: 140, left: 0, right: 0, width: 600, height: 40 });
      standUpReadingLayout();
      booted.openBlockGapLine({ above: null, below: first, after: null, before: first });
      const line = read('blockGapLine');
      if (!line) throw new Error('the space above the first block got no clickable line');
      // One line tall against the top of the block below — the span blockGapSpan measures — not reaching for a block above that is not there.
      if (line.style.top !== '68px' || line.style.height !== '32px') {
        throw new Error(`the line was laid at ${line.style.top} for ${line.style.height}`);
      }
      for (const handler of line.listeners.get('mousedown') || []) handler({ preventDefault() {} });
      if (!above(first)) throw new Error('clicking the top space left nothing standing above the first block');
      if (sent.length) throw new Error(`clicking the top space wrote ${JSON.stringify(sent)}`);
      read('closeBlockGapLine()');
    });
  });

  // The other half of the standing test: a space is gone when the end it really has has left the page, so the plus is never left floating beside nothing after a render replaced the block it was measured off.
  check('a space whose real end has left the page is still called gone', () => {
    const off = fakeElement('replaced');
    off.isConnected = false;
    const on = fakeElement('standing');
    if (booted.blockGapStanding({ above: null, below: off })) {
      throw new Error('the top space stands on a block a render took away');
    }
    if (booted.blockGapStanding({ above: off, below: on })) {
      throw new Error('a space stands on an above a render took away');
    }
    if (booted.blockGapStanding({ above: on, below: off })) {
      throw new Error('a space stands on a below a render took away');
    }
    if (booted.blockGapStanding({ above: null, below: null })) {
      throw new Error('a space with no ends at all is standing');
    }
  });

  // A pause puts what is being typed into the file without redrawing the page, so both plus paths under a block have to save that block even where its words are back at the baseline — skip it and the file keeps a word the page shows as taken back, for the next render to draw in again.
  check('a word typed and taken back inside the pause is still written out by both plus paths', () => {
    const note = '# Title\n\nA paragraph.\n';
    const start = note.indexOf('A paragraph.');
    const end = start + 'A paragraph.'.length;
    const typedOn = (block) => {
      const el = block(start, end);
      el.textContent = 'A paragraph.';
      el.childNodes = [{ nodeType: 3, nodeValue: 'A paragraph.' }];
      el.__editingActive = true;
      el.__editBaseline = 'A paragraph.';
      // The pause has already put this block's typing into the buffer, and the words have since gone back to what they started as.
      el.__liveStarted = true;
      return el;
    };
    const saved = (edit, what) => {
      if (edit.start !== start || edit.end !== end || edit.text !== 'A paragraph.') {
        throw new Error(`${what} saved the block as ${JSON.stringify(edit)}`);
      }
    };

    noteGutter(note, ({ block, sent, option }) => {
      const after = typedOn(block);
      booted.runGapInsert({ after, before: null }, option('divider'));
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 2) throw new Error(`the gap under it sent ${JSON.stringify(edits)}`);
      saved(edits[0], 'the gap under it');
      if (edits[1].start !== end) throw new Error(`the new block landed at ${edits[1].start}, not after the saved line`);
    });

    noteGutter(note, ({ block, sent, option }) => {
      const after = typedOn(block);
      booted.runGapInsert({ after, before: null }, option('text'));
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 1) throw new Error(`the line opened under it sent ${JSON.stringify(edits)}`);
      saved(edits[0], 'the line opened under it');
    });
  });

  // Picking a kind on a line that is already open is the one option that commits nothing: the line is not in the buffer, so it swaps for an empty one of the kind that was picked and waits for its first word. Writing here would splice a marker with no words behind it.
  check('picking another kind on a line already open swaps it and sends no edit', () => {
    const note = '# Title\n\nA paragraph.\n';
    const opened = noteBlankLine(note, 'text', note.length);
    try {
      const was = opened.host;
      booted.runBlockInsert(opened.line, booted.blockInsertOptions(null).find((one) => one.id === 'quote'));
      if (opened.sent.length) throw new Error(`swapping the kind wrote ${JSON.stringify(opened.sent)}`);
      if (opened.host === was) throw new Error('the line was not swapped at all');
      if (was.isConnected !== false) throw new Error('the line it swapped out stayed on the page');
      if (opened.line.dataset.placeholder !== 'Someone else’s words...') {
        throw new Error(`it swapped to ${JSON.stringify(opened.line.dataset.placeholder)}`);
      }

      // And the swapped line commits as its own kind, at the offset the first one was opened at.
      opened.type('Said elsewhere');
      opened.enter();
      const edits = opened.wrote();
      if (edits.length !== 1 || edits[0].text !== '\n\n> Said elsewhere') {
        throw new Error(`the swapped line committed ${JSON.stringify(edits)}`);
      }
      if (edits[0].start !== note.length) throw new Error(`it landed at ${edits[0].start}`);
    } finally {
      opened.restore();
    }
  });

  // A document with nothing in it opens on a title and a line under it, and neither is in the source yet — so the pair has to commit as ONE splice at offset zero. Two blocks each holding "insert at 0" would overwrite each other, whichever committed second, and the reader would watch half of what they wrote disappear.
  check('an empty note writes its title and its first line as one edit at the top of the file', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const was = {
      format: read('currentDocumentFormat'),
      source: read('currentDocumentSource'),
      send: booted.ipc.postMessage,
    };
    let sent = [];
    // The page's body. The pair goes in front of whatever is already there, story first and the title in front of it.
    const openStart = () => {
      sent = [];
      const placed = [];
      booted.openMediumStart({
        firstChild: null,
        insertBefore: (node) => {
          placed.unshift(node);
          return node;
        },
      });
      return { title: placed[0], story: placed[1] };
    };
    const write = (block, words) => {
      block.textContent = words;
      block.childNodes = [{ nodeType: 3, nodeValue: words }];
      for (const handler of block.listeners.get('input') || []) handler({});
    };
    const raise = (block, type, event) => {
      for (const handler of block.listeners.get(type) || []) handler(event || {});
    };
    const wrote = () => sent.filter((one) => one.command === 'editBlock');
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      read("currentDocumentFormat = 'markdown'; currentDocumentSource = ''; pendingCaret = null;");

      const both = openStart();
      write(both.title, 'A name');
      write(both.story, 'The first words');
      // Enter in the title is not a commit: a title with no story under it is not a document yet, so it walks down to the line below.
      raise(both.title, 'keydown', { key: 'Enter', preventDefault() {} });
      if (wrote().length) throw new Error(`Enter in the title wrote ${JSON.stringify(wrote())}`);
      raise(both.story, 'keydown', { key: 'Enter', preventDefault() {} });
      const edits = wrote();
      if (edits.length !== 1 || edits[0].text !== '# A name\n\nThe first words') {
        throw new Error(`the pair committed ${JSON.stringify(edits)}`);
      }
      if (edits[0].start !== 0 || edits[0].end !== 0) {
        throw new Error(`the pair landed at ${edits[0].start}..${edits[0].end}`);
      }

      // A title on its own is still something to carry on under, so clicking away keeps it and writes nothing else.
      const named = openStart();
      write(named.title, 'A name');
      raise(named.title, 'focusout', { relatedTarget: null });
      if (wrote().length !== 1 || wrote()[0].text !== '# A name') {
        throw new Error(`a title on its own committed ${JSON.stringify(wrote())}`);
      }

      // And words with no title keep their own line, with no heading invented over them.
      const unnamed = openStart();
      write(unnamed.story, 'The first words');
      raise(unnamed.story, 'keydown', { key: 'Enter', preventDefault() {} });
      if (wrote().length !== 1 || wrote()[0].text !== 'The first words') {
        throw new Error(`a story on its own committed ${JSON.stringify(wrote())}`);
      }

      // Neither typed on is not a document: the pair stays standing and nothing is written.
      const untouched = openStart();
      raise(untouched.story, 'focusout', { relatedTarget: null });
      if (sent.length) throw new Error(`an untouched pair wrote ${JSON.stringify(sent)}`);
    } finally {
      booted.ipc.postMessage = was.send;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; ` +
          `currentDocumentSource = ${JSON.stringify(was.source)}; pendingCaret = null;`,
      );
    }
  });

  // The gap between two settled blocks is worked off the gutter's own list of occupants. A blank line waiting for its first keystroke is not on that list — it has no height, and the list keeps only what takes up room — so the space under it is found by stepping the page instead: past every block of no height, then on to one that has an offset in the buffer to write at. The blocks are given real rectangles here, because every stock one is zero and a walk over those runs to the end and reads nothing, which is a check passing on nothing.
  check('the space under a blank line is walked to across a block of no height and on to one with a range', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const layout = standUpReadingLayout();
    const body = layout.querySelector('.document-body');
    const was = { unlocked: read('readingUnlocked'), held: [...body.children] };
    // Room, or none: the list of occupants keeps only what takes up room, so a block of no height is invisible to it and has to be stepped past on the page.
    const block = (id, { top, bottom, start, end }) => {
      const el = booted.document.createElement('div');
      el.id = id;
      if (start != null) {
        el.dataset.srcStart = String(start);
        el.dataset.srcEnd = String(end);
      }
      el.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 600, width: 600, height: bottom - top });
      body.appendChild(el);
      return el;
    };
    try {
      read('readingUnlocked = true; blockGutterGap = null;');
      booted.bindBlockControls();
      const typedOn = block('walk-typed-on', { top: 100, bottom: 100, start: 0, end: 0 });
      const noHeight = block('walk-no-height', { top: 140, bottom: 140, start: 8, end: 20 });
      const decoration = block('walk-decoration', { top: 140, bottom: 180 });
      const written = block('walk-written', { top: 180, bottom: 220, start: 30, end: 44 });
      // The blank line and the block of no height are both off the list, which is what puts this walk on the page rather than on the list.
      const occupants = booted.blockGutterOccupants().map((el) => el.id);
      if (occupants.includes('walk-typed-on') || occupants.includes('walk-no-height')) throw new Error(`a block of no height is on the gutter's list: ${occupants.join(',')}`);

      booted.aimBlockGutterBelow(typedOn);
      const gap = read('blockGutterGap');
      if (!gap) throw new Error('the space under the line being typed in was never found');
      if (gap.above !== typedOn || gap.after !== typedOn) throw new Error('the space was not measured off the line being typed in');
      // The walk steps past the block of no height and stops at the first one that takes up room.
      if (gap.below !== decoration) throw new Error(`the space below was found as ${gap.below ? gap.below.id : 'nothing'} rather than the first block with room under it`);
      // It goes on past that one, because a block the page drew has no offset in the buffer to write a new line at.
      if (gap.before !== written) throw new Error(`the new line would be written beside ${gap.before ? gap.before.id : 'nothing'} rather than the nearest block with a range`);

      // Nothing under the line at all is nothing under it, rather than the walk running off the end and answering something.
      const alone = block('walk-alone', { top: 300, bottom: 300, start: 60, end: 60 });
      booted.aimBlockGutterBelow(alone);
      const end = read('blockGutterGap');
      if (end.below !== null || end.before !== null) throw new Error('the walk off the end of the document answered a block that is not there');
    } finally {
      for (const child of [...body.children]) if (!was.held.includes(child)) child.remove();
      read(`readingUnlocked = ${JSON.stringify(was.unlocked)}; blockGutterGap = null;`);
    }
  });
}
