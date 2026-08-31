// The find bar: the pattern its toggles promise, and what it counts.

import { join } from 'node:path';
import vm from 'node:vm';
import {
  bootReading,
  check,
  record,
  registrationsOn,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // Find drives two engines from one field, and both of them can write to a file. The pattern is what decides which text is a match; the block rewrite is what turns a match on the page into bytes spliced into the buffer.
  check('the find bar builds the pattern its toggles promise', () => {
    const { findPattern, toggleFindFlag } = booted;
    const field = booted.document.getElementById('findInput');
    const matches = (query, text) => {
      field.value = query;
      const pattern = findPattern(true);
      return !!pattern && pattern.test(text);
    };

    // A plain query is literal text: a period finds a period.
    if (!matches('a.b', 'a.b')) throw new Error('a plain query does not find itself');
    if (!matches('a.b', 'a.b')) throw new Error('a plain query is being read as an expression');
    // And case does not matter until it is asked to.
    if (!matches('dharma', 'DHARMA')) throw new Error('find is case-sensitive by default');
    toggleFindFlag('matchCase');
    if (matches('dharma', 'DHARMA')) throw new Error('match case did not take');
    toggleFindFlag('matchCase');

    toggleFindFlag('wholeWord');
    if (matches('dharma', 'dharmakaya')) throw new Error('whole word matched inside a longer word');
    if (!matches('dharma', 'the dharma talk')) throw new Error('whole word lost a real word');
    toggleFindFlag('wholeWord');

    toggleFindFlag('regex');
    if (!matches('dhar+ma', 'dharrrma')) throw new Error('the expression toggle did not take');
    // A half-typed expression is said to be bad, not answered with silence.
    field.value = '(unclosed';
    if (findPattern(true) !== null) throw new Error('an unparseable expression was accepted');
    if (booted.findCountText() !== 'Bad expression') throw new Error('a bad expression is not named');
    toggleFindFlag('regex');
    field.value = '';
  });

  // The flattened page is a picture of the page, not of the query, so letters typed into the field walk it no times at all — and a page that did move under the bar is walked again before the next search, or a match lands on a node that is gone.
  check('six letters walk the page no times, and a redraw walks it once', () => {
    const { context } = bootReading({ path: 'C:\Notes\long.md', blocks: [{ srcStart: 0 }, { srcStart: 40 }] });
    const field = context.document.getElementById('findInput');
    const appEl = context.document.getElementById('app');
    let walks = 0;
    let words = 'a needle here and a needle there';
    // The fake page renders nothing, so the walk is stood in: one run of words, counted every time it is asked for.
    context.document.createTreeWalker = () => {
      walks += 1;
      let handed = false;
      return {
        nextNode: () => {
          if (handed) return null;
          handed = true;
          return { nodeType: 3, nodeValue: words, textContent: words };
        },
      };
    };
    const typed = () => (field.listeners.get('input') || []).forEach((handler) => handler({}));
    // `findMatches` is a `let` in the page's one scope, so it is read the way the page reads it rather than off the context object.
    const found = () => vm.runInContext('findMatches.length', context);
    const type = (word) => {
      field.value = '';
      typed();
      for (let at = 1; at <= word.length; at += 1) {
        field.value = word.slice(0, at);
        typed();
      }
    };

    // Opening the bar walks the page once, because whatever redrew while it was shut went unwatched.
    walks = 0;
    context.openFindBar();
    if (walks !== 1) throw new Error(`opening the bar walked the page ${walks} times`);
    walks = 0;
    type('needle');
    if (walks !== 0) throw new Error(`six letters walked the page ${walks} times`);
    if (found() !== 2) throw new Error(`the kept flattening found ${found()} matches`);

    // The page is redrawn under the open bar: the watcher on the reader forgets the flattening the moment it sees the change, rather than inside its deferred refresh, so a letter typed in that gap searches the page that is there rather than the one that was.
    const [watch] = registrationsOn(context.__watchers, 'MutationObserver', appEl);
    if (!watch) throw new Error('the open bar does not watch the reader for a redraw');
    // Words typed into the page are a `characterData` change and nothing else. A watch on the child list alone would leave the flattening describing a paragraph that has since been retyped, and a match's offset into a node that has grown shorter is a range the browser refuses outright.
    if (!watch.options.characterData) throw new Error('the watcher does not see words typed into the page');
    if (!watch.options.childList || !watch.options.subtree) throw new Error('the watcher does not see the page redrawn');
    words = 'one needle only';
    walks = 0;
    watch.callback([], watch);
    type('needle');
    if (walks !== 1) throw new Error(`a redrawn page walked ${walks} times over six letters`);
    if (found() !== 1) throw new Error(`the redrawn page found ${found()} matches`);

    // Mermaid swaps a diagram's source text for its drawn labels and says so at once, so the search lands on the label rather than on the node it replaced.
    words = 'needle needle needle';
    walks = 0;
    context.mermaidPageTextChanged();
    type('needle');
    if (walks !== 1) throw new Error(`a diagram's new labels walked ${walks} times over six letters`);
    if (found() !== 3) throw new Error(`the drawn labels found ${found()} matches`);

    // The query and the toggles decide what counts as a match rather than what the page says, so each still recomputes the list — off the one flattening, without walking again.
    walks = 0;
    field.value = 'NEEDLE';
    typed();
    if (found() !== 3) throw new Error('a case-blind query lost its matches');
    context.toggleFindFlag('matchCase');
    if (found() !== 0) throw new Error('match case did not recompute the list');
    context.toggleFindFlag('matchCase');
    field.value = 'need';
    typed();
    if (found() !== 3) throw new Error('a shorter query lost its matches');
    context.toggleFindFlag('wholeWord');
    if (found() !== 0) throw new Error('whole word did not recompute the list');
    context.toggleFindFlag('wholeWord');
    if (walks !== 0) throw new Error(`the query and the toggles walked the page ${walks} times`);
    context.closeFindBar();
  });

  check('a replace in the reading view rewrites the block, or refuses it whole', () => {
    const { findRewriteBlock, toggleFindFlag } = booted;
    const field = booted.document.getElementById('findInput');
    const source = '# Notes\n\nThe dharma talk, and the dharma book.\n';
    booted.window.leafBlocksResynced({ source });
    // The paragraph's own byte range, as the reading view stamps it on the block.
    const start = source.indexOf('The');
    const end = source.length - 1;
    field.value = 'dharma';

    // Both occurrences the page found in this block.
    const both = findRewriteBlock({ start, end, ranks: [0, 1], total: 2 }, 'sutra');
    if (both !== 'The sutra talk, and the sutra book.') throw new Error(`replace all rewrote: ${both}`);
    // Only the one the cursor is on.
    const second = findRewriteBlock({ start, end, ranks: [1], total: 2 }, 'sutra');
    if (second !== 'The dharma talk, and the sutra book.') throw new Error(`one replace rewrote: ${second}`);
    // The page shows a match the block's source does not hold in one piece — formatting split it — so nothing is spliced rather than the wrong thing.
    if (findRewriteBlock({ start, end, ranks: [0], total: 3 }, 'sutra') !== null) {
      throw new Error('a match split by formatting was replaced anyway');
    }
    toggleFindFlag('regex');
    field.value = '(unclosed';
    if (findRewriteBlock({ start, end, ranks: [0], total: 1 }, 'sutra') !== null) {
      throw new Error('a bad expression was allowed to rewrite a block');
    }
    toggleFindFlag('regex');
    field.value = '';
  });

  // Every caller slices the one document, so the helper keeps the bytes of the source it was last handed. A block rewrite that encoded the whole file again per slice made replace-all cost the document once per match rather than once.
  check('one source is encoded once however many blocks are rewritten', () => {
    const { findRewriteBlock, sliceSourceBytes } = booted;
    const field = booted.document.getElementById('findInput');
    field.value = 'dharma';
    const encodes = () => vm.runInContext('__encodeCalls', booted);
    const reset = () => vm.runInContext('__encodeCalls = 0', booted);
    vm.runInContext(
      '__realEncode = TextEncoder.prototype.encode; __encodeCalls = 0; TextEncoder.prototype.encode = function (text) { __encodeCalls += 1; return __realEncode.call(this, text); };',
      booted
    );
    try {
      const first = '# Notes\n\nThe dharma talk, and the dharma book.\n';
      booted.window.leafBlocksResynced({ source: first });
      const group = { start: first.indexOf('The'), end: first.length - 1, ranks: [0, 1], total: 2 };
      reset();
      for (let round = 0; round < 20; round += 1) findRewriteBlock(group, 'sutra');
      if (encodes() !== 1) throw new Error(`twenty rewrites of one source encoded it ${encodes()} times`);

      // A second source is encoded once more and answers out of its own bytes. Its heading carries an o-umlaut, so the paragraph starts one byte later than it starts characters — the reading that goes wrong first if the cache ever hands back the source before it.
      const second = '# Nötes\n\nThe dharma talk, and the dharma book.\n';
      booted.window.leafBlocksResynced({ source: second });
      const bytes = new TextEncoder();
      const at = bytes.encode(second.slice(0, second.indexOf('The'))).length;
      const to = bytes.encode(second).length - 1;
      if (at !== second.indexOf('The') + 1) throw new Error('the second source does not push the block off its character offset');
      reset();
      const rewritten = findRewriteBlock({ start: at, end: to, ranks: [0, 1], total: 2 }, 'sutra');
      if (encodes() !== 1) throw new Error(`a source the helper had not seen encoded ${encodes()} times`);
      if (rewritten !== 'The sutra talk, and the sutra book.') throw new Error(`the second source rewrote: ${rewritten}`);

      // And the first source is a fresh one again, because only the last is kept.
      reset();
      if (sliceSourceBytes(first, group.start, group.end) !== 'The dharma talk, and the dharma book.') {
        throw new Error('the first source came back wrong after a second one');
      }
      if (encodes() !== 1) throw new Error(`going back to the first source encoded ${encodes()} times`);

      // An empty source is still an empty answer rather than a throw, which is what every caller with no document open hands in.
      reset();
      if (sliceSourceBytes('', 0, 0) !== '') throw new Error('an empty source did not slice to nothing');
      if (sliceSourceBytes(null, 0, 4) !== '') throw new Error('a missing source did not slice to nothing');
    } finally {
      vm.runInContext('TextEncoder.prototype.encode = __realEncode;', booted);
      field.value = '';
    }
  });

  check('a locked view finds and refuses to replace', () => {
    const { replaceInReading, replaceInSource } = booted;
    const posted = [];
    const growls = [];
    booted.ipc = { postMessage: (message) => posted.push(message) };
    booted.leafToast = (message) => growls.push(message);

    // Both padlocks are down on a fresh page: the refusal is a growl saying so, and nothing is written.
    replaceInReading(false);
    replaceInSource(true);
    if (growls.length !== 2) throw new Error(`a locked view said: ${JSON.stringify(growls)}`);
    if (!growls.every((growl) => growl.includes('padlock'))) {
      throw new Error(`a refusal did not name the padlock: ${JSON.stringify(growls)}`);
    }
    if (posted.some((message) => message.includes('editBlock'))) {
      throw new Error(`a locked view wrote: ${posted.join(', ')}`);
    }

    // Unlocked, the same calls fall through to "there is nothing to replace" and say nothing — which is what proves the padlock is what refused above.
    growls.length = 0;
    booted.setReadingUnlocked(true);
    booted.setCodeUnlocked(true);
    replaceInReading(false);
    replaceInSource(true);
    if (growls.length) throw new Error(`an unlocked view still refused: ${JSON.stringify(growls)}`);
    booted.setReadingUnlocked(false);
    booted.setCodeUnlocked(false);
  });

  // The replace goes through and one match is left behind, so the growl says which, and one left behind reads "1 match is" rather than "1 matches are".
  check('a replace that left matches behind counts them in the singular and the plural', () => {
    const growls = [];
    const wasToast = booted.leafToast;
    const wasSend = booted.ipc;
    booted.leafToast = (message) => growls.push(message);
    booted.ipc = { postMessage: () => {} };
    booted.setReadingUnlocked(true);
    booted.window.leafBlocksResynced({ source: 'The dharma talk.\n' });
    try {
      // The blocks and the rewrite stand in, so the growl under test is the shipped sentence rather than a copy of it.
      vm.runInContext('__wasGroups = findRenderedGroups; __wasRewrite = findRewriteBlock;', booted);
      const refusing = (left) => {
        growls.length = 0;
        booted.__left = left;
        vm.runInContext(
          `currentDocumentFormat = 'markdown';
           findMatches = [{}];
           findCurrent = 0;
           findRenderedGroups = () => [{ start: 0, end: 4, ranks: [0] }, { start: 4, end: 8, ranks: new Array(__left).fill(0) }];
           findRewriteBlock = (group) => (group.start === 0 ? 'Kept' : null);
           replaceInReading(true);`,
          booted
        );
        return growls.join(' | ');
      };
      if (!refusing(1).includes('1 match is split by formatting')) throw new Error(`one left behind said: ${refusing(1)}`);
      if (!refusing(2).includes('2 matches are split by formatting')) throw new Error(`two left behind said: ${refusing(2)}`);
    } finally {
      vm.runInContext('findRenderedGroups = __wasGroups; findRewriteBlock = __wasRewrite; findMatches = []; findCurrent = -1;', booted);
      delete booted.__left;
      booted.setReadingUnlocked(false);
      booted.leafToast = wasToast;
      booted.ipc = wasSend;
    }
  });

  // Carets in a read-only editor are a set of cursors every keystroke then growls at, so the button asks the padlock before it places any. And the modifier that adds one by hand is ours, not the editor's default Alt — Alt is the menu key here.
  check('a cursor on every match asks the padlock first, and Ctrl adds one by hand', () => {
    const { findSelectAllOccurrences } = booted;
    const growls = [];
    const selections = [];
    booted.leafToast = (message) => growls.push(message);
    booted.__fakeMonaco = {
      setSelections: (next) => selections.push(next),
      updateOptions: () => {},
      focus: () => {},
    };
    const range = { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 7 };
    try {
      vm.runInContext('monacoEditor = __fakeMonaco; codeViewActive = true;', booted);
      vm.runInContext('findMatches = [__fakeRange];', Object.assign(booted, { __fakeRange: range }));
      // A growl is throttled, and the locked-replace check above just spent one.
      vm.runInContext('lastLockedGrowl = 0;', booted);

      // Locked, which is how every source opens: the refusal names the padlock and no caret is placed.
      findSelectAllOccurrences();
      if (selections.length) throw new Error('a locked source was given carets');
      if (growls.length !== 1 || !growls[0].includes('padlock')) {
        throw new Error(`a locked source said: ${JSON.stringify(growls)}`);
      }

      // Unlocked, every match becomes a selection with the cursor at its end — which is what proves the padlock is what refused above.
      growls.length = 0;
      booted.setCodeUnlocked(true);
      findSelectAllOccurrences();
      if (growls.length) throw new Error(`an unlocked source still refused: ${JSON.stringify(growls)}`);
      if (selections.length !== 1 || selections[0].length !== 1) {
        throw new Error(`the button set: ${JSON.stringify(selections)}`);
      }
      const one = selections[0][0];
      if (one.selectionStartColumn !== 1 || one.positionColumn !== 7) {
        throw new Error(`the cursor is not at the end of the match: ${JSON.stringify(one)}`);
      }
    } finally {
      booted.setCodeUnlocked(false);
      vm.runInContext('monacoEditor = null; codeViewActive = false; findMatches = [];', booted);
    }

    // The editor's own default is altKey; nothing else in the app sets this, so a lost line means Ctrl-click silently goes back to placing one cursor.
    if (!source.includes("multiCursorModifier: 'ctrlCmd'")) {
      throw new Error('the code view does not ask for Ctrl or Cmd as the add-a-cursor modifier');
    }
  });
}
