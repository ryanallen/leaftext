// Taking a diagram out of the page, and the endings the save window answers with.

import { join } from 'node:path';
import vm from 'node:vm';
import { check, checkLendingTheWindow, diagramStand, readingCss, record, runShell, source } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;
  const { drawnDiagram } = diagramStand(booted);

  // ---- taking a diagram out of the page --------------------------------------
  //
  // The chip in a diagram's own corner is a reader's way to the two exports, which a shut padlock and a flowchart-only editor otherwise keep. So what is driven below is the page's own builder and the page's own menu, never the helpers under them.


  // The walk up from the button, which the stand-in cannot do: the page asks the chip what block it is in and whether it is inside the full-window view. Its corner is put 2000px out, so where the menu lands says whether it was clamped.
  const exportChipOn = (block) => {
    const chip = block.__find('mermaid-export');
    if (!chip) throw new Error('the diagram carries no export button');
    chip.closest = (selector) => (String(selector) === 'pre.mermaid' ? block : null);
    chip.getBoundingClientRect = () => ({ left: 2000, top: 40, right: 2028, bottom: 68, width: 28, height: 28 });
    return chip;
  };

  const exportMenuOn = (host) => host.children.find((child) => String(child.className || '') === 'flow-menu');
  const exportRow = (host, label) => {
    const menu = exportMenuOn(host);
    if (!menu) throw new Error('no menu was opened');
    const row = menu.children.find((child) => (child.children[0] || {}).textContent === label);
    if (!row) throw new Error(`the menu has no ${label} row`);
    return row;
  };
  const press = (row) => (row.listeners.get('click') || []).forEach((handler) => handler());
  // Export asks where the file goes and draws nothing until the answer comes back, so choosing a format is answering the save window with a name that ends in it.
  const answerSaveWindow = (sent, ending) => {
    const ask = sent.filter((one) => one.command === 'pickDiagramPath').pop();
    if (!ask) throw new Error('Export asked nobody where the file goes, so no save window ever opened');
    booted.window.leafDiagramPathPicked(ask.token, '/out/diagram.' + ending);
  };
  // The press hands off to a chain of promises, so the check waits for it to reach an answer rather than for a number of turns somebody counted.
  const settle = async (answered, turns = 40) => {
    for (let at = 0; at < turns && !answered(); at += 1) await Promise.resolve();
  };

  check('a diagram on a locked page carries the export button and no editing buttons', () => {
    // The page boots locked, which is the state this whole subject exists for.
    if (booted.readerEditingAllowed()) throw new Error('the page under test was not locked');
    const block = drawnDiagram('flowchart TD\n  X1 --> X2');
    booted.addMermaidControls(block);
    const chip = block.__find('mermaid-export');
    if (!chip) throw new Error('a locked page lost the export button along with the editing pair');
    if (!String(chip.innerHTML).includes('lt-icon-export')) throw new Error('the export button wears no icon');
    if (block.__find('mermaid-tools')) throw new Error('the editing pair came through the padlock');
    const row = block.__find('mermaid-view-controls');
    if (!row) throw new Error('the top-right controls are not one row');
    // Export first: its own rounded control, left of the segmented four.
    if (row.children[0] !== chip || !String(row.children[1].className).includes('mermaid-zoom')) {
      throw new Error('the export chip is not left of the zoom group');
    }
    if (row.children[1].children.length !== 4) throw new Error('the four view buttons did not stay one group');
    // Built once, however many times the page redraws around it.
    booted.addMermaidControls(block);
    if (block.children.filter((child) => String(child.className).includes('mermaid-view-controls')).length !== 1) {
      throw new Error('a second pass built the row all over again');
    }
  });

  // Neither export reads a flowchart model — mermaid is handed a string — so the kinds that could never open in the editor at all are the ones this reaches first.
  check('a pie chart and a sequence diagram each carry the export button', () => {
    for (const source of ['pie title Pets\n  "Dogs" : 6\n  "Cats" : 4', 'sequenceDiagram\n  A->>B: hello']) {
      const block = drawnDiagram(source);
      booted.addMermaidControls(block);
      if (!block.__find('mermaid-export')) throw new Error(`a ${source.split(/\s/)[0]} diagram was left with no way out`);
    }
  });

  // The sheet a diagram is printed on. The shipped paper class does the opposite of what this needs on its own — it computes the full-window diagram to `display: none` and grows the surface to the whole document — so a print under it alone would be the note with the drawing missing. The cascade is what decides this and the stand-in page has none, so the rule is read off the stylesheet the way the other CSS checks here are.
  check('a printed diagram is the only thing left on the sheet', () => {
    if (!booted.document.getElementById('diagramPrint')) throw new Error('the page has no container to print a diagram in');
    const css = readingCss();
    // Anchored at the start of a line, so a rule under a wider selector cannot answer for one keyed on the container itself.
    const rule = (selector, paint) => css.includes('\n' + selector + ' {' + '\n' + '  ' + paint + ';');
    if (!rule('.diagram-print', 'display: none')) throw new Error('the print container is not out of the layout until an export fills it');
    if (!rule('body.leaf-paper-diagram .diagram-print', 'display: block')) throw new Error('the print state does not put the container on the sheet');
    if (!rule('body.leaf-paper-diagram .app-surface > :not(.diagram-print)', 'display: none')) throw new Error('the print state leaves the rest of the app on the sheet');
  });

  check('on Windows a diagram asks where it goes and opens nothing over the page', () => {
    const surface = booted.document.getElementById('appSurface');
    const wasSend = booted.ipc.postMessage;
    const sent = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    try {
      const block = drawnDiagram('flowchart TD\n  K1 --> K2');
      booted.addMermaidControls(block);
      booted.openMermaidExportMenu(exportChipOn(block));
      // On Windows the save window carries the three formats in its own dropdown, so a menu here would be the same question asked twice. The check below boots a Mac, where that dropdown does not exist and the menu is the only place the question is ever put.
      if (exportMenuOn(surface)) throw new Error('on Windows Export opened a menu over the page, where the save window is already asking');
      const asked = sent.filter((one) => one.command === 'pickDiagramPath');
      if (asked.length !== 1) throw new Error(`pressing Export asked ${asked.length} times where the file goes`);
      if (!(asked[0].token > 0)) throw new Error(`the ask carried no export to answer: ${JSON.stringify(asked[0])}`);
      // Nobody was asked, so the window is handed no answer and keeps every row in its dropdown.
      if ('format' in asked[0]) throw new Error(`on Windows the ask named ${asked[0].format}, which takes the other two out of the dropdown`);
      // Nothing is drawn before the answer: that is what stops two pictures nobody asked for being made.
      if (sent.some((one) => one.command === 'exportDiagram')) throw new Error('a diagram was encoded before anybody said where it goes');
    } finally {
      booted.ipc.postMessage = wasSend;
    }
  });

  // The one branch nothing in this suite had ever run: every page it boots reports its platform as `test`, so the Mac half of the export was unread. A page of its own is booted rather than the shared one repointed, because the platform is read once as the page loads into a value the fragments then share.
  check('on a Mac Export asks the format first, and the answer reaches the save window', () => {
    const mac = runShell(source, {
      navigator: { userAgent: 'leaf-check', platform: 'MacIntel', clipboard: { writeText: () => {} } },
    });
    const surface = mac.document.getElementById('appSurface');
    const sent = [];
    mac.ipc.postMessage = (text) => sent.push(JSON.parse(text));

    const block = drawnDiagram('flowchart TD\n  Q1 --> Q2', mac);
    mac.addMermaidControls(block);
    mac.openMermaidExportMenu(exportChipOn(block));

    const menu = exportMenuOn(surface);
    if (!menu) throw new Error('a Mac was handed a save window with no format in it and nothing asked beforehand');
    const rows = menu.children.map((child) => (child.children[0] || {}).textContent);
    if (String(rows) !== 'Markdown,PNG,WebP,PDF,JPEG') throw new Error(`the menu offers ${rows.join(', ') || 'nothing'}`);
    // Nothing is asked and nothing is drawn until a row is pressed: a save window opened here would be the second question.
    if (sent.length) throw new Error(`opening the menu already sent ${sent.map((one) => one.command).join(', ')}`);

    press(exportRow(surface, 'PNG'));
    if (exportMenuOn(surface)) throw new Error('the menu stayed open over the page after a format was picked');
    const asked = sent.filter((one) => one.command === 'pickDiagramPath');
    if (asked.length !== 1) throw new Error(`picking a format asked ${asked.length} times where the file goes`);
    if (asked[0].format !== 'png') throw new Error(`the save window was told ${JSON.stringify(asked[0].format)} rather than the format that was picked`);
    if (!(asked[0].token > 0)) throw new Error(`the ask carried no export to answer: ${JSON.stringify(asked[0])}`);
    // Still nothing drawn: the picture is made once the path comes back, which is what stops one nobody asked for.
    if (sent.some((one) => one.command === 'exportDiagram')) throw new Error('a diagram was encoded before anybody said where it goes');

    // The flowchart sheet's own Export is the third button and the second call site, and it drops its menu on the sheet rather than on the page under it.
    vm.runInContext('flowCode.value = "flowchart TD\\n  S1 --> S2"; flowSession = { text: flowCode.value };', mac);
    const sheetExport = mac.document.getElementById('flowSheetExport');
    (sheetExport.listeners.get('click') || []).forEach((handler) => handler());
    const sheet = mac.document.getElementById('flowSheet');
    if (!exportMenuOn(sheet)) throw new Error('the flowchart sheet’s Export opened no menu on a Mac');
    if (exportMenuOn(surface)) throw new Error('the sheet’s menu was put on the page under it');
    press(exportRow(sheet, 'WebP'));
    const fromSheet = sent.filter((one) => one.command === 'pickDiagramPath').pop();
    if (fromSheet.format !== 'webp') throw new Error(`the sheet asked for ${JSON.stringify(fromSheet.format)}`);

    // The menu is a suggestion, the typed name is the answer. A reader who picks one format and then types another ending gets what they typed — the format is never read back off the ask, so no second answer exists to reconcile with the path.
    mac.window.leafDiagramPathPicked(fromSheet.token, '/out/diagram.md');
    const written = sent.filter((one) => one.command === 'exportDiagram').pop();
    if (!written || written.format !== 'md') {
      throw new Error(`picking WebP and typing a name ending in md wrote ${JSON.stringify((written || {}).format) || 'nothing'}`);
    }
    if (written.path !== '/out/diagram.md') throw new Error(`the write carried ${JSON.stringify(written.path)} rather than the name the reader typed`);
  });

  // The other window that panel opens, and the same silence: the first Save of a note that has never had a file. The formats are handed in rather than written here, which is how the page is held to keeping none of its own — the host injects them off `src/format.rs`, and a sixth row appears because the table gained one.
  check('on a Mac the first Save of a new note asks the format first, and on Windows it does not', () => {
    const readable = [
      { label: 'Markdown', ext: 'md' },
      { label: 'XML', ext: 'xml' },
      { label: 'JSON', ext: 'json' },
      { label: 'YAML', ext: 'yaml' },
      { label: 'Email', ext: 'eml' },
    ];
    const jobs = [];
    const boot = (platform, formats) => {
      const page = runShell(source, {
        navigator: { userAgent: 'leaf-check', platform, clipboard: { writeText: () => {} } },
        // The save waits a turn for whatever is being typed to commit, and the stand-in page swallows a timer by default.
        setTimeout: (fn) => {
          jobs.push(fn);
          return 0;
        },
        __leafDocumentFormats: formats,
      });
      jobs.length = 0;
      const note = { title: 'Untitled', path: 'Untitled.md', dirty: true, undoable: false, redoable: false, untitled: true };
      vm.runInContext(`currentState = { recent: [], favorites: [], tabs: [${JSON.stringify(note)}], active: 0, document: null }; dirtyByPath.set('Untitled.md', true);`, page);
      const button = page.document.getElementById('saveButton');
      button.getBoundingClientRect = () => ({ left: 240, top: 8, right: 300, bottom: 36, width: 60, height: 28 });
      return { page, button };
    };
    const drain = () => {
      while (jobs.length) jobs.shift()();
    };

    const mac = boot('MacIntel', readable);
    const macSent = [];
    mac.page.ipc.postMessage = (text) => macSent.push(JSON.parse(text));
    (mac.button.listeners.get('click') || []).forEach((handler) => handler());
    drain();
    const surface = mac.page.document.getElementById('appSurface');
    const menu = exportMenuOn(surface);
    if (!menu) throw new Error('a Mac was handed the Save Document As window with no format in it and nothing asked beforehand');
    const rows = menu.children.map((child) => (child.children[0] || {}).textContent);
    if (String(rows) !== String(readable.map((one) => one.label))) throw new Error(`the menu offers ${rows.join(', ') || 'nothing'}`);
    // A note cannot become a format nobody picked: nothing is written while the question stands.
    if (macSent.length) throw new Error(`opening the menu already sent ${macSent.map((one) => one.command).join(', ')}`);

    press(exportRow(surface, 'YAML'));
    drain();
    const saved = macSent.filter((one) => one.command === 'saveDocument');
    if (saved.length !== 1) throw new Error(`picking a format saved ${saved.length} times`);
    if (saved[0].format !== 'yaml') throw new Error(`the save window was told ${JSON.stringify(saved[0].format)} rather than the format that was picked`);

    // The rows are the host's list and nothing else: a table with a sixth format in it draws six.
    const sixth = boot('MacIntel', readable.concat([{ label: 'Rich text', ext: 'rtf' }]));
    sixth.page.ipc.postMessage = () => {};
    (sixth.button.listeners.get('click') || []).forEach((handler) => handler());
    drain();
    const grown = exportMenuOn(sixth.page.document.getElementById('appSurface'));
    const grownRows = grown ? grown.children.map((child) => (child.children[0] || {}).textContent) : [];
    if (String(grownRows.slice(-1)) !== 'Rich text') throw new Error(`a format added to the app's table drew ${grownRows.join(', ') || 'nothing'}`);

    // Windows asks inside the window it opens, so the press writes straight through and nothing stands over the page.
    const win = boot('Win32', readable);
    const winSent = [];
    win.page.ipc.postMessage = (text) => winSent.push(JSON.parse(text));
    (win.button.listeners.get('click') || []).forEach((handler) => handler());
    drain();
    if (exportMenuOn(win.page.document.getElementById('appSurface'))) throw new Error('on Windows Save opened a menu over the page, where the window is already asking');
    const wrote = winSent.filter((one) => one.command === 'saveDocument');
    if (wrote.length !== 1) throw new Error(`on Windows Save sent ${winSent.map((one) => one.command).join(', ') || 'nothing'}`);
    if ('format' in wrote[0]) throw new Error(`on Windows the save named ${wrote[0].format}, which takes the other four out of the dropdown`);
  });

  check('an ending the app does not write is refused, and nothing is', () => {
    const wasSend = booted.ipc.postMessage;
    const wasToast = booted.leafToast;
    const sent = [];
    const said = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.leafToast = (words) => said.push(words);
    try {
      const block = drawnDiagram('flowchart TD\n  K3 --> K4');
      booted.addMermaidControls(block);
      booted.openMermaidExportMenu(exportChipOn(block));
      answerSaveWindow(sent, 'svg');
      if (sent.some((one) => one.command === 'exportDiagram')) throw new Error('a name ending in svg was written as some format nobody asked for');
      if (said.length !== 1) throw new Error(`it said ${said.join(' / ') || 'nothing'}`);
      // The refusal names the three it does write, so the reader knows what to type instead.
      if (!/Markdown/.test(said[0]) || !/PNG/.test(said[0]) || !/WebP/.test(said[0])) {
        throw new Error(`the refusal left the reader nowhere to go: ${said[0]}`);
      }

      // A second answer to an export already spent is ignored: the window is gone and the source with it.
      const ask = sent.filter((one) => one.command === 'pickDiagramPath').pop();
      booted.window.leafDiagramPathPicked(ask.token, '/out/diagram.md');
      if (sent.some((one) => one.command === 'exportDiagram')) throw new Error('an answer to a finished export wrote a file anyway');
    } finally {
      booted.ipc.postMessage = wasSend;
      booted.leafToast = wasToast;
    }
  });

  // Every spelling of Markdown the app opens is one this window writes: refusing `.markdown` in the sentence that offers Markdown reads as the app not knowing its own format.
  check('a name ending in any spelling of Markdown is written, not refused', () => {
    for (const ending of ['md', 'markdown', 'mdown']) {
      const wasSend = booted.ipc.postMessage;
      const wasToast = booted.leafToast;
      const sent = [];
      const said = [];
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      booted.leafToast = (words) => said.push(words);
      try {
        const block = drawnDiagram('flowchart TD\n  M1 --> M2');
        booted.addMermaidControls(block);
        booted.openMermaidExportMenu(exportChipOn(block));
        answerSaveWindow(sent, ending);
        if (said.length) throw new Error(`a name ending in ${ending} was refused: ${said.join(' / ')}`);
        const wrote = sent.filter((one) => one.command === 'exportDiagram');
        if (wrote.length !== 1) throw new Error(`a name ending in ${ending} wrote ${wrote.length} files`);
        // The row's own id, whichever spelling the reader typed: the host is asked one format and writes the mermaid text under it.
        if (wrote[0].format !== 'md') throw new Error(`a name ending in ${ending} sent ${JSON.stringify(wrote[0].format)} rather than md`);
        if (!String(wrote[0].data).includes('M1 --> M2')) throw new Error(`what went out under ${ending} is not the diagram: ${JSON.stringify(wrote[0].data)}`);
        if (wrote[0].path !== '/out/diagram.' + ending) throw new Error(`the file went somewhere other than the name the reader typed: ${wrote[0].path}`);
      } finally {
        booted.ipc.postMessage = wasSend;
        booted.leafToast = wasToast;
      }
    }
  });

  check('a menu given a host is clamped inside it, and the editor keeps the sheet', () => {
    const surface = booted.document.getElementById('appSurface');
    const wasRect = surface.getBoundingClientRect;
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700 });
    const rows = [{ label: 'Duplicate', run: () => {} }, { label: 'Detach', run: () => {} }];
    try {
      // Not the reader, which is the scrolling box: a menu hung inside it is cut off at its edge.
      booted.openFlowMenuWith(2000, 40, rows, surface);
      const menu = exportMenuOn(surface);
      if (!menu) throw new Error('a menu given the app surface was not put on it');
      if (menu.style.left !== '892px') throw new Error(`the menu sits at ${menu.style.left} rather than clamped inside the surface`);
      booted.closeFlowMenu();

      // The editor asks for no host and keeps the one it always had.
      booted.openFlowMenuWith(10, 10, rows);
      const sheet = booted.document.getElementById('flowSheet');
      if (!exportMenuOn(sheet)) throw new Error('the flowchart canvas’s own menu left the sheet');
      if (exportMenuOn(surface)) throw new Error('the canvas’s menu was put on the page instead');
    } finally {
      booted.closeFlowMenu();
      surface.getBoundingClientRect = wasRect;
    }
  });

  check('Markdown sends the block’s own text in a mermaid fence', () => {
    const surface = booted.document.getElementById('appSurface');
    const wasSend = booted.ipc.postMessage;
    const sent = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    try {
      const first = drawnDiagram('flowchart TD\n  M1 --> M2');
      booted.addMermaidControls(first);
      booted.openMermaidExportMenu(exportChipOn(first));
      answerSaveWindow(sent, 'md');
      const written = sent.filter((one) => one.command === 'exportDiagram');
      if (written.length !== 1 || written[0].format !== 'md') {
        throw new Error(`naming a file .md sent ${sent.map((one) => one.command).join(', ') || 'nothing'}`);
      }
      if (written[0].data !== '```mermaid\nflowchart TD\n  M1 --> M2\n```\n') {
        throw new Error(`the file would hold ${JSON.stringify(written[0].data)}`);
      }
      // The path the reader chose travels with the bytes, so the host opens no second window.
      if (written[0].path !== '/out/diagram.md') throw new Error(`the write carried ${JSON.stringify(written[0].path)} rather than the name the reader gave`);

      // The second diagram in the page exports its own text, not the first one's: the chip holds nothing, and the source is read off the block it was pressed on.
      const second = drawnDiagram('sequenceDiagram\n  M3->>M4: hello');
      booted.addMermaidControls(second);
      booted.openMermaidExportMenu(exportChipOn(second));
      answerSaveWindow(sent, 'md');
      const both = sent.filter((one) => one.command === 'exportDiagram');
      if (both.length !== 2 || !both[1].data.includes('M3->>M4')) {
        throw new Error('the second diagram exported the first one’s text');
      }
    } finally {
      booted.ipc.postMessage = wasSend;
    }
  });

  // The picture checks all lend the same globals — a canvas, an `Image`, `btoa` — so they run one after another, on the one queue every lending check shares. The picture export beside this one lends the same window, so a queue of this file's own would let the two interleave.
  const checkPicture = checkLendingTheWindow;

  // A window that can draw one, which is where the three picture rows part: PNG hands the host raw pixels to encode, WebP and JPEG hand it a file the canvas already wrote. The stand-in page has no canvas at all, so one is lent for the length of the check.
  const withCanvas = (answer) => {
    const original = booted.document.createElement;
    const was = { send: booted.ipc.postMessage, toast: booted.leafToast, drawing: booted.diagramDrawingSvg, image: booted.Image, btoa: booted.btoa };
    const sent = [];
    const said = [];
    // Every encode the canvas was asked for, so a row refused before it reached one is told apart from a row that encoded and threw.
    const asked = [];
    // Only the export, because a check running beside this one reports its own faults down the same pipe.
    booted.ipc.postMessage = (text) => {
      const one = JSON.parse(text);
      if (one.command === 'exportDiagram' || one.command === 'pickDiagramPath') sent.push(one);
    };
    booted.leafToast = (words) => said.push(words);
    booted.diagramDrawingSvg = async () => '<svg viewBox="0 0 200 100"></svg>';
    booted.btoa = (binary) => Buffer.from(binary, 'binary').toString('base64');
    booted.Image = class {
      set src(unused) {
        this.naturalWidth = answer.wide || 200;
        this.naturalHeight = 100;
        Promise.resolve().then(() => this.onload && this.onload());
      }
    };
    booted.document.createElement = (tag) => {
      const made = original.call(booted.document, tag);
      if (String(tag).toLowerCase() === 'canvas') {
        made.getContext = () => ({
          fillRect: () => {},
          drawImage: () => {},
          // Four bytes, one white pixel: what the PNG row reads off the canvas.
          getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
        });
        // A real canvas asked for a type it cannot write answers a PNG, which is the case the type check exists for. The type asked for is honored otherwise, so a row that sent the wrong one is caught here rather than in a file somebody opens.
        made.toDataURL = (type, quality) => {
          asked.push({ type: String(type), quality });
          if (answer.cannotWrite) return 'data:image/png;base64,UE5H';
          // The first bytes of a real JPEG, so what the page forwards can be read as one rather than taken on trust.
          if (String(type) === 'image/jpeg') return 'data:image/jpeg;base64,/9j/4AAQ';
          return 'data:image/webp;base64,V0VCUA==';
        };
      }
      return made;
    };
    return {
      sent,
      said,
      asked,
      done: () => {
        booted.closeFlowMenu();
        booted.document.createElement = original;
        booted.ipc.postMessage = was.send;
        booted.leafToast = was.toast;
        booted.diagramDrawingSvg = was.drawing;
        booted.Image = was.image;
        booted.btoa = was.btoa;
      },
    };
  };

  checkPicture('the ending the reader chose is the one encoded, and WebP sends a finished file where PNG sends pixels', async () => {
    const lent = withCanvas({});
    const written = () => lent.sent.filter((one) => one.command === 'exportDiagram');
    try {
      const block = drawnDiagram('flowchart TD\n  W1 --> W2');
      booted.addMermaidControls(block);
      booted.openMermaidExportMenu(exportChipOn(block));
      answerSaveWindow(lent.sent, 'webp');
      await settle(() => written().length || lent.said.length);
      if (lent.said.length) throw new Error(`WebP refused: ${lent.said.join(' / ')}`);
      const webp = written()[0];
      if (!webp || webp.format !== 'webp') throw new Error(`a name ending in webp sent ${JSON.stringify(webp) || 'nothing'}`);
      // The file itself, not pixels for the host to encode — which is the whole of why WebP is cheaper than PNG.
      if (webp.data !== 'V0VCUA==') throw new Error(`WebP sent ${JSON.stringify(webp.data)} rather than the canvas's own bytes`);
      if (webp.width || webp.height) throw new Error('a finished file was sent with pixel dimensions beside it');

      booted.openMermaidExportMenu(exportChipOn(block));
      answerSaveWindow(lent.sent, 'png');
      await settle(() => written().length > 1 || lent.said.length);
      const png = written()[1];
      if (!png || png.format !== 'png') throw new Error(`a name ending in png sent ${JSON.stringify(png) || 'nothing'}`);
      if (png.data !== '/////w==' || png.width !== 400 || png.height !== 200) {
        throw new Error(`PNG sent ${JSON.stringify(png.data)} at ${png.width}×${png.height} rather than pixels at twice life size`);
      }
      // One picture per export, never all three: nothing is drawn until the window has answered.
      if (written().length !== 2) throw new Error(`two exports made ${written().length} files`);
    } finally {
      lent.done();
    }
  });

  // v1.24.0 measured it: a fifty-step left-to-right flowchart is 16,872 pixels across at export size, so this is a diagram somebody draws rather than a guard against the absurd. The canvas answers an empty URL rather than throwing, so a row that did not check would save a six-byte file.
  checkPicture('a drawing too big for WebP is refused out loud, and a window that cannot write one says so instead', async () => {
    for (const [answer, expected] of [[{ wide: 9000 }, /too big/i], [{ cannotWrite: true }, /cannot write WebP/i]]) {
      const lent = withCanvas(answer);
      const written = () => lent.sent.filter((one) => one.command === 'exportDiagram');
      try {
        const block = drawnDiagram('flowchart LR\n  W3 --> W4');
        booted.addMermaidControls(block);
        booted.openMermaidExportMenu(exportChipOn(block));
        answerSaveWindow(lent.sent, 'webp');
        await settle(() => written().length || lent.said.length);
        if (written().length) throw new Error('a refused WebP asked for a file anyway');
        if (lent.said.length !== 1 || !expected.test(lent.said[0])) throw new Error(`it said ${lent.said.join(' / ') || 'nothing'}`);
        // Both refusals point at the row that can still write the drawing.
        if (!/PNG/.test(lent.said[0])) throw new Error(`the refusal left the reader nowhere to go: ${lent.said[0]}`);
      } finally {
        lent.done();
      }
    }
  });

  // What has to hold is that the file really is a JPEG, at the quality the page names, and that both spellings of the ending reach it.
  checkPicture('a JPEG goes out as a finished JPEG, at the quality the page names, under either spelling of the ending', async () => {
    for (const ending of ['jpg', 'jpeg']) {
      const lent = withCanvas({});
      const written = () => lent.sent.filter((one) => one.command === 'exportDiagram');
      try {
        const block = drawnDiagram('flowchart TD\n  J1 --> J2');
        booted.addMermaidControls(block);
        booted.openMermaidExportMenu(exportChipOn(block));
        answerSaveWindow(lent.sent, ending);
        await settle(() => written().length || lent.said.length);
        if (lent.said.length) throw new Error(`a name ending in ${ending} was refused: ${lent.said.join(' / ')}`);
        const jpeg = written()[0];
        if (!jpeg || jpeg.format !== 'jpg') throw new Error(`a name ending in ${ending} sent ${JSON.stringify((jpeg || {}).format) || 'nothing'} rather than jpg`);
        // The file itself, forwarded byte for byte: the host writes what the canvas wrote, exactly as it does for WebP.
        const bytes = Buffer.from(jpeg.data, 'base64');
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error(`what went out does not start like a JPEG: ${JSON.stringify(jpeg.data)}`);
        if (jpeg.width || jpeg.height) throw new Error('a finished file was sent with pixel dimensions beside it');
        const encode = lent.asked.filter((one) => one.type === 'image/jpeg');
        if (encode.length !== 1) throw new Error(`the canvas was asked for a JPEG ${encode.length} times`);
        // Written down rather than inherited, so a web view update cannot move every exported diagram quietly.
        if (encode[0].quality !== 0.92) throw new Error(`the JPEG was asked for at ${encode[0].quality} rather than the quality the page names`);
      } finally {
        lent.done();
      }
    }
  });

  // Past 65,500 pixels a side — this window's ceiling, bisected on a running copy, not the format's own 65,535 — a canvas answers an empty URL rather than throwing, which is the trap the WebP guard was written for. With no guard of its own the type check catches it and says this window cannot write JPEG, which is the wrong thing to tell a reader.
  checkPicture('a drawing too big for JPEG is refused before anything is encoded, and points at the row that can still write it', async () => {
    const lent = withCanvas({ wide: 40000 });
    const written = () => lent.sent.filter((one) => one.command === 'exportDiagram');
    try {
      const block = drawnDiagram('flowchart LR\n  J3 --> J4');
      booted.addMermaidControls(block);
      booted.openMermaidExportMenu(exportChipOn(block));
      answerSaveWindow(lent.sent, 'jpg');
      await settle(() => written().length || lent.said.length);
      if (written().length) throw new Error('a refused JPEG asked for a file anyway');
      if (lent.asked.length) throw new Error('the drawing was encoded before the size was refused, which is the work the guard exists to skip');
      if (lent.said.length !== 1 || !/too big/i.test(lent.said[0])) throw new Error(`it said ${lent.said.join(' / ') || 'nothing'}`);
      if (!/PNG/.test(lent.said[0])) throw new Error(`the refusal left the reader nowhere to go: ${lent.said[0]}`);
    } finally {
      lent.done();
    }
  });

  // The guard's own edge, which the check above cannot see: its 40,000 is past both the format's 65,535 and this window's 65,500, so it passes whichever number the constant carries. The lent canvas takes its size from the stand-in image doubled by the export's own scale, so 32,751 is 65,502 on the canvas — inside the thirty-five-pixel band where the format would take the drawing and this engine will not — and 32,750 is 65,500, the widest it writes.
  checkPicture('a drawing inside the band the format allows and this window will not encode is refused as too big, and one at the ceiling is written', async () => {
    const refuse = async (wide, expect) => {
      const lent = withCanvas({ wide });
      const written = () => lent.sent.filter((one) => one.command === 'exportDiagram');
      try {
        const block = drawnDiagram(`flowchart LR
  B${wide} --> C${wide}`);
        booted.addMermaidControls(block);
        booted.openMermaidExportMenu(exportChipOn(block));
        answerSaveWindow(lent.sent, 'jpg');
        await settle(() => written().length || lent.said.length);
        if (expect === 'refused') {
          if (written().length) throw new Error(`a drawing ${wide} across asked for a file anyway`);
          if (lent.asked.length) throw new Error(`a drawing ${wide} across was encoded before the size was refused`);
          if (lent.said.length !== 1 || !/too big/i.test(lent.said[0])) throw new Error(`a drawing ${wide} across said ${lent.said.join(' / ') || 'nothing'}`);
          if (!/PNG/.test(lent.said[0])) throw new Error(`the refusal left the reader nowhere to go: ${lent.said[0]}`);
          return;
        }
        if (lent.said.length) throw new Error(`a drawing ${wide} across was refused: ${lent.said.join(' / ')}`);
        if (written().length !== 1 || written()[0].format !== 'jpg') throw new Error(`a drawing ${wide} across sent ${written().length} files`);
      } finally {
        lent.done();
      }
    };
    await refuse(32751, 'refused');
    await refuse(32750, 'written');
  });

  // This window has no canvas, which is the branch the refusal is written for, so what is held is that it refuses out loud and writes nothing — a row failing quietly leaves a reader waiting on a Save dialog that never opens. The drawing step stands in: everything after it is what is under test.
  checkPicture('the picture refuses in a toast when the window cannot draw one, and sends nothing', async () => {
    const surface = booted.document.getElementById('appSurface');
    const was = {
      send: booted.ipc.postMessage,
      toast: booted.leafToast,
      drawing: booted.diagramDrawingSvg,
      image: booted.Image,
      btoa: booted.btoa,
    };
    const sent = [];
    const said = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.leafToast = (words) => said.push(words);
    booted.diagramDrawingSvg = async () => '<svg viewBox="0 0 200 100"></svg>';
    booted.btoa = (binary) => Buffer.from(binary, 'binary').toString('base64');
    // The markup loads as a picture, so the refusal below is the canvas and nothing before it.
    booted.Image = class {
      set src(unused) {
        this.naturalWidth = 200;
        this.naturalHeight = 100;
        Promise.resolve().then(() => this.onload && this.onload());
      }
    };
    try {
      const block = drawnDiagram('flowchart TD\n  N1 --> N2');
      booted.addMermaidControls(block);
      booted.openMermaidExportMenu(exportChipOn(block));
      answerSaveWindow(sent, 'png');
      await settle(() => said.length || sent.some((one) => one.command === 'exportDiagram'));
      if (sent.some((one) => one.command === 'exportDiagram')) throw new Error('a window that cannot draw a picture asked for a file anyway');
      if (said.length !== 1 || !/picture/i.test(said[0])) throw new Error(`it said ${said.join(' / ') || 'nothing'}`);
    } finally {
      booted.ipc.postMessage = was.send;
      booted.leafToast = was.toast;
      booted.diagramDrawingSvg = was.drawing;
      booted.Image = was.image;
      booted.btoa = was.btoa;
    }
  });

  // A PDF is the one row nothing in the page encodes: the drawing goes into a box of its own, the sheet state takes the rest of the app off the page, and the host renders it. The size is the half that is easy to get wrong — measured in a running copy, a container holding a 268-wide drawing reports 1,864, which is the surface's width, and a sheet made to that comes out window-wide with the drawing stranded in white.
  const withPrintedDiagram = (drawingBox) => {
    const container = booted.document.getElementById('diagramPrint');
    if (!container) throw new Error('the page has no container to print a diagram in');
    const was = { send: booted.ipc.postMessage, toast: booted.leafToast, drawing: booted.diagramDrawingSvg, hold: booted.window.leafHoldAppearance, child: Object.getOwnPropertyDescriptor(container, 'firstElementChild') };
    const sent = [];
    const said = [];
    const held = [];
    const asked = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.leafToast = (words) => said.push(words);
    booted.diagramDrawingSvg = async (source) => {
      asked.push(source);
      return '<svg width="' + drawingBox.width + '" height="' + drawingBox.height + '"></svg>';
    };
    booted.window.leafHoldAppearance = (on) => held.push(on);
    // The container is as wide as the surface under the paper rules, which is exactly the box that must not be the one measured. The drawing inside it says its own size.
    container.getBoundingClientRect = () => ({ top: 0, left: 0, right: 1864, bottom: 0, width: 1864, height: 0 });
    const drawn = booted.document.createElement('svg');
    drawn.getBoundingClientRect = () => ({ top: 0, left: 0, right: drawingBox.width, bottom: drawingBox.height, width: drawingBox.width, height: drawingBox.height });
    Object.defineProperty(container, 'firstElementChild', { get: () => (container.innerHTML ? drawn : null), configurable: true });
    return {
      sent,
      said,
      held,
      asked,
      container,
      printed: () => sent.filter((one) => one.command === 'printDiagramPdf'),
      wearing: () => booted.document.body.classList.contains('leaf-paper-diagram'),
      done: () => {
        booted.closeFlowMenu();
        booted.window.leafDiagramPrinted();
        booted.ipc.postMessage = was.send;
        booted.leafToast = was.toast;
        booted.diagramDrawingSvg = was.drawing;
        booted.window.leafHoldAppearance = was.hold;
        if (was.child) Object.defineProperty(container, 'firstElementChild', was.child);
      },
    };
  };

  checkPicture('a PDF prints the drawing on a sheet of its own, at the drawing’s size and not the box around it', async () => {
    const lent = withPrintedDiagram({ width: 268, height: 108 });
    try {
      const block = drawnDiagram('flowchart TD\n  P1 --> P2');
      booted.addMermaidControls(block);
      booted.openMermaidExportMenu(exportChipOn(block));
      answerSaveWindow(lent.sent, 'pdf');
      await settle(() => lent.printed().length || lent.said.length);
      if (lent.said.length) throw new Error(`the PDF refused: ${lent.said.join(' / ')}`);
      const print = lent.printed()[0];
      if (!print) throw new Error('a name ending in pdf asked for no print at all');
      // Nothing the page could have made: a PDF is rendered, so the row that carries bytes must never be the one that runs.
      if (lent.sent.some((one) => one.command === 'exportDiagram')) throw new Error('a PDF went out as bytes the page made, which is a .pdf full of something else');
      if (print.path !== '/out/diagram.pdf') throw new Error(`the print carried ${JSON.stringify(print.path)} rather than the name the reader gave`);
      if (print.width !== 268 || print.height !== 108) throw new Error(`the sheet was asked for at ${print.width}×${print.height} rather than the drawing's own 268×108`);
      if (!lent.container.innerHTML) throw new Error('the drawing was never put anywhere the render could reach it');
      if (!lent.wearing()) throw new Error('the sheet state was never raised, so the print would be the whole document with a drawing on the end of it');
      if (String(lent.held) !== 'true') throw new Error(`the appearance was held ${lent.held.length} times: ${lent.held.join(', ') || 'never'}`);

      // The host has answered. The page is the reader's document again however the print went — a state left on is a window holding a bare drawing.
      booted.window.leafDiagramPrinted();
      if (lent.wearing()) throw new Error('the sheet state stayed on after the host answered');
      if (lent.container.innerHTML) throw new Error('the print container kept the drawing after the host answered');
      if (String(lent.held) !== 'true,false') throw new Error(`the appearance hold was not let go exactly once: ${lent.held.join(', ')}`);
      booted.window.leafDiagramPrinted();
      if (String(lent.held) !== 'true,false') throw new Error(`a second answer let the appearance hold go twice: ${lent.held.join(', ')}`);
    } finally {
      lent.done();
    }
  });

  // The three rows that ship all draw the diagram again on purpose, and the PDF has the most to lose by not: a zoomed diagram is absolutely placed inside a box of fixed height, so what is on screen is cropped to that box and a sheet made to it prints the piece somebody happened to be looking at.
  checkPicture('a zoomed and dragged diagram still prints the whole drawing', async () => {
    const lent = withPrintedDiagram({ width: 268, height: 108 });
    try {
      const block = drawnDiagram('flowchart TD\n  Z1 --> Z2');
      booted.addMermaidControls(block);
      // What a reader has zoomed and dragged: pinned to a box of fixed height, with the drawing translated inside it.
      block.classList.add('is-moved');
      block.getBoundingClientRect = () => ({ top: 0, left: 0, right: 900, bottom: 420, width: 900, height: 420 });
      booted.openMermaidExportMenu(exportChipOn(block));
      answerSaveWindow(lent.sent, 'pdf');
      await settle(() => lent.printed().length || lent.said.length);
      const print = lent.printed()[0];
      if (!print) throw new Error('a name ending in pdf asked for no print at all');
      if (lent.asked.length !== 1 || !lent.asked[0].includes('Z1 --> Z2')) throw new Error('the print did not draw the diagram again from its own text');
      if (print.width !== 268 || print.height !== 108) throw new Error(`the sheet took the zoomed block's ${print.width}×${print.height} rather than the fresh drawing's 268×108`);
    } finally {
      lent.done();
    }
  });
}
