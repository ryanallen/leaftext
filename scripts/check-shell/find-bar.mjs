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

  // Turning every occurrence in the whole document into a DOM range to ask where it sits is work the 999 cap cannot bound, because a candidate the selection rejects never counts toward it. The flattening already knows where each piece of text starts, so the selection is a pair of numbers and a candidate is a comparison.
  check('a find narrowed to a selection compares places, and falls back to ranges only where it cannot', () => {
    const { context } = bootReading({ path: 'C:\Notes\scope.md', blocks: [{ srcStart: 0 }] });
    const field = context.document.getElementById('findInput');
    const pieces = ['alpha needle one ', 'beta needle two ', 'gamma needle three'];
    const nodes = pieces.map((text) => ({ nodeType: 3, nodeValue: text, textContent: text }));
    const starts = [];
    pieces.reduce((at, text) => (starts.push(at), at + text.length), 0);
    context.document.createTreeWalker = () => {
      let at = 0;
      return { nextNode: () => (at < nodes.length ? nodes[at++] : null) };
    };
    // Every range the page builds, counted: this is the number the whole phase is about.
    let ranges = 0;
    context.document.createRange = () => {
      ranges += 1;
      const range = {
        startContainer: null,
        startOffset: 0,
        endContainer: null,
        endOffset: 0,
        setStart(node, offset) {
          range.startContainer = node;
          range.startOffset = offset;
        },
        setEnd(node, offset) {
          range.endContainer = node;
          range.endOffset = offset;
        },
      };
      return range;
    };
    // The selection holds the middle piece and nothing else. Its own comparePoint is the answer the range path would have given, so both paths are asked the same question.
    const flatOf = (node, offset) => starts[nodes.indexOf(node)] + offset;
    const low = flatOf(nodes[1], 0);
    const high = flatOf(nodes[1], pieces[1].length);
    const comparePoint = (node, offset) => {
      const point = flatOf(node, offset);
      if (point < low) return -1;
      if (point > high) return 1;
      return 0;
    };
    const scoped = (range) => {
      context.__scope = range;
      vm.runInContext('findScopeRange = __scope;', context);
      ranges = 0;
      return vm.runInContext('collectRenderedMatches()', context);
    };
    const places = (found) => found.map((hit) => `${hit.start}-${hit.end}`).join(' ');

    field.value = 'needle';
    // The selection as the page usually hands it over: both ends inside one piece of text.
    const byPlace = scoped({ startContainer: nodes[1], startOffset: 0, endContainer: nodes[1], endOffset: pieces[1].length, comparePoint });
    if (ranges !== 0) throw new Error(`a narrowed search built ${ranges} ranges`);
    if (byPlace.length !== 1) throw new Error(`the selection kept ${byPlace.length} of the three matches`);

    // A selection that names a child rather than a letter: the end resolves to the first or last piece of text inside the child it points at.
    const paragraph = { nodeType: 1, childNodes: [nodes[1]] };
    const byElement = scoped({ startContainer: paragraph, startOffset: 0, endContainer: paragraph, endOffset: 1, comparePoint });
    if (ranges !== 0) throw new Error(`an element-ended selection built ${ranges} ranges`);
    if (places(byElement) !== places(byPlace)) throw new Error(`an element-ended selection found ${places(byElement)}`);

    // And a selection anchored where the flattening never walked: the bounds will not resolve, so the loop asks the DOM the way it always did and finds the same match.
    const elsewhere = { nodeType: 3, nodeValue: pieces[1] };
    const byRange = scoped({ startContainer: elsewhere, startOffset: 0, endContainer: elsewhere, endOffset: pieces[1].length, comparePoint });
    if (ranges !== nodes.length) throw new Error(`the fallback built ${ranges} ranges for ${nodes.length} candidates`);
    if (places(byRange) !== places(byPlace)) throw new Error(`the fallback found ${places(byRange)}, not ${places(byPlace)}`);

    // With no selection at all every occurrence is kept, and still no range is built to decide it.
    context.__scope = null;
    vm.runInContext('findScopeRange = __scope;', context);
    ranges = 0;
    const all = vm.runInContext('collectRenderedMatches()', context);
    if (all.length !== nodes.length) throw new Error(`an unnarrowed search found ${all.length} matches`);
    if (ranges !== 0) throw new Error(`an unnarrowed search built ${ranges} ranges`);
  });

  // Opening the bar is what takes the page's highlight away: focusing the field collapses the selection, and the toggle read the selection at the moment it was pressed — so it refused every time and no gesture in the rendered document could turn it on. The page keeps the highlight as it is made instead, and the toggle reads that.
  check('find in selection narrows to the highlight the open took away, and still refuses when there is none', () => {
    const { context } = bootReading({ path: 'C:\Notes\kept.md', blocks: [{ srcStart: 0 }] });
    const bar = context.document.getElementById('findBar');
    const field = context.document.getElementById('findInput');
    const pieces = ['alpha needle one ', 'beta needle two ', 'gamma needle three'];
    const nodes = pieces.map((text) => ({ nodeType: 3, nodeValue: text, textContent: text }));
    context.document.createTreeWalker = () => {
      let at = 0;
      return { nextNode: () => (at < nodes.length ? nodes[at++] : null) };
    };
    // A range its clones stay live to, the way a browser's is: a redraw collapses the range the page kept, and the clone the toggle takes has to see that rather than a copy of how it used to be.
    const rangeOver = (start, startOffset, end, endOffset) => {
      const range = {
        startContainer: start,
        startOffset,
        endContainer: end,
        endOffset,
        collapsed: false,
        cloneRange: () => ({
          ...range,
          get collapsed() {
            return range.collapsed;
          },
          cloneRange: range.cloneRange,
        }),
      };
      return range;
    };
    // The page's one selection, and the event the web view raises whenever it moves. Real enough to be written to, because drawing the current match is the bar putting a range into it.
    let held = [];
    const selection = {
      get rangeCount() {
        return held.length;
      },
      get isCollapsed() {
        return !held.length || !!held[0].collapsed;
      },
      getRangeAt: (at) => held[at],
      removeAllRanges() {
        held = [];
      },
      addRange(range) {
        held = [range];
      },
      toString: () => '',
    };
    context.getSelection = () => selection;
    const selectionMoved = () => (context.document.listeners.get('selectionchange') || []).forEach((handler) => handler({}));
    const kept = () => vm.runInContext('findKeptRange', context);
    const found = () => vm.runInContext('findMatches.length', context);
    const on = () => vm.runInContext('findFlags.scoped', context);
    const said = [];
    context.leafToast = (words) => said.push(words);
    const refusal = 'Select some text first, then find inside it.';
    // A find bar that really holds what is put inside it, so the caret the open leaves there is told apart from a caret in the page.
    const inTheBar = { nodeType: 1 };
    bar.contains = (node) => node === inTheBar;

    // The reader highlights the middle paragraph and presses Ctrl+F. The open focuses the field, and that collapses the page's selection into the bar — which is the whole fault, so it is played rather than described.
    const highlight = rangeOver(nodes[1], 0, nodes[1], pieces[1].length);
    held = [highlight];
    selectionMoved();
    context.openFindBar();
    const caretInBar = rangeOver(inTheBar, 0, inTheBar, 0);
    caretInBar.collapsed = true;
    held = [caretInBar];
    selectionMoved();
    if (!kept()) throw new Error('the caret the open left in the bar dropped the highlight');

    field.value = 'needle';
    context.toggleFindFlag('scoped');
    if (!on()) throw new Error(`find in selection refused after the open: ${said.join(' ')}`);
    if (found() !== 1) throw new Error(`the narrowed find counted ${found()} of the three`);

    // Where the web view has no highlight API the bar draws the current match by putting it into the page's own selection. That is a real range in the document, and the keeper has to ignore exactly it or the reader's highlight becomes whichever match they stepped onto.
    if (!vm.runInContext('findPaintedRange', context)) throw new Error('the bar drew the current match without recording what it selected');
    selectionMoved();
    if (kept().startContainer !== nodes[1]) throw new Error("the match the bar drew was taken for the reader's highlight");

    // A redraw leaves the kept range attached to the page but collapsed onto nothing, which is no selection at all — so the reader gets the growl rather than a bar answering over a range pointing nowhere.
    context.toggleFindFlag('scoped');
    highlight.collapsed = true;
    said.length = 0;
    context.toggleFindFlag('scoped');
    if (on()) throw new Error('a kept range a redraw collapsed was taken for a selection');
    if (said[0] !== refusal) throw new Error(`a collapsed kept range said: ${said.join(' ')}`);

    // And a caret the reader puts down in the page is them clearing the highlight, so the toggle refuses again.
    highlight.collapsed = false;
    held = [highlight];
    selectionMoved();
    const caret = rangeOver(nodes[0], 3, nodes[0], 3);
    caret.collapsed = true;
    held = [caret];
    selectionMoved();
    if (kept()) throw new Error('a caret put down in the page left the old highlight standing');
    said.length = 0;
    context.toggleFindFlag('scoped');
    if (on()) throw new Error('find in selection turned on with nothing highlighted');
    if (said[0] !== refusal) throw new Error(`a cleared highlight said: ${said.join(' ')}`);
    context.closeFindBar();
    // The other half of the drawing: where the web view does have the highlight API, nothing goes into the page's selection at all, so the bar must be holding no painted range — otherwise a stale one from an earlier document could swallow a real highlight that happened to sit on the same nodes.
    held = [highlight];
    selectionMoved();
    const highlights = new Map();
    context.CSS = { highlights };
    context.Highlight = function Highlight() {
      this.add = () => {};
    };
    context.openFindBar();
    context.toggleFindFlag('scoped');
    if (!on()) throw new Error('the toggle refused with the highlight API in place');
    if (vm.runInContext('findPaintedRange', context)) throw new Error('the bar held a painted range while drawing through the highlight API');
    if (!highlights.size) throw new Error('the bar drew no highlights through the API it has');
    selectionMoved();
    if (kept().startContainer !== nodes[1]) throw new Error('the highlight was dropped by a draw that never touched the selection');
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

  // Every caller slices the one open document, and the door encodes it once. A block rewrite that encoded the whole file again per slice made replace-all cost the document once per match rather than once.
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

      // And the first document handed over again is encoded once more, because the door holds the open document and nothing before it.
      booted.window.leafBlocksResynced({ source: first });
      reset();
      if (sliceSourceBytes(group.start, group.end) !== 'The dharma talk, and the dharma book.') {
        throw new Error('the first source came back wrong after a second one');
      }
      if (encodes() !== 1) throw new Error(`going back to the first source encoded ${encodes()} times`);

      // A document with nothing in it is still an empty answer rather than a throw, which is what every slice with no document open gets.
      booted.window.leafBlocksResynced({ source: '' });
      if (sliceSourceBytes(0, 0) !== '') throw new Error('an empty source did not slice to nothing');
      if (sliceSourceBytes(0, 4) !== '') throw new Error('a slice past the end of an empty source did not come back empty');
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
