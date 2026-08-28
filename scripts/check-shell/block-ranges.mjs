// A block's own range, and typing a block in: what the page hands the host to splice into the file it will write.

import { join } from 'node:path';
import {
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
    booted.attachMarkdownBlockRanges(body, blocks, source);

    const [field, heading, paragraph] = body.children;
    if ('srcStart' in field.dataset) throw new Error('the field block took a source range, so it is being edited as Markdown');
    if (heading.dataset.srcStart !== '22' || paragraph.dataset.srcStart !== '33') throw new Error(`the ranges did not land: ${JSON.stringify([heading.dataset, paragraph.dataset])}`);
    if (source.slice(Number(paragraph.dataset.srcStart), Number(paragraph.dataset.srcEnd)) !== 'A paragraph.') throw new Error('the paragraph range does not slice back to the paragraph');
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
    booted.attachMarkdownBlockRanges(body, paragraphs, source);
    const [before, after] = body.children;
    if (source.slice(Number(before.dataset.srcStart), Number(before.dataset.srcEnd)) !== 'Before.') throw new Error('the first paragraph range does not slice back to it');
    if (source.slice(Number(after.dataset.srcStart), Number(after.dataset.srcEnd)) !== 'After.') throw new Error('the second paragraph range does not slice back to it');
    // The blank-page pair opens on a document with no `[data-src-start]` anywhere, which is why an unstamped note claimed to be a new one.
    if (!body.children.every((el) => 'srcStart' in el.dataset)) throw new Error('a block was left unstamped, so the page would offer the new-document lines over a note with content');

    // What the host must not send: a span for the comment, with no element to pair it with.
    const withComment = drawn();
    booted.attachMarkdownBlockRanges(withComment, [paragraphs[0], { id: 1, kind: 'html_block', start: 9, end: 24, editable: false }, { ...paragraphs[1], id: 2 }], source);
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
    booted.attachMarkdownBlockRanges(body, blocks, source);

    body.children.forEach((el, index) => {
      const [, , kind, text] = drawn[index];
      if (!('srcStart' in el.dataset)) throw new Error(`the ${kind} was left unstamped, so the note is read-only with nothing saying why`);
      const shown = source.slice(Number(el.dataset.srcStart), Number(el.dataset.srcEnd));
      if (shown !== text) throw new Error(`the ${kind} wears somebody else's bytes: ${JSON.stringify(shown)}`);
      if (el.dataset.blockKind !== kind) throw new Error(`the ${kind} is stamped as a ${el.dataset.blockKind}`);
    });
    // The last block of the file must not inherit the rule above it, since a rule is the one kind the page never opens.
    if (body.children[4].dataset.editable !== 'true') throw new Error('the last block of the file cannot be edited');
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
      booted.attachMarkdownBlockRanges(body, blocks, source);
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
    booted.attachMarkdownBlockRanges(body, [good, definition], source);
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
    booted.attachMarkdownBlockRanges(body, blocks, source);
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
}
