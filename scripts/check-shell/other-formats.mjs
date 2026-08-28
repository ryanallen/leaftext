// Documents that are not Markdown: what each one lets a reader type on, and what it says where it does not.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  check,
  fakeElement,
  record,
  root,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // The padlock is the one control whose whole job is to say this document can be changed, so it stands only where that is true. A page that proved no source range has nothing to click into, and pressing it there costs a whole re-render and shows nothing — which reads as a broken button. The tray's other tools do not go with it, and the source view's padlock is a different switch on the same document.
  check('the reading padlock leaves the tray on a document that proved nothing', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    try {
      read('currentDocumentBindsAnything = true;');
      booted.renderViewTools('reading');
      if (read('readerLockButton.hidden')) throw new Error('a document that proved a range lost its padlock');
      if (read('speedReaderButton.hidden')) throw new Error('the speed reader left the tray with the padlock');

      read('currentDocumentBindsAnything = false;');
      booted.renderViewTools('reading');
      if (!read('readerLockButton.hidden')) throw new Error('a document that proved nothing kept its padlock');
      if (read('speedReaderButton.hidden')) throw new Error('the speed reader went with the padlock');

      // The source view edits the whole file whatever the page proved, so its own padlock stands on the very same document.
      booted.renderViewTools('code');
      if (read('readerLockButton.hidden')) throw new Error('the source view lost its padlock');
    } finally {
      read('currentDocumentBindsAnything = true;');
      booted.renderViewTools('reading');
    }
  });

  // The answer comes off the payload the host already sends, and it is read as a document binds — so an email that proved nothing and an empty note, which has no blocks either, must not come out the same.
  check('a document binds something when it is Markdown or a block proved a range', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const bind = (doc) => {
      booted.bindReadingEditor(doc, { deferCaret: true });
      return read('currentDocumentBindsAnything');
    };
    // A drawn document, because the bind walks away from a page holding none — and then the answer read back is whatever was in the value before it was asked.
    const drawn = booted.document.createElement('div');
    drawn.className = 'document-body';
    booted.document.getElementById('app').appendChild(drawn);
    try {
      if (!bind({ format: 'markdown', blocks: [], source: '' })) {
        throw new Error('an empty note lost the padlock it is unlocked to type into');
      }
      if (bind({ format: 'eml', blocks: [], source: 'Subject: packed\r\n' })) {
        throw new Error('a document with no proved range still claimed one');
      }
      if (!bind({ format: 'eml', blocks: [{ id: 0, kind: 'email_header', start: 9, end: 15 }], source: 'Subject: packed\r\n' })) {
        throw new Error('a proved range did not put the padlock back');
      }
    } finally {
      read("currentDocumentFormat = 'markdown'; currentDocumentSource = ''; currentDocumentBindsAnything = true;");
    }
  });

  // A message's words are typed on where they are drawn, and the one thing that may never happen is Markdown syntax landing in somebody's mail. So the serializer writes text and nothing else, and a block only opens for typing when what it writes equals the bytes its range cuts.
  check('an email block serializes back to the file’s own bytes', () => {
    const { emailBlockDomToText } = booted;
    // A drawn paragraph: two lines joined by a break, with a bare address linkified the way the renderer draws one.
    const text = (value) => ({ nodeType: 3, nodeValue: value });
    const element = (tag, children) => ({
      nodeType: 1,
      tagName: tag.toUpperCase(),
      childNodes: children,
      dataset: {},
    });
    const paragraph = element('p', [
      text('Read '),
      element('a', [text('https://example.com/page')]),
      element('br', []),
      text('before Friday.'),
    ]);
    const written = emailBlockDomToText(paragraph, '\r\n');
    if (written !== 'Read https://example.com/page\r\nbefore Friday.') {
      throw new Error(`the serializer did not write the file’s bytes: ${JSON.stringify(written)}`);
    }
    // The ending is the one the block's own slice uses, never the browser's.
    if (emailBlockDomToText(paragraph, '\n') !== 'Read https://example.com/page\nbefore Friday.') {
      throw new Error('the serializer ignored the line ending it was given');
    }
    // Nothing a Markdown serializer would add: no asterisks, no bracket form for the link.
    if (/[*[\]`]/.test(written)) throw new Error(`Markdown syntax reached a message: ${written}`);
  });

  // The gate over that serializer: a block opens for typing only where its output is the slice. A row the reader re-spelled -- a date, an address list the parser rejoined -- has to keep the raw-slice editor, or typing on it would rewrite bytes nobody touched.
  check('an email block opens for typing only where the page can write its bytes back', () => {
    const { emailBlockTypeableInPlace } = booted;
    const source = 'From: a@example.com\r\nDate: 3 Aug 2026 09:00 +0000\r\n\r\nOne line.\r\n';
    const read = (expression) => vm.runInContext(expression, booted);
    const block = (start, end, drawn) => ({
      dataset: { srcStart: String(start), srcEnd: String(end) },
      nodeType: 1,
      tagName: 'P',
      childNodes: [{ nodeType: 3, nodeValue: drawn }],
    });
    const wasSource = read('currentDocumentSource');
    try {
      read(`currentDocumentSource = ${JSON.stringify(source)};`);
      // The paragraph, drawn exactly as the file spells it.
      if (!emailBlockTypeableInPlace(block(source.indexOf('One line.'), source.indexOf('One line.') + 9, 'One line.'))) {
        throw new Error('a paragraph drawn as the file spells it did not open for typing');
      }
      // The date row. Drawn as the file spells it, it opens; re-spelled by the reader into a fuller form, it must not.
      const value = '3 Aug 2026 09:00 +0000';
      const dateStart = source.indexOf(value);
      const dateEnd = dateStart + value.length;
      if (!emailBlockTypeableInPlace(block(dateStart, dateEnd, value))) {
        throw new Error('a row drawn as the file spells it did not open for typing');
      }
      if (emailBlockTypeableInPlace(block(dateStart, dateEnd, 'Mon, 3 Aug 2026 09:00:00 +0000'))) {
        throw new Error('a row the reader re-spelled opened for typing over bytes it does not match');
      }
      // A paragraph running over two lines, drawn the way the renderer draws one: two runs of text with a break between them and no character of the page's own.
      const over = 'One line.\r\nAnd another.';
      const twoLines = {
        dataset: { srcStart: '0', srcEnd: String(over.length) },
        nodeType: 1,
        tagName: 'P',
        childNodes: [
          { nodeType: 3, nodeValue: 'One line.' },
          { nodeType: 1, tagName: 'BR', childNodes: [] },
          { nodeType: 3, nodeValue: 'And another.' },
        ],
      };
      read(`currentDocumentSource = ${JSON.stringify(over)};`);
      if (!emailBlockTypeableInPlace(twoLines)) {
        throw new Error('a paragraph over two lines fell back to the raw editor');
      }
      // The fault it had: one newline of the page's own after the break, and the paragraph can never be written back.
      twoLines.childNodes[2] = { nodeType: 3, nodeValue: '\nAnd another.' };
      if (emailBlockTypeableInPlace(twoLines)) {
        throw new Error('a paragraph carrying a character the message has not got opened for typing');
      }

      read(`currentDocumentSource = ${JSON.stringify(source)};`);
      // A block with no usable range is nobody's to type on.
      if (emailBlockTypeableInPlace({ dataset: {}, childNodes: [] })) {
        throw new Error('a block with no range opened for typing');
      }
    } finally {
      read(`currentDocumentSource = ${JSON.stringify(wasSource)};`);
    }
  });

  // The message's gate, asked of an element: the words of an XML document are typed on where they are drawn, and the one thing that may never happen is a tag being rewritten by somebody fixing a word. So a block opens only where what is drawn is exactly the bytes between its own tags, and what it commits lands between those tags and nowhere near them.
  check('an XML element opens for typing only where the drawn words are its own bytes', () => {
    const { xmlBlockTypeableInPlace, blockDomToSource, commitBlockEdit } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const source =
      '<TEI>\n<p>The translation starts here.</p>\n<p>A <hi>word</hi> here.</p>\n' +
      '<p>Tea &amp; toast.</p>\n<p>Tea &#38; toast.</p>\n<head>Split\n  over lines.</head>\n' +
      '<lb/>\n<!-- a note -->\n<p>café 😀</p>\n</TEI>\n';
    // The buffer counts bytes, so every range is measured the way the host measures it.
    const bytesTo = (index) => Buffer.byteLength(source.slice(0, index), 'utf8');
    const block = (fragment, drawn) => {
      const at = source.indexOf(fragment);
      if (at < 0) throw new Error(`the fixture has no ${fragment}`);
      return {
        isConnected: true,
        tagName: 'P',
        dataset: {
          blockKind: 'paragraph',
          srcStart: String(bytesTo(at)),
          srcEnd: String(bytesTo(at + fragment.length)),
        },
        childNodes: [],
        textContent: drawn,
        previousElementSibling: null,
        nextElementSibling: null,
      };
    };
    const keeps = (fragment, drawn, why) => {
      if (xmlBlockTypeableInPlace(block(fragment, drawn))) throw new Error(why);
    };
    const posted = [];
    const wasIpc = booted.ipc;
    const wasFormat = read('currentDocumentFormat');
    const wasSource = read('currentDocumentSource');
    try {
      read("currentDocumentFormat = 'xml';");
      booted.window.leafBlocksResynced({ source });
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };

      // A paragraph of plain text: the span is the words alone, with the tags outside it on both sides.
      const plain = block('<p>The translation starts here.</p>', 'The translation starts here.');
      const span = xmlBlockTypeableInPlace(plain);
      if (!span) throw new Error('a paragraph drawn as the file spells it did not open for typing');
      if (source.slice(span.start, span.end) !== 'The translation starts here.') {
        throw new Error(`the span opened was ${JSON.stringify(source.slice(span.start, span.end))}`);
      }

      // What the page writes for it: the words as a tree holds them, never Markdown.
      const written = blockDomToSource({ ...plain, textContent: 'A word & another <one>.' });
      if (written !== 'A word &amp; another &lt;one>.') {
        throw new Error(`the tree serializer wrote ${JSON.stringify(written)}`);
      }

      // And the commit: only the span between the tags, so both tags survive it.
      plain.__innerSpan = span;
      posted.length = 0;
      commitBlockEdit(plain, 'The translation starts there.');
      const edits = posted.filter((message) => message.command === 'editBlock');
      if (edits.length !== 1) throw new Error(`typing on an element sent ${edits.length} edits`);
      if (edits[0].start !== span.start || edits[0].end !== span.end) {
        throw new Error(`the commit widened the span to [${edits[0].start},${edits[0].end})`);
      }
      const after = source.slice(0, edits[0].start) + edits[0].text + source.slice(edits[0].end);
      if (!after.includes('<p>The translation starts there.</p>')) {
        throw new Error(`the tags did not survive the commit: ${JSON.stringify(after.slice(0, 60))}`);
      }

      // An entity the file spells as a tree does round-trips, so it opens; one spelled another way does not, and keeps the editor it has.
      if (!xmlBlockTypeableInPlace(block('<p>Tea &amp; toast.</p>', 'Tea & toast.'))) {
        throw new Error('an escaped ampersand that round-trips did not open for typing');
      }
      keeps('<p>Tea &#38; toast.</p>', 'Tea & toast.', 'an entity the file spells another way opened for typing');

      // Everything the renderer changed on the way to the page keeps the raw editor.
      keeps('<p>A <hi>word</hi> here.</p>', 'A word here.', 'inline markup the renderer flattened opened for typing');
      keeps('<head>Split\n  over lines.</head>', 'Split over lines.', 'text the renderer collapsed opened for typing');
      keeps('<!-- a note -->', ' a note ', 'a comment opened for typing');
      keeps('<lb/>', '', 'an element with no inside opened for typing');

      // The span is in bytes, not characters: a paragraph after multi-byte text still cuts where its words are.
      const wide = xmlBlockTypeableInPlace(block('<p>café 😀</p>', 'café 😀'));
      if (!wide) throw new Error('a paragraph of multi-byte text did not open for typing');
      const bytes = Buffer.from(source, 'utf8');
      if (bytes.subarray(wide.start, wide.end).toString('utf8') !== 'café 😀') {
        throw new Error('the span was cut on characters rather than on bytes');
      }

      // A block with no usable range is nobody's to type on.
      if (xmlBlockTypeableInPlace({ dataset: {}, textContent: '' })) {
        throw new Error('a block with no range opened for typing');
      }
    } finally {
      booted.ipc = wasIpc;
      booted.window.leafBlocksResynced({ source: wasSource });
      read(`currentDocumentFormat = ${JSON.stringify(wasFormat)};`);
    }
  });

  // The same gate asked of one cell of a table, and the whole point of asking it: a reader correcting one date must not have every other row of the file move under them. So the splice a cell commits is its own element's words and the rest of the file comes back byte for byte.
  check('a cell of an XML table writes its own bytes and leaves every other row alone', () => {
    const { xmlCellTypeableInPlace, commitBlockEdit } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const source =
      '<urlset>\n<url><loc>https://leaftext.com/</loc><lastmod>2026-07-24</lastmod></url>\n' +
      '<url><loc>https://leaftext.com/docs/</loc><lastmod>2026-07-11</lastmod></url>\n</urlset>\n';
    const cellFor = (element, drawn) => {
      const at = source.indexOf(element);
      if (at < 0) throw new Error(`the fixture has no ${element}`);
      const cell = fakeElement('cell');
      cell.tagName = 'TD';
      cell.dataset = { cellStart: String(at), cellEnd: String(at + element.length) };
      cell.textContent = drawn;
      return cell;
    };
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const wasIpc = booted.ipc;
    const posted = [];
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };

      const date = cellFor('<lastmod>2026-07-24</lastmod>', '2026-07-24');
      const span = xmlCellTypeableInPlace(date);
      if (!span) throw new Error('a cell drawn from one element could not be typed on');
      if (source.slice(span.start, span.end) !== '2026-07-24') {
        throw new Error('the span a cell commits through is not its own words');
      }
      // Two elements drawn as one string with a separator the file has not got: no splice can name it, so no caret goes in it.
      if (xmlCellTypeableInPlace(cellFor('<lastmod>2026-07-24</lastmod>', '2026-07-24, 2026-07-11'))) {
        throw new Error('a cell holding two elements opened for typing');
      }
      // A cell with no range at all — one the record was short of — is nobody's to type on either.
      if (xmlCellTypeableInPlace({ dataset: {}, textContent: '' })) {
        throw new Error('a cell with no range opened for typing');
      }

      date.__innerSpan = span;
      date.__editBaseline = '2026-07-24';
      commitBlockEdit(date, '2026-08-01');
      const edit = posted.find((message) => message.command === 'editBlock');
      if (!edit) throw new Error('typing in a cell wrote nothing');
      const after = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
      if (!after.includes('<lastmod>2026-08-01</lastmod>')) throw new Error('the cell was not written');
      if (after.replace('2026-08-01', '2026-07-24') !== source) {
        throw new Error('writing one cell moved something else in the file');
      }
    } finally {
      booted.ipc = wasIpc;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // Several elements under one name fold into one cell, and the separator between them is the renderer's rather than the file's. So the range sits on a span each rather than on the cell, and each span is one element's own bytes exactly as a single-element cell is — which is what lets a reader correct one of two tags without the other, or any other record, moving.
  check('one value of a folded XML cell writes its own element and leaves the rest of the file alone', () => {
    const { xmlCellTypeableInPlace, bindEditableBlocks, commitBlockEdit } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    // The two tags are not next to each other: an element's range is absolute, so what stands between them never mattered.
    const run =
      '<url><loc>https://leaftext.com/</loc><tag>one</tag><lastmod>2026-07-24</lastmod><tag>two</tag></url>';
    const source = `<urlset>
${run}
</urlset>
`;
    const spanFor = (element, drawn) => {
      const at = source.indexOf(element);
      if (at < 0) throw new Error(`the fixture has no ${element}`);
      const el = fakeElement(drawn);
      el.tagName = 'SPAN';
      el.dataset = { cellStart: String(at), cellEnd: String(at + element.length) };
      el.textContent = drawn;
      return el;
    };
    const cell = fakeElement('folded');
    cell.tagName = 'TD';
    cell.textContent = 'one, two';
    const one = spanFor('<tag>one</tag>', 'one');
    const two = spanFor('<tag>two</tag>', 'two');
    // The stand-in page answers every selector with everything it holds, so a stub that ignored the selector would pass whether the pass asked for a cell or for anything in a table.
    const nodes = [cell, one, two];
    const body = {
      querySelectorAll: (selector) => {
        // A tag name only counts where it abuts the bracket: `td[…]` names a tag, `table [… ]` names anything inside one.
        const upTo = selector.slice(0, selector.indexOf('['));
        const tag = upTo.endsWith(' ') ? '' : upTo;
        return tag ? nodes.filter((node) => node.tagName.toLowerCase() === tag) : nodes;
      },
    };
    const inApp = read('app');
    const wasQuery = inApp.querySelector;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const wasIpc = booted.ipc;
    const posted = [];
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      inApp.querySelector = (selector) => (selector === '.document-body' ? body : wasQuery(selector));
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };

      // The separator is in the cell and in no span, so the cell itself is nobody's bytes and stays shut.
      if (xmlCellTypeableInPlace(cell)) throw new Error('the cell holding both values opened for typing');
      for (const span of [one, two]) {
        const proved = xmlCellTypeableInPlace(span);
        if (!proved) throw new Error(`the span drawn from <tag>${span.textContent}</tag> could not be typed on`);
        if (source.slice(proved.start, proved.end) !== span.textContent) {
          throw new Error('the span a folded value commits through is not its own words');
        }
      }

      // The pass has to reach a span inside a cell, not only a cell: it asks anything in a table carrying the range.
      bindEditableBlocks('xml');
      for (const span of [one, two]) {
        if (!span.listeners.has('pointerup') || !span.__innerSpan) {
          throw new Error('a folded value was not opened for typing');
        }
        if (!span.classList.contains('leaf-editable')) {
          throw new Error('a folded value was left out of the editable pass');
        }
      }
      if (cell.listeners.has('pointerup') || cell.classList.contains('leaf-editable')) {
        throw new Error('the cell around two values was wired for typing anyway');
      }

      one.__editBaseline = 'one';
      commitBlockEdit(one, 'first');
      const edit = posted.find((message) => message.command === 'editBlock');
      if (!edit) throw new Error('typing in one value of a folded cell wrote nothing');
      const after = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
      if (!after.includes('<tag>first</tag>')) throw new Error('the value was not written');
      if (!after.includes('<tag>two</tag>')) throw new Error('the other value of the same cell moved');
      if (after.replace('first', 'one') !== source) {
        throw new Error('writing one value of a folded cell moved something else in the file');
      }
    } finally {
      booted.ipc = wasIpc;
      inApp.querySelector = wasQuery;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // A stand-in table: the heading row and the cells in reading order, answering the three questions the wiring pass and a heading ask of one. A cell drawn from one element carries the range itself; one drawn from several carries none and holds a span each.
  const xmlTable = (source, run, heads, rows) => {
    const spanFor = (element, tag) => {
      const at = source.indexOf(element);
      if (at < 0) throw new Error(`the fixture has no ${element}`);
      const el = fakeElement(element);
      el.tagName = tag;
      el.dataset = { cellStart: String(at), cellEnd: String(at + element.length) };
      el.textContent = element.slice(element.indexOf('>') + 1, element.lastIndexOf('</'));
      return el;
    };
    const table = fakeElement('table');
    table.tagName = 'TABLE';
    table.dataset = {
      blockKind: 'table',
      srcStart: String(source.indexOf(run)),
      srcEnd: String(source.indexOf(run) + run.length),
    };
    const ths = heads.map((label) => {
      const th = fakeElement(`th:${label}`);
      th.tagName = 'TH';
      th.textContent = label;
      th.closest = (selector) => (selector === 'table' ? table : null);
      return th;
    });
    const tds = [];
    const spans = [];
    for (const row of rows) {
      for (const parts of row) {
        const td = fakeElement('td');
        td.tagName = 'TD';
        td.dataset = {};
        td.querySelectorAll = () => [];
        if (parts.length === 1) {
          const only = spanFor(parts[0], 'TD');
          td.dataset = only.dataset;
        } else if (parts.length > 1) {
          const held = parts.map((element) => spanFor(element, 'SPAN'));
          td.querySelectorAll = () => held;
          spans.push(...held);
        }
        // What the page drew: each element's own words, and where several folded into one cell the separator the renderer put between them.
        td.textContent = parts.map((element) => element.slice(element.indexOf('>') + 1, element.lastIndexOf('</'))).join(', ');
        tds.push(td);
      }
    }
    table.querySelectorAll = (selector) => (selector === 'th' ? ths : selector === 'td' ? tds : []);
    const body = {
      querySelectorAll: (selector) => {
        if (selector === 'table th') return ths;
        if (selector.includes('data-cell-start')) return [...tds, ...spans];
        if (selector.includes('data-src-start')) return [table];
        return [];
      },
    };
    return { table, ths, tds, spans, body };
  };

  // Stand the page's document up around one table and hand the block back, with everything put back afterwards however the check ends.
  const overXmlTable = (source, built, work) => {
    const read = (expression) => vm.runInContext(expression, booted);
    const inApp = read('app');
    const wasQuery = inApp.querySelector;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const wasToast = booted.leafToast;
    const wasIpc = booted.ipc;
    const said = [];
    const posted = [];
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      inApp.querySelector = (selector) => (selector === '.document-body' ? built.body : wasQuery(selector));
      booted.leafToast = (words) => said.push(words);
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
      booted.bindEditableBlocks('xml');
      work({ said, posted });
    } finally {
      booted.ipc = wasIpc;
      booted.leafToast = wasToast;
      inApp.querySelector = wasQuery;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  };

  // A table is the one block whose shape is the reading, so nothing a reader presses may take the grid away and leave the markup of every record in its place. The parts of it that can be typed on answer for themselves — a cell of its own element, a value of a folded cell on a span of its own, and a heading over a column with an element to rename — and the table itself still answers a press with nothing and says nothing.
  check('an XML table keeps its shape when a press lands where nothing can be typed', () => {
    const run =
      '<url id="a"><loc>https://leaftext.com/</loc><tag>one</tag></url>\n' +
      '<url id="b"><loc>https://leaftext.com/docs/</loc><tag>two</tag><tag>three</tag></url>';
    const source = `<urlset>\n${run}\n</urlset>\n`;
    const built = xmlTable(
      source,
      run,
      ['ID', 'URL', 'Tag'],
      [
        [[], ['<loc>https://leaftext.com/</loc>'], ['<tag>one</tag>']],
        [[], ['<loc>https://leaftext.com/docs/</loc>'], ['<tag>two</tag>', '<tag>three</tag>']],
      ],
    );
    const { table, ths, tds, spans } = built;
    overXmlTable(source, built, ({ said }) => {
      const proved = tds[1];
      const folded = tds[5];
      if (!proved.listeners.has('pointerup')) throw new Error('a cell of its own element was not opened for typing');
      if (!proved.__innerSpan) throw new Error('the cell carries no span for its commit to splice');
      if (!proved.classList.contains('leaf-editable')) throw new Error('a proved cell was left out of the editable pass');
      // The cell around two values is nobody's bytes; each value inside it is its own.
      if (folded.listeners.has('pointerup') || folded.__innerSpan || folded.classList.contains('leaf-editable')) {
        throw new Error('a cell holding two elements was wired for typing anyway');
      }
      for (const value of spans) {
        if (!value.listeners.has('pointerup') || !value.__innerSpan) {
          throw new Error('a value of a folded cell was not opened for typing');
        }
      }
      // The names a block is found by stay a block's, or the gutter would offer a cell a drag handle and a plus.
      if (proved.dataset.srcStart != null || proved.dataset.srcEnd != null) {
        throw new Error('a cell answers to the names a block is found by');
      }

      // A heading over a column with an element behind it opens onto the tag; the one over the column drawn from a value inside a tag has nothing to rename and stays shut.
      if (ths[0].listeners.has('pointerup') || ths[0].classList.contains('leaf-editable')) {
        throw new Error('a heading over a column drawn from an attribute was wired for typing');
      }
      for (const th of [ths[1], ths[2]]) {
        if (!th.listeners.has('pointerup')) throw new Error(`the heading ${th.textContent} was not opened for typing`);
        if (!th.classList.contains('leaf-editable')) throw new Error(`the heading ${th.textContent} was left out of the editable pass`);
      }

      // Nothing may swap the grid for its own markup, so the table is never handed the raw-source editor.
      if (typeof table.__startSourceEdit === 'function' || table.classList.contains('leaf-editable')) {
        throw new Error('a table was wired to open as its own text');
      }
      // And nothing may answer a press with a message either: a strip growling at somebody who pressed a heading is a locked door with a sign on it, not a page.
      if (table.listeners.size) {
        throw new Error(`a table answers a press with ${[...table.listeners.keys()].join(', ')}`);
      }
      if (said.length) throw new Error(`the page said ${JSON.stringify(said)} while drawing a table`);
    });
  });

  // A heading is in no part of the file, so pressing one puts the tag the file holds under the caret and committing renames that element in every record of the run. One splice over the run's own bytes, so one press of undo takes the whole rename back and every byte the reader did not rename comes back as it was.
  check('renaming an XML column writes every record of the run and nothing else', () => {
    const run =
      '<url><loc>https://leaftext.com/</loc><tag>one</tag>  <!-- kept --></url>\n' +
      '<url><loc>https://leaftext.com/docs/</loc><tag>two</tag><tag>three</tag></url>\n' +
      '<url><loc>https://leaftext.com/about/</loc></url>';
    const source = `<urlset>\n${run}\n</urlset>\n`;
    const built = xmlTable(
      source,
      run,
      ['URL', 'Tag'],
      [
        [['<loc>https://leaftext.com/</loc>'], ['<tag>one</tag>']],
        [['<loc>https://leaftext.com/docs/</loc>'], ['<tag>two</tag>', '<tag>three</tag>']],
        [['<loc>https://leaftext.com/about/</loc>'], []],
      ],
    );
    overXmlTable(source, built, ({ posted, said }) => {
      const heading = built.ths[1];
      heading.listeners.get('pointerup').forEach((listen) => listen({ button: 0 }));
      // The words under the caret are the tag the file holds, never the label the lookup made — that lookup does not invert and a heading with a space in it is no XML name.
      if (heading.textContent !== 'tag') throw new Error(`the heading opened onto ${heading.textContent}`);

      heading.textContent = 'label';
      heading.listeners.get('focusout').forEach((listen) => listen({}));
      // The label the column was drawn with is back on the page; the file is what changed.
      if (heading.textContent !== 'Tag') throw new Error(`the heading kept ${heading.textContent} after its commit`);

      const edits = posted.filter((message) => message.command === 'editBlock');
      if (edits.length !== 1) throw new Error(`renaming a column sent ${edits.length} edits, so undo would take more than one press`);
      const after = source.slice(0, edits[0].start) + edits[0].text + source.slice(edits[0].end);
      for (const element of ['<label>one</label>', '<label>two</label>', '<label>three</label>']) {
        if (!after.includes(element)) throw new Error(`the rename missed ${element}`);
      }
      // The record with no element of that name contributed no range, so nothing of it moved — and neither did the comment, the spacing or any other tag.
      if (!after.includes('<url><loc>https://leaftext.com/about/</loc></url>')) {
        throw new Error('a record with no element of that name was rewritten anyway');
      }
      if (after.split('label').length - 1 !== 6) throw new Error('the rename wrote a name somewhere it was not asked to');
      if (after.replace(/label/g, 'tag') !== source) throw new Error('renaming a column moved something else in the file');
      if (said.length) throw new Error(`the page said ${JSON.stringify(said)} for a rename it accepted`);
    });
  });

  // Half the file's own grammar is what an element may be called, and the page is where a reader finds out. A name the file could not hold is refused where it was typed, and nothing goes out.
  check('an XML column refuses a name no element could carry, and writes nothing', () => {
    const run = '<url><loc>https://leaftext.com/</loc></url>\n<url><loc>https://leaftext.com/docs/</loc></url>';
    const source = `<urlset>\n${run}\n</urlset>\n`;
    const built = xmlTable(
      source,
      run,
      ['URL'],
      [[['<loc>https://leaftext.com/</loc>']], [['<loc>https://leaftext.com/docs/</loc>']]],
    );
    overXmlTable(source, built, ({ posted, said }) => {
      const heading = built.ths[0];
      heading.listeners.get('pointerup').forEach((listen) => listen({ button: 0 }));
      heading.textContent = 'web address';
      heading.listeners.get('focusout').forEach((listen) => listen({}));
      if (posted.some((message) => message.command === 'editBlock')) {
        throw new Error('a name no element could carry was written into the file');
      }
      if (!said.length) throw new Error('a refused name was refused in silence');
      if (heading.textContent !== 'URL') throw new Error('a refused name was left on the page');

      // And leaving a heading on the name it opened with is not an edit at all.
      heading.listeners.get('pointerup').forEach((listen) => listen({ button: 0 }));
      heading.listeners.get('focusout').forEach((listen) => listen({}));
      if (posted.some((message) => message.command === 'editBlock')) {
        throw new Error('opening a heading and leaving it alone wrote to the file');
      }
      if (said.length !== 1) throw new Error(`the page said ${JSON.stringify(said)} for a heading nobody typed in`);
    });
  });

  // The gutter's drag handle reorders a block and its plus inserts beside one; a cell is neither. That is the whole reason a cell carries names of its own rather than a block's, and the way it stays true is that the gutter never learns the cell's.
  check('the gutter still finds only blocks, so no cell is offered a handle or a plus', () => {
    const gutter = readFileSync(join(root, 'src/assets/shell/block-controls.js'), 'utf8');
    if (/data-cell-|cellStart|cellEnd/.test(gutter)) {
      throw new Error('the block gutter reaches for a table cell');
    }
    const lookups = (gutter.match(/closest\('\[data-src-start\]/g) || []).length;
    if (lookups < 2) throw new Error(`the gutter no longer finds a block by its own name (${lookups})`);
  });

  // The gate decides, but the wiring is what a reader meets: on one tree page the words that can be typed on have to come out as one kind of block and the markup that cannot as the other, side by side. And the keys that make structure are taken away there — an element is one block, so Enter would have to write its own tags.
  check('an XML page wires the words it can type on apart from the markup it cannot', () => {
    const { bindEditableBlocks, handleWysiwygKeydown } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const source = '<div><p>A line.</p><p>A <hi>word</hi> here.</p></div>';
    const at = (fragment) => {
      const start = source.indexOf(fragment);
      return {
        blockKind: 'paragraph',
        srcStart: String(start),
        srcEnd: String(start + fragment.length),
      };
    };
    const plain = fakeElement('plain');
    plain.dataset = at('<p>A line.</p>');
    plain.textContent = 'A line.';
    const mixed = fakeElement('mixed');
    mixed.dataset = at('<p>A <hi>word</hi> here.</p>');
    mixed.textContent = 'A word here.';
    const body = { querySelectorAll: () => [plain, mixed] };
    const inApp = read('app');
    const wasQuery = inApp.querySelector;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const posted = [];
    const wasIpc = booted.ipc;
    const wasCaret = booted.caretTextOffsetIn;
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      inApp.querySelector = (selector) => (selector === '.document-body' ? body : wasQuery(selector));
      bindEditableBlocks('xml');
      if (!plain.listeners.has('pointerup')) throw new Error('a paragraph of plain words was not opened for typing');
      if (!plain.__innerSpan) throw new Error('the paragraph carries no span for its commit to splice');
      if (source.slice(plain.__innerSpan.start, plain.__innerSpan.end) !== 'A line.') {
        throw new Error('the span wired onto the paragraph is not its own words');
      }
      if (!mixed.listeners.has('pointerdown') || mixed.listeners.has('pointerup')) {
        throw new Error('a paragraph holding markup lost the raw editor it has today');
      }
      if (mixed.__innerSpan) throw new Error('a block that cannot be typed on carries a span anyway');
      if (!plain.classList.contains('leaf-editable') || !mixed.classList.contains('leaf-editable')) {
        throw new Error('a block was left out of the editable pass');
      }

      // Enter is the page's own from here rather than the browser's, so the new line can be an element; a letter is left alone. With no caret in the block neither writes anything.
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
      booted.caretTextOffsetIn = () => null;
      const press = (key, shift) => {
        let stopped = false;
        handleWysiwygKeydown(plain, {
          key,
          shiftKey: !!shift,
          preventDefault: () => {
            stopped = true;
          },
        });
        return stopped;
      };
      if (!press('Enter')) throw new Error('Enter was left to the browser to answer');
      if (!press('Enter', true)) throw new Error('Enter with shift was left to the browser to answer');
      if (press('a')) throw new Error('typing a letter was refused');
      if (posted.length) throw new Error(`a key with no caret in the block wrote ${JSON.stringify(posted)}`);
    } finally {
      booted.ipc = wasIpc;
      booted.caretTextOffsetIn = wasCaret;
      inApp.querySelector = wasQuery;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // A JSON or YAML file naming its own title draws it as the big heading and leaves the pair out of the body, so the heading is the only place that value appears on the page. The wiring above runs for XML alone, so nothing here proved a data block ever reaches the in-place source editor — which is how the one value a reader most wants to correct stayed the one thing on the page answering a press with nothing.
  check('a data document’s own title heading opens the value’s own bytes where it is drawn', () => {
    const { bindEditableBlocks } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const source = '{"title": "Release notes", "version": "1.0"}';
    const value = '"Release notes"';
    const at = source.indexOf(value);
    const heading = fakeElement('title');
    heading.tagName = 'H1';
    heading.dataset = { blockKind: 'data_heading', srcStart: String(at), srcEnd: String(at + value.length) };
    heading.textContent = 'Release notes';
    const body = { querySelectorAll: () => [heading] };
    const inApp = read('app');
    const wasQuery = inApp.querySelector;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    try {
      read(`currentDocumentFormat = 'json'; currentDocumentSource = ${JSON.stringify(source)};`);
      inApp.querySelector = (selector) => (selector === '.document-body' ? body : wasQuery(selector));
      bindEditableBlocks('json');

      if (!heading.classList.contains('leaf-editable')) {
        throw new Error('the title heading was left out of the editable pass');
      }
      const press = (heading.listeners.get('pointerdown') || [])[0];
      if (!press) throw new Error('the title heading answers a press with nothing');

      press({ target: null, preventDefault() {} });
      if (heading.dataset.editingSource !== 'true') throw new Error('pressing the title heading opened no editor');
      // The drawn title is whitespace-collapsed and entity-decoded; what opens is the file's own bytes, quotes and all, exactly as a press on a field opens them.
      if (heading.textContent !== value) {
        throw new Error(`the title heading opened ${JSON.stringify(heading.textContent)}`);
      }

      // And a heading standing in for a title the document has not got names no value, so it is stamped with no range and stays what it is: a name to rename the file by.
      const borrowed = fakeElement('borrowed');
      borrowed.tagName = 'H1';
      borrowed.dataset = { blockKind: 'data_heading' };
      borrowed.textContent = 'Notes';
      inApp.querySelector = (selector) =>
        selector === '.document-body' ? { querySelectorAll: () => [borrowed] } : wasQuery(selector);
      bindEditableBlocks('json');
      if (borrowed.listeners.size || borrowed.classList.contains('leaf-editable')) {
        throw new Error('a heading borrowed from the file name was wired to type over bytes it does not name');
      }
    } finally {
      inApp.querySelector = wasQuery;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // Enter was refused in a tree document at first, and a refused Enter reads as a bug rather than as a rule. A newline written inside the element would draw as a space the moment the page redrew, so the new line is another element of the same name — the words on both sides of the caret survive it, the tags on both halves are the element's own, and the caret lands in the second.
  check('Enter in an element of a tree document carries on in another of the same element', () => {
    const { handleWysiwygKeydown } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const element = '<p rend="lead">One line here.</p>';
    const source = `<div>\n${element}\n</div>`;
    const start = source.indexOf(element);
    const posted = [];
    const asked = [];
    const wasIpc = booted.ipc;
    const wasCaret = booted.caretTextOffsetIn;
    const wasInsert = booted.openInsertBlockAfter;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const paragraph = fakeElement('paragraph');
    paragraph.dataset = {
      blockKind: 'paragraph',
      srcStart: String(start),
      srcEnd: String(start + element.length),
    };
    paragraph.textContent = 'One line here.';
    paragraph.__innerSpan = { start: start + '<p rend="lead">'.length, end: start + element.length - '</p>'.length };
    paragraph.__editBaseline = 'One line here.';
    const enter = () => {
      posted.length = 0;
      handleWysiwygKeydown(paragraph, { key: 'Enter', shiftKey: false, preventDefault() {} });
      return posted.filter((message) => message.command === 'editBlock');
    };
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
      booted.openInsertBlockAfter = (el, spec) => asked.push(spec);

      // In the middle of the words: two elements, each with the attribute the one before it carried, and no word lost between them.
      booted.caretTextOffsetIn = () => 'One line'.length;
      const split = enter();
      if (split.length !== 1) throw new Error(`Enter sent ${split.length} edits`);
      const after = source.slice(0, split[0].start) + split[0].text + source.slice(split[0].end);
      if (after !== '<div>\n<p rend="lead">One line</p>\n<p rend="lead">here.</p>\n</div>') {
        throw new Error(`Enter left the file as ${JSON.stringify(after)}`);
      }
      const landed = vm.runInContext('pendingCaret', booted);
      if (!landed || landed.srcStart !== start + '<p rend="lead">One line</p>\n'.length || landed.textOffset !== 0) {
        throw new Error(`the caret landed at ${JSON.stringify(landed)}`);
      }

      // At the end of the words there is nothing to carry down, so a blank line opens inside another of the same element rather than an empty one being written.
      vm.runInContext('pendingCaret = null;', booted);
      booted.caretTextOffsetIn = () => 'One line here.'.length;
      if (enter().length) throw new Error('an element with nothing in it was written into the file');
      if (asked.length !== 1 || asked[0] !== 'element:p') {
        throw new Error(`the blank line opened as ${JSON.stringify(asked)}`);
      }

      // At the very start it would leave an empty element above the words, so it does nothing at all.
      booted.caretTextOffsetIn = () => 0;
      if (enter().length || asked.length !== 1) throw new Error('Enter at the start of the words wrote something');

      // A heading is not a paragraph: a second one in the same part is never drawn, so splitting it would take the words off the page.
      booted.caretTextOffsetIn = () => 'One line'.length;
      paragraph.dataset.blockKind = 'heading';
      if (enter().length) throw new Error('a heading was split into one the page would not draw');
    } finally {
      booted.ipc = wasIpc;
      booted.caretTextOffsetIn = wasCaret;
      booted.openInsertBlockAfter = wasInsert;
      vm.runInContext('pendingCaret = null;', booted);
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // A note left in an XML file is the one block that is only ever prose, and it answered a press with its own angle-bracket marks in code type while every sentence beside it took a caret. It types on its words now: the span is the inside of the marks, narrowed by the ends the fold trims, and nothing is escaped on the way in or out — a comment holds no escapes, so an ampersand typed into one is an ampersand in the file.
  check('a comment types on its own words and its marks survive the commit', () => {
    const { xmlCommentTypeableInPlace, blockDomToSource, commitBlockEdit, bindEditableBlocks } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const comment = '<!-- A note & a mark -->';
    const source = `<div>\n${comment}\n</div>`;
    const start = source.indexOf(comment);
    const fold = fakeElement('fold');
    fold.dataset = { blockKind: 'comment', srcStart: String(start), srcEnd: String(start + comment.length) };
    const words = fakeElement('words');
    words.classList.add('xml-comment-body');
    words.textContent = 'A note & a mark';
    fold.querySelector = (selector) => (selector === '.xml-comment-body' ? words : null);
    const posted = [];
    const wasIpc = booted.ipc;
    const inApp = read('app');
    const wasQuery = inApp.querySelector;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };

      // The span is the words alone: the marks and the spaces the fold trimmed are outside it.
      const span = xmlCommentTypeableInPlace(fold, words.textContent);
      if (!span) throw new Error('a note drawn as the file spells it did not open for typing');
      if (source.slice(span.start, span.end) !== 'A note & a mark') {
        throw new Error(`the span opened was ${JSON.stringify(source.slice(span.start, span.end))}`);
      }

      // Words the fold did not draw are nobody's to splice over.
      if (xmlCommentTypeableInPlace(fold, 'Something else')) {
        throw new Error('a note drawn as something other than its own bytes opened for typing');
      }

      // Nothing escapes on the way out, which is the whole difference from an element.
      if (blockDomToSource(words) !== 'A note & a mark') {
        throw new Error(`a note was written as ${JSON.stringify(blockDomToSource(words))}`);
      }

      // The commit lands between the marks, and both marks are still there afterwards.
      words.__innerSpan = span;
      words.__editBaseline = 'A note & a mark';
      posted.length = 0;
      commitBlockEdit(words, 'A note & two marks');
      const edits = posted.filter((message) => message.command === 'editBlock');
      if (edits.length !== 1) throw new Error(`typing in a note sent ${edits.length} edits`);
      const after = source.slice(0, edits[0].start) + edits[0].text + source.slice(edits[0].end);
      if (after !== '<div>\n<!-- A note & two marks -->\n</div>') {
        throw new Error(`the marks did not survive: ${JSON.stringify(after)}`);
      }

      // And the wiring: the words are what opens, while the fold keeps its own row for opening and shutting.
      inApp.querySelector = (selector) => (selector === '.document-body' ? { querySelectorAll: () => [fold] } : wasQuery(selector));
      bindEditableBlocks('xml');
      if (!words.listeners.has('pointerup')) throw new Error('the note’s words were not opened for typing');
      if (fold.listeners.has('pointerdown')) throw new Error('the fold was wired as an editor over its own row');
    } finally {
      booted.ipc = wasIpc;
      inApp.querySelector = wasQuery;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // Two dashes in a row end a comment early, and a comment has no escape to hide them behind — so the one thing somebody can type into a note that stops the file opening is refused rather than written, and the words go back to what the file has.
  check('a note refuses two dashes in a row rather than writing a file that will not open', () => {
    const { commitBlockEdit } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const source = '<div>\n<!-- A note -->\n</div>';
    const said = [];
    const posted = [];
    const wasToast = booted.leafToast;
    const wasIpc = booted.ipc;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const words = fakeElement('words');
    words.classList.add('xml-comment-body');
    words.textContent = 'A note';
    words.__editBaseline = 'A note';
    words.__innerSpan = { start: source.indexOf('A note'), end: source.indexOf('A note') + 'A note'.length };
    const edits = () => posted.filter((message) => message.command === 'editBlock');
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      booted.leafToast = (message) => said.push(message);
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };

      words.textContent = 'A -- note';
      commitBlockEdit(words, 'A -- note');
      if (edits().length) throw new Error('a note holding two dashes was written into the file');
      if (said.length !== 1) throw new Error(`the refusal said ${JSON.stringify(said)}`);
      if (words.textContent !== 'A note') throw new Error('the words were left as the file cannot hold them');

      // A dash at the end runs into the closing mark, and is refused the same way.
      words.textContent = 'A note-';
      commitBlockEdit(words, 'A note-');
      if (edits().length) throw new Error('a note ending in a dash was written into the file');

      // The same words without it are written as any other note is.
      words.textContent = 'A better note';
      commitBlockEdit(words, 'A better note');
      if (edits().length !== 1) throw new Error('a note with nothing wrong with it was refused');
    } finally {
      booted.leafToast = wasToast;
      booted.ipc = wasIpc;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });
}
