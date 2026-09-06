// The full-window table, and the lane a wide table is given in the page.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { check, fakeElement, layerOf, readingCss, record, root } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // This sheet is a reader before it becomes an editor: it copies only a safe rendered table, and no route from opening or closing it reaches the document buffer.
  check('a full-window table is safe to open and cannot write in its first phase', () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/table-sheet.js'), 'utf8');
    for (const part of ['function bindTableSheet()', 'tableWysiwygSafe(table)', 'function openTableSheet(table, opener)', 'function closeTableSheet()', 'table.cloneNode(true)', 'function scrollTableSheetHorizontally(event)', 'event.metaKey', 'dragWindowFrom(head)', "event.key !== 'Escape'"]) {
      if (!fragment.includes(part)) throw new Error(`the table sheet lost: ${part}`);
    }
    if (/\b(?:send|sendEditCommand|ipc\.postMessage)\b/.test(fragment)) {
      throw new Error('opening or closing the table sheet can still reach the document buffer');
    }
    const lib = readFileSync(join(root, 'src/lib.rs'), 'utf8');
    const decorate = lib.indexOf('assets/shell/decorate.js');
    const tableSheet = lib.indexOf('assets/shell/table-sheet.js');
    const minimap = lib.indexOf('assets/shell/minimap.js');
    if (tableSheet < decorate || tableSheet > minimap) throw new Error('the table sheet is outside the fragment range its table needs');
    const dom = readFileSync(join(root, 'src/assets/shell/dom.js'), 'utf8');
    if (!dom.includes('function dragWindowFrom(bar) {')) {
      throw new Error('the full-window table header no longer borrows the app bar drag rule');
    }
    const css = readingCss();
    for (const rule of ['.table-sheet-grid th,', 'border: var(--lt-stroke-1) solid var(--lt-markdown-table-border);', 'background: var(--lt-markdown-table-row-background);', 'color: var(--lt-markdown-heading);', 'font-weight: var(--lt-weight-600);', '.table-sheet-grid tr:nth-child(2n) td']) {
      if (!css.includes(rule)) throw new Error(`the table sheet no longer carries the page table treatment: ${rule}`);
    }
    // The copy takes the room the sheet has, never its content's, and only `anywhere` shrinks a column — `break-word` reads as the fix and never enters a column's smallest width.
    const sheetRule = (selector) => {
      const opened = css.indexOf(`${selector} {`);
      if (opened < 0) throw new Error(`no rule for ${selector} in the full-window table`);
      return css.slice(opened, css.indexOf('}', opened));
    };
    const copied = sheetRule('.table-sheet-grid > table');
    for (const rule of ['width: fit-content;', 'max-width: 100%;']) {
      if (!copied.includes(rule)) throw new Error(`the full-window table no longer fits the room the sheet has: ${rule}`);
    }
    if (/max-width:\s*none|width:\s*max-content/.test(copied)) {
      throw new Error('the full-window table asks for its content width again, so one long cell pushes the later columns past the right edge');
    }
    const bodyCells = css.match(/(?<!,\n)\.table-sheet-grid td \{([^}]*)\}/);
    if (!bodyCells || !/overflow-wrap:\s*anywhere;/.test(bodyCells[1])) {
      throw new Error('the full-window table body cells no longer break anywhere, so an unbreakable run still widens its column past the sheet');
    }
    // Breaking anywhere is what drops a body cell's smallest width to one character, so without the floor a column headed by a short word stops at that heading.
    if (!/min-width:\s*7ch;/.test(bodyCells[1])) {
      throw new Error('the full-window table has no floor under its narrowest column, so a three-letter cell under a three-letter heading draws on two lines');
    }
    // On a heading it lets a column fall under one word, and a "Ref" column comes out reading "R / ef".
    const everyCell = css.match(/\.table-sheet-grid th,\s*\n\.table-sheet-grid td \{([^}]*)\}/);
    if (!everyCell || /overflow-wrap/.test(everyCell[1])) {
      throw new Error('the full-window table headings break anywhere, so a short column falls under its own heading word');
    }
    if (/min-width/.test(everyCell[1])) {
      throw new Error('the floor sits on the full-window table headings too, so it widens a column that already reads correctly');
    }
    // The theme's link color and a glossary word's dotted underline are both written behind `.document-body`, so the copy reads as the web view's stock blue-purple until the grid holding it wears that class.
    const held = booted.tableSheetGrid(fakeElement('themeProbeTable'));
    const worn = String(held.className || '').split(/\s+/).filter(Boolean);
    for (const name of ['table-sheet-grid', 'document-body']) {
      if (!worn.includes(name)) throw new Error(`the full-window table's grid is not drawn as ${name}, so its links leave the theme`);
    }
    // What that class brings that the sheet is not: a document's reading measure, the negative margin hanging it off the scroll origin, and the page's text size the cells' own padding and floor are measured against.
    const gridRule = sheetRule('.table-sheet-grid');
    for (const rule of ['width: auto;', 'margin: 0;', 'font-size: inherit;', 'padding: var(--lt-space-16);', 'overflow: auto;']) {
      if (!gridRule.includes(rule)) throw new Error(`the full-window table's grid took a document's own shape: ${rule}`);
    }
    // The document hands a table its own scroll box, which would take the sideways wheel off the grid, and a gap under it the sheet's padding already gives.
    for (const rule of ['margin: 0;', 'overflow: visible;']) {
      if (!copied.includes(rule)) throw new Error(`the copied table kept a document rule the sheet cannot carry: ${rule}`);
    }
  });

  // A plan's table is mostly links, and the copy on the whole window sits beside the document rather than inside it — so a click the delegated handler does not claim is the web view's, and the re-render a finished load brings rewrites `#app` with the table in it. That made every link a trap in the one place a wide table reads.
  check('a link in the full-window table is the app’s to follow, and a term rises without taking the table down', () => {
    const { bindDocumentLinks } = booted;
    const app = booted.document.getElementById('app');
    const glossarySheet = booted.document.getElementById('glossarySheet');
    const wasContains = app.contains;
    const wasQuery = app.querySelector;
    const wasHidden = glossarySheet.hidden;
    const wasIpc = booted.ipc;
    const posted = [];
    // The binding is once-per-page, so a run where a render already did it would leave nothing to raise.
    const wasBound = vm.runInContext('documentLinksBound', booted);
    vm.runInContext('documentLinksBound = false;', booted);
    const WATCHED = ['click', 'auxclick', 'mousedown'];
    const before = new Map(WATCHED.map((type) => [type, (app.listeners.get(type) || []).length]));
    let removed = false;
    const overlay = {
      remove: () => {
        removed = true;
      },
      __tableSheetOpener: null,
      __tableSheetScrim: null,
    };
    // A link in the copy: inside the overlay and inside no document body, which is the whole difference from a link in the page.
    const inCopy = (written) => {
      const link = {
        getAttribute: (name) => (name === 'href' ? written : null),
        closest: (selector) =>
          selector === '.table-sheet-overlay' ? overlay : selector === '.document-body' ? null : link,
      };
      return link;
    };
    let canceled = 0;
    const clickOn = (link, held = {}) => {
      posted.length = 0;
      removed = false;
      for (const handler of (app.listeners.get('click') || []).slice(before.get('click'))) {
        handler({
          target: link,
          button: 0,
          defaultPrevented: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          preventDefault() {
            canceled += 1;
          },
          ...held,
        });
      }
      return posted.slice();
    };
    try {
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
      app.contains = () => true;
      app.querySelector = (selector) =>
        String(selector) === '.table-sheet-overlay' ? overlay : wasQuery.call(app, selector);
      bindDocumentLinks();

      const term = clickOn(inCopy('glossary:vault'));
      if (!canceled) throw new Error('a click in the table copy was left for the web view to follow');
      if (!term.some((one) => one.command === 'openGlossary' && one.href === 'glossary:vault')) {
        throw new Error(`a glossary word in the table copy sent ${JSON.stringify(term)}`);
      }
      if (removed) throw new Error('the term the reader asked for took the table down with it');
      booted.dismissGlossary();

      const page = clickOn(inCopy('../two.md'));
      if (!page.some((one) => one.command === 'openLink' && one.href === '../two.md')) {
        throw new Error(`a page link in the table copy sent ${JSON.stringify(page)}`);
      }
      if (!removed) throw new Error('the table stayed up over a document it no longer belongs to');

      // A jump inside this document scrolls a page nobody can see under the sheet, so it leaves too.
      const within = clickOn(inCopy('#how-it-ranks'));
      if (!within.some((one) => one.command === 'openLink')) throw new Error('a jump inside the document sent nothing');
      if (!removed) throw new Error('the table stayed up over a jump nobody could watch land');

      // Held, the reader chose to stay where they are, so the table stays with them.
      const behind = clickOn(inCopy('../two.md'), booted.isMacPlatform ? { metaKey: true } : { ctrlKey: true });
      if (!behind.some((one) => one.command === 'openLink' && one.newPage)) {
        throw new Error(`a link opened behind sent ${JSON.stringify(behind)}`);
      }
      if (removed) throw new Error('a page opened behind still took the table the reader stayed on');
    } finally {
      booted.ipc = wasIpc;
      app.contains = wasContains;
      app.querySelector = wasQuery;
      glossarySheet.hidden = wasHidden;
      for (const type of WATCHED) {
        const held = app.listeners.get(type);
        if (held) held.length = before.get(type);
      }
      vm.runInContext(`documentLinksBound = ${wasBound ? 'true' : 'false'};`, booted);
    }
  });

  // The sheet is rendered outside `#app`, so the draw pass never collects a diagram in an entry and one stays undrawn for as long as the sheet is open. The stylesheet holds it to a strip instead, and that rule keys on a `pre.mermaid` inside `.glossary-sheet-body`, which is the pair this check builds by opening the sheet on a real entry.
  check('a glossary entry carrying a drawing puts the block the strip rule keys on inside the sheet', () => {
    const sheet = booted.document.getElementById('glossarySheet');
    const body = booted.document.getElementById('glossarySheetBody');
    const wasHidden = sheet.hidden;
    const wasBody = body.innerHTML;
    // One block per element, so a clone can be that block parsed again rather than a node shared with the page it came from.
    const blocks = [
      '<h2 id="a-term">A term</h2>',
      '<p>What it means.</p>',
      '<pre class="mermaid" data-language="mermaid">flowchart TD A --&gt; B</pre>',
      '<p>And it reads on.</p>',
      '<h2 id="the-next-term">The next term</h2>',
      '<p>Not this one.</p>',
    ];
    const html = blocks.join('');
    const parsed = booted.document.createElement('div');
    parsed.innerHTML = html;
    try {
      booted.__glossaryProbeRoot = parsed;
      booted.__glossaryProbeHtml = html;
      vm.runInContext('glossaryParsedRoot = __glossaryProbeRoot; glossaryParsedHtml = __glossaryProbeHtml; glossaryWaiting = true;', booted);
      booted.leafShowGlossary(html, 'a-term');

      if (!body.classList.contains('glossary-sheet-body') || !body.classList.contains('document-body')) {
        throw new Error('the sheet body no longer wears both classes the undrawn block is styled through');
      }
      const drawn = body.querySelectorAll('pre.mermaid');
      if (drawn.length !== 1) throw new Error(`the entry put ${drawn.length} diagram blocks in the sheet`);
      // The corner word is the whole of what the strip still says, so a block reaching the sheet without it is a strip with nothing in it.
      if (drawn[0].dataset.language !== 'mermaid') throw new Error('the block in the sheet carries no corner word');
      if (!body.textContent.includes('And it reads on.')) throw new Error('the entry stopped at the drawing rather than reading on past it');
      if (body.textContent.includes('Not this one.')) throw new Error('the entry ran on into the next term');
    } finally {
      vm.runInContext('glossaryParsedRoot = null; glossaryParsedHtml = null; glossaryWaiting = false;', booted);
      delete booted.__glossaryProbeRoot;
      delete booted.__glossaryProbeHtml;
      body.innerHTML = wasBody;
      sheet.hidden = wasHidden;
      sheet.classList.remove('open');
    }
  });

  // The table sheet hears Escape on the document in the capture phase and the term's own Escape waits in the bubble phase, so the key closed the table underneath and left the term standing over the bare document.
  check('Escape over the term closes the term and leaves the full-window table where it was', () => {
    const app = booted.document.getElementById('app');
    const glossarySheet = booted.document.getElementById('glossarySheet');
    const wasQuery = app.querySelector;
    const wasHidden = glossarySheet.hidden;
    let removed = false;
    const overlay = {
      remove: () => {
        removed = true;
      },
      __tableSheetOpener: null,
      __tableSheetScrim: null,
    };
    let stopped = 0;
    const escape = () => ({
      key: 'Escape',
      preventDefault() {},
      stopPropagation() {
        stopped += 1;
      },
    });
    try {
      app.querySelector = (selector) =>
        String(selector) === '.table-sheet-overlay' ? overlay : wasQuery.call(app, selector);

      glossarySheet.hidden = false;
      booted.onTableSheetKey(escape());
      if (removed) throw new Error('Escape closed the table under the term standing over it');
      if (stopped) throw new Error('the table sheet swallowed the key the term was waiting for');

      glossarySheet.hidden = true;
      booted.onTableSheetKey(escape());
      if (!removed) throw new Error('Escape no longer closes the full-window table on its own');
      if (!stopped) throw new Error('the table sheet stopped claiming the key it answers');
    } finally {
      app.querySelector = wasQuery;
      glossarySheet.hidden = wasHidden;
    }
  });

  // The term is the app's one sheet that can stand on another, and its scrim was painted at the layer every first scrim takes — so over the full-window table it dimmed nothing and the press that closes it landed on the table underneath.
  check('the term’s dim falls over the full-window table, and a press on it closes the term', () => {
    const scrim = layerOf('#glossaryBackdrop');
    if (!(scrim > layerOf('.table-sheet-overlay'))) {
      throw new Error('the term’s dim is painted under the full-window table, so the table stands at full brightness and a press outside the term lands on it');
    }
    if (!(layerOf('.glossary-sheet') > scrim)) throw new Error('the term sits under its own dim');

    const app = booted.document.getElementById('app');
    const glossarySheet = booted.document.getElementById('glossarySheet');
    const glossaryBackdrop = booted.document.getElementById('glossaryBackdrop');
    const wasQuery = app.querySelector;
    const wasHidden = glossarySheet.hidden;
    let removed = false;
    const overlay = {
      remove: () => {
        removed = true;
      },
      __tableSheetOpener: null,
      __tableSheetScrim: null,
    };
    try {
      app.querySelector = (selector) =>
        String(selector) === '.table-sheet-overlay' ? overlay : wasQuery.call(app, selector);
      glossarySheet.hidden = false;
      glossarySheet.classList.add('open');
      const pressed = glossaryBackdrop.listeners.get('click') || [];
      if (!pressed.length) throw new Error('nothing hears a press on the term’s dim');
      for (const handler of pressed) handler({});
      if (glossarySheet.classList.contains('open')) throw new Error('a press on the term’s dim left the term standing');
      if (removed) throw new Error('a press on the term’s dim took the table down with it');
    } finally {
      app.querySelector = wasQuery;
      glossarySheet.classList.remove('open');
      glossarySheet.hidden = wasHidden;
    }
  });

  // A term is only ever raised from a word inside the table, so a table closing under it left it standing over an ordinary page with no way back to what it came from.
  check('closing the full-window table takes a raised term with it, and closing the term leaves the table', () => {
    const app = booted.document.getElementById('app');
    const glossarySheet = booted.document.getElementById('glossarySheet');
    const wasQuery = app.querySelector;
    const wasHidden = glossarySheet.hidden;
    let removed = false;
    const overlay = {
      remove: () => {
        removed = true;
      },
      __tableSheetOpener: null,
      __tableSheetScrim: null,
    };
    try {
      app.querySelector = (selector) =>
        String(selector) === '.table-sheet-overlay' ? overlay : wasQuery.call(app, selector);

      glossarySheet.hidden = false;
      glossarySheet.classList.add('open');
      booted.closeTableSheet();
      if (!removed) throw new Error('the full-window table no longer closes');
      if (glossarySheet.classList.contains('open')) throw new Error('closing the table left the term standing over a page it never came from');

      // The other direction, which is what shipped: the term goes and the table it was raised from stays where it was.
      removed = false;
      glossarySheet.hidden = false;
      glossarySheet.classList.add('open');
      booted.dismissGlossary();
      if (glossarySheet.classList.contains('open')) throw new Error('the term no longer closes on its own');
      if (removed) throw new Error('closing the term took the table it was raised from down with it');
    } finally {
      app.querySelector = wasQuery;
      glossarySheet.classList.remove('open');
      glossarySheet.hidden = wasHidden;
    }

    // The key's own path, read as text: it is fired for real above, and this holds it to the one close rather than to a second copy of the removal.
    const fragment = readFileSync(join(root, 'src/assets/shell/table-sheet.js'), 'utf8');
    const key = fragment.slice(fragment.indexOf('function onTableSheetKey('));
    if (!key.includes('closeTableSheet()')) throw new Error('the key closes the full-window table by some other path than the one close');
    if (!fragment.includes('dismissGlossary();')) throw new Error('closing the full-window table says nothing about the term raised from it');
  });

  // Both ways out are pressed on the elements that carry them, over a table of the check's own: a binding matched as a line of text passes whether or not anything ever reaches it.
  check('the full-window table opens over a table of its own, wears its open state, and both ways out take it back down', () => {
    const app = booted.document.getElementById('app');
    const wasQuery = app.querySelector;
    const held = app.children.slice();
    // Safe to open: nothing the serializer refuses, and a real header row to key the pipes off. The laid-out page it would be copied out of is the one thing the check has no version of, so the copy is a stand-in too.
    const standInTable = () => {
      const table = fakeElement('checkedTable');
      table.tagName = 'TABLE';
      const head = fakeElement('checkedTableHead');
      head.tagName = 'THEAD';
      const row = fakeElement('checkedTableRow');
      row.tagName = 'TR';
      const heading = fakeElement('checkedTableHeading');
      heading.tagName = 'TH';
      row.appendChild(heading);
      head.appendChild(row);
      table.appendChild(head);
      return table;
    };
    const opener = fakeElement('checkedTableOpener');
    const wornBy = (child) => String((child && child.className) || '');
    // The page's class list holds only what the shipped markup declares, so an overlay the open just built is not in it — the one query that finds it is pointed at what landed on the page, the way the checks above point it.
    let standing = null;
    const openOnce = () => {
      standing = null;
      booted.openTableSheet(standInTable(), opener);
      const fresh = app.children.filter((child) => !held.includes(child));
      standing = fresh.find((child) => wornBy(child).includes('table-sheet-overlay')) || null;
      return { fresh, scrim: fresh.find((child) => wornBy(child) === 'lt-backdrop') || null };
    };
    const press = (element) => (element.listeners.get('click') || []).forEach((handler) => handler({}));
    const gone = (...leaving) => leaving.every((one) => !app.children.includes(one));
    try {
      app.querySelector = (selector) => (String(selector) === '.table-sheet-overlay' ? standing : wasQuery.call(app, selector));
      const first = openOnce();
      if (!standing || !first.scrim) throw new Error(`opening the full-window table put ${first.fresh.length} new things on the page`);
      const [head, grid] = standing.children;
      if (!wornBy(head).includes('table-sheet-head')) throw new Error('the sheet opened with no header row');
      if (!wornBy(grid).includes('table-sheet-grid')) throw new Error('the sheet opened holding no copy of the table');
      const [title, cross] = head.children;
      if (title.textContent !== 'Table') throw new Error(`the sheet is titled ${JSON.stringify(title.textContent)}`);
      if (!wornBy(cross).includes('table-sheet-close')) throw new Error('the header carries no close cross');
      // The open state rides on a frame the page asks for, so a sheet born open could never be seen arriving.
      if (standing.classList.contains('open')) throw new Error('the sheet and its dim were built already open');
      booted.__frames.drain();
      if (!standing.classList.contains('open') || !first.scrim.classList.contains('open')) {
        throw new Error('the frame the page asked for left the sheet or its dim shut');
      }
      press(cross);
      if (!gone(standing, first.scrim)) throw new Error('the close cross left the sheet or its dim standing on the page');

      const second = openOnce();
      if (!standing || !second.scrim) throw new Error('the table would not open a second time');
      booted.__frames.drain();
      press(second.scrim);
      if (!gone(standing, second.scrim)) throw new Error('a press on the sheet’s own dim left it standing on the page');
    } finally {
      app.querySelector = wasQuery;
      for (const child of app.children.slice()) if (!held.includes(child)) child.remove();
    }
  });

  // The widened table's rules, read as text: none of it is reachable without a laid-out page, and every way it breaks is silent — a table back at the text measure, one grown wider than the lane it sits in, a frontmatter table dragged into the margin, or a fade that veils a column instead of pointing past it.
  const tableLaneRule = () => {
    const css = readingCss();
    const opened = css.indexOf('.table-bay > .table-lane {');
    if (opened < 0) throw new Error('no rule sizes a table lane inside its bay');
    const bayAt = css.indexOf('.document-body > .table-bay {');
    if (bayAt < 0) throw new Error('no rule widens a table bay to the reader lane');
    return { css, rule: css.slice(opened, css.indexOf('}', opened)), bay: css.slice(bayAt, css.indexOf('}', bayAt)) };
  };

  check('Control or Command wheel scrolls only an overflowing table lane sideways', () => {
    const handlers = booted.document.getElementById('app').listeners.get('wheel') || [];
    const handler = handlers.at(-1);
    if (!handler || handlers.length < 2) throw new Error('the table or Mermaid wheel listener was not bound');
    const table = Object.assign(fakeElement('wheelTable'), { tagName: 'TABLE', scrollLeft: 20, scrollWidth: 400, clientWidth: 100 });
    const lane = fakeElement('wheelLane');
    lane.className = 'table-lane';
    lane.appendChild(table);
    const target = fakeElement('wheelTarget');
    lane.appendChild(target);
    const wheel = (changes = {}) => {
      let prevented = false;
      return {
        target,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        deltaX: 0,
        deltaY: 45,
        preventDefault() {
          prevented = true;
        },
        prevented: () => prevented,
        ...changes,
      };
    };

    const claimed = wheel();
    handler(claimed);
    if (table.scrollLeft !== 65 || !claimed.prevented()) throw new Error('a Control wheel did not move the table and claim the notch');

    for (const changes of [{ ctrlKey: false }, { altKey: true }, { shiftKey: true }, { deltaY: 0, deltaX: 45 }]) {
      table.scrollLeft = 20;
      const ignored = wheel(changes);
      handler(ignored);
      if (table.scrollLeft !== 20 || ignored.prevented()) throw new Error('an unclaimed wheel moved the table or stopped the browser');
    }

    table.scrollLeft = 300;
    const atEnd = wheel();
    handler(atEnd);
    if (table.scrollLeft !== 300 || !atEnd.prevented()) throw new Error('a table end let a claimed wheel escape');

    table.scrollWidth = 100;
    table.scrollLeft = 20;
    const narrow = wheel();
    handler(narrow);
    if (table.scrollLeft !== 20 || narrow.prevented()) throw new Error('a table without sideways overflow claimed the wheel');

    table.scrollWidth = 400;
    table.scrollLeft = 20;
    const diagram = fakeElement('diagram');
    diagram.tagName = 'PRE';
    diagram.className = 'mermaid';
    diagram.dataset.processed = 'true';
    const svg = fakeElement('diagramSvg');
    svg.tagName = 'SVG';
    diagram.appendChild(svg);
    lane.appendChild(diagram);
    const diagramTarget = diagram;
    const mermaid = wheel({ target: diagramTarget, deltaY: -45 });
    handlers.forEach((bound) => bound(mermaid));
    if (table.scrollLeft !== 20 || !mermaid.prevented() || diagram.__mermaidView?.zoom <= 1) {
      throw new Error('a Mermaid wheel did not stay with Mermaid');
    }
  });

  // The inset is the room the drag handle and plus occupy, written once in the stylesheet and once in the script that places them.
  check('the table lane leaves exactly the block controls their margin', () => {
    const { css, bay } = tableLaneRule();
    if (!bay.includes('var(--reader-lane-inset)')) {
      throw new Error('the bay no longer keeps the block controls their strip');
    }
    const declared = css.match(/--reader-lane-inset:\s*(\d+)px/);
    if (!declared) throw new Error('--reader-lane-inset is not declared');
    const script = readFileSync(join(root, 'src/assets/shell/block-controls.js'), 'utf8');
    const tools = script.match(/BLOCK_TOOLS_WIDTH = (\d+)/);
    if (!tools) throw new Error('BLOCK_TOOLS_WIDTH is gone from block-controls.js');
    if (declared[1] !== tools[1]) {
      throw new Error(`the stylesheet says ${declared[1]}px and the script says ${tools[1]}px`);
    }
  });

  // A table's sliced column dissolves into the page, and what makes it safe is that a table with nothing to scroll has no timeline at all — so the bands stay at the opacity 0 they start at. A clock-driven animation would veil every table on the page, once, and never come back.
  check('a table fades its ends from its own scroll, never from a clock', () => {
    const { css, rule } = tableLaneRule();
    // The bands are on the lane and the scroll is the table's, one box down, so the timeline has to be published up for them to name it.
    if (!rule.includes('timeline-scope: --lt-table-scroll')) {
      throw new Error("the lane no longer publishes the table's scroll timeline");
    }
    for (const declaration of [
      'scroll-timeline: --lt-table-scroll inline;',
      'animation-timeline: --lt-table-scroll;',
      'opacity: 0;',
    ]) {
      if (!css.includes(declaration)) throw new Error(`the edge fade lost: ${declaration}`);
    }
    const bands = css.slice(css.indexOf('.table-lane::before,'), css.indexOf('.table-lane::before {'));
    if (/animation-duration|animation-delay/.test(bands)) {
      throw new Error('the fade has been given a clock, so it runs on a table that cannot scroll');
    }
    // The dot screen and the wash the page's own edges use, in the page's color, ramped by one mask.
    if (!bands.includes('background-attachment: fixed, scroll;')) {
      throw new Error("the band is no longer the chrome's own window-anchored lattice");
    }
    if (!css.includes('--lt-grain-dot: var(--lt-markdown-background);')) {
      throw new Error('the band draws its dots in something other than the page color');
    }
  });

  // `100cqi` with no container falls back to the viewport, which is the whole window — so a lane would grow past the reading column and under the minimap.
  check('the reader lane is still the container the table measures against', () => {
    const { css } = tableLaneRule();
    const layout = css.slice(css.indexOf('.reader-layout {'), css.indexOf('.reader-layout-no-minimap'));
    if (!/container-type:\s*inline-size/.test(layout)) {
      throw new Error('.reader-layout no longer declares container-type: inline-size');
    }
  });

  // Frontmatter scrolls on its own wrapper and a data file's table wraps its cells on purpose; neither may be pulled into a lane. The gutter reads the body's own children, so a lane with no source range is furniture it steps over and the table loses its handle.
  check('only a body table is laned, and the lane carries its source range', () => {
    const { rule, bay } = tableLaneRule();
    // The bay is the box the centering arithmetic can name, and the lane inside it may carry neither a slide nor a transform: a transform makes its own box the containing block for every fixed background under it, which tiled the dots in each header cell from a box that moves sideways with the columns.
    if (/transform/.test(rule) || /left:/.test(rule)) {
      throw new Error('the lane is centered by a transform again, so its cells tile their grain from a box that moves');
    }
    if (!/margin-inline:\s*auto/.test(rule)) throw new Error('the lane no longer centers inside its bay');
    if (!/margin-inline:\s*calc\(\(100% - max\(100%, 100cqi - 2 \* var\(--reader-lane-inset\)\)\) \/ 2\)/.test(bay)) {
      throw new Error('the bay no longer centers itself on the arithmetic its own width gives');
    }
    if (/transform/.test(bay)) throw new Error('the bay carries a transform, which is the thing it exists to avoid');
    const decorate = readFileSync(join(root, 'src/assets/shell/decorate.js'), 'utf8');
    const wrap = decorate.slice(decorate.indexOf('function laneWideTables'), decorate.indexOf('function decorateBlockquoteLines'));
    if (!wrap) throw new Error('nothing wraps a table in a lane');
    for (const guard of ["tagName !== 'TABLE'", "classList.contains('data-table')", 'body.children', "'table-bay'", "'table-lane'"]) {
      if (!wrap.includes(guard)) throw new Error(`the wrap no longer checks: ${guard}`);
    }
    // The bay and the lane are the reader's boxes, not the document's: everything that walks the body's blocks has to see through both, or an edit serializes a wrapper and finds no rows in it.
    const blocks = readFileSync(join(root, 'src/assets/shell/reading-blocks.js'), 'utf8');
    for (const box of ['table-bay', 'table-lane']) {
      if (!blocks.includes(`el.classList.contains('${box}')`)) {
        throw new Error(`the range walk stamps the ${box} instead of the table inside it`);
      }
    }
    const controls = readFileSync(join(root, 'src/assets/shell/block-controls.js'), 'utf8');
    if ((controls.match(/unwrapTableLane/g) || []).length < 3) {
      throw new Error('the block gutter no longer sees through the lane to the table');
    }
    const run = controls.slice(controls.indexOf('function blockSiblingRun'), controls.indexOf('function blockDropIndex'));
    for (const box of ['table-lane', 'table-bay']) {
      if (!run.includes(`'${box}'`)) {
        throw new Error(`a laned table's sibling run stops at the ${box} rather than climbing to the body`);
      }
    }
    // The 62px strip is measured from the reader's edge, and the gutter from the text measure — so a widened table's handle lands on its first column unless it rides the lane.
    const place = controls.slice(controls.indexOf('function positionBlockGutter'), controls.indexOf('function blockGutterAnchorY'));
    if (!place.includes(".closest('.table-lane, .image-lane')")) {
      throw new Error('the drag handle is anchored to the text measure, so it sits on a widened table');
    }
    const render = readFileSync(join(root, 'src/assets/shell/render-document.js'), 'utf8');
    if (!render.includes('laneWideTables();')) throw new Error('nothing calls laneWideTables on a render');
  });

  // The decision is taken on the grid, never on the cards it chose last time and never on a number kept from an earlier width: a table that fits reports its lane, so a remembered width cards it as soon as the lane narrows under the one it was measured at.
  check('a wide table is read as a grid every time and becomes cards only when its lane cuts it', () => {
    const decorate = readFileSync(join(root, 'src/assets/shell/decorate.js'), 'utf8');
    const measure = decorate.slice(decorate.indexOf('function measureWideTables'), decorate.indexOf('function decorateBlockquoteLines'));
    for (const part of ["classList.remove('is-cards')", "classList.add('no-cards')", 'table.scrollWidth > lane.clientWidth + 2', 'new ResizeObserver', 'document.fonts?.ready']) {
      if (!measure.includes(part)) throw new Error(`the card changeover lost: ${part}`);
    }
    if (/dataset\.leafTableWidth/.test(measure)) {
      throw new Error('the changeover keeps a width between decisions again, so a table that fits is carded the moment its lane narrows under the width it was first measured at');
    }
    const off = measure.indexOf("classList.add('no-cards')");
    if (off < 0 || off > measure.indexOf('table.scrollWidth')) {
      throw new Error('the width is read before the cards come off, so the decision reads the shape it chose last time');
    }
  });

  // Every reset is written before any width is read, so one settled layout answers the whole delivery. Written lane by lane it is a class write and a grid read in turn, which flushes layout once a table: over the plan log's sixteen lanes that cost 71ms a width change against 10ms batched, four frames against under one.
  check('a resize delivery writes every reset before it reads a width, and keeps no width after it', () => {
    const decorate = readFileSync(join(root, 'src/assets/shell/decorate.js'), 'utf8');
    const measure = decorate.slice(decorate.indexOf('function measureWideTables'), decorate.indexOf('function decorateBlockquoteLines'));
    const once = (part) => {
      const at = measure.indexOf(part);
      if (at < 0) throw new Error(`the card changeover lost: ${part}`);
      if (measure.indexOf(part, at + 1) >= 0) throw new Error(`the card changeover writes ${part} in two places, so the order of one says nothing about the other`);
      return at;
    };
    const reset = once("classList.add('no-cards')");
    const read = once('table.scrollWidth > lane.clientWidth + 2');
    const apply = once("classList.toggle('is-cards'");
    if (!(reset < read && read < apply)) {
      throw new Error('the reset, the grid read and the card answer are no longer three passes in that order, so a class write sits between two reads and flushes layout again');
    }
    if (!/const cards = pairs\.map\(/.test(measure)) {
      throw new Error('the grid answers are no longer collected before they are applied, so the delivery writes between its reads');
    }
    if (/entries\.forEach\(\s*\(entry\)\s*=>\s*decide\(/.test(measure)) {
      throw new Error('the observer decides one entry at a time again, so a delivery of four lanes flushes layout four times');
    }
    if (!/new ResizeObserver\(\(entries\) => decide\(entries\.map\(/.test(measure)) {
      throw new Error('the observer no longer hands its whole delivery to one decision');
    }
    for (const path of ['decide(lanes);', 'document.fonts.ready.then(() => decide(lanes))']) {
      if (!measure.includes(path)) throw new Error(`the first render and the late font no longer take the same batched path: ${path}`);
    }
    const kept = measure.slice(0, measure.indexOf('const decide =')) + measure.slice(measure.indexOf('decide(lanes);'));
    if (/(?:cards|widths|pairs)/.test(kept)) {
      throw new Error('a grid width or card answer is held outside one decision, so a table that fits is carded the moment its lane narrows under the width it was measured at');
    }
  });

  // Cards are the answer for a reader with no room, and only for one. Read as classes alone this passes on a page that cards every wide grid, so the roomy table's own grid width is watched for the read that must never come: the flag is asked first and the grid never measured above the card width, which is what leaves the bands, the timeline and the sideways wheel something to run on.
  check('a reader with room keeps a scrollable grid and is never measured for one', () => {
    const laneAt = (flag, grid) => {
      const lane = fakeElement(`cardFlagLane${flag}${grid}`);
      lane.className = 'table-lane';
      lane.style.setProperty('--reader-table-cards', flag);
      lane.clientWidth = 100;
      const table = Object.assign(fakeElement(`cardFlagTable${flag}${grid}`), { tagName: 'TABLE' });
      let reads = 0;
      Object.defineProperty(table, 'scrollWidth', {
        get() {
          reads += 1;
          return grid;
        },
      });
      lane.appendChild(table);
      return { lane, table, reads: () => reads };
    };
    const roomy = laneAt('0', 400);
    const narrow = laneAt('1', 400);
    const fits = laneAt('1', 100);
    const page = fakeElement('cardFlagPage');
    for (const one of [roomy, narrow, fits]) page.appendChild(one.lane);

    booted.measureWideTables(page);

    if (roomy.table.classList.contains('is-cards')) {
      throw new Error('a reader with room was handed cards anyway, so the bands, the timeline and the sideways wheel stay unreachable');
    }
    if (roomy.reads() !== 0) {
      throw new Error('a lane above the card width was measured all the same, so every width change pays for a grid nothing is going to card');
    }
    if (!narrow.table.classList.contains('is-cards')) {
      throw new Error('a narrow reader lost the cards a grid too wide for its lane needs');
    }
    if (fits.table.classList.contains('is-cards')) {
      throw new Error('a grid that fits its narrow lane was carded');
    }
    for (const one of [roomy, narrow, fits]) {
      if (!one.table.classList.contains('no-cards')) throw new Error('a table lost the mark that silences the stylesheet’s width fallback');
    }

    // One flag and one number: the lane rests at 0 and exactly one rule turns it on, inside the container query that already draws the cards, at the width the two sites' own copy keys on.
    const css = readingCss();
    const resting = (css.match(/--reader-table-cards: 0;/g) || []).length;
    const turned = (css.match(/--reader-table-cards: 1;/g) || []).length;
    if (resting !== 1 || turned !== 1) {
      throw new Error(`the card flag rests in ${resting} rules and is turned on by ${turned}; one of each, or the card width is written twice`);
    }
    const on = css.indexOf('--reader-table-cards: 1;');
    const opener = css.lastIndexOf('@container (max-width: ', on);
    if (opener < 0) throw new Error('the flag is turned on outside a container query, so the card width no longer lives in one place');
    const width = css.slice(opener).match(/@container \(max-width: (\d+)px\)/)[1];
    const fallback = css.match(/@media screen and \(max-width: (\d+)px\)/);
    if (!fallback || fallback[1] !== width) {
      throw new Error(`the flag cards at ${width}px and the two sites' own copy cards at ${fallback ? fallback[1] : 'no'}px`);
    }
  });

  // The card shape, read as the three copies it has to be: the window's container query, the two sites' width query and the measured class. Every fault this catches was watched in a running copy — a cell of links shredded into a column each, a path hanging out of the card, and every second card shaded because the striping is written for a grid and carries the same weight as these selectors.
  check('a card is one surface and a cell inside it is one run of words', () => {
    const css = readingCss();
    const grain = css.lastIndexOf('.document-body tr:nth-child(2n + 1) td {');
    const cards = css.indexOf('/* Cards, and the last word on a cell:');
    if (grain < 0 || cards < 0) throw new Error('the row grain or the card block is gone');
    if (cards < grain) {
      throw new Error('the card block is written above the striping and the grain, so every second card is shaded and every cell in it wears a box of its own');
    }
    const region = css.slice(cards, css.indexOf('.document-body kbd {', cards));
    const bodies = (selector) => {
      const found = [];
      let at = 0;
      for (;;) {
        const opened = region.indexOf(selector, at);
        if (opened < 0) return found;
        found.push(region.slice(opened, region.indexOf('}', opened)));
        at = opened + selector.length;
      }
    };
    const both = (tail) => [...bodies(`table:not(.no-cards) ${tail}`), ...bodies(`table.is-cards ${tail}`)];
    const rows = both('tr {');
    const cells = both('td {');
    const labels = both('td::before {');
    const heads = both('thead {');
    if (rows.length !== 3 || cells.length !== 3 || labels.length !== 3 || heads.length !== 3) {
      throw new Error(`the card shape is written ${rows.length} times for the row, ${cells.length} for the cell, ${labels.length} for the label and ${heads.length} for the heading row; each needs all three`);
    }
    for (const row of rows) {
      if (!/display:\s*flex/.test(row) || !/flex-wrap:\s*wrap/.test(row)) {
        throw new Error('a card no longer wraps its cells, so nothing decides where a line ends');
      }
      if (/grid-template-columns/.test(row)) {
        throw new Error('a card is back on equal tracks, which hand a one-character column the room a paragraph needs');
      }
      // The room, read off each copy rather than left to the count above: it is the space around a record that makes a stack read as a list of them, so the card is opened at the step above its column gap and its lines sit at the step below.
      if (!/gap:\s*var\(--lt-space-8\) /.test(row)) {
        throw new Error('the lines inside a card sit at some other step, so the room inside it is no longer read against the room around it');
      }
      if (!/padding:\s*var\(--lt-space-16\)/.test(row)) {
        throw new Error('a card is no longer opened top and bottom, so its first line sits on its own edge');
      }
      // The edge: one rule between records rather than a box round each, which is what a stack of eighteen boxes down a page came out reading as.
      if (!/border:\s*0;/.test(row) || !/border-radius:\s*0;/.test(row)) {
        throw new Error('a card is boxed again, and a stack of them reads as a fence rather than a list');
      }
      if (!/border-bottom:\s*var\(--lt-stroke-1\) solid var\(--lt-markdown-table-border\);/.test(row)) {
        throw new Error('nothing separates one card from the next');
      }
      if (!/margin-bottom:\s*0;/.test(row)) {
        throw new Error('a card is spaced away from the next one as well as ruled off it, so the rule belongs to neither');
      }
    }
    // And the last card in a table is not ruled off something that is not there.
    const ends = both('tr:last-child {');
    if (ends.length !== 3) {
      throw new Error(`the last card's missing rule is written ${ends.length} times; the reader's container query, the width query and the measured class each need it`);
    }
    for (const end of ends) {
      if (!/border-bottom:\s*0;/.test(end)) throw new Error('the last card in a table is followed by a rule with nothing under it');
    }
    for (const cell of cells) {
      if (!/display:\s*block/.test(cell)) throw new Error('a card cell is a flex box again, so every link and comma in it becomes a column of its own');
      if (!/overflow-wrap:\s*anywhere/.test(cell)) throw new Error('a value with nothing to break on runs out past the card again');
      if (!/background:\s*none/.test(cell)) throw new Error('a card cell paints a fill of its own, so the card is not one surface');
      if (!/min-width:\s*0/.test(cell)) throw new Error('a card cell cannot shrink under its longest word again');
      if (!/text-align:\s*left/.test(cell)) throw new Error('a column alignment still reaches a card, where there are no columns');
    }
    for (const label of labels) {
      if (!/display:\s*inline-block/.test(label)) throw new Error('the label is a flex item again, which is what shredded the value beside it');
      if (!/content:\s*attr\(data-leaf-col\)/.test(label)) throw new Error('the label no longer comes from the column the renderer stamped on the cell');
      // The eyebrow, held where the label already is: drawn at the value's own size it is only a weight and a shade away from its answer, which is what made a card one run of words.
      if (!/font-size:\s*0\.75em/.test(label)) throw new Error("a card label is back at the value's own size, so a field's name reads as part of its answer");
      if (!/text-transform:\s*uppercase/.test(label)) throw new Error("a card label is back in the value's own case");
      if (!/letter-spacing:\s*var\(--lt-tracking-/.test(label)) throw new Error('a card label is tracked by hand or not at all, and every spacing decision here comes from a token');
    }
    for (const head of heads) {
      if (!/display:\s*none/.test(head)) throw new Error('the heading row is drawn above cards that each carry their own labels');
    }
    for (const flat of [...bodies('.table-lane:has(> table:not(.no-cards)) {'), ...bodies('.table-lane:has(> table.is-cards) {')]) {
      if (!/width:\s*100%/.test(flat) || !/max-width:\s*none/.test(flat)) {
        throw new Error('the lane keeps its widened shape under cards, so the cards shrink-wrap to the grid width they replaced');
      }
    }
    // And the break-out itself is the bay's, so the bay is what stands down to the measure: left wide, the lane would fill it and the cards would spread across the whole reader.
    for (const stood of [...bodies('.table-bay:has(table:not(.no-cards)) {'), ...bodies('.table-bay:has(table.is-cards) {')]) {
      if (!/width:\s*100%/.test(stood) || !/margin-inline:\s*0/.test(stood)) {
        throw new Error('the bay keeps its widened, centered shape under cards, so the cards spread past the writing they replaced');
      }
    }
    if (bodies('.table-bay:has(table.is-cards) {').length === 0) {
      throw new Error('nothing stands the bay down under cards');
    }
  });

  // The field block is the one table that is already a card, so the card rules have to be handed back in full. Giving the table its own display and stopping left its rows still folding into cards and its keys still stacking above their values, at every width under the changeover.
  check('the frontmatter block keeps its rows under the card width', () => {
    const css = readingCss();
    const at = css.indexOf('.document-body .frontmatter table:not(.no-cards) {');
    if (at < 0) throw new Error('the frontmatter block no longer opts out of the cards');
    const region = css.slice(at, css.indexOf('.document-body .frontmatter tr th,', at));
    for (const [what, value] of [['its rows group', 'table-row-group'], ['its rows', 'table-row'], ['its keys and values', 'table-cell']]) {
      const found = region.split(`display: ${value};`).length - 1;
      if (found !== 2) {
        throw new Error(`the frontmatter opt-out gives ${what} back ${found} times, and both the container query and the width query need it`);
      }
    }
    if (!region.includes('table:not(.no-cards) th,')) {
      throw new Error('the frontmatter key cell is never given its display back, so a key stacks above its value');
    }

    // And every declaration the card row carries, read off the card row itself rather than listed here: with the border, the radius, the padding, the gap and the margin left behind, the one table meant to carry no chrome at all wore a rounded box round each of its rows the moment the reader went narrow. Read this way, a declaration added to the card row later and not to the opt-out stops the build rather than landing on the field block.
    const propertiesOf = (body) => new Set((body.match(/^\s*([a-z-]+):/gm) || []).map((one) => one.trim().slice(0, -1)));
    const bodyAt = (selector) => {
      const opened = css.indexOf(selector);
      if (opened < 0) throw new Error(`the stylesheet no longer writes ${selector}`);
      return css.slice(opened, css.indexOf('}', opened));
    };
    const carried = propertiesOf(bodyAt('.document-body table.is-cards tr {'));
    // `border` gives back every side it draws, and nothing else the word starts.
    const answered = (given, wanted) =>
      given.has(wanted) ||
      (given.has('border') && wanted.startsWith('border-') && !/^border-(radius|collapse|spacing)/.test(wanted));
    for (const opt of ['.document-body .frontmatter table:not(.no-cards) tr {']) {
      let at = 0;
      let found = 0;
      for (;;) {
        const opened = css.indexOf(opt, at);
        if (opened < 0) break;
        found += 1;
        const given = propertiesOf(css.slice(opened, css.indexOf('}', opened)));
        for (const one of carried) {
          if (!answered(given, one)) {
            throw new Error(`the card row sets ${one} and the field block's opt-out never gives it back, so the one table meant to carry no chrome wears it under the card width`);
          }
        }
        at = opened + opt.length;
      }
      if (found !== 2) throw new Error(`the field block's opt-out row is written ${found} times; the container query and the width query both need it`);
    }
  });

  // A box that folds in the flow wears `folds` and slides to its new height, so the mark and the rule are held to each other here: only the two together make it move, and a box that loses the mark snaps open with every other check still green.
  check('both boxes that fold in place wear the mark the stylesheet slides', () => {
    const css = readingCss();
    if (!css.includes('@supports (interpolate-size: allow-keywords) {') || !css.includes('  .folds {')) {
      throw new Error('the shared folding rule is gone, so the mark below moves nothing');
    }
    const shell = readFileSync(join(root, 'src/assets/app-shell.html'), 'utf8');
    if (!/id="findReplaceRow"/.test(shell) || !/class="[^"]*\bfolds\b[^"]*"[^>]*id="findReplaceRow"/.test(shell)) {
      throw new Error('the find bar\'s Replace row lost the mark, so it jumps open again');
    }
    const gutter = readFileSync(join(root, 'src/assets/shell/block-controls.js'), 'utf8');
    if (!/class="block-insert-row[^"]*\bfolds\b/.test(gutter)) {
      throw new Error('the gutter\'s insert row lost the mark, so its options appear in one frame');
    }
  });
}
