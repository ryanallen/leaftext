// Exporting the page: the paper it asks for, what it hands over, and the growl that opens what it wrote.

import { join } from 'node:path';
import vm from 'node:vm';
import {
  check,
  checkSettled,
  fakeElement,
  record,
  runShell,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  check('Export asks for the file straight away and sends the page size with the format', () => {
    const sent = [];
    const ipc = booted.window.ipc;
    booted.window.ipc = { postMessage: (message) => sent.push(JSON.parse(message)) };
    try {
      booted.renderReaderToolbar(true);
      const button = booted.document.getElementById('exportPdfButton');
      (button.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
      const surface = booted.document.getElementById('appSurface');
      // Windows draws the formats as a dropdown inside the save window, so the window is the whole question and nothing opens over the page. The menu is a Mac panel's answer, where no label survives at all.
      if (surface.children.some((child) => String(child.className || '') === 'flow-menu')) {
        throw new Error('pressing Export opened a menu over the page where the save window asks the format itself');
      }
      const asked = sent.filter((one) => one.command === 'exportPdf');
      if (asked.length !== 1) throw new Error(`pressing Export sent ${asked.length} exports`);
      // Only the page knows how tall the document is, and that height is the whole of what makes the file one continuous page instead of a document chopped across sheets.
      if (asked[0].format !== '') throw new Error(`Export named ${asked[0].format} rather than leaving the save window every row to offer`);
      if (!(asked[0].height > 0) || !(asked[0].width > 0)) throw new Error(`the export carried no page size: ${JSON.stringify(asked[0])}`);
    } finally {
      booted.window.ipc = ipc;
      booted.renderReaderToolbar(false);
    }
  });

  // A waiting diagram, standing in a document body in front of the reader, with its drawing already in the picture memo so the draw the export starts finishes without the renderer. Real elements, so the export reads the block the way it reads one on the page.
  const WAITING_SOURCE = 'flowchart TD\n  A --> B';
  const waitingDocument = () => {
    const holder = fakeElement('');
    holder.innerHTML = '<div class="document-body"><h1>Release notes</h1><pre class="mermaid">flowchart TD A --> B</pre></div>';
    const body = holder.children[0];
    const diagram = body.querySelectorAll('pre.mermaid')[0];
    diagram.__mermaidSource = WAITING_SOURCE;
    diagram.isConnected = true;
    return { body, diagram };
  };
  const standDocument = (body) => {
    const reader = vm.runInContext('app', booted);
    const wasQuery = reader.querySelector;
    reader.querySelector = (selector) =>
      String(selector) === '.document-body' ? body : wasQuery.call(reader, selector);
    return () => {
      reader.querySelector = wasQuery;
    };
  };
  const rememberDrawing = () => {
    const memo = vm.runInContext('mermaidRenderCache', booted);
    memo.set(booted.mermaidCacheKey(WAITING_SOURCE), '<svg class="flowchart lt-mmd-0"></svg>');
    return () => memo.delete(booted.mermaidCacheKey(WAITING_SOURCE));
  };
  // The page's own promise chain: the draw resolves, the finally runs, the send goes out.
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  // One press at a time, and the page's own chain landed before the body ends. A chain of its own alongside the collector's would start the first press the moment this file is read, which is before any awaiting body has run — so the presses would interleave with them, and the hand-back after each body would put the page back under a press still in flight. The queue is the one that orders bodies, so a press is a body on it and the settle stays inside.
  const checkPressed = (name, run) =>
    checkSettled(name, async () => {
      try {
        await run();
      } finally {
        await settle();
      }
    });

  // Four rounds shipped an export that measured and sent while the diagrams below the window were still boxes, and the boxes printed as empty frames the right size. So the press draws first and sends after, with the document spinner up for the wait — and a document with nothing waiting sends the way it always did, in the same turn as the press.
  checkPressed('pressing Export with diagrams still waiting draws them before the measurement is sent, and with none waiting sends at once', async () => {
    const sent = [];
    const ipc = booted.window.ipc;
    const { body, diagram } = waitingDocument();
    const unstand = standDocument(body);
    const forget = rememberDrawing();
    const spinner = vm.runInContext('readerLoading', booted);
    booted.window.ipc = { postMessage: (message) => sent.push({ ...JSON.parse(message), drawn: diagram.dataset.processed === 'true' }) };
    try {
      booted.renderReaderToolbar(true);
      const button = booted.document.getElementById('exportPdfButton');
      (button.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
      if (sent.some((one) => one.command === 'exportPdf')) throw new Error('the export was sent in the same turn as the press while a diagram was still waiting to be drawn');
      if (spinner && spinner.hidden !== false) throw new Error('the document spinner was not raised for the wait');
      await settle();
      const asked = sent.filter((one) => one.command === 'exportPdf');
      if (asked.length !== 1) throw new Error(`the export was sent ${asked.length} times after the drawing finished`);
      if (!asked[0].drawn) throw new Error('the measurement went out while the diagram was still a box');
      if (!(asked[0].height > 0) || !(asked[0].width > 0)) throw new Error(`the export carried no page size: ${JSON.stringify(asked[0])}`);
      if (spinner && spinner.hidden !== true) throw new Error('the document spinner was left up after the measurement went out');
      if (vm.runInContext('mermaidExportDrawing', booted) !== 0) throw new Error('the export left its drawing pass counted as still running');
      // The recycler stays off until the reader scrolls again: the save window is open and the render is still to come.
      if (vm.runInContext('mermaidExportHolding', booted) !== true) throw new Error('the export dropped its hold on the recycler when the pass ended rather than at the reader’s next scroll');
      booted.readerScrollSettled();
      if (vm.runInContext('mermaidExportHolding', booted) !== false) throw new Error('the reader’s scroll settling did not end the export’s hold on the recycler');

      // Nothing waiting now: the same press sends in the same turn.
      sent.length = 0;
      (button.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
      const atOnce = sent.filter((one) => one.command === 'exportPdf');
      if (atOnce.length !== 1) throw new Error(`with every diagram drawn, pressing Export sent ${atOnce.length} exports in the turn of the press`);
    } finally {
      forget();
      unstand();
      booted.window.ipc = ipc;
      booted.renderReaderToolbar(false);
    }
  });

  // The first font load after a document opens repaints every drawing back to a box. A pass that met one mid-way found as many waiting as the round before and stopped, and a 67-diagram document exported the moment it opened printed 376 frames. So a round that shrank nothing is a round to run again, and the press still sends with the diagram drawn.
  checkPressed('a repaint landing after the first round leaves the press still drawing, and the measurement goes out with the diagram drawn', async () => {
    const sent = [];
    const ipc = booted.window.ipc;
    const { body, diagram } = waitingDocument();
    const unstand = standDocument(body);
    const forget = rememberDrawing();
    booted.window.ipc = { postMessage: (message) => sent.push({ ...JSON.parse(message), drawn: diagram.dataset.processed === 'true' }) };
    try {
      booted.renderReaderToolbar(true);
      const button = booted.document.getElementById('exportPdfButton');
      (button.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
      if (diagram.dataset.processed !== 'true') throw new Error('the first round did not draw the diagram out of the memo');
      // The repaint lands before the pass looks again, leaving the block the way the font repaint leaves every drawing: its source back in it and its drawn mark gone. Done on the block itself, because the repaint sweeps the reader element and this block stands in front of it rather than inside it.
      diagram.textContent = diagram.__mermaidSource;
      delete diagram.dataset.processed;
      if (diagram.dataset.processed === 'true') throw new Error('the repaint left the diagram drawn, so nothing here is being tested');
      await settle();
      const asked = sent.filter((one) => one.command === 'exportPdf');
      if (asked.length !== 1) throw new Error(`the export was sent ${asked.length} times after the repaint`);
      if (!asked[0].drawn) throw new Error('the pass gave up on the round the repaint reset and sent the diagram as a box');
      booted.readerScrollSettled();
    } finally {
      forget();
      unstand();
      booted.window.ipc = ipc;
      booted.renderReaderToolbar(false);
    }
  });

  // A block the decorating pass has not reached yet has no recorded source, and the draw reads the source rather than the element — so Export pressed the moment a document opens has to give such a block its own text, or it is skipped and prints as a frame.
  check('a diagram with no recorded source is drawn from its own text', () => {
    const { body, diagram } = waitingDocument();
    delete diagram.__mermaidSource;
    const unstand = standDocument(body);
    try {
      const waiting = booted.mermaidWaitingForExport();
      if (waiting.length !== 1) throw new Error(`${waiting.length} diagrams were found waiting where one was`);
      if (diagram.__mermaidSource !== diagram.textContent) throw new Error(`the block was given ${JSON.stringify(diagram.__mermaidSource)} as its source rather than its own text`);
      diagram.dataset.processed = 'true';
      if (booted.mermaidWaitingForExport().length) throw new Error('a drawn diagram was counted as waiting');
    } finally {
      unstand();
    }
  });

  // The Web page row hands over the document's own markup, and a box still waiting in it is a box on the exported page for good: nothing there will ever draw it. So the markup read after the press carries drawings and no waiting block.
  checkPressed('the markup the exported web page is built from carries no diagram still waiting to be drawn', async () => {
    const ipc = booted.window.ipc;
    const { body, diagram } = waitingDocument();
    const unstand = standDocument(body);
    const forget = rememberDrawing();
    booted.window.ipc = { postMessage: () => {} };
    try {
      booted.renderReaderToolbar(true);
      const button = booted.document.getElementById('exportPdfButton');
      (button.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
      await settle();
      if (diagram.dataset.processed !== 'true') throw new Error('pressing Export left the waiting diagram a box');
      const markup = vm.runInContext('pageExportMarkup', booted)();
      if (!markup.includes('<pre class="mermaid" data-processed="true">')) throw new Error(`the exported page carries a diagram still waiting to be drawn: ${markup}`);
      if (!markup.includes('<svg class="flowchart lt-mmd-0">')) throw new Error(`the drawing did not reach the exported page: ${markup}`);
      // The reader scrolls on, which is what lets the recycler back in after this press too.
      booted.readerScrollSettled();
    } finally {
      forget();
      unstand();
      booted.window.ipc = ipc;
      booted.renderReaderToolbar(false);
    }
  });

  // A rendered document with each of the app's own controls inside it, a diagram already drawn, a block carrying what the renderer stamped on it, and the correction the rail parks on the live body. Real elements, so what the export hands over is the page's own markup rather than a string written here: a copy that read back the string it was given could not say whether a control was taken out at all.
  const DRAWN_DOCUMENT_MARKUP =
    '<div class="document-body" style="--reader-scroll-origin: 16px">' +
    '<h1>Release notes</h1>' +
    '<pre class="mermaid" data-processed="true"><svg class="flowchart lt-mmd-0"></svg></pre>' +
    // A style of the document's own, one element down: mermaid writes the drawn box's height there, so a copy that shed its whole attribute must still shed only its own.
    '<div class="mermaid-view" style="height: 420px"></div>' +
    '<button class="code-copy"></button>' +
    '<div class="image-lane-corner"><button class="image-sheet-open"></button><button class="image-export-open"></button></div>' +
    '<div class="mermaid-tools"></div>' +
    '<div class="mermaid-zoom"></div>' +
    '</div>';
  const drawnDocument = () => {
    const holder = fakeElement('');
    holder.innerHTML = DRAWN_DOCUMENT_MARKUP;
    return holder.children[0];
  };

  // Stand the drawn document in front of the reader element, and hand back whatever the export made of it. A caller that wants to read the live element afterwards passes its own.
  const exportedMarkup = (live) => {
    const reader = vm.runInContext('app', booted);
    const wasQuery = reader.querySelector;
    const drawn = live || drawnDocument();
    reader.querySelector = (selector) =>
      String(selector) === '.document-body' ? drawn : wasQuery.call(reader, selector);
    try {
      return vm.runInContext('pageExportMarkup', booted)();
    } finally {
      reader.querySelector = wasQuery;
    }
  };

  check('The web page export hands over the document and none of the app that was drawn inside it', () => {
    const markup = exportedMarkup();
    // Nothing is drawn, fetched or run for the export: the diagram is already an SVG sitting in the document.
    if (!markup.includes('<svg class="flowchart lt-mmd-0">')) {
      throw new Error(`the drawn diagram did not travel with the document: ${markup}`);
    }
    if (!markup.includes('<h1>Release notes</h1>')) throw new Error(`the document itself did not travel: ${markup}`);
    // What the renderer stamped on a block travels with it: an exported page that lost it is one whose diagrams are drawn a second time by whatever opens the file.
    if (!markup.includes('<pre class="mermaid" data-processed="true">')) {
      throw new Error(`a block lost what the renderer stamped on it: ${markup}`);
    }
    // Four kinds of control, every one of which does nothing on somebody else's machine. The copy button is one per fenced block, which is the one an earlier reading missed; the picture s corner is a row, so both its buttons are named as well as the row that carries them.
    for (const control of ['code-copy', 'image-lane-corner', 'image-sheet-open', 'image-export-open', 'mermaid-tools', 'mermaid-zoom']) {
      if (markup.includes(control)) throw new Error(`the export carried the app's own ${control}: ${markup}`);
    }
  });

  check('The exported wrapper chain reserves no column for a rail it has not got', () => {
    const markup = exportedMarkup();
    // Every rule in the stylesheet is keyed on this chain, so a body without it renders unstyled.
    if (!markup.startsWith('<div class="app-surface"><main class="reader-shell has-document"><div class="reader-layout reader-layout-no-minimap">')) {
      throw new Error(`the exported document was not wrapped in the ancestors the stylesheet is keyed on: ${markup}`);
    }
    if (!markup.endsWith('</div></main></div>')) throw new Error(`the wrapper chain was left open: ${markup}`);
    // `has-minimap` is what sets the rail's column and the grid is what spends it, so a copy carrying it lays the document out beside an empty rail.
    if (markup.includes('has-minimap')) {
      throw new Error(`the export said it has a minimap it does not carry: ${markup}`);
    }
  });

  check('The exported page starts where the document starts, not where the app bar was', () => {
    const live = drawnDocument();
    const markup = exportedMarkup(live);
    // The rail writes this on the live body as a negative top margin, so the reader's scroll starts at the words rather than at the top of the box. An exported page has no bar, no card inset and no rail, so a copy wearing it opens with the title against the window's edge — or with as much of the document as the correction is wide scrolled off above it and no way back.
    if (markup.includes('--reader-scroll-origin')) {
      throw new Error(`the export carried the app's scroll-origin correction: ${markup}`);
    }
    // The whole attribute, because the renderer writes this element bare and the next correction parked there would be this fault over again.
    if (/<div class="document-body" style=/.test(markup)) {
      throw new Error(`the exported document body kept a style attribute: ${markup}`);
    }
    // Only the copy sheds it: the reader still needs the value, and everything inside the copy keeps its own.
    if (!live.getAttribute('style')) throw new Error('the export took the correction off the live document');
    if (!markup.includes('style="height: 420px"')) {
      throw new Error(`the export stripped a style from inside the document: ${markup}`);
    }
  });

  check('The page sends the paper the document needs and not the room its own controls take', () => {
    const sent = [];
    const ipc = booted.window.ipc;
    const surface = booted.document.getElementById('appSurface');
    const wasRect = surface.getBoundingClientRect;
    booted.window.ipc = { postMessage: (message) => sent.push(JSON.parse(message)) };
    // The sheet is the app surface's own box while the page is wearing the paper rules, and nothing else: three rounds of subtracting the reader's own measurements from a screen layout each left blank paper under the last line. So the surface answers one box while the class is on and a window-shaped one while it is off, and only the first may be sent.
    const paper = { width: 1277, height: 28207, top: 0, left: 0, right: 1277, bottom: 28207 };
    const screen = { width: 1611, height: 1281, top: 0, left: 0, right: 1611, bottom: 1281 };
    // The hold lives in the theme bootstrap, an inline script this harness never boots, so it stands in here doing the one thing the page depends on: the class.
    const wasHold = booted.window.leafHoldAppearance;
    let holding = 0;
    booted.window.leafHoldAppearance = (held) => {
      holding = Math.max(0, holding + (held ? 1 : -1));
      booted.document.body.classList.toggle('leaf-paper', holding > 0);
    };
    let heldWhenMeasured = null;
    surface.getBoundingClientRect = () => {
      const held = booted.document.body.classList.contains('leaf-paper');
      heldWhenMeasured = held;
      return held ? paper : screen;
    };
    try {
      booted.renderReaderToolbar(true);
      const button = booted.document.getElementById('exportPdfButton');
      (button.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
      const asked = sent.filter((one) => one.command === 'exportPdf');
      if (asked.length !== 1) throw new Error(`pressing Export sent ${asked.length} exports`);
      if (heldWhenMeasured !== true) throw new Error('the page measured itself before it was wearing the paper rules, which is the screen layout and not the sheet');
      if (asked[0].height !== paper.height || asked[0].width !== paper.width) {
        throw new Error(`the sheet was asked for at ${asked[0].width} x ${asked[0].height} rather than the ${paper.width} x ${paper.height} the paper rules lay out`);
      }
      // Measuring is synchronous, so the ask keeps the paper size while the reader is back on screen before the save window opens.
      if (booted.document.body.classList.contains('leaf-paper')) {
        throw new Error('the document was still wearing the paper rules when the export ask was sent');
      }
    } finally {
      booted.window.leafHoldAppearance = wasHold;
      surface.getBoundingClientRect = wasRect;
      booted.window.ipc = ipc;
      booted.renderReaderToolbar(false);
    }
  });

  check('Export stands only where there is a rendered page to print', () => {
    const button = booted.document.getElementById('exportPdfButton');
    const set = (source) => vm.runInContext(source, booted);
    try {
      // The home screen. The three views are three ways of showing one document, and here there is no document, so there is nothing to hand a print panel.
      booted.renderReaderToolbar(false);
      if (!button.hidden) throw new Error('the export action stood on the home screen, where there is no page to print');

      booted.renderReaderToolbar(true);
      if (button.hidden) throw new Error('a rendered document left the export action hidden');

      // The source view. Monaco realizes the lines it is drawing and nothing else, so what a print would give is whatever happened to be on screen rather than the file.
      set('codeViewActive = true;');
      booted.renderReaderToolbar(true);
      if (!button.hidden) throw new Error('the export action stood in the source view, where a print gives only the realized lines');

      // The map, which the print rules take down with the rest of the app's own controls, so a print there is a blank sheet.
      set('codeViewActive = false; graphViewOpen = true;');
      booted.renderReaderToolbar(true);
      if (!button.hidden) throw new Error('the export action stood on the map, which the print rules hide');
    } finally {
      set('codeViewActive = false; graphViewOpen = false;');
      booted.renderReaderToolbar(false);
    }
  });

  // A Mac panel throws every label away, so the app draws the menu itself — and it draws it on a Mac browser reading the published site too, where every export ends in that browser's own print. So the rows are the host's rather than the page's: a row the page offers that its host cannot write hands that reader a printed PDF and calls it a picture.
  const macPage = (extras) =>
    runShell(source, {
      navigator: { userAgent: 'Macintosh; Intel Mac OS X 10_15_7', platform: 'MacIntel', clipboard: { writeText: () => {} } },
      ...extras,
    });
  const macMenuRows = (page) => {
    page.renderReaderToolbar(true);
    const button = page.document.getElementById('exportPdfButton');
    (button.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
    const surface = page.document.getElementById('appSurface');
    const menu = surface.children.find((child) => String(child.className || '').includes('flow-menu'));
    if (!menu) throw new Error('a Mac pressed Export and no menu opened, so the panel is the only question and it shows no format at all');
    const labels = [];
    (function walk(node) {
      for (const child of node.children) {
        const text = String(child.textContent || '').trim();
        if (String(child.className || '').includes('flow-menu-item') && text) labels.push(text.split('\n')[0].trim());
        else walk(child);
      }
    })(menu);
    return labels;
  };

  check('A Mac is offered the rows its own host says it writes, and no others', () => {
    const sent = [];
    const page = macPage({
      ipc: { postMessage: (message) => sent.push(JSON.parse(message)) },
      // What the desktop seeds: its own save-window table, in the order that window offers it.
      __leafPageExports: [
        { id: 'pdf', label: 'PDF document' },
        { id: 'html', label: 'Web page' },
        { id: 'png', label: 'PNG picture' },
      ],
    });
    const labels = macMenuRows(page);
    const named = labels.filter((label) => ['PDF document', 'Web page', 'PNG picture'].includes(label));
    if (named.length !== 3) {
      throw new Error(`the host named three rows and the menu drew ${JSON.stringify(labels)}`);
    }
    // The order is the save window's, and it is load-bearing: a file typed with no ending is named off the first row.
    if (named[0] !== 'PDF document') {
      throw new Error(`the menu opened with ${named[0]} rather than the row a bare name is written under`);
    }
    // A row the host never named must not be there at all — that is the whole point of asking it.
    for (const absent of ['WebP picture', 'JPEG picture']) {
      if (labels.includes(absent)) throw new Error(`the menu offered ${absent}, which this host never said it writes`);
    }
  });

  // The JPEG row, which is the one the host offers on both platforms and the one a reader picks when whatever they are handing the file to will not take a WebP. Driven rather than read: the menu is drawn from what the host injected, so a row with no words under it and a row that sends the wrong ending both look right in the source.
  check('A Mac offered the JPEG row draws it last, with its own line, and pressing it asks for that ending', () => {
    const sent = [];
    const page = macPage({
      ipc: { postMessage: (message) => sent.push(JSON.parse(message)) },
      // The whole of what the desktop seeds today, in the order the save window offers it.
      __leafPageExports: [
        { id: 'pdf', label: 'PDF document' },
        { id: 'html', label: 'Web page' },
        { id: 'png', label: 'PNG picture' },
        { id: 'webp', label: 'WebP picture' },
        { id: 'jpg', label: 'JPEG picture' },
      ],
    });
    const labels = macMenuRows(page);
    if (labels[labels.length - 1] !== 'JPEG picture') {
      throw new Error(`the menu ends with ${JSON.stringify(labels[labels.length - 1])} rather than with the row that goes under the pictures`);
    }
    // Every row this page has words for says what it is, and the menu carries them as the button's own title. A row drawn with nothing there is one a reader has to guess at, and JPEG is the row most worth explaining.
    const surface = page.document.getElementById('appSurface');
    const menu = surface.children.find((child) => String(child.className || '').includes('flow-menu'));
    let jpeg = null;
    (function walk(node) {
      for (const child of node.children) {
        const text = String(child.textContent || '').trim();
        if (String(child.className || '').includes('flow-menu-item') && text.startsWith('JPEG picture')) jpeg = child;
        else walk(child);
      }
    })(menu);
    if (!jpeg) throw new Error('the JPEG row was drawn and cannot be found to press');
    if (!String(jpeg.title || '').includes('WebP')) {
      throw new Error(`the JPEG row carries no line saying what it is for: ${JSON.stringify(String(jpeg.title || ''))}`);
    }
    (jpeg.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
    const asked = sent.filter((one) => one.command === 'exportPdf').pop();
    if (!asked) throw new Error('pressing the JPEG row asked nowhere for a file');
    if (asked.format !== 'jpg') {
      throw new Error(`pressing the JPEG row asked for ${JSON.stringify(asked.format)}, so the panel would be left the wrong row`);
    }
  });

  check('A host that names no rows still prints, and offers nothing it cannot write', () => {
    const sent = [];
    // A browser reading the published site: no save window, no disk, and `exportPdf` reaching `window.print()`. Its own seeded row is the one it can honestly answer.
    const page = macPage({
      ipc: { postMessage: (message) => sent.push(JSON.parse(message)) },
      __leafPageExports: undefined,
    });
    const labels = macMenuRows(page);
    if (labels.length !== 1 || labels[0] !== 'PDF') {
      throw new Error(`a host that named nothing was drawn as ${JSON.stringify(labels)} rather than the one row every host has`);
    }
    // And pressing it still reaches the command a browser answers with its own print.
    const menu = page.document.getElementById('appSurface').children.find((child) => String(child.className || '').includes('flow-menu'));
    let pressed = null;
    (function walk(node) {
      for (const child of node.children) {
        if (String(child.className || '').includes('flow-menu-item') && !pressed) pressed = child;
        else walk(child);
      }
    })(menu);
    (pressed.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
    const asked = sent.filter((one) => one.command === 'exportPdf');
    if (asked.length !== 1) throw new Error(`the one row a host with no table offers sent ${asked.length} exports`);
    if (asked[0].format !== 'pdf') throw new Error(`it asked for ${asked[0].format} rather than the row it was drawn as`);
  });

  check('Pressing Export leaves the reader as it was when the save window opens', () => {
    // Measuring raises and drops its own hold before the ask leaves, so the save window never stands over the paper layout.
    const sent = [];
    const page = runShell(source, { ipc: { postMessage: (message) => sent.push(JSON.parse(message)) } });
    let held = 0;
    page.window.leafHoldAppearance = (on) => {
      held = Math.max(0, held + (on ? 1 : -1));
    };
    page.renderReaderToolbar(true);
    const button = page.document.getElementById('exportPdfButton');
    (button.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
    if (sent.filter((one) => one.command === 'exportPdf').length !== 1) {
      throw new Error('pressing Export did not ask for one export');
    }
    if (held !== 0) {
      throw new Error(`pressing Export left ${held} holds on the page before the save window opened`);
    }
  });

  check('The saved growl opens the file it names', () => {
    // Its own boot: the growl slot replaces itself, so a shared page carries whatever an earlier check left in it.
    const sent = [];
    const page = runShell(source, { ipc: { postMessage: (message) => sent.push(JSON.parse(message)) } });
    const written = 'C:\\Users\\reader\\Documents\\quarterly review.pdf';
    page.window.leafFileWritten(written);
    const surface = page.document.getElementById('appSurface');
    const growl = surface.children.filter((child) => String(child.className || '').includes('app-toast')).pop();
    if (!growl) throw new Error('a file was written and nothing was said');
    // The path itself takes the press, not a button beside it: it is what the reader reaches for.
    const pressable = (growl.children || []).find((child) => String(child.className || '') === 'app-toast-link');
    if (!pressable) throw new Error(`the path was drawn as plain words, so there is nothing to press: ${(growl.children || []).map((child) => child.className).join(',') || growl.textContent}`);
    if (String(pressable.textContent) !== written) throw new Error(`the press carried ${pressable.textContent} rather than the file`);
    (pressable.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
    const asked = sent.filter((one) => one.command === 'openExternal');
    if (asked.length !== 1) throw new Error(`pressing the path sent ${asked.length} opens`);
    if (asked[0].url !== written) throw new Error(`the open asked for ${asked[0].url} rather than the file just written`);
    // Gone as it is pressed: the file has been handed to another program, so a second press on the same offer is not left standing.
    if (surface.children.includes(growl)) throw new Error('the growl stayed up after its path was pressed');
  });
}
