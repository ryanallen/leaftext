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
    for (const rule of ['.table-sheet-grid th,', 'border: var(--lt-stroke-1) solid var(--lt-markdown-table-border);', 'background: var(--lt-markdown-table-header-background);', '.table-sheet-grid tr:nth-child(2n) td']) {
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
    const held = booted.tableSheetGrid({ cloneNode: () => ({ classList: { add() {} }, removeAttribute() {}, querySelectorAll: () => [] }) });
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
    // The stand-in page has neither of these and the entry walker uses both: it clones the heading, then every block after it until the next heading of the same rank.
    parsed.children.forEach((el, i) => {
      el.cloneNode = () => {
        const one = booted.document.createElement('div');
        one.innerHTML = blocks[i];
        return one.children[0];
      };
      el.nextElementSibling = parsed.children[i + 1] || null;
    });
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
      table.querySelector = (selector) => (String(selector) === ':scope > thead > tr > th' ? fakeElement('checkedTableHeading') : null);
      table.cloneNode = () => fakeElement('checkedTableCopy');
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
    const opened = css.indexOf('.document-body > .table-lane {');
    if (opened < 0) throw new Error('no rule widens a table lane to the reader lane');
    return { css, rule: css.slice(opened, css.indexOf('}', opened)) };
  };

  check('Control or Command wheel scrolls only an overflowing table lane sideways', () => {
    const handlers = booted.document.getElementById('app').listeners.get('wheel') || [];
    const handler = handlers.at(-1);
    if (!handler || handlers.length < 2) throw new Error('the table or Mermaid wheel listener was not bound');
    const table = { scrollLeft: 20, scrollWidth: 400, clientWidth: 100 };
    const lane = { querySelector: (selector) => (selector === ':scope > table' ? table : null) };
    const target = {
      closest: (selector) => (selector === '.table-lane' ? lane : null),
    };
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
    diagram.dataset = {};
    diagram.querySelector = () => fakeElement('svg');
    const diagramTarget = {
      closest: (selector) => {
        if (selector === 'pre.mermaid[data-processed="true"]') return diagram;
        return selector === '.table-lane' ? lane : null;
      },
    };
    const mermaid = wheel({ target: diagramTarget, deltaY: -45 });
    handlers.forEach((bound) => bound(mermaid));
    if (table.scrollLeft !== 20 || !mermaid.prevented() || diagram.__mermaidView?.zoom <= 1) {
      throw new Error('a Mermaid wheel did not stay with Mermaid');
    }
  });

  // The inset is the room the drag handle and plus occupy, written once in the stylesheet and once in the script that places them.
  check('the table lane leaves exactly the block controls their margin', () => {
    const { css, rule } = tableLaneRule();
    if (!rule.includes('var(--reader-lane-inset)')) {
      throw new Error('the lane no longer keeps the block controls their strip');
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
    const { rule } = tableLaneRule();
    if (!/transform:\s*translateX\(-50%\)/.test(rule) || !/left:\s*50%/.test(rule)) {
      throw new Error('the lane is no longer centered on its own width');
    }
    const decorate = readFileSync(join(root, 'src/assets/shell/decorate.js'), 'utf8');
    const wrap = decorate.slice(decorate.indexOf('function laneWideTables'), decorate.indexOf('function decorateBlockquoteLines'));
    if (!wrap) throw new Error('nothing wraps a table in a lane');
    for (const guard of ["tagName !== 'TABLE'", "classList.contains('data-table')", 'body.children']) {
      if (!wrap.includes(guard)) throw new Error(`the wrap no longer checks: ${guard}`);
    }
    // The lane is the reader's box, not the document's: everything that walks the body's blocks has to see through it, or an edit serializes the wrapper and finds no rows in it.
    const blocks = readFileSync(join(root, 'src/assets/shell/reading-blocks.js'), 'utf8');
    if (!blocks.includes("el.classList.contains('table-lane')")) {
      throw new Error('the range walk stamps the lane instead of the table inside it');
    }
    const controls = readFileSync(join(root, 'src/assets/shell/block-controls.js'), 'utf8');
    if ((controls.match(/unwrapTableLane/g) || []).length < 3) {
      throw new Error('the block gutter no longer sees through the lane to the table');
    }
    // The 62px strip is measured from the reader's edge, and the gutter from the text measure — so a widened table's handle lands on its first column unless it rides the lane.
    const place = controls.slice(controls.indexOf('function positionBlockGutter'), controls.indexOf('function blockGutterAnchorY'));
    if (!place.includes(".closest('.table-lane, .image-lane')")) {
      throw new Error('the drag handle is anchored to the text measure, so it sits on a widened table');
    }
    const render = readFileSync(join(root, 'src/assets/shell/render-document.js'), 'utf8');
    if (!render.includes('laneWideTables();')) throw new Error('nothing calls laneWideTables on a render');
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
