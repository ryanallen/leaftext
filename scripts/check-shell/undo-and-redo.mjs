// Delete over a run of blocks, over a section, and the undo and redo behind both.

import { join } from 'node:path';
import vm from 'node:vm';
import {
  FakeElement,
  check,
  fakeElement,
  record,
  source,
  typingStand,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;
  const { withPageTimers, typedBlock, wordsFollowMarkup, typeInto, pressUndoKey, openTyping, restTyping } = typingStand(booted);

  // A selection can already cross blocks — Ctrl+A makes one — and each block is its own editing host, so the browser has no answer for Delete on it. The splice that answers it runs from the first touched block's start to the last one's end, which is the widest range anything in the reading view writes: getting it wrong takes out text nobody selected.
  check('Delete over a run of blocks keeps the two ends and nothing between them', () => {
    const { blockRunForDelete, crossBlockDeletePlan, blockMarkerOf, blockCanBeCutInHalf } = booted;

    // The run the splice is allowed to cover. Refusing leaves the key to the browser, which is the right answer for a selection inside one block.
    const block = (kind, start, end, tag) => ({
      tagName: tag || (kind === 'heading' ? 'H2' : 'P'),
      dataset: { blockKind: kind, srcStart: String(start), srcEnd: String(end) },
      childNodes: [],
      querySelector: () => null,
      parentElement: null,
      previousElementSibling: null,
      nextElementSibling: null,
    });
    const body = (...blocks) => {
      const parent = { children: blocks };
      blocks.forEach((one, index) => {
        one.parentElement = parent;
        one.previousElementSibling = blocks[index - 1] || null;
        one.nextElementSibling = blocks[index + 1] || null;
      });
      return blocks;
    };

    const [a, b, c] = body(block('paragraph', 0, 1), block('paragraph', 3, 4), block('paragraph', 6, 7));
    const run = blockRunForDelete(a, c);
    if (!run || run.elements.length !== 3) throw new Error('a run of three siblings was refused');
    if (JSON.stringify(run.ranges) !== '[[0,1],[3,4],[6,7]]') throw new Error(`the ranges came back ${JSON.stringify(run.ranges)}`);
    if (blockRunForDelete(b, b)) throw new Error('a selection inside one block should be left to the browser');
    if (blockRunForDelete(c, a)) throw new Error('a backwards run should be refused');
    // A raw-HTML wrapper nests the blocks after it, so the two ends can have different parents.
    const [nested] = body(block('paragraph', 9, 10));
    if (blockRunForDelete(a, nested)) throw new Error('two ends under different parents were spliced');
    // A range the host would refuse: the map drifted and two blocks overlap.
    const [bad, worse] = body(block('paragraph', 0, 9), block('paragraph', 4, 12));
    if (blockRunForDelete(bad, worse)) throw new Error('overlapping ranges were spliced');
    // A block that is only in the DOM has no offset to splice at.
    const [real, blank] = body(block('paragraph', 0, 1), block('paragraph', 3, 3));
    if (blockRunForDelete(real, blank)) throw new Error('a blank line was made one end of a splice');

    // Which kinds may be cut part way. Everything else the selection touches goes whole — only these two round-trip from their rendered DOM back to source.
    if (!blockCanBeCutInHalf(block('paragraph', 0, 1))) throw new Error('a paragraph cannot be cut');
    if (!blockCanBeCutInHalf(block('heading', 0, 1))) throw new Error('a heading cannot be cut');
    for (const kind of ['code_block', 'table', 'list', 'blockquote', 'html_block', 'rule']) {
      if (blockCanBeCutInHalf(block(kind, 0, 1))) throw new Error(`a ${kind} was cut in half`);
    }
    // And a paragraph the app cannot rebuild from its rendered DOM — one holding a picture — goes whole like the rest.
    const withPicture = block('paragraph', 0, 1);
    withPicture.querySelector = () => ({});
    if (blockCanBeCutInHalf(withPicture)) throw new Error('a paragraph holding a picture was cut in half');
    if (blockMarkerOf(block('heading', 0, 1, 'H3')) !== '### ') throw new Error('a heading lost its level');
    if (blockMarkerOf(block('paragraph', 0, 1)) !== '') throw new Error('a paragraph was given a marker');

    // And the splice. The source is four blocks; a selection from the middle of the first to the middle of the last has to leave one block holding both halves.
    const source = '# Title\n\nFirst paragraph.\n\n```\ncode\n```\n\nLast paragraph.\n';
    const at = (text) => source.indexOf(text);
    const half = (markdown) => ({ markdown, text: markdown.length });
    const applied = (plan) => source.slice(0, plan.start) + plan.text + source.slice(plan.end);

    const across = crossBlockDeletePlan(
      source,
      { start: at('First'), marker: '' },
      { end: source.length - 1, marker: '' },
      half('First'),
      half('paragraph.'),
    );
    if (applied(across) !== '# Title\n\nFirstparagraph.\n') {
      throw new Error(`across four blocks left ${JSON.stringify(applied(across))}`);
    }
    // The fence in the middle was never serialized — it is simply not in the replacement.
    if (applied(across).includes('```')) throw new Error('a block in the middle survived');

    // A selection ending inside the fence takes the fence whole rather than half of it: that end survives as nothing.
    const intoFence = crossBlockDeletePlan(
      source,
      { start: at('First'), marker: '' },
      { end: at('```\ncode\n```') + '```\ncode\n```'.length, marker: '' },
      half('First'),
      half(''),
    );
    if (applied(intoFence) !== '# Title\n\nFirst\n\nLast paragraph.\n') {
      throw new Error(`into a fence left ${JSON.stringify(applied(intoFence))}`);
    }

    // The joined block keeps the kind of the first block that kept any of its own text, so a heading cut part way is still a heading.
    const fromHeading = crossBlockDeletePlan(
      source,
      { start: 0, marker: '# ' },
      { end: at('First') + 'First paragraph.'.length, marker: '' },
      half('Ti'),
      half('paragraph.'),
    );
    if (applied(fromHeading) !== '# Tiparagraph.\n\n```\ncode\n```\n\nLast paragraph.\n') {
      throw new Error(`from a heading left ${JSON.stringify(applied(fromHeading))}`);
    }
    // And where the first block went whole, the last one's kind is what is left to keep — a heading's words do not come back as body text.
    const ontoHeading = crossBlockDeletePlan(
      source,
      { start: at('```'), marker: '' },
      { end: source.length - 1, marker: '## ' },
      half(''),
      half('paragraph.'),
    );
    if (applied(ontoHeading) !== '# Title\n\nFirst paragraph.\n\n## paragraph.\n') {
      throw new Error(`onto a heading left ${JSON.stringify(applied(ontoHeading))}`);
    }

    // Both ends empty: the whole run goes, and the range eats one blank line the way one emptied block does.
    const fenceEnd = at('```\ncode\n```') + '```\ncode\n```'.length;
    const whole = crossBlockDeletePlan(source, { start: at('First'), marker: '' }, { end: fenceEnd, marker: '' }, half(''), half(''));
    if (applied(whole) !== '# Title\n\nLast paragraph.\n') throw new Error(`the whole run left ${JSON.stringify(applied(whole))}`);
    if (applied(whole).includes('\n\n\n')) throw new Error('the blank lines from both sides were left stacked');
  });

  // Ctrl+A widens a step per press with the caret in a block — the block, its section, the page — and the section is what the outline draws as one part of the document. The rule has to be the predictable one: stop at the next heading whatever its size, so pressing twice never takes more than what was on screen.
  check('a section is a heading and everything under it, down to the next heading', () => {
    const { blockSectionRun, selectAllStep } = booted;
    // A document as a run of siblings, written the way the outline reads it.
    const page = (...kinds) => {
      const blocks = kinds.map((kind, index) => ({
        dataset: { blockKind: kind === 'p' ? 'paragraph' : 'heading', srcStart: String(index * 10), srcEnd: String(index * 10 + 5) },
        name: kind + index,
      }));
      const parent = { children: blocks };
      blocks.forEach((one) => { one.parentElement = parent; });
      return blocks;
    };
    const named = (run) => (run ? run.map((one) => one.name).join(' ') : null);
    const sectionOf = (blocks, index, want) => {
      const got = named(blockSectionRun(blocks[index]));
      if (got !== want) throw new Error(`the section of ${blocks[index].name} is ${got}, wanted ${want}`);
    };

    // A paragraph under an h3 under an h2: the nearest heading above it is the h3, so that is the section — the second press never reaches the h2's whole part.
    const nested = page('h2', 'p', 'h3', 'p', 'p', 'h2', 'p');
    sectionOf(nested, 3, 'h32 p3 p4');
    sectionOf(nested, 4, 'h32 p3 p4');
    // The h2 itself stops at the h3 under it and goes no further.
    sectionOf(nested, 0, 'h20 p1');
    // The last heading in the document takes everything left.
    sectionOf(nested, 5, 'h25 p6');
    sectionOf(nested, 6, 'h25 p6');
    // A document opening with body text: from the first block down to the first heading.
    const leading = page('p', 'p', 'h2', 'p');
    sectionOf(leading, 0, 'p0 p1');
    sectionOf(leading, 1, 'p0 p1');
    // A heading with nothing under it is its own section, which is what sends the second press on to the page instead.
    const lone = page('p', 'h2');
    sectionOf(lone, 1, 'h21');
    // No headings at all: the section is the whole document, so the second press and the third agree.
    sectionOf(page('p', 'p', 'p'), 1, 'p0 p1 p2');

    // Which press it is, read off what is already selected rather than counted — so moving the caret between two presses starts again, with nothing to reset.
    const step = (spans, covers, whole, want, what) => {
      const got = selectAllStep(spans, covers, whole);
      if (got !== want) throw new Error(`${what}: step ${got}, wanted ${want}`);
    };
    step(false, 0, 40, 1, 'a caret in a block'); // nothing selected: the browser takes the block
    step(false, 12, 40, 1, 'a word highlighted'); // part of it: still the browser's
    step(false, 40, 40, 2, 'the whole block'); // the block is taken, so the section is next
    step(true, 60, 40, 3, 'a selection past the block'); // the section is taken, so the page is next
    step(false, 0, 0, 2, 'an empty block'); // nothing to select, so the first press takes the section

    // And whether there is a caret in a block at all, which is what decides between stepping and the one press that takes the page. A locked document has no editing host, so it keeps the Ctrl+A it always had.
    const { caretBlockForSelectAll } = booted;
    const inApp = booted.document.getElementById('app');
    const wasContains = inApp.contains;
    inApp.contains = (node) => !!node && node.inApp === true;
    try {
      const host = (attributes, inside) => {
        const block = {
          nodeType: 1,
          dataset: attributes.editingSource ? { editingSource: 'true' } : {},
          inApp: inside !== false,
          getAttribute: (name) => (name === 'contenteditable' ? attributes.contenteditable || null : null),
        };
        block.closest = () => block;
        return block;
      };
      if (!caretBlockForSelectAll(host({ contenteditable: 'true' }))) {
        throw new Error('an unlocked block does not step');
      }
      if (caretBlockForSelectAll(host({}))) throw new Error('a locked block steps instead of taking the page');
      if (caretBlockForSelectAll(host({ contenteditable: 'true', editingSource: true }))) {
        throw new Error('a block showing its raw source lost the browser’s own select-all');
      }
      if (caretBlockForSelectAll(host({ contenteditable: 'true' }, false))) {
        throw new Error('a block outside the document was stepped through');
      }
      if (caretBlockForSelectAll({ nodeType: 1, closest: () => null, inApp: true })) {
        throw new Error('something that is not a block was read as one');
      }
    } finally {
      inApp.contains = wasContains;
    }
  });

  // Ctrl+Z inside a block is the page's press, never the web view's: the web view's own step is one letter, so a paragraph took hundreds of presses to clear. What still keeps its own undo is everything else editable — the source view and the app's own field boxes.
  check('Ctrl+Z inside a block is the page’s, and every other editable surface keeps its own', () => {
    const { nativeUndoOwnsKey } = booted;
    const inApp = booted.document.getElementById('app');
    const wasContains = inApp.contains;
    inApp.contains = () => true;
    try {
      const block = (state) => {
        const el = Object.assign(new FakeElement(), {
          nodeType: 1,
          tagName: 'P',
          dataset: { blockKind: 'paragraph', srcStart: '0', srcEnd: '5' },
          childNodes: [],
          classList: { contains: (name) => name === 'leaf-editable' },
          getAttribute: (name) => (name === 'contenteditable' ? 'true' : null),
          __editingActive: state.editing === true,
          __editBaseline: state.baseline,
        });
        el.closest = () => el;
        return el;
      };
      // Mid-typing and untouched alike: the block's own groups answer the key, and the web view never sees it.
      if (nativeUndoOwnsKey(block({ editing: true, baseline: 'something else' }))) {
        throw new Error('a block mid-typing handed the key back to the web view, one letter a press');
      }
      if (nativeUndoOwnsKey(block({ editing: true, baseline: '' }))) {
        throw new Error('a block with no keystrokes of its own still swallowed Ctrl+Z');
      }
      if (nativeUndoOwnsKey(block({ editing: false, baseline: undefined }))) {
        throw new Error('a block nobody has typed in swallowed Ctrl+Z');
      }
      // The code view is Monaco's, always.
      vm.runInContext('codeViewActive = true;', booted);
      if (!nativeUndoOwnsKey(block({ editing: false, baseline: undefined }))) {
        throw new Error('Monaco lost its own undo');
      }
      vm.runInContext('codeViewActive = false;', booted);
      // A field box sits inside no editable block, so the walk finds none and it keeps the browser's own.
      const field = Object.assign(new FakeElement(), {
        nodeType: 1,
        tagName: 'INPUT',
        closest: (selector) => (String(selector).includes('data-src-start') ? null : field),
      });
      if (!nativeUndoOwnsKey(field)) throw new Error('a field box lost its own undo');
      // Nothing editable under the key at all: the app's undo, as before.
      if (nativeUndoOwnsKey(Object.assign(new FakeElement(), { nodeType: 1, closest: () => null }))) {
        throw new Error('a press outside every field was treated as typing');
      }
    } finally {
      inApp.contains = wasContains;
      vm.runInContext('codeViewActive = false;', booted);
    }
  });

  // The whole of what was asked for: a paragraph of forty words was two hundred presses to clear, because the web view's undo steps one letter. A press takes back a word now — a group that ends at a word boundary, at a caret moved elsewhere, and (phase 2) at a pause.
  check('a press takes back a word of the typing, not a letter', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      const source = '# Title\n\nA\n';
      openTyping(source);
      const block = wordsFollowMarkup(typedBlock({ start: 9, end: 10, typed: 'A', baseline: 'A' }));
      booted.wireMarkdownEditable(block);
      booted.document.activeElement = block;
      const fire = (type, event) => {
        for (const handler of [...(block.listeners.get(type) || [])]) handler(event);
      };
      // The session opens on the click in: the block as it stands is the bottom of the list.
      block.__editingActive = false;
      fire('focusin', {});

      typeInto(block, ' one two');
      if (block.textContent !== 'A one two') throw new Error(`the block holds ${JSON.stringify(block.textContent)}`);

      // Three presses for three groups — the last word, the one before it, and the space that opened the typing. Nine keystrokes went in.
      const words = [];
      for (let press = 0; press < 3; press += 1) {
        if (!pressUndoKey(block)) throw new Error(`press ${press + 1} was handed to the web view`);
        words.push(block.textContent);
      }
      if (JSON.stringify(words) !== JSON.stringify(['A one ', 'A ', 'A'])) {
        throw new Error(`the presses walked back through ${JSON.stringify(words)}`);
      }

      // And each press put its words into the document rather than only on the page, continuing the run so the app's own stack still holds the session as one step.
      const written = posted.filter((message) => message.command === 'editBlock');
      if (!written.length) throw new Error('a press took the words off the page and left them in the document');
      // The trailing space is the serializer's to drop, exactly as it does for the pause that writes mid-typing.
      if (written[0].text !== 'A one') throw new Error(`the first press wrote ${JSON.stringify(written[0].text)}`);
      if (written.some((message) => message.live !== true)) {
        throw new Error('a press asked for a re-render under the caret');
      }
      if (written.slice(1).some((message) => message.continuing !== true)) {
        throw new Error('a press started a second undo step in the app’s own stack');
      }
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // The hand-over: a block's groups are the page's, and once they are spent the same key goes on meaning what it has always meant — one committed edit back. Swallowing it there would leave the reader pressing a key that does nothing.
  check('the last group spent hands Ctrl+Z to the app’s own undo', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      openTyping('# Title\n\nA\n');
      const block = wordsFollowMarkup(typedBlock({ start: 9, end: 10, typed: 'A', baseline: 'A' }));
      booted.wireMarkdownEditable(block);
      booted.document.activeElement = block;
      block.__editingActive = false;
      for (const handler of [...(block.listeners.get('focusin') || [])]) handler({});
      typeInto(block, ' one two');
      // Three groups: the space that opened the typing, and a word each.
      pressUndoKey(block);
      pressUndoKey(block);
      pressUndoKey(block);
      if (block.textContent !== 'A') throw new Error(`the presses left ${JSON.stringify(block.textContent)}`);
      posted.length = 0;
      withPageTimers((drain) => {
        pressUndoKey(block);
        drain();
      });
      if (!posted.some((message) => message.command === 'undoEdit')) {
        throw new Error('the press after the last group was swallowed instead of reaching the app’s undo');
      }
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // Word boundaries end most groups, and a long word typed slowly has none — so without this half a reader who stops to think mid-word gets the whole stop back in one press, or nothing until the next space.
  check('a pause in the typing ends the group too', () => {
    const wasIpc = booted.ipc;
    const wasNow = booted.typingStepNow;
    booted.ipc = { postMessage: () => {} };
    try {
      let clock = 1000;
      booted.typingStepNow = () => clock;
      const typeWithPause = () => {
        openTyping('# Title\n\nA\n');
        const block = wordsFollowMarkup(typedBlock({ start: 9, end: 10, typed: 'A', baseline: 'A' }));
        booted.wireMarkdownEditable(block);
        booted.document.activeElement = block;
        block.__editingActive = false;
        for (const handler of [...(block.listeners.get('focusin') || [])]) handler({});
        return block;
      };

      // One word, typed straight through: one press takes the whole of it back.
      let block = typeWithPause();
      typeInto(block, 'bcde');
      pressUndoKey(block);
      if (block.textContent !== 'A') throw new Error(`typed straight through, a press left ${JSON.stringify(block.textContent)}`);

      // The same word with a stop in the middle of it: two presses, one for each side of the stop.
      block = typeWithPause();
      typeInto(block, 'bc');
      clock += 2000;
      typeInto(block, 'de');
      pressUndoKey(block);
      if (block.textContent !== 'Abc') throw new Error(`after the stop, a press left ${JSON.stringify(block.textContent)}`);
      pressUndoKey(block);
      if (block.textContent !== 'A') throw new Error(`the second press left ${JSON.stringify(block.textContent)}`);
    } finally {
      booted.ipc = wasIpc;
      booted.typingStepNow = wasNow;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // Taking the key off the web view took its redo with it, and the app has none to fall back on — so without this a press too many is words nobody can get back, which is worse than the letter-at-a-time undo it replaced.
  check('a press too many walks forward again, until something new is typed', () => {
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: () => {} };
    try {
      const open = () => {
        openTyping('# Title\n\nA\n');
        const block = wordsFollowMarkup(typedBlock({ start: 9, end: 10, typed: 'A', baseline: 'A' }));
        booted.wireMarkdownEditable(block);
        booted.document.activeElement = block;
        block.__editingActive = false;
        for (const handler of [...(block.listeners.get('focusin') || [])]) handler({});
        return block;
      };
      const pressRedo = (target, how) => pressUndoKey(target, how);

      // Three back and two forward is one press from where the typing stood.
      let block = open();
      typeInto(block, ' one two');
      for (let press = 0; press < 3; press += 1) pressUndoKey(block);
      if (block.textContent !== 'A') throw new Error(`three presses left ${JSON.stringify(block.textContent)}`);
      // Both spellings of the key, so neither is left doing nothing.
      if (!pressRedo(block, { key: 'y' })) throw new Error('Ctrl+Y was handed to the web view');
      if (!pressRedo(block, { shift: true })) throw new Error('Ctrl+Shift+Z was handed to the web view');
      if (block.textContent !== 'A one ') throw new Error(`two forward left ${JSON.stringify(block.textContent)}`);
      pressRedo(block, { key: 'y' });
      if (block.textContent !== 'A one two') throw new Error('the newest words never came back');
      // Nothing ahead of the newest words: the key is quiet rather than walking off the end.
      pressRedo(block, { key: 'y' });
      if (block.textContent !== 'A one two') throw new Error('a press walked past the words that were typed');

      // Typing after a press drops what was ahead of it, the way every editor does.
      block = open();
      typeInto(block, ' one two');
      pressUndoKey(block);
      typeInto(block, ' three');
      pressRedo(block, { key: 'y' });
      if (block.textContent !== 'A one  three') {
        throw new Error(`the words a press had walked back from came back after typing: ${JSON.stringify(block.textContent)}`);
      }
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // The other half of the hand-over: with a block's own forward steps spent, both spellings of the key mean one committed edit forward. Swallowed there, a press too many is words nobody can get back.
  check('the last group spent hands Ctrl+Y and Ctrl+Shift+Z to the app’s own redo', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    const openBlock = () => {
      openTyping('# Title\n\nA\n');
      const block = wordsFollowMarkup(typedBlock({ start: 9, end: 10, typed: 'A', baseline: 'A' }));
      booted.wireMarkdownEditable(block);
      booted.document.activeElement = block;
      block.__editingActive = false;
      for (const handler of [...(block.listeners.get('focusin') || [])]) handler({});
      return block;
    };
    try {
      for (const how of [{ key: 'y' }, { shift: true }]) {
        const block = openBlock();
        // Nothing typed in it, so the block has no step of its own to walk to — and the host says a version is waiting.
        vm.runInContext("redoableByPath.set('notes.md', true);", booted);
        posted.length = 0;
        withPageTimers((drain) => {
          if (!pressUndoKey(block, how)) throw new Error(`${JSON.stringify(how)} was handed to the web view`);
          drain();
        });
        if (!posted.some((message) => message.command === 'redoEdit')) {
          throw new Error(`${JSON.stringify(how)} was swallowed instead of reaching the app’s redo`);
        }
      }

      // With a group still ahead of it the key stays the block's: the words come forward and the document's own history is left where it is.
      const block = openBlock();
      typeInto(block, ' one');
      pressUndoKey(block);
      const walkedBack = block.textContent;
      vm.runInContext("redoableByPath.set('notes.md', true);", booted);
      posted.length = 0;
      withPageTimers((drain) => {
        pressUndoKey(block, { key: 'y' });
        drain();
      });
      if (posted.some((message) => message.command === 'redoEdit')) {
        throw new Error('a block with a step ahead of it stepped the document instead of walking its own words forward');
      }
      if (block.textContent === walkedBack) throw new Error('the words never came forward');
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // A resync that moves Redo alone moves neither the dirty flag nor Undo, which is the case a bar refreshed only on dirty would miss.
  check('the Redo button follows what the host says the history holds', () => {
    try {
      openTyping('# Title\n\nA paragraph.\n');
      booted.window.leafBlocksResynced({ dirty: true, canUndo: true, canRedo: true });
      if (vm.runInContext('redoButton.hidden', booted) !== false) {
        throw new Error('an undone edit left the Redo button hidden');
      }
      booted.window.leafBlocksResynced({ dirty: true, canUndo: true, canRedo: false });
      if (vm.runInContext('redoButton.hidden', booted) !== true) {
        throw new Error('Redo was left offered with nothing to bring back');
      }
    } finally {
      restTyping();
    }
  });

  // The groups live on the block, so two blocks typed in are two lists — and a press answers the one the caret is in. A single list would take a word off a paragraph somebody stopped typing in ten minutes ago.
  check('a press takes back the block it was pressed in, and leaves the other alone', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      openTyping('# Title\n\nA\n\nB\n');
      const first = wordsFollowMarkup(typedBlock({ start: 9, end: 10, typed: 'A', baseline: 'A' }));
      const second = wordsFollowMarkup(typedBlock({ start: 12, end: 13, typed: 'B', baseline: 'B' }));
      for (const block of [first, second]) {
        booted.wireMarkdownEditable(block);
        block.__editingActive = false;
        for (const handler of [...(block.listeners.get('focusin') || [])]) handler({});
      }
      typeInto(first, ' one');
      typeInto(second, ' two');
      booted.document.activeElement = second;
      if (!pressUndoKey(second)) throw new Error('the press was handed to the web view');
      if (second.textContent !== 'B ') throw new Error(`the pressed block holds ${JSON.stringify(second.textContent)}`);
      if (first.textContent !== 'A one') throw new Error('the press reached into a block nobody was typing in');
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // A press that only rewrote the page would leave the buffer holding what the pauses spliced, so a save right after it would write the words the press removed. What a press puts back rides the live splice, which is what makes the save honest.
  check('a save right after a press writes the words the press put back', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      const source = '# Title\n\nA\n';
      openTyping(source);
      const block = wordsFollowMarkup(typedBlock({ start: 9, end: 10, typed: 'A', baseline: 'A' }));
      booted.wireMarkdownEditable(block);
      booted.document.activeElement = block;
      // The page's own map of where every block's bytes are, so the second splice writes over what the first one left rather than over what it replaced.
      const appElement = vm.runInContext('app', booted);
      const wasQuery = appElement.querySelector;
      const body = Object.assign(fakeElement('document-body'), {
        querySelectorAll: (selector) => (String(selector) === '[data-src-start]' ? [block] : []),
      });
      appElement.querySelector = (selector) => (String(selector) === '.document-body' ? body : wasQuery(selector));
      block.__editingActive = false;
      for (const handler of [...(block.listeners.get('focusin') || [])]) handler({});
      typeInto(block, ' one two');
      // The pause the typing left behind, so the buffer really holds the words the press is about to take off.
      booted.sendLiveBlockEdit(block);
      pressUndoKey(block);
      posted.length = 0;
      withPageTimers((drain) => {
        booted.saveActiveDocument();
        drain();
      });
      const written = posted.filter((message) => message.command === 'editBlock');
      if (written.length && written[written.length - 1].text !== 'A one') {
        throw new Error(`the save wrote ${JSON.stringify(written[written.length - 1].text)}`);
      }
      if (vm.runInContext('currentDocumentSource', booted) !== '# Title\n\nA one\n') {
        throw new Error(`the document became ${JSON.stringify(vm.runInContext('currentDocumentSource', booted))}`);
      }
      if (!posted.some((message) => message.command === 'saveDocument')) {
        throw new Error('the save never reached the host');
      }
      appElement.querySelector = wasQuery;
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // The delete is behind the same padlock as the rest of the editing layer, and the code view has its own. Neither refusal is visible — the key just does nothing — so both are held here rather than left to be found by hand.
  check('the cross-block delete is behind the padlock and out of the code view', () => {
    const { handleBlockRunDeleteKey } = booted;
    let reads = 0;
    let prevented = 0;
    const wasSelection = booted.getSelection;
    booted.getSelection = () => {
      reads += 1;
      return null; // Past the guards, and then nothing to delete.
    };
    const press = (key) => {
      reads = 0;
      prevented = 0;
      handleBlockRunDeleteKey({ key, preventDefault: () => { prevented += 1; } });
    };
    try {
      // Locked, which is how every document opens.
      booted.setReadingUnlocked(false);
      vm.runInContext("codeViewActive = false; currentDocumentFormat = 'markdown';", booted);
      press('Delete');
      if (reads) throw new Error('a locked document read the selection');
      press('Backspace');
      if (reads) throw new Error('a locked document read the selection on Backspace');

      // Unlocked, the same press gets as far as reading the selection — which is what proves the padlock is what refused above.
      booted.setReadingUnlocked(true);
      press('Delete');
      if (reads !== 1) throw new Error('an unlocked document did not reach the selection');
      press('Backspace');
      if (reads !== 1) throw new Error('Backspace does not answer a cross-block selection');
      if (prevented) throw new Error('the browser was stopped with no run to splice');
      // No other key is this one's business.
      for (const key of ['a', 'Enter', 'ArrowLeft', 'x']) {
        press(key);
        if (reads) throw new Error(`${key} was read as a delete`);
      }

      // The code view has its own editor and its own padlock.
      vm.runInContext('codeViewActive = true;', booted);
      press('Delete');
      if (reads) throw new Error('the code view was answered by the reading view’s delete');
      vm.runInContext('codeViewActive = false;', booted);

      // And a document that is not Markdown has no block map to splice against.
      vm.runInContext("currentDocumentFormat = 'xml';", booted);
      press('Delete');
      if (reads) throw new Error('an XML document was spliced by the Markdown delete');
    } finally {
      booted.getSelection = wasSelection;
      booted.setReadingUnlocked(false);
      vm.runInContext("codeViewActive = false; currentDocumentFormat = 'markdown';", booted);
    }
  });
}
