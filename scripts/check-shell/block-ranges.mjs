// A block's own range, and typing a block in: what the page hands the host to splice into the file it will write.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  bootReading,
  check,
  fakeElement,
  names,
  node,
  record,
  root,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // The walk slices the open document to tell a closing raw-HTML tag from an opening one, so a stand-in note goes on the page for the call and what was there goes back after it.
  const attach = (body, blocks, source) => {
    const was = booted.sliceSourceBytes(0, booted.documentSourceLength());
    booted.setDocumentSource(source);
    try {
      booted.attachMarkdownBlockRanges(body, blocks);
    } finally {
      booted.setDocumentSource(was);
    }
  };

  // The two things the field block asks the page for ride on `data-leaf-` attributes the renderer stamped on the table, so the names have to agree across Rust and here. They are read from the DOM rather than passed in, which means a rename on either side is silent: the class stops arriving and nothing throws.
  check('a note gets the style it asked for and one growl for what did not land', () => {
    const win = booted.window;
    const growls = [];
    const wasNotice = win.leafShowNotice;
    // A stand-in reader: one table carrying what the renderer stamped, and one body to receive the class.
    const layout = (asked, unread) => {
      const added = [];
      const table = { dataset: { leafDocClasses: asked, leafUnread: unread } };
      const body = { classList: { add: (...names) => added.push(...names) } };
      return {
        added,
        root: { querySelector: (selector) => (selector === '.frontmatter' ? table : body) },
      };
    };
    const run = (asked, unread) => {
      const stand = layout(asked, unread);
      growls.length = 0;
      win.leafShowNotice = (message) => growls.push(message);
      try {
        win.applyFrontmatterAsks(stand.root);
      } finally {
        win.leafShowNotice = wasNotice;
      }
      return stand.added;
    };

    const added = run('document-body-wide', '"midnight" — no style of that name here');
    if (!added.includes('document-body-wide')) throw new Error(`the class the note asked for never reached the page: ${JSON.stringify(added)}`);
    if (growls.length !== 1) throw new Error(`one growl for the whole block, not ${growls.length}`);
    if (!growls[0].includes('midnight')) throw new Error(`the growl does not say what did not land: ${growls[0]}`);

    // Nothing to say, nothing said -- a note whose block read cleanly must not growl at all.
    if (run('', '').length !== 0) throw new Error('a class was added out of an empty attribute');
    if (growls.length !== 0) throw new Error('a clean block still growled');
  });

  // The walk pairs rendered elements with the host's spans in document order and throws every range away if it cannot line them up, so one span too many leaves a whole document uneditable and says nothing. The field block is the standing case: the page skips its div, and the host has to leave the fences out to match (`block_source_map_leaves_out_a_leading_field_block`).
  check('a note that opens with a field block still gets a range on every block', () => {
    const source = '---\ntitle: Notes\n---\n\n# Heading\n\nA paragraph.\n';
    // The spans the host reports for that document, which the Rust side pins by slicing them back out of it.
    const blocks = [
      { id: 0, kind: 'heading', start: 22, end: 31, editable: true },
      { id: 1, kind: 'paragraph', start: 33, end: 45, editable: true },
    ];
    const element = (tag, className) => ({
      nodeType: 1,
      tagName: tag,
      dataset: {},
      children: [],
      classList: { contains: (name) => name === className },
    });
    const body = { children: [element('DIV', 'frontmatter'), element('H1', ''), element('P', '')] };
    attach(body, blocks, source);

    const [field, heading, paragraph] = body.children;
    if ('srcStart' in field.dataset) throw new Error('the field block took a source range, so it is being edited as Markdown');
    const at = (el) => booted.rangeOf(el, 'block');
    if (at(heading).start !== 22 || at(paragraph).start !== 33) throw new Error(`the ranges did not land: ${JSON.stringify([at(heading), at(paragraph)])}`);
    if (source.slice(at(paragraph).start, at(paragraph).end) !== 'A paragraph.') throw new Error('the paragraph range does not slice back to the paragraph');
  });

  // The other side of the same bargain: a comment is stripped before the page sees it, so the host must not report a span for it (`block_source_map_leaves_out_a_comment_between_two_paragraphs`). This proves both halves — the spans it reports stamp every element, and a span for the comment would leave the whole note uneditable.
  check('a note with a comment line in it gets a range on every block', () => {
    const source = 'Before.\n\n<!-- a note -->\n\nAfter.\n';
    const paragraphs = [
      { id: 0, kind: 'paragraph', start: 0, end: 7, editable: true },
      { id: 1, kind: 'paragraph', start: 26, end: 32, editable: true },
    ];
    const element = () => ({ nodeType: 1, tagName: 'P', dataset: {}, children: [], classList: { contains: () => false } });
    const drawn = () => ({ children: [element(), element()] });

    const body = drawn();
    attach(body, paragraphs, source);
    const [before, after] = body.children;
    const at = (el) => booted.rangeOf(el, 'block');
    if (source.slice(at(before).start, at(before).end) !== 'Before.') throw new Error('the first paragraph range does not slice back to it');
    if (source.slice(at(after).start, at(after).end) !== 'After.') throw new Error('the second paragraph range does not slice back to it');
    // The blank-page pair opens on a document with no `[data-src-start]` anywhere, which is why an unstamped note claimed to be a new one.
    if (!body.children.every((el) => 'srcStart' in el.dataset)) throw new Error('a block was left unstamped, so the page would offer the new-document lines over a note with content');

    // What the host must not send: a span for the comment, with no element to pair it with.
    const withComment = drawn();
    attach(withComment, [paragraphs[0], { id: 1, kind: 'html_block', start: 9, end: 24, editable: false }, { ...paragraphs[1], id: 2 }], source);
    if (withComment.children.some((el) => 'srcStart' in el.dataset)) throw new Error('a span with no element still stamped, so the guard that makes this fix necessary is gone');
  });

  // A footnote is written in the middle of a note and drawn at the foot of the page, so the host reports its block last and the walk pairs the two lists by position — it has no other way to know where the renderer moved it. Before that, every element from the footnote down wore the block above it: the paragraph under it opened on the footnote's own words and typing there wrote over them (`block_source_map_reports_a_footnote_where_the_page_draws_it`).
  check('a note with a footnote in the middle gets a range on every block', () => {
    const source = '# Title\n\nBefore the note.[^1]\n\n[^1]: The note itself.\n\nAfter the note.\n\n---\n\nThe last words.\n';
    // In the order the page draws them, which is the order the host reports them in: tag, class, kind, and the source the element is showing.
    const drawn = [
      ['H1', '', 'heading', '# Title'],
      ['P', '', 'paragraph', 'Before the note.[^1]'],
      ['P', '', 'paragraph', 'After the note.'],
      ['HR', '', 'rule', '---'],
      ['P', '', 'paragraph', 'The last words.'],
      ['DIV', 'footnote-definition', 'footnote_definition', '[^1]: The note itself.'],
    ];
    const blocks = drawn.map(([, , kind, text], id) => ({
      id,
      kind,
      start: source.indexOf(text),
      end: source.indexOf(text) + text.length,
      editable: kind === 'paragraph' || kind === 'heading',
    }));
    const body = {
      children: drawn.map(([tag, className]) => ({
        nodeType: 1,
        tagName: tag,
        dataset: {},
        children: [],
        classList: { contains: (name) => className !== '' && name === className },
      })),
    };
    attach(body, blocks, source);

    body.children.forEach((el, index) => {
      const [, , kind, text] = drawn[index];
      if (!('srcStart' in el.dataset)) throw new Error(`the ${kind} was left unstamped, so the note is read-only with nothing saying why`);
      const range = booted.rangeOf(el, 'block');
      const shown = source.slice(range.start, range.end);
      if (shown !== text) throw new Error(`the ${kind} wears somebody else's bytes: ${JSON.stringify(shown)}`);
      if (el.dataset.blockKind !== kind) throw new Error(`the ${kind} is stamped as a ${el.dataset.blockKind}`);
    });
    // The last block of the file must not inherit the rule above it, since a rule is the one kind the page never opens.
    if (body.children[4].dataset.editable !== 'true') throw new Error('the last block of the file cannot be edited');
  });

  // A wide table sits two boxes deep in the body — a bay that centers it and a lane the bands are painted in, both the reader's own furniture. The walk has to reach the table through both: stamp a wrapper instead and an edit serializes a `<div>` and finds no rows in it, and stamp neither and the whole note goes read-only, because one element with no block throws every range away.
  check('a table two reader boxes deep is stamped, and neither box round it is', () => {
    const source = 'Before.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.\n';
    const shown = ['Before.', '| a | b |\n| --- | --- |\n| 1 | 2 |', 'After.'];
    const blocks = shown.map((text, id) => ({
      id,
      kind: id === 1 ? 'table' : 'paragraph',
      start: source.indexOf(text),
      end: source.indexOf(text) + text.length,
      editable: true,
    }));
    const element = (tag, className, children = []) => ({
      nodeType: 1,
      tagName: tag,
      dataset: {},
      children,
      classList: { contains: (name) => className !== '' && name === className },
    });
    const table = element('TABLE', '');
    const lane = element('DIV', 'table-lane', [table]);
    const bay = element('DIV', 'table-bay', [lane]);
    const body = { children: [element('P', ''), bay, element('P', '')] };
    attach(body, blocks, source);

    for (const [name, box] of [['bay', bay], ['lane', lane]]) {
      if ('srcStart' in box.dataset) throw new Error(`the ${name} took the table's source range, so an edit would write the wrapper back into the file`);
    }
    const tableRange = booted.rangeOf(table, 'block');
    if (source.slice(tableRange.start, tableRange.end) !== shown[1]) {
      throw new Error(`the table's range does not slice back to the table: ${JSON.stringify(tableRange)}`);
    }
    const [before, , after] = body.children;
    for (const [name, block] of [['paragraph above', before], ['paragraph below', after]]) {
      if (!('srcStart' in block.dataset)) throw new Error(`the ${name} was left unstamped, so the whole note is read-only`);
    }
  });

  // The count guard only fires on a block left over or an element with no block, and a list that drifted out of order keeps both counts equal — so a kind that can only ever be one tag is the second thing held to the element it landed on. Four kinds and no others: the rest have more than one tag each and would refuse documents that are fine.
  check('a block whose kind cannot be the element it landed on stamps nothing', () => {
    const source = 'A paragraph.\n\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';
    const element = (tag, className) => ({
      nodeType: 1,
      tagName: tag,
      dataset: {},
      children: [],
      classList: { contains: (name) => className !== undefined && name === className },
    });
    const stamped = (blocks, tags) => {
      const body = { children: tags.map((tag) => element(tag)) };
      attach(body, blocks, source);
      return body.children.filter((el) => 'srcStart' in el.dataset).length;
    };
    // Each of the four kinds, handed the wrong element, with a good paragraph in front of it to prove the refusal drops that one too rather than stamping what it liked.
    const good = { id: 0, kind: 'paragraph', start: 0, end: 12, editable: true };
    const wrong = [
      ['rule', 'P'],
      ['table', 'DIV'],
      ['list', 'P'],
      ['footnote_definition', 'P'],
    ];
    for (const [kind, tag] of wrong) {
      const count = stamped([good, { id: 1, kind, start: 14, end: 17, editable: false }], ['P', tag]);
      if (count !== 0) throw new Error(`a ${kind} on a <${tag.toLowerCase()}> still stamped ${count} of 2 blocks`);
    }
    // The same four kinds on the elements they belong to still stamp, or the guard would take editing away from every document that has one.
    const right = [
      ['rule', 'HR'],
      ['table', 'TABLE'],
      ['list', 'UL'],
      ['list', 'OL'],
    ];
    for (const [kind, tag] of right) {
      const count = stamped([good, { id: 1, kind, start: 14, end: 17, editable: false }], ['P', tag]);
      if (count !== 2) throw new Error(`a ${kind} on its own <${tag.toLowerCase()}> stamped ${count} of 2 blocks`);
    }
    // A footnote definition is the one of the four that needs its class as well as its tag.
    const definition = { id: 1, kind: 'footnote_definition', start: 14, end: 17, editable: false };
    const body = { children: [element('P'), element('DIV', 'footnote-definition')] };
    attach(body, [good, definition], source);
    if (!body.children.every((el) => 'srcStart' in el.dataset)) throw new Error('a footnote definition on its own div was refused');
  });

  // The drift as it arrived: the host reported its blocks in the order the file was written, and the page draws the footnote at the foot. Fourteen blocks, fourteen elements, every pair wrong from the footnote on — and nothing said so. This is that list, handed in unfixed, refused by the kind check alone.
  check('the footnote drift is refused by the kind check on its own', () => {
    const source = '# Title\n\nBefore the note.[^1]\n\n[^1]: The note itself.\n\nAfter the note.\n\n---\n\nThe last words.\n';
    // In the order the file was written.
    const written = [
      ['heading', '# Title'],
      ['paragraph', 'Before the note.[^1]'],
      ['footnote_definition', '[^1]: The note itself.'],
      ['paragraph', 'After the note.'],
      ['rule', '---'],
      ['paragraph', 'The last words.'],
    ];
    const blocks = written.map(([kind, text], id) => ({
      id,
      kind,
      start: source.indexOf(text),
      end: source.indexOf(text) + text.length,
      editable: kind === 'paragraph' || kind === 'heading',
    }));
    // In the order the page draws them, with the definition at the foot.
    const body = {
      children: [
        ['H1', ''],
        ['P', ''],
        ['P', ''],
        ['HR', ''],
        ['P', ''],
        ['DIV', 'footnote-definition'],
      ].map(([tag, className]) => ({
        nodeType: 1,
        tagName: tag,
        dataset: {},
        children: [],
        classList: { contains: (name) => className !== '' && name === className },
      })),
    };
    attach(body, blocks, source);
    if (body.children.some((el) => 'srcStart' in el.dataset)) throw new Error('the drift stamped a range, so a click into one block would write over another');
  });

  // ---- footnotes edit as they are drawn ---------------------------------------
  //
  // A footnote as the renderer draws it at the foot of the page: the number it wears and the arrow back are the renderer's, not the file's.
  const drawnFootnote = (name, words, range) =>
    node('div', {
      className: 'footnote-definition',
      id: name,
      dataset: range ? { blockKind: 'footnote_definition', srcStart: String(range[0]), srcEnd: String(range[1]) } : { blockKind: 'footnote_definition' },
      children: [
        node('sup', { className: 'footnote-definition-label', children: ['1'] }),
        node('p', { children: [...words, node('a', { className: 'footnote-backref', attributes: { href: '#fnref-' + name }, children: [node('svg', {})] })] }),
      ],
    });

  // A footnote reference is a superscript number on screen and `[^name]` in the file, so a paragraph carrying one has to stay in typing-as-it-looks rather than dropping out and opening as raw source. The name is on the element; the number is assigned by first use and cannot be written back.
  check('a sentence carrying a footnote is typed in as it looks and keeps its marker', () => {
    const marker = node('sup', { className: 'footnote-reference', id: 'fnref-why', children: [node('a', { attributes: { href: '#why' }, children: ['1'] })] });
    const paragraph = node('p', { dataset: { blockKind: 'paragraph' }, children: ['Before the note.', marker, ' After it.'] });
    if (!booted.markdownBlockWysiwygSafe(paragraph)) throw new Error('a paragraph with a footnote in it still opens as raw source');
    const written = booted.blockDomToMarkdown(paragraph);
    if (written !== 'Before the note.[^why] After it.') throw new Error(`the marker did not survive the write-back: ${JSON.stringify(written)}`);
  });

  // The other end of the same complaint: the footnote's own words at the foot of the page. The number and the back-arrow are drawn into the block and are not in the file, so both come off on the way out and the marker is rebuilt from the name.
  check('a footnote at the foot of the page is typed in as it looks', () => {
    const definition = drawnFootnote('why', ['The note itself.']);
    if (!booted.footnoteDefinitionWysiwygSafe(definition)) throw new Error('the footnote still opens as raw source');
    const written = booted.blockDomToMarkdown(definition);
    if (written !== '[^why]: The note itself.') throw new Error(`the footnote wrote back wrong: ${JSON.stringify(written)}`);

    // A footnote holding a second paragraph is indented in the file and that indent cannot be read off the page, so it keeps the source editor.
    const two = drawnFootnote('why', ['First.']);
    two.children.push(node('p', { children: ['Second.'] }));
    if (booted.footnoteDefinitionWysiwygSafe(two)) throw new Error('a two-paragraph footnote was offered the as-it-looks editor');
  });

  // A footnote written inside a quote is lifted out and drawn at the foot, so the quote on screen no longer holds it — writing the quote back from what is drawn would delete that line. Its own lines go back on the end, taken from the file rather than rebuilt (`block_source_map_marks_the_block_a_footnote_was_written_inside`).
  check('a quote a footnote was written in keeps that footnote when the quote is typed in', () => {
    const source = 'Text [^x] here.\n\n> a quote line\n>\n> [^x]: the note\n\nAfter.\n';
    const definition = drawnFootnote('x', ['the note'], [36, 50]);
    const quote = node('blockquote', {
      dataset: { blockKind: 'blockquote', holdsFootnote: 'true', srcStart: '17', srcEnd: '50' },
      children: [node('p', { children: ['a quote line'] })],
    });
    const body = { children: [quote, definition], querySelectorAll: () => [definition] };
    const appEl = booted.document.getElementById('app');
    const wasQuery = appEl.querySelector;
    appEl.querySelector = (selector) => (selector === '.document-body' ? body : wasQuery.call(appEl, selector));
    let written;
    let emptied;
    try {
      booted.window.leafBlocksResynced({ source });
      written = booted.blockDomToMarkdown(quote);
      // The quote drawn with nothing in it — its only content was the footnote — writes back as the footnote alone rather than as an empty quote.
      quote.children.length = 0;
      quote.childNodes.length = 0;
      emptied = booted.blockDomToMarkdown(quote);
    } finally {
      appEl.querySelector = wasQuery;
    }
    if (written !== '> a quote line\n>\n> [^x]: the note') throw new Error(`the footnote's line was lost writing the quote back: ${JSON.stringify(written)}`);
    if (emptied !== '> [^x]: the note') throw new Error(`an empty-looking quote wrote the footnote out of the file: ${JSON.stringify(emptied)}`);
  });

  // A list written with blank lines between its items draws each item's words in a paragraph of their own, and a paragraph in a list must not send the whole list to the raw-source editor, or spacing a list out takes typing-as-it-looks away from it. The blank lines go back on the way out, or the list would close up under the reader.
  check('a list with blank lines between its items is typed in as it looks', () => {
    const item = (words) => node('li', { children: [node('p', { children: [words] })] });
    const list = node('ul', { dataset: { blockKind: 'list' }, children: [item('First item.'), item('Second item.')] });
    if (!booted.listWysiwygSafe(list)) throw new Error('a list spaced out with blank lines still opens as raw source');
    const written = booted.blockDomToMarkdown(list);
    if (written !== '- First item.\n\n- Second item.') throw new Error(`the blank line between the items was lost: ${JSON.stringify(written)}`);

    // A list whose items sit together writes back the way it always has, with no blank line invented between them.
    const tight = node('ul', { dataset: { blockKind: 'list' }, children: [node('li', { children: ['First item.'] }), node('li', { children: ['Second item.'] })] });
    if (booted.blockDomToMarkdown(tight) !== '- First item.\n- Second item.') throw new Error('a list whose items sit together came back spaced out');

    // An item holding a second paragraph is a continuation whose indent cannot be read off the page, so it keeps the source editor.
    const twoParagraphs = node('ul', { children: [node('li', { children: [node('p', { children: ['First.'] }), node('p', { children: ['Continued.'] })] })] });
    if (booted.listWysiwygSafe(twoParagraphs)) throw new Error('an item with two paragraphs was offered the as-it-looks editor');
  });

  // The other way that same empty-looking quote can be written over: the plus in the margin writes its block onto the line it is offered on, which is a delete rather than an edit. Clicking it still opens it.
  check('the plus is not offered on a quote a footnote was lifted out of', () => {
    const quote = (holds) => ({ tagName: 'BLOCKQUOTE', dataset: holds ? { holdsFootnote: 'true' } : {}, textContent: '', querySelector: () => null });
    if (!booted.blockAcceptsInsert(quote(false))) throw new Error('the plus stopped being offered on an empty line');
    if (booted.blockAcceptsInsert(quote(true))) throw new Error("pressing the plus there would write over the footnote's line");
  });

  // ---- a checkbox is armed against the document the reader is looking at ------
  //
  // A checkbox is bound by position: the page counts the boxes in the drawn document, pairs them one for one against the task list the front tab answered, and sends the Nth box's index back. So the binding is only right while exactly one drawn document stands inside the reader — and nothing in the page says so. Four elements wear `.document-body`, three of them outside the reader, and a table opened full-window builds a fourth inside it. That one lands after the drawn document, so the first is still the reader's own; it is right by the order of two appends and by nothing else. Get that order wrong and a tick is written into a file nobody was looking at, silently, because the count guard passes whenever the two documents hold the same number of tasks.
  check('the boxes a press arms are the drawn document inside the reader, not a second one standing beside it', () => {
    const appEl = booted.document.getElementById('app');
    const drawn = (count) => {
      const body = fakeElement('');
      body.className = 'document-body';
      const boxes = [];
      for (let at = 0; at < count; at += 1) {
        const box = fakeElement('');
        box.tagName = 'INPUT';
        box.setAttribute('type', 'checkbox');
        body.appendChild(box);
        boxes.push(box);
      }
      return { body, boxes };
    };
    const armed = (boxes) => boxes.map((box) => box.dataset.taskIndex);
    const press = (box) => (box.listeners.get('change') || []).forEach((handler) => handler({}));

    const reader = drawn(3);
    const table = drawn(3);
    const wasSend = booted.ipc.postMessage;
    const sent = [];
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      appEl.appendChild(reader.body);
      booted.bindTaskCheckboxes(['one', 'two', 'three']);
      if (armed(reader.boxes).join(',') !== '0,1,2') throw new Error(`the drawn document's boxes were armed as ${JSON.stringify(armed(reader.boxes))}`);
      // And the index a press sends is the box's own place in that document, which is what the host writes into the front tab.
      press(reader.boxes[1]);
      if (sent.length !== 1 || sent[0].command !== 'toggleTask' || sent[0].index !== 1) throw new Error(`pressing the second box sent ${JSON.stringify(sent)}`);
      if (typeof sent[0].token !== 'number') throw new Error(`a press sent no token, so nothing can tell the box its tick is standing on air: ${JSON.stringify(sent[0])}`);

      // A table opened full-window stands a second element of the same name inside the reader, appended after the document. Binding again must still take the first.
      appEl.appendChild(table.body);
      for (const box of [...reader.boxes, ...table.boxes]) delete box.dataset.taskIndex;
      booted.bindTaskCheckboxes(['one', 'two', 'three']);
      if (armed(reader.boxes).join(',') !== '0,1,2') throw new Error(`with a table standing beside it the drawn document's boxes were armed as ${JSON.stringify(armed(reader.boxes))}`);
      if (armed(table.boxes).some((index) => index !== undefined)) throw new Error(`the full-window table's own boxes were armed as ${JSON.stringify(armed(table.boxes))}`);
      // The second bind wired the same boxes a second time, so a press now sends twice — the index each time is still the reader's own.
      sent.length = 0;
      press(reader.boxes[2]);
      if (sent.some((message) => message.index !== 2)) throw new Error(`a press after the second bind sent ${JSON.stringify(sent)}`);
      // The table's boxes send nothing at all: this path never reached them, so nothing is standing between its clicks and the reader's task list.
      sent.length = 0;
      press(table.boxes[0]);
      if (sent.length) throw new Error(`a box inside the full-window table sent ${JSON.stringify(sent)}`);
    } finally {
      booted.ipc.postMessage = wasSend;
      reader.body.remove();
      table.body.remove();
    }
    if (appEl.querySelector('.document-body')) throw new Error('the check left a drawn document standing in the reader');
  });

  // Encoding the whole document, slicing it either side of the edit and joining the halves back into a fresh string kills the byte cache keyed on the old string, so the next gesture wanting a slice pays a second full encode. The splice writes into the buffer the page already holds, so nothing after it encodes the document at all.
  check('a slice straight after a live splice encodes nothing', () => {
    const note = '# Notes\n\nThe first paragraph.\n\nThe second paragraph.\n';
    const at = note.indexOf('first');
    booted.window.leafBlocksResynced({ source: note });
    const encodes = () => vm.runInContext('__spliceEncodes', booted);
    const reset = () => vm.runInContext('__spliceEncodes = 0;', booted);
    vm.runInContext(
      '__realEncode = TextEncoder.prototype.encode; __spliceEncodes = 0; TextEncoder.prototype.encode = function (text) { __spliceEncodes += 1; return __realEncode.call(this, text); };',
      booted
    );
    try {
      // The document goes on the page as the string the host handed over, so the first ask for bytes is the one encode of it this whole run is allowed.
      booted.sliceSourceBytes(0, 7);
      if (encodes() !== 1) throw new Error(`the first slice encoded ${encodes()} times`);

      // Six pauses in a row. Each encodes what was typed and nothing else — twelve would mean the document itself went through the encoder again.
      reset();
      for (let round = 0; round < 6; round += 1) booted.spliceDocumentSource(at, at + 5, 'first');
      if (encodes() !== 6) throw new Error(`six splices encoded ${encodes()} times, so one of them encoded the whole document`);
      if (booted.documentSourceLength() !== new TextEncoder().encode(note).length) {
        throw new Error(`the document is ${booted.documentSourceLength()} bytes after six splices that replaced a word with itself`);
      }

      // And the slice after them — the click into another block — encodes nothing at all.
      reset();
      const read = booted.sliceSourceBytes(at, at + 5);
      if (read !== 'first') throw new Error(`the slice after the splices read ${JSON.stringify(read)}`);
      if (encodes() !== 0) throw new Error(`a slice straight after a splice encoded ${encodes()} times`);
    } finally {
      vm.runInContext('TextEncoder.prototype.encode = __realEncode;', booted);
      booted.window.leafBlocksResynced({ source: '' });
    }
  });

  // A drawn range read straight off `dataset` reads the stale mark the element wears and splices the wrong bytes into somebody's file, because the numbers live in the page's own table. So there is one door, `rangeOf`/`hasRangeOf`/`setRangeOf` in `shell/reading-blocks.js`, and this refuses every other way in. The presence tests are untouched on purpose: `closest('[data-src-start]')` asks whether an element can be typed on at all, which is a different question, and the attribute is staying to answer it.
  check('nothing reads a drawn range off the DOM but the one door', () => {
    const door = 'reading-blocks.js';
    const spelled = /\.dataset\s*\.\s*(srcStart|srcEnd|cellStart|cellEnd|valueStart|valueEnd)\b/;
    const computed = /\.dataset\s*\[/;
    const folder = join(root, 'src/assets/shell');
    const fragments = readdirSync(folder).filter((file) => file.endsWith('.js'));
    if (fragments.length < 30) throw new Error(`only ${fragments.length} fragments were read out of ${folder}`);
    const raw = [];
    for (const file of fragments) {
      readFileSync(join(folder, file), 'utf8').split('\n').forEach((line, at) => {
        if (spelled.test(line)) raw.push(`${file}:${at + 1} ${line.trim()}`);
        // The door reaches its own names through the table, which is the one computed read the page is allowed.
        else if (file !== door && computed.test(line)) raw.push(`${file}:${at + 1} ${line.trim()}`);
      });
    }
    if (raw.length) throw new Error(`a drawn range is read off the DOM outside the door: ${raw.join(' | ')}`);
    // And the door itself is where the numbers can be moved to, so it has to be there to move them.
    const doorSource = readFileSync(join(folder, door), 'utf8');
    for (const name of ['function rangeOf(', 'function hasRangeOf(', 'function setRangeOf(']) {
      if (!doorSource.includes(name)) throw new Error(`${door} no longer holds ${name.replace('function ', '').replace('(', '')}`);
    }
  });

  // The offsets a splice arrives with are the host's, and a map that drifted hands over one the buffer no longer has. The door clamps rather than writing off the end, because a splice at an offset the document does not reach writes the wrong bytes into somebody's file.
  check('a splice at an offset the document does not reach is clamped to its end', () => {
    const was = booted.sliceSourceBytes(0, booted.documentSourceLength());
    try {
      booted.setDocumentSource('One.\n');
      booted.spliceDocumentSource(400, 900, ' Two.');
      if (booted.sliceSourceBytes(0, booted.documentSourceLength()) !== 'One.\n Two.') {
        throw new Error(`a splice past the end wrote ${JSON.stringify(booted.sliceSourceBytes(0, booted.documentSourceLength()))}`);
      }
      // Backwards, which is the other way a drifted map arrives: the end is pulled up to the start, so it writes what was typed in and takes nothing away.
      booted.setDocumentSource('One.\n');
      booted.spliceDocumentSource(4, 0, 'Two.');
      if (booted.sliceSourceBytes(0, booted.documentSourceLength()) !== 'One.Two.\n') {
        throw new Error(`a backwards splice wrote ${JSON.stringify(booted.sliceSourceBytes(0, booted.documentSourceLength()))}`);
      }
      // A document that is not a string at all is an empty one, not a throw as the page binds.
      booted.setDocumentSource(null);
      if (booted.documentSourceLength() !== 0) throw new Error('a document that is not a string came back with a length');
    } finally {
      booted.setDocumentSource(was);
    }
  });

  // The page holds the open document once, as bytes behind one door, so a fragment that reaches the held buffer by name or asks the page for the whole document as a string is a second copy on its way back.
  check('nothing reaches the open document but the one door', () => {
    const door = 'reading-blocks.js';
    const held = /\b(heldSourceBytes|heldSourceText|currentDocumentSource)\b/;
    const folder = join(root, 'src/assets/shell');
    const fragments = readdirSync(folder).filter((file) => file.endsWith('.js'));
    if (fragments.length < 30) throw new Error(`only ${fragments.length} fragments were read out of ${folder}`);
    const raw = [];
    for (const file of fragments) {
      if (file === door) continue;
      readFileSync(join(folder, file), 'utf8').split('\n').forEach((line, at) => {
        if (held.test(line)) raw.push(`${file}:${at + 1} ${line.trim()}`);
      });
    }
    if (raw.length) throw new Error(`the open document is reached outside the door: ${raw.join(' | ')}`);
    // And the door itself is where it is held, so it has to be there to hold it.
    const doorSource = readFileSync(join(folder, door), 'utf8');
    for (const name of ['function setDocumentSource(', 'function documentSourceBytes(', 'function documentSourceLength(', 'function spliceDocumentSource(', 'function sliceSourceBytes(']) {
      if (!doorSource.includes(name)) throw new Error(`${door} no longer holds ${name.replace('function ', '').replace('(', '')}`);
    }
    // Nothing hands the whole document back as a string: a reader that wants text asks for the range it wants.
    if (/function documentSourceText\s*\(/.test(doorSource)) throw new Error('the door hands the whole document back as a string again');
  });

  // The door answers the numbers the element is actually wearing, under each of the three names — a block's, a cell of a table's, and a value an element keeps inside its own tag. Nothing on the page wears two, so asking one thing for another kind's range has to come back empty rather than borrowing the pair beside it.
  check('the door answers the range each kind of thing wears, and no other', () => {
    const { rangeOf, hasRangeOf, setRangeOf } = booted;
    const wearing = (attribute, start, end) => {
      const el = fakeElement('');
      el.setAttribute(attribute, String(start));
      el.setAttribute(attribute.replace('-start', '-end'), String(end));
      return el;
    };
    const kinds = [
      { kind: 'block', attribute: 'data-src-start', start: 149, end: 267 },
      { kind: 'cell', attribute: 'data-cell-start', start: 12, end: 40 },
      { kind: 'value', attribute: 'data-value-start', start: 55, end: 61 },
    ];
    for (const { kind, attribute, start, end } of kinds) {
      const el = wearing(attribute, start, end);
      const read = rangeOf(el, kind);
      if (read.start !== start || read.end !== end) throw new Error(`the door read a ${kind} as ${JSON.stringify(read)} where the element wears ${start}..${end}`);
      if (!hasRangeOf(el, kind)) throw new Error(`the door says a ${kind} wearing ${start}..${end} carries no range`);
      // Every other kind comes back empty: a cell must never answer to a block's names, or a splice would move the table around it.
      for (const other of kinds) {
        if (other.kind === kind) continue;
        if (hasRangeOf(el, other.kind)) throw new Error(`a ${kind} answered to a ${other.kind}'s names`);
        if (Number.isFinite(rangeOf(el, other.kind).start)) throw new Error(`a ${kind} handed back a ${other.kind}'s start`);
      }
      // A write goes into the table, and the element is left wearing a mark rather than an offset — so it can still be found by the attribute and nothing can read a number off it.
      setRangeOf(el, kind, start + 7, end + 7);
      const moved = rangeOf(el, kind);
      if (moved.start !== start + 7 || moved.end !== end + 7) throw new Error(`the door read a moved ${kind} as ${JSON.stringify(moved)}`);
      if (el.getAttribute(attribute) == null) throw new Error(`a ${kind} lost the attribute the page asks it whether it can be typed on by`);
      if (Number.isFinite(Number(el.getAttribute(attribute)))) throw new Error(`a ${kind} still wears ${el.getAttribute(attribute)} on the page, which a read that got past the check could splice at`);
    }
    // Nothing wearing a range at all, and an element that is not one: both answer nothing rather than throwing, because the gutter asks this of whatever is under the pointer.
    const bare = fakeElement('');
    if (hasRangeOf(bare, 'block') || Number.isFinite(rangeOf(bare, 'block').start)) throw new Error('an element wearing no range was given one');
    if (hasRangeOf(null, 'block') || Number.isFinite(rangeOf(null, 'block').start)) throw new Error('nothing at all was given a range');
    if (Number.isFinite(rangeOf(bare, 'nothing-of-that-name').start)) throw new Error('a kind with no names of its own was given a range');
  });

  // ---- the numbers live in a table, and a splice moves that ---------------------
  //
  // The page a splice has to be right on: the blocks are drawn in an order that is not their order in the file. A footnote definition is written in the middle and drawn at the foot — `relocate_footnote_definition_blocks` does that on purpose — so anything that walked from the caret to the end of the drawn page would move a range written above the splice and miss two written below it, and that is a splice at the wrong offset in somebody's file. The stand is the ticket's own watched page: drawn at 0, 25, 149, 267, 84, 202.
  const outOfOrderPage = () => {
    const body = fakeElement('');
    body.className = 'document-body';
    const drawn = [
      ['heading', 0, 7],
      ['paragraph', 25, 45],
      ['paragraph', 149, 164],
      ['paragraph', 267, 282],
      ['footnote_definition', 84, 106],
      ['footnote_definition', 202, 224],
    ];
    const blocks = drawn.map(([kind, start, end]) => {
      const el = fakeElement('');
      el.dataset.blockKind = kind;
      el.setAttribute('data-src-start', String(start));
      el.setAttribute('data-src-end', String(end));
      body.appendChild(el);
      return el;
    });
    return { body, blocks, drawn };
  };

  // Stand the page in the reader for as long as `run` takes, so the shift finds it the way it finds a real one.
  const standingIn = (body, run) => {
    const appEl = booted.document.getElementById('app');
    const wasQuery = appEl.querySelector;
    appEl.querySelector = (selector) => (selector === '.document-body' ? body : wasQuery.call(appEl, selector));
    try {
      return run();
    } finally {
      appEl.querySelector = wasQuery;
    }
  };

  check('a splice moves every range below it and none above it, on a page drawn out of its own order', () => {
    const { body, blocks, drawn } = outOfOrderPage();
    booted.resetDrawnRanges();
    standingIn(body, () => {
      booted.adoptDrawnRanges(body);
      // Typing in the block at 149 that grew it by five.
      booted.shiftBlockRangesAfter(164, 5);
    });
    blocks.forEach((el, at) => {
      const [kind, start, end] = drawn[at];
      const want = { start: start >= 164 ? start + 5 : start, end: end >= 164 ? end + 5 : end };
      const read = booted.rangeOf(el, 'block');
      if (read.start !== want.start || read.end !== want.end) {
        throw new Error(`the ${kind} drawn ${at + 1}st at [${start},${end}) reads ${JSON.stringify(read)} rather than ${JSON.stringify(want)}`);
      }
      // And nothing on the page is left wearing an offset a read that got past the check could splice at.
      if (Number.isFinite(Number(el.getAttribute('data-src-start')))) {
        throw new Error(`the ${kind} drawn ${at + 1}st still wears ${el.getAttribute('data-src-start')} on the page`);
      }
    });
  });

  // The direction the drawn order gets wrong both ways round. A splice inside the definition written at 84 has two paragraphs below it in the file — 149 and 267 — that are drawn above it, and they have to move; and the paragraphs at 0 and 25 are written above the splice and have to stay, whichever side of it they are drawn on.
  check('a splice inside a footnote definition leaves what is written before it exactly where it was', () => {
    const { body, blocks, drawn } = outOfOrderPage();
    booted.resetDrawnRanges();
    standingIn(body, () => {
      booted.adoptDrawnRanges(body);
      // Typing inside the definition drawn at the foot and written at 84, which grew it by four.
      booted.shiftBlockRangesAfter(100, 4);
    });
    const read = blocks.map((el) => booted.rangeOf(el, 'block'));
    const want = drawn.map(([, start, end]) => ({ start: start >= 100 ? start + 4 : start, end: end >= 100 ? end + 4 : end }));
    for (let at = 0; at < read.length; at += 1) {
      if (read[at].start !== want[at].start || read[at].end !== want[at].end) {
        throw new Error(`the block drawn ${at + 1}st reads ${JSON.stringify(read[at])} rather than ${JSON.stringify(want[at])}`);
      }
    }
    // Said plainly, because it is the whole reason a shift cannot walk from the caret to the foot of the drawn page: the two paragraphs written below the definition are drawn above it and still moved, and the two written above it did not.
    if (read[2].start !== 153 || read[3].start !== 271) throw new Error('a paragraph written below the definition and drawn above it was left behind');
    if (read[0].start !== 0 || read[1].start !== 25) throw new Error('a paragraph written above the splice was moved');
    if (read[4].start !== 84 || read[4].end !== 110) throw new Error(`the definition typed in reads ${JSON.stringify(read[4])} rather than [84,110)`);
  });

  // The caret carried across a re-render comes back by a lookup in the table: the element wears a mark rather than a number, so there is no `[data-src-start="123"]` on the page to match against. This is the one place that finds an element by its number rather than the other way round.
  check('the caret carried across a re-render lands on the block the number names', () => {
    const { body, blocks } = outOfOrderPage();
    booted.resetDrawnRanges();
    const landed = blocks[3];
    for (const el of blocks) el.classList.add('leaf-editable');
    standingIn(body, () => {
      booted.adoptDrawnRanges(body);
      booted.setPendingCaret({ srcStart: 267, textOffset: 3 });
      booted.placePendingCaret(body);
    });
    if (landed.getAttribute('contenteditable') !== 'true') {
      const opened = blocks.filter((el) => el.getAttribute('contenteditable') === 'true');
      throw new Error(`the caret opened ${opened.length} blocks, and the one written at 267 was not among them`);
    }
    for (const el of blocks) {
      if (el !== landed && el.getAttribute('contenteditable') === 'true') throw new Error('the caret opened a second block as well');
    }
    // A number no block is at opens nothing rather than the first block on the page.
    booted.resetDrawnRanges();
    const second = outOfOrderPage();
    standingIn(second.body, () => {
      booted.adoptDrawnRanges(second.body);
      booted.setPendingCaret({ srcStart: 9999 });
      booted.placePendingCaret(second.body);
    });
    if (second.blocks.some((el) => el.getAttribute('contenteditable') === 'true')) throw new Error('a caret at an offset no block holds opened one anyway');
  });

  // The table is one document's. A render draws the page whole, so a document the reader has moved on from has to drop out of it — otherwise the page holds every element of every document opened in the session, and a number looked up in it could still find one nobody can see.
  check('a document the reader has moved on from stops being held', () => {
    const { context } = bootReading({ path: 'C:\Notes\first.md' });
    const appEl = context.document.getElementById('app');
    // A document drawn the way a renderer draws one, with both ends of every range stamped.
    const drawTwoBlocks = (path, at) => {
      const title = path.split(/[\/]/).pop().replace(/\.[^.]+$/, '');
      const html = `<div class="document-body"><p data-src-start="${at}" data-src-end="${at + 7}">One</p><p data-src-start="${at + 9}" data-src-end="${at + 16}">Two</p></div>`;
      context.window.leafSetState({
        recent: [],
        favorites: [],
        tabs: [{ title, path }],
        active: 0,
        document: { title, path, html, has_visible_content: true, format: 'Markdown', blocks: [], tasks: [], source: 'x'.repeat(at + 16) },
      });
      return appEl.querySelector('.document-body').children;
    };

    const [first] = drawTwoBlocks('C:\Notes\first.md', 0);
    if (context.rangeOf(first, 'block').start !== 0) throw new Error('the first document was not taken into the table at all, so this proves nothing');
    if (Number.isFinite(Number(first.getAttribute('data-src-start')))) throw new Error('the render left the number on the element, so the table is not what the door is reading');

    const [standing] = drawTwoBlocks('C:\Notes\second.md', 12);
    const read = context.rangeOf(first, 'block');
    if (Number.isFinite(read.start) || Number.isFinite(read.end)) {
      throw new Error(`a block of the document that was closed still reads ${JSON.stringify(read)}`);
    }
    // And the page drawn now is in the table, so the reset did not take the live one with it.
    if (context.rangeOf(standing, 'block').start !== 12) throw new Error('the document now on screen has no range, so the render left the page unreadable');
  });
}
