// Exporting the page: the paper it asks for, what it hands over, and the growl that opens what it wrote.

import { join } from 'node:path';
import vm from 'node:vm';
import {
  check,
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

  // A rendered document with each of the app's own controls inside it, a diagram already drawn, a block carrying what the renderer stamped on it, and the correction the rail parks on the live body. Real elements, so what the export hands over is the page's own markup rather than a string written here: a copy that read back the string it was given could not say whether a control was taken out at all.
  const DRAWN_DOCUMENT_MARKUP =
    '<div class="document-body" style="--reader-scroll-origin: 16px">' +
    '<h1>Release notes</h1>' +
    '<pre class="mermaid" data-processed="true"><svg class="flowchart lt-mmd-0"></svg></pre>' +
    // A style of the document's own, one element down: mermaid writes the drawn box's height there, so a copy that shed its whole attribute must still shed only its own.
    '<div class="mermaid-view" style="height: 420px"></div>' +
    '<button class="code-copy"></button>' +
    '<button class="image-sheet-open"></button>' +
    '<div class="mermaid-tools"></div>' +
    '<div class="mermaid-zoom"></div>' +
    '</div>';
  const drawnDocument = () => {
    const holder = fakeElement('');
    holder.innerHTML = DRAWN_DOCUMENT_MARKUP;
    const body = holder.children[0];
    // The one piece still handed in: the page has no `cloneNode` yet. A second element built from the same markup is what a copy is, so the live one and the copy the export works on are two things the way they are on the page.
    body.cloneNode = () => drawnDocument();
    return body;
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
    // Four kinds of control, every one of which does nothing on somebody else's machine. The copy button is one per fenced block, which is the one an earlier reading missed.
    for (const control of ['code-copy', 'image-sheet-open', 'mermaid-tools', 'mermaid-zoom']) {
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
      // The rules stay on until the host answers, so the render is laid out under the ones that were measured.
      if (!booted.document.body.classList.contains('leaf-paper')) {
        throw new Error('the paper rules came off before the render, so the sheet is sized for a layout the render will not use');
      }
    } finally {
      booted.window.leafHoldAppearance(false);
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

  // A Mac panel throws every label away, so the app draws the menu itself — and it draws it on a Mac browser reading the published site too, where every export ends in that browser's own print. So the rows have to be the host's rather than the page's: a row this page offered that its host could not write handed that reader a printed PDF and called it a picture.
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

  check('Pressing Export leaves exactly one hold for the host to give back', () => {
    // The hold counts rather than switches, so what the host has to undo is a number and the page is what sets it. It shipped as two — the page raised one and the host raised a second for the render, and only one came off — and the app was left wearing the paper, where every one of its own controls is hidden and the close button with them.
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
    // One, not two and not none: measuring the sheet raises and drops a hold of its own, and what is left standing is the one the render is laid out under.
    if (held !== 1) {
      throw new Error(`pressing Export left ${held} holds on the page, and the host gives back one`);
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
