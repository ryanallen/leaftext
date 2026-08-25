// Drawing a diagram into the page: what it costs the reader on screen, and what a failed one says.

import { join } from 'node:path';
import { check, checkSettled, fakeElement, readingCss, record, runShell, source } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // Scrolling a page of diagrams jolted the words on every drawing that landed: a block grows above the reader, everything on screen shoves down by what it gained, and the app's own re-pin ran a painted frame later. The fix is arithmetic inside the batch loop, and the whole of it is which blocks count.
  const readerStand = () => {
    const appEl = booted.document.getElementById('app');
    const wasRect = appEl.getBoundingClientRect;
    // The reader's top edge at 100: the app bar's own strip is above it and everything the reader sees is below.
    appEl.getBoundingClientRect = () => ({ left: 0, top: 100, right: 1080, bottom: 920, width: 1080, height: 820 });
    appEl.scrollTop = 4000;
    return {
      appEl,
      done: () => {
        appEl.getBoundingClientRect = wasRect;
        appEl.scrollTop = 0;
      },
    };
  };
  // A block whose bottom is at or above the top edge; `height` is read fresh, so raising it is the block growing.
  const growingBlock = (bottom, start) => {
    const block = {
      isConnected: true,
      height: start,
      getBoundingClientRect: () => ({ top: bottom - block.height, bottom, height: block.height }),
    };
    return block;
  };

  check('a diagram drawn above the reader does not shove the page', () => {
    const { mermaidBlocksAboveReader, mermaidRepayGrowthAbove } = booted;
    const stand = readerStand();
    try {
      // The measured median and the measured worst: 114px to 306px, and 261px to 1051px.
      const median = growingBlock(60, 114);
      const worst = growingBlock(40, 261);
      const above = mermaidBlocksAboveReader([median, worst]);
      if (above.length !== 2) throw new Error(`${above.length} of the two blocks above the reader were counted`);
      median.height = 306;
      worst.height = 1051;
      mermaidRepayGrowthAbove(above);
      // 4000 + (306-114) + (1051-261).
      if (Math.round(stand.appEl.scrollTop) !== 4982) {
        throw new Error(`the reader was left at ${stand.appEl.scrollTop} rather than 4982`);
      }

      // 19 of the 60 drew shorter than the box that held them, which moves the page the other way and is owed just the same.
      stand.appEl.scrollTop = 4000;
      const shrinking = growingBlock(60, 192);
      const shrank = mermaidBlocksAboveReader([shrinking]);
      shrinking.height = 105;
      mermaidRepayGrowthAbove(shrank);
      if (Math.round(stand.appEl.scrollTop) !== 3913) {
        throw new Error(`a drawing shorter than its box left the reader at ${stand.appEl.scrollTop} rather than 3913`);
      }
    } finally {
      stand.done();
    }
  });

  // A block grows downward, so one straddling the top edge grows into the room under the reader's eyes and nothing they can see moves. Paying for that would drag the diagram they are looking at up and off the window — the one case a reader would notice most.
  check('a diagram drawn below the reader’s top edge, or straddling it, moves the reader not at all', () => {
    const { mermaidBlocksAboveReader, mermaidRepayGrowthAbove } = booted;
    const stand = readerStand();
    try {
      const below = { isConnected: true, getBoundingClientRect: () => ({ top: 300, bottom: 500, height: 200 }) };
      const straddling = { isConnected: true, getBoundingClientRect: () => ({ top: 20, bottom: 300, height: 280 }) };
      const above = mermaidBlocksAboveReader([below, straddling]);
      if (above.length) throw new Error(`${above.length} block(s) were counted as above the reader`);
      mermaidRepayGrowthAbove(above);
      if (stand.appEl.scrollTop !== 4000) throw new Error(`the reader moved to ${stand.appEl.scrollTop}`);

      // The edge itself belongs to the block above it: a bottom exactly on the top edge shoves the page.
      const touching = growingBlock(100, 114);
      if (mermaidBlocksAboveReader([touching]).length !== 1) throw new Error('a block ending exactly on the top edge was not counted');
    } finally {
      stand.done();
    }
  });

  // `min-height` cannot make a block shorter than its own contents, and a waiting box's contents are the diagram's source text with the ink turned off. 19 of the 60 diagrams in the test document draw shorter than that text — worst 192px of source against a 105px drawing — so a remembered height held as a floor left those boxes 87px too tall and shoved the page anyway when the drawing landed.
  check('a remembered height shorter than the box’s own source text is taken exactly, not as a floor', () => {
    const { finishMermaidDiagram, markMermaidWait } = booted;
    const styleStand = () => ({
      removeProperty(name) {
        delete this[name === 'min-height' ? 'minHeight' : name];
      },
    });
    const block = (source, height) => ({
      dataset: {},
      style: styleStand(),
      isConnected: true,
      __mermaidSource: source,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, bottom: height, width: 400, height }),
    });

    // Drawn at 105px: that is what the memo learns.
    finishMermaidDiagram(block('flowchart TD\n  A --> B', 105));
    const waiting = block('flowchart TD\n  A --> B', 192);
    markMermaidWait(waiting, false);
    if (waiting.style.height !== '105px') throw new Error(`the box was given a height of ${waiting.style.height || 'nothing'}`);
    if (waiting.style.minHeight !== '0px') throw new Error('the stylesheet’s 88px floor was left on a box shorter than it');

    // Nothing measured at this column width: the box keeps the stylesheet's floor and its source text's height rather than another drawing's.
    const unknown = block('flowchart TD\n  C --> D', 192);
    markMermaidWait(unknown, false);
    if ('height' in unknown.style || 'minHeight' in unknown.style) {
      throw new Error('a box with no remembered height was pinned to one anyway');
    }

    // And the drawing itself is never clamped to what it measured last time.
    const drawn = block('flowchart TD\n  A --> B', 105);
    drawn.style.height = '105px';
    drawn.style.minHeight = '0px';
    finishMermaidDiagram(drawn);
    if ('height' in drawn.style || 'minHeight' in drawn.style) {
      throw new Error('a drawn diagram was left holding the height its box was given');
    }
  });

  // Every box in a document is drawn once while the window is quiet, so nothing in it resizes afterwards and a scroll to the bottom moves nothing. What decides that is one list: everything whose height has never been measured at this column width. A drawing already measured is skipped, which is what makes the pass idempotent, and a theme change or a change in the column's width re-keys the memo and so makes every diagram a candidate again without anything having to notice why.
  check('the warm pass draws only what has never been measured at this column width', () => {
    const { mermaidWarmCandidates, finishMermaidDiagram } = booted;
    const appEl = booted.document.getElementById('app');
    const wasQuery = appEl.querySelector;
    const styleStand = () => ({
      removeProperty(name) {
        delete this[name === 'min-height' ? 'minHeight' : name];
      },
    });
    const diagram = (source) => ({
      dataset: {},
      style: styleStand(),
      isConnected: true,
      __mermaidSource: source,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, bottom: 220, width: 400, height: 220 }),
    });
    // The reading column at 640px, which is where these heights are measured.
    const bodyOf = (held) => ({
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 640, bottom: 900, width: 640, height: 900 }),
      querySelectorAll: (selector) => (String(selector).includes(':not(') ? held.filter((d) => d.dataset.processed !== 'true') : held),
    });
    const stand = (held) => {
      const body = bodyOf(held);
      appEl.querySelector = (selector) => (String(selector) === '.document-body' ? body : wasQuery.call(appEl, selector));
    };

    try {
      const measured = diagram('flowchart TD\n  W1 --> W2');
      const never = diagram('flowchart TD\n  W3 --> W4');
      stand([measured, never]);
      // One of the two has been drawn and measured at this width.
      finishMermaidDiagram(measured);
      const queue = mermaidWarmCandidates();
      if (queue.length !== 1 || queue[0] !== never) {
        throw new Error(`the warm pass queued ${queue.length} of the two, and not the unmeasured one`);
      }

      // Nothing left to learn: the pass has an empty queue and draws nothing, which is why it can be scheduled after every other pass without costing anything.
      finishMermaidDiagram(never);
      if (mermaidWarmCandidates().length) throw new Error('a document whose every height is known was warmed again');

      // Past the memo's cap it empties wholesale rather than dropping the oldest, so warming a document this size is a redraw of it on every scroll. It is left exactly as it ships.
      const crowd = Array.from({ length: 201 }, (unused, at) => diagram(`flowchart TD\n  C${at} --> D`));
      stand(crowd);
      if (mermaidWarmCandidates().length) throw new Error('a document with more diagrams than the memo holds was warmed anyway');
      // One under the cap still is.
      stand(crowd.slice(0, 200));
      if (mermaidWarmCandidates().length !== 200) throw new Error('a document inside the cap was refused');
    } finally {
      appEl.querySelector = wasQuery;
    }
  });

  // Mermaid writes a whole stylesheet into every drawing it makes, scoped by that drawing's own svg id — so a document of 67 diagrams carries 67 sheets, 44 of them byte-identical, and that is what makes a settled page of drawings scroll badly. One copy per distinct sheet in the page's head, scoped by a class the drawing wears instead.
  const sheetHolder = (page = booted) => (page.document.head.children || []).find((child) => child.id === 'leaf-mermaid-sheets');
  const standInDrawing = (id, css) => {
    const worn = new Set();
    const style = {
      textContent: css,
      taken: false,
      remove() {
        this.taken = true;
      },
    };
    const svg = {
      id,
      classList: { add: (name) => worn.add(name) },
      getAttribute: (name) => (name === 'class' ? Array.from(worn).join(' ') : null),
      querySelector: (selector) => (String(selector) === 'style' && !style.taken ? style : null),
    };
    return {
      style,
      svg,
      worn: () => Array.from(worn),
      querySelector: (selector) => (String(selector) === 'svg' ? svg : null),
    };
  };
  const flowchartSheet = (id) => `#${id}{font-size:16px;}@keyframes dash{to{stroke-dashoffset:0;}}#${id} .node rect{fill:#eef;}`;

  check('two drawings of the same kind share one sheet', () => {
    const { shareMermaidSheet, forgetMermaidSheets } = booted;
    forgetMermaidSheets();
    const first = standInDrawing('mermaid-1', flowchartSheet('mermaid-1'));
    const second = standInDrawing('mermaid-2', flowchartSheet('mermaid-2'));
    shareMermaidSheet(first);
    shareMermaidSheet(second);
    const cls = first.worn().find((name) => name.startsWith('lt-mmd-'));
    if (!cls) throw new Error('the drawing wears no class naming its sheet');
    if (!second.worn().includes(cls)) throw new Error('two byte-identical sheets were given two classes');
    if (!first.style.taken || !second.style.taken) throw new Error('a drawing kept its own style element after its rules were hoisted');
    const sheet = sheetHolder();
    if (!sheet) throw new Error('nothing was written into the page');
    const scoped = sheet.textContent.split(`.${cls} .node rect`).length - 1;
    if (scoped !== 1) throw new Error(`the shared rule was written ${scoped} times`);
    if (sheet.textContent.includes('#mermaid-1')) throw new Error('the drawing’s own id was left in the shared sheet');
  });

  // A rule that names no id — an animation, and anything mermaid's themeCSS appends — has nothing to normalize out, so it would otherwise be written once per distinct sheet rather than once for the page. Kept when the theme changes, too: it carries no color.
  check('an animation a drawing shares is written once, not once per drawing', () => {
    // A page of its own, because every animation the page has ever been shown is kept for the life of it — so a run of this on a page another check has drawn into is asking whether the animation arrives at all, not whether it arrives once.
    const page = runShell(source);
    const { shareMermaidSheet, forgetMermaidSheets } = page;
    forgetMermaidSheets();
    shareMermaidSheet(standInDrawing('mermaid-3', flowchartSheet('mermaid-3')));
    // A different kind of diagram: its own sheet, the same animation inside it.
    shareMermaidSheet(standInDrawing('mermaid-4', `#mermaid-4 .pieCircle{stroke:#333;}@keyframes dash{to{stroke-dashoffset:0;}}`));
    const sheet = sheetHolder(page);
    const written = sheet.textContent.split('@keyframes dash').length - 1;
    if (written !== 1) throw new Error(`the animation was written ${written} times`);
    if (sheet.textContent.includes('@keyframes dash{to{stroke-dashoffset:0;}}#')) {
      throw new Error('the animation was left inside a sheet rather than lifted out of it');
    }
  });

  // Every rule in there paints the theme it was drawn in, so a reader trying six themes would otherwise end with six sets of rules in the page and five of them dead. The animations stay — they carry no color — and a drawing restored out of the picture memo can still put its own sheet back, which is what a theme left and come back to needs.
  check('the page-level sheet is emptied when the theme changes', () => {
    // Its own page for the same reason as the check above: what a theme change leaves behind is the animations, and a page already holding them cannot show that they were kept.
    const page = runShell(source);
    const { shareMermaidSheet, forgetMermaidSheets, ensureMermaidSheets } = page;
    forgetMermaidSheets();
    const drawing = standInDrawing('mermaid-5', flowchartSheet('mermaid-5'));
    shareMermaidSheet(drawing);
    const cls = drawing.worn().find((name) => name.startsWith('lt-mmd-'));
    const sheet = sheetHolder(page);
    forgetMermaidSheets();
    if (sheet.textContent.includes(`.${cls} .node rect`)) throw new Error('the sheets written for the theme being left were kept');
    if (!sheet.textContent.includes('@keyframes dash')) throw new Error('the animations went with them');
    // Restored from the picture memo: the drawing carries the class and no sheet of its own, so the page has to be handed its rules back.
    ensureMermaidSheets({ querySelector: (selector) => (String(selector) === 'svg' ? drawing.svg : null) });
    if (!sheet.textContent.includes(`.${cls} .node rect`)) throw new Error('a restored drawing was left with nothing painting it');
    const twice = sheet.textContent.split(`.${cls} .node rect`).length - 1;
    if (twice !== 1) throw new Error(`putting the sheet back wrote it ${twice} times`);
  });

  // Sheet first, memo second, and the memo is the picture read back off the block — so what it holds is the drawing with its own sheet gone and the shared sheet's class on it. Hoisting the other way round remembers a sheet the page had already taken away, and a drawing restored out of the memo would then paint the theme it was drawn in for ever.
  check('the drawing memo keeps the picture with its own sheet lifted out and the shared class on', () => {
    const { shareMermaidSheet, forgetMermaidSheets } = booted;
    forgetMermaidSheets();
    const block = fakeElement('memo-diagram');
    block.innerHTML = `<svg id="mermaid-9" class="flowchart"><style>${flowchartSheet('mermaid-9')}</style><g class="node"></g></svg>`;
    shareMermaidSheet(block);
    // What the memo is handed, read off the block the way the pass reads it.
    const remembered = block.innerHTML;
    const cls = String(block.querySelector('svg').getAttribute('class') || '')
      .split(/\s+/)
      .find((name) => name.startsWith('lt-mmd-'));
    if (!cls) throw new Error('the drawing wears no class naming its shared sheet');
    if (remembered !== `<svg id="mermaid-9" class="flowchart ${cls}"><g class="node"></g></svg>`) {
      throw new Error(`the memo would remember ${JSON.stringify(remembered)}`);
    }
    if (remembered.includes('<style')) throw new Error('the memo carries a sheet the page had already taken away');
  });

  // The same bargain for math: katex draws into the block by building children, and what is kept is the block read back afterwards. A second copy of the same formula is then drawn out of the memo without katex being asked at all, which is the whole point of keeping it — a page of forty identical formulas otherwise draws forty times.
  checkSettled('the math memo keeps what was drawn into the block, and a second copy is drawn out of it', async () => {
    const page = runShell(source);
    const appEl = page.document.getElementById('app');
    // Two formulas drawn, and a third copy of the first arriving after them — so what comes out of the memo is read against what was drawn.
    const holder = fakeElement('math-holder');
    holder.innerHTML = '<span class="math math-display">a^2</span><span class="math math-inline">b</span>';
    const [first, other] = holder.children;
    const drawn = [];
    // katex builds children rather than assigning a string, which is the case the memo could not read while an element answered with the string it was last given.
    page.window.katex = {
      render(text, node) {
        drawn.push(text);
        node.innerHTML = '';
        const span = page.document.createElement('span');
        span.tagName = 'SPAN';
        span.className = 'katex';
        span.append(text.toUpperCase());
        node.appendChild(span);
      },
    };
    const wasQuery = appEl.querySelectorAll;
    appEl.querySelectorAll = (selector) => (String(selector).startsWith('.math') ? holder.children.filter((node) => !node.dataset.mathRendered) : wasQuery.call(appEl, selector));
    try {
      page.renderMathElements();
      await new Promise((done) => setImmediate(done));
      await new Promise((done) => setImmediate(done));
      if (drawn.length !== 2) throw new Error(`katex was asked ${drawn.length} times for two distinct formulas`);
      if (first.innerHTML !== '<span class="katex">A^2</span>') throw new Error(`the first block holds ${JSON.stringify(first.innerHTML)}`);
      if (other.innerHTML !== '<span class="katex">B</span>') throw new Error(`the other formula holds ${JSON.stringify(other.innerHTML)}`);
      // A copy arriving later is drawn out of the memo alone, with katex never asked again.
      const later = fakeElement('');
      later.tagName = 'SPAN';
      later.className = 'math math-display';
      later.append('a^2');
      holder.appendChild(later);
      page.renderMathElements();
      if (drawn.length !== 2) throw new Error('a formula already remembered was drawn again rather than read out of the memo');
      if (later.innerHTML !== first.innerHTML) throw new Error(`the copy drawn out of the memo holds ${JSON.stringify(later.innerHTML)}`);
    } finally {
      appEl.querySelectorAll = wasQuery;
    }
  });

  // A drawing off screen stops painting, and the browser is handed the exact height it drew to so the block holds its place while it is away. That exact height is the whole reason this can be done at all: it was tried once across the document, when nothing knew how tall a block was, and it flashed blanks and jumped the rail's position box.
  check('a drawn diagram carries its own measured height as its intrinsic size', () => {
    const { finishMermaidDiagram, markMermaidWait } = booted;
    const styleStand = () => ({
      removeProperty(name) {
        delete this[String(name).replace(/-([a-z])/g, (whole, letter) => letter.toUpperCase())];
      },
    });
    const block = (source, height) => ({
      dataset: {},
      style: styleStand(),
      isConnected: true,
      __mermaidSource: source,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, bottom: height, width: 400, height }),
    });

    const drawn = block('flowchart TD\n  S1 --> S2', 214);
    finishMermaidDiagram(drawn);
    if (drawn.style.contentVisibility !== 'auto') throw new Error('a drawn diagram goes on painting off screen');
    if (drawn.style.containIntrinsicSize !== 'auto 214px') {
      throw new Error(`the block stands in at ${drawn.style.containIntrinsicSize || 'nothing'} rather than the height it drew to`);
    }

    // A box has no drawing to skip, and its own remembered height is what holds the page still.
    markMermaidWait(drawn, false);
    if ('contentVisibility' in drawn.style || 'containIntrinsicSize' in drawn.style) {
      throw new Error('a box handed back was left skipping its own paint');
    }

    // Measured at nothing: there is no height to stand in with, so nothing is skipped either.
    const unmeasured = block('flowchart TD\n  S3 --> S4', 0);
    finishMermaidDiagram(unmeasured);
    if ('contentVisibility' in unmeasured.style) throw new Error('a drawing nothing could measure was skipped anyway');

    // The stand-in size is the box's contents and the height measured is the whole block, so the padding around a diagram comes off it. Left on, every skipped block stands 25px taller than the drawing it is holding a place for, and a document of 67 grows by 1,655px as the reader scrolls away from them.
    const wasStyle = booted.getComputedStyle;
    try {
      booted.getComputedStyle = () => ({
        getPropertyValue: (name) => (String(name).startsWith('padding') ? '12.5px' : '0px'),
      });
      const padded = block('flowchart TD\n  S5 --> S6', 231);
      finishMermaidDiagram(padded);
      if (padded.style.containIntrinsicSize !== 'auto 206px') {
        throw new Error(`the padding was left in the stand-in size: ${padded.style.containIntrinsicSize}`);
      }
    } finally {
      booted.getComputedStyle = wasStyle;
    }
  });

  // Named after the fault this reopens: skipping off-screen blocks across the whole document jumped the page, because nothing knew how tall a block was and the browser re-estimated as it went. Two things keep it still now — the stand-in size is the drawing's own measured height rather than an estimate, and the rail's clone cancels the skip so the thumbnail is not a column of blanks.
  check('a diagram off screen keeps its place in the document', () => {
    const { finishMermaidDiagram, markMermaidWait } = booted;
    const styleStand = () => ({
      removeProperty(name) {
        delete this[String(name).replace(/-([a-z])/g, (whole, letter) => letter.toUpperCase())];
      },
    });
    const block = (source, height) => ({
      dataset: {},
      style: styleStand(),
      isConnected: true,
      __mermaidSource: source,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, bottom: height, width: 400, height }),
    });

    // What the block holds open while it is skipped, and what a box put back in its place is given, are the same number.
    const drawn = block('flowchart TD\n  P1 --> P2', 137);
    finishMermaidDiagram(drawn);
    const standIn = drawn.style.containIntrinsicSize;
    const waiting = block('flowchart TD\n  P1 --> P2', 402);
    markMermaidWait(waiting, false);
    if (standIn !== `auto ${waiting.style.height}`) {
      throw new Error(`the skipped block stands in at ${standIn} and a box put back at ${waiting.style.height}`);
    }

    const css = readingCss();
    const clone = css.slice(css.indexOf('.document-minimap-preview pre.mermaid {'));
    if (!clone.startsWith('.document-minimap-preview pre.mermaid {')) throw new Error('nothing cancels the skip inside the rail’s clone');
    if (!clone.slice(0, 120).includes('content-visibility: visible !important;')) {
      throw new Error('the rail’s clone inherits the skip, which blanks every drawing in the thumbnail');
    }
  });

  // The complaint this whole subject exists to answer: a diagram scrolled three screens past that comes back to an empty box makes a document of diagrams read twice a document of blanks. It stays drawn — everywhere the memos can remember it, which is at or under their cap. Past that they empty wholesale, a box put back would be redrawn from scratch, and a page holding every drawing gives up a whole second in one frame; there, and only there, the empty box stands.
  check('a diagram scrolled well past is still drawn when you come back', () => {
    const { mermaidMayRecycle } = booted;
    const appEl = booted.document.getElementById('app');
    const wasQuery = appEl.querySelector;
    const drawing = {
      dataset: { processed: 'true' },
      isConnected: true,
      __mermaidSource: 'flowchart TD\n  R1 --> R2',
      classList: { contains: () => false },
      style: { removeProperty() {} },
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, bottom: 180, width: 400, height: 180 }),
    };
    // The page holds `held` diagrams, and this one has been drawn and measured, so both memos know it.
    const stand = (held) => {
      const body = {
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 640, bottom: 900, width: 640, height: 900 }),
        querySelectorAll: () => Array.from({ length: held }, () => drawing),
      };
      appEl.querySelector = (selector) => (String(selector) === '.document-body' ? body : wasQuery.call(appEl, selector));
    };

    try {
      stand(60);
      booted.finishMermaidDiagram(drawing);
      drawing.dataset.processed = 'true';
      if (mermaidMayRecycle(drawing)) throw new Error('a diagram on a document the memos can hold was handed back as a box');
      // And nothing is even watching for it to go: a document that keeps every drawing has nothing to watch for.
      if (booted.mermaidDocumentPastMemory()) throw new Error('a 60-diagram document was called too big to remember');

      // Past the cap both memos empty wholesale, so the page behaves as it always did. What the guard then asks is whether this drawing is still in the picture memo, which is the check that was there before this and is unchanged.
      stand(201);
      if (!booted.mermaidDocumentPastMemory()) throw new Error('a 201-diagram document was called small enough to remember');
    } finally {
      appEl.querySelector = wasQuery;
    }
  });

  // A warm pass a nearer one interrupted has to pick itself up, or it stalls until the reader happens to scroll. Two things start it: the settle after a gesture, and the end of every other pass. One at a time, because a document being warmed schedules one on every batch it finishes.
  check('a settled scroll starts the warm pass again, one at a time', () => {
    const { readerScrollSettled } = booted;
    const wasTimeout = booted.setTimeout;
    const queued = [];
    booted.setTimeout = (fn, delay) => {
      queued.push({ fn, delay });
      return queued.length;
    };
    let first = 0;
    try {
      readerScrollSettled();
      first = queued.length;
      if (!first) throw new Error('a settled scroll queued no warm pass');
      readerScrollSettled();
      if (queued.length !== first) throw new Error('a second settle queued a second warm pass on top of the first');
      // Let it run, so the page is not left holding a timer that never fires — the stand-in page has no diagrams, so it finds nothing to draw.
      queued[0].fn();
      readerScrollSettled();
      if (queued.length !== first + 1) throw new Error('the pass that ran did not free the next one');
    } finally {
      queued.slice(first).forEach((held) => held.fn());
      booted.setTimeout = wasTimeout;
    }
  });
}
