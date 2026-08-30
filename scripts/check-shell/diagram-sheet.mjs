// The diagram sheet and the flowchart canvas inside it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { check, fakeElement, readingCss, record, root, source } from './shared.mjs';

// The flowchart sheet, every fragment of it. The two negative guards below read the lot rather than whichever file kept the name, or a later cut quietly takes lines out of their reach.
const SHEET_FRAGMENTS = [
  'src/assets/shell/flow-canvas.js',
  'src/assets/shell/flow-pointer.js',
  'src/assets/shell/flow-menu.js',
  'src/assets/shell/flow-rename.js',
  'src/assets/shell/flow-picker.js',
  'src/assets/shell/flow-export.js',
];

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // The sheet stands open for minutes, so the document moves under it. Where Save writes is read when Save is pressed, and a Save with nothing left to write onto says so rather than splicing into whatever took those bytes.
  check('the diagram sheet writes where the block is when Save is pressed, and refuses once it has gone', () => {
    const note = '# Title\n\n```mermaid\nflowchart TD\n    A["a"]\n```\n';
    const at = note.indexOf('```mermaid');
    const end = note.indexOf('\n```\n', at) + '\n```'.length;
    const read = (expression) => vm.runInContext(expression, booted);
    const was = { source: read('currentDocumentSource'), send: booted.ipc.postMessage, toast: booted.leafToast };
    const sent = [];
    const said = [];
    const block = fakeElement('flowBlockUnderTest');
    block.dataset = { srcStart: String(at), srcEnd: String(end) };
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      booted.leafToast = (message) => said.push(message);
      read(`currentDocumentSource = ${JSON.stringify(note)};`);
      booted.openMermaidBlockSheet(block);
      if (read('flowSession && flowSession.text') !== 'flowchart TD\n    A["a"]') {
        throw new Error(`the sheet opened on ${JSON.stringify(read('flowSession && flowSession.text'))}`);
      }

      // A pause in somebody's typing above the diagram: the buffer grows and every block's numbers move, with nothing redrawn — what advanceLiveRanges does as the splice lands.
      const grew = 'A new sentence.\n\n';
      read(`currentDocumentSource = ${JSON.stringify(note.slice(0, at) + grew + note.slice(at))};`);
      block.dataset.srcStart = String(at + grew.length);
      block.dataset.srcEnd = String(end + grew.length);

      read('flowCode').value = 'flowchart TD\n    A["b"]';
      booted.saveFlowSheet();
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 1) throw new Error(`Save sent ${JSON.stringify(sent)}`);
      if (edits[0].start !== at + grew.length + '```mermaid\n'.length) {
        throw new Error(`Save landed at ${edits[0].start}, which is where the block used to be`);
      }
      if (edits[0].text !== 'flowchart TD\n    A["b"]') throw new Error(`Save wrote ${JSON.stringify(edits[0].text)}`);
      if (said.length) throw new Error(`a Save that landed said ${JSON.stringify(said)}`);

      // The same sheet over a block a render has taken away: nothing is written, the reader is told why, and the drawing stays on screen to be copied out of.
      sent.length = 0;
      booted.openMermaidBlockSheet(block);
      block.isConnected = false;
      booted.saveFlowSheet();
      if (sent.filter((one) => one.command === 'editBlock').length) {
        throw new Error(`a Save with no block left wrote ${JSON.stringify(sent)}`);
      }
      if (said.length !== 1 || !said[0].includes('nowhere left to save it')) {
        throw new Error(`it said ${JSON.stringify(said)}`);
      }
      if (!read('!!flowSession')) throw new Error('the refused Save closed the sheet over the drawing');
    } finally {
      read('flowSession = null;');
      read(`currentDocumentSource = ${JSON.stringify(was.source)};`);
      booted.ipc.postMessage = was.send;
      booted.leafToast = was.toast;
      booted.__frames.drain();
    }
  });

  // The sheet waits for the host's word before it closes. Answering true on the dispatch closes it over a write the host has not made, and a reader whose file has gone loses the drawing.
  check('the diagram sheet waits for the host before it closes, and keeps the drawing when the edit is refused', () => {
    const note = '# Title\n\n\`\`\`mermaid\nflowchart TD\n    A["a"]\n\`\`\`\n';
    const at = note.indexOf('\`\`\`mermaid');
    const end = note.indexOf('\n\`\`\`\n', at) + '\n\`\`\`'.length;
    const read = (expression) => vm.runInContext(expression, booted);
    const was = { source: read('currentDocumentSource'), send: booted.ipc.postMessage, toast: booted.leafToast };
    const sent = [];
    const said = [];
    const block = fakeElement('flowBlockWaitingOnTheHost');
    block.dataset = { srcStart: String(at), srcEnd: String(end) };
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      booted.leafToast = (message) => said.push(message);
      read(`currentDocumentSource = ${JSON.stringify(note)};`);

      // A Save the host refuses: the sheet stays up with the drawing in it, and the reason is said where the reader is looking.
      booted.openMermaidBlockSheet(block);
      booted.saveFlowSheet();
      const refused = sent.filter((one) => one.command === 'editBlock');
      if (refused.length !== 1) throw new Error(`Save sent ${JSON.stringify(sent)}`);
      if (typeof refused[0].token !== 'number') {
        throw new Error(`Save sent no token, so nothing can answer it: ${JSON.stringify(refused[0])}`);
      }
      if (!read('!!flowSession')) throw new Error('the sheet closed on the dispatch, before the host had written anything');
      if (said.length) throw new Error(`a Save still waiting said ${JSON.stringify(said)}`);

      const why = 'watch.md was not changed: the file could not be read.';
      booted.leafEditAnswered(refused[0].token, false, why);
      if (!read('!!flowSession')) throw new Error('a refused Save closed the sheet over the only copy of the drawing');
      if (said.length !== 1 || said[0] !== why) throw new Error(`it said ${JSON.stringify(said)}`);

      // An answer to a Save nobody is holding any more is dropped rather than closing whatever is open now.
      booted.leafEditAnswered(refused[0].token, true, null);
      if (!read('!!flowSession')) throw new Error('an answer already spent closed the sheet');

      // And a Save the host wrote: that one closes it.
      sent.length = 0;
      said.length = 0;
      booted.saveFlowSheet();
      const landed = sent.filter((one) => one.command === 'editBlock');
      if (landed.length !== 1) throw new Error(`the second Save sent ${JSON.stringify(sent)}`);
      if (landed[0].token === refused[0].token) throw new Error('two Saves shared one token');
      if (!read('!!flowSession')) throw new Error('the sheet closed before the answer arrived');
      booted.leafEditAnswered(landed[0].token, true, null);
      if (read('!!flowSession')) throw new Error('a Save the host wrote left the sheet open');
      if (said.length) throw new Error(`a Save that landed said ${JSON.stringify(said)}`);
    } finally {
      read('flowSession = null;');
      read(`currentDocumentSource = ${JSON.stringify(was.source)};`);
      booted.ipc.postMessage = was.send;
      booted.leafToast = was.toast;
      booted.__frames.drain();
    }
  });

  // The other senders on the same channel: both kinds of checkbox, which draw their own tick before the command leaves and so are the only thing that can undraw it. The host cannot name a box to redraw — a box inside a table carries no task number at all — so what it answers is whether the buffer is holding the change, and the listener that drew the tick reads that.
  check('a tick the buffer is not holding comes back off the box that drew it', () => {
    const appEl = booted.document.getElementById('app');
    const wasSend = booted.ipc.postMessage;
    const sent = [];
    const body = fakeElement('');
    body.className = 'document-body';
    const boxes = [];
    for (let at = 0; at < 2; at += 1) {
      const box = fakeElement('');
      box.tagName = 'INPUT';
      box.setAttribute('type', 'checkbox');
      body.appendChild(box);
      boxes.push(box);
    }
    // A click, as the browser makes it: the tick is drawn first and the listener runs with it already on.
    const press = (box) => {
      box.checked = !box.checked;
      (box.listeners.get('change') || []).forEach((handler) => handler({}));
    };
    const wasToast = booted.leafToast;
    const said = [];
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      booted.leafToast = (message) => said.push(message);
      appEl.appendChild(body);
      booted.bindTaskCheckboxes(['one', 'two']);

      // A box in a plain list, told the buffer is holding nothing: the tick the browser drew comes back off, so the box stops contradicting the message beside it.
      press(boxes[0]);
      const nothing = sent[sent.length - 1];
      if (typeof nothing.token !== 'number') throw new Error(`a tick sent no token: ${JSON.stringify(nothing)}`);
      const refused = 'notes.md was not changed: the file could not be read.';
      booted.leafEditAnswered(nothing.token, false, refused);
      if (boxes[0].checked) throw new Error('a tick standing on nothing was left ticked beside the message saying nothing was changed');
      // The sentence rides the answer, so the box is what says it. The host stays quiet wherever a token came, so a box that does not say it leaves the reader told nothing at all.
      if (said.length !== 1 || said[0] !== refused) throw new Error(`a refused tick said ${JSON.stringify(said)}`);

      // The same box, told the buffer is holding it: the tick stands. This is the tick whose file was refused — the change is real and unsaved, and taking it off screen would leave a dirty document that looks untouched.
      said.length = 0;
      press(boxes[0]);
      const holding = sent[sent.length - 1];
      if (holding.token === nothing.token) throw new Error('two ticks traveled under one token');
      const unsaved = 'notes.md was changed and not saved: the file could not be written.';
      booted.leafEditAnswered(holding.token, true, unsaved);
      if (!boxes[0].checked) throw new Error('a tick the buffer is holding was taken back off the screen');
      if (said.length !== 1 || said[0] !== unsaved) throw new Error(`a held tick over an unwritten file said ${JSON.stringify(said)}`);

      // And a tick that landed says nothing at all: there is nothing to tell anybody.
      said.length = 0;
      press(boxes[1]);
      booted.leafEditAnswered(sent[sent.length - 1].token, true, '');
      if (said.length) throw new Error(`a tick that landed said ${JSON.stringify(said)}`);
      if (!boxes[1].checked) throw new Error('a tick that landed was taken off the screen');

      // An answer already spent, and one to a token nobody is holding: both dropped.
      booted.leafEditAnswered(holding.token, false, 'notes.md was not changed.');
      booted.leafEditAnswered(nothing.token, false, 'notes.md was not changed.');
      if (!boxes[0].checked) throw new Error('an answer nobody was waiting on unticked a box');

      // A box inside a table sends the other command, carries no task number, and is undrawn the same way.
      sent.length = 0;
      const cellBox = fakeElement('');
      cellBox.tagName = 'INPUT';
      cellBox.checked = true;
      const table = fakeElement('tickInsideATable');
      table.dataset = { srcStart: '0', srcEnd: '10', blockKind: 'table' };
      booted.sendCheckboxBlockEdit(table, 0, 10, '| x |' + String.fromCharCode(10), { row: 1, column: 0, columns: 1, text: '[x]' }, cellBox);
      const spliced = sent[sent.length - 1];
      if (!spliced || spliced.command !== 'editBlock' || spliced.autosave !== true) throw new Error(`a table's tick sent ${JSON.stringify(sent)}`);
      if (typeof spliced.token !== 'number') throw new Error(`a table's tick sent no token: ${JSON.stringify(spliced)}`);
      said.length = 0;
      booted.leafEditAnswered(spliced.token, false, refused);
      if (cellBox.checked) throw new Error("a table's tick standing on nothing was left ticked");
      if (said.length !== 1 || said[0] !== refused) throw new Error(`a table's refused tick said ${JSON.stringify(said)}`);
    } finally {
      booted.ipc.postMessage = wasSend;
      booted.leafToast = wasToast;
      body.remove();
    }
    if (appEl.querySelector('.document-body')) throw new Error('the check left a drawn document standing in the reader');
  });

  // The other way in: the plus offers a new diagram, and the gutter it was pressed on is rebuilt by every render — so a drawing that comes back after one has no line left to be written onto.
  check('a new diagram writes nothing once the line the plus stood on has gone', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const was = { source: read('currentDocumentSource'), toast: booted.leafToast };
    const wrote = [];
    const said = [];
    const line = fakeElement('flowPlaceUnderTest');
    line.dataset = { srcStart: '9', srcEnd: '9' };
    try {
      booted.leafToast = (message) => said.push(message);
      read(`currentDocumentSource = ${JSON.stringify('# Title\n\n\n')};`);
      const standing = (place) => booted.blockInsertPlaceStanding(place);
      if (!standing({ target: line })) throw new Error('a line still on the page was called gone');
      if (!standing({ gap: { after: line, before: null } })) throw new Error('a gap under a standing block was called gone');
      if (standing(null) || standing({ target: null }) || standing({ gap: { after: null, before: null } })) {
        throw new Error('a place with nothing in it was called standing');
      }

      // The stand-in answers what the insert row answers — the token it sent — because an array push answers its new length, and a sheet reading that would hold itself open on a number nothing will ever come back with.
      const write = (written) => {
        wrote.push(written);
        return booted.nextEditToken();
      };

      booted.openBlockFlowSheet(write, { target: line });
      line.isConnected = false;
      booted.saveFlowSheet();
      if (wrote.length) throw new Error(`it wrote ${JSON.stringify(wrote)}`);
      if (said.length !== 1 || !said[0].includes('nowhere left to save it')) {
        throw new Error(`it said ${JSON.stringify(said)}`);
      }
      if (!read('!!flowSession')) throw new Error('the refused Save closed the sheet over the drawing');

      // And back on a line that is still there, the same Save writes the fenced block and asks to be answered.
      line.isConnected = true;
      booted.saveFlowSheet();
      if (wrote.length !== 1 || !wrote[0].text.startsWith('```mermaid\n')) {
        throw new Error(`the Save that should have landed wrote ${JSON.stringify(wrote)}`);
      }
      if (!wrote[0].answered) throw new Error('the new-diagram Save asked the insert row for no answer');
    } finally {
      read('flowSession = null;');
      read(`currentDocumentSource = ${JSON.stringify(was.source)};`);
      booted.leafToast = was.toast;
      booted.__frames.drain();
    }
  });

  // The same wait, down the door a new diagram takes: through the insert row. A diagram already in the page survives a sheet that closes on the dispatch — it is still in the file — and a new one exists nowhere else at all, so this door is the one that must hold the drawing until the host answers.
  check('a new diagram from the plus waits for the host and keeps the drawing when nothing was written', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const was = { source: read('currentDocumentSource'), send: booted.ipc.postMessage, toast: booted.leafToast };
    const note = '# Title\n\n\n';
    const sent = [];
    const said = [];
    // The empty line the plus stands on: nothing on it, nothing carrying a footnote's line, and its own range in the buffer.
    const emptyLine = () => {
      const line = fakeElement('flowInsertLineUnderTest');
      line.tagName = 'P';
      line.dataset = { srcStart: '9', srcEnd: '9' };
      return line;
    };
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      booted.leafToast = (message) => said.push(message);
      read(`currentDocumentSource = ${JSON.stringify(note)};`);

      // Drawn on a line the row will take. The write goes out with a token on it, and the sheet stays up: nothing is in the file yet.
      const line = emptyLine();
      booted.openBlockFlowSheet((chosen) => booted.runBlockInsert(line, chosen), { target: line });
      booted.saveFlowSheet();
      const refused = sent.filter((one) => one.command === 'editBlock');
      if (refused.length !== 1) throw new Error(`the new-diagram Save sent ${JSON.stringify(sent)}`);
      if (typeof refused[0].token !== 'number') {
        throw new Error(`it sent no token, so nothing can answer it: ${JSON.stringify(refused[0])}`);
      }
      if (!refused[0].text.startsWith('```mermaid\n')) throw new Error(`it wrote ${JSON.stringify(refused[0].text)}`);
      if (!read('!!flowSession')) throw new Error('the sheet closed on the dispatch, before the host had written anything');
      if (said.length) throw new Error(`a Save still waiting said ${JSON.stringify(said)}`);

      // The host could not write it. The drawing stays on screen to be copied out of, with the reason beside it.
      const why = 'watch.md was not changed: the file could not be read.';
      booted.leafEditAnswered(refused[0].token, false, why);
      if (!read('!!flowSession')) throw new Error('a refused Save closed the sheet over the only copy of the drawing');
      if (said.length !== 1 || said[0] !== why) throw new Error(`it said ${JSON.stringify(said)}`);

      // And the host wrote it: that one closes the sheet.
      sent.length = 0;
      said.length = 0;
      booted.saveFlowSheet();
      const landed = sent.filter((one) => one.command === 'editBlock');
      if (landed.length !== 1) throw new Error(`the second Save sent ${JSON.stringify(sent)}`);
      if (landed[0].token === refused[0].token) throw new Error('two Saves shared one token');
      if (!read('!!flowSession')) throw new Error('the sheet closed before the answer arrived');
      booted.leafEditAnswered(landed[0].token, true, null);
      if (read('!!flowSession')) throw new Error('a Save the host wrote left the sheet open');
      if (said.length) throw new Error(`a Save that landed said ${JSON.stringify(said)}`);

      // The other way the drawing was lost: a line the row will not write onto. Nothing goes out, and the sheet has to say so rather than close over a drawing the host was never even asked about.
      sent.length = 0;
      said.length = 0;
      const says = emptyLine();
      says.textContent = 'A paragraph.';
      booted.openBlockFlowSheet((chosen) => booted.runBlockInsert(says, chosen), { target: says });
      booted.saveFlowSheet();
      if (sent.filter((one) => one.command === 'editBlock').length) {
        throw new Error(`the plus wrote over a line that says something: ${JSON.stringify(sent)}`);
      }
      if (said.length !== 1 || !said[0].includes('nowhere left to save it')) {
        throw new Error(`it said ${JSON.stringify(said)}`);
      }
      if (!read('!!flowSession')) throw new Error('a Save that wrote nothing closed the sheet over the drawing');
    } finally {
      read('flowSession = null;');
      read(`currentDocumentSource = ${JSON.stringify(was.source)};`);
      booted.ipc.postMessage = was.send;
      booted.leafToast = was.toast;
      booted.__frames.drain();
    }
  });

  // The flowchart sheet reads and writes mermaid, and Save splices what it wrote straight into the document. Everything dangerous is parseFlow refusing correctly, so both halves of that are held here: what we write must come back unchanged, and what we cannot model must come back null — never a partial graph the canvas could then save over.
  check('a flowchart we wrote survives the round trip', () => {
    const { parseFlow, renderFlow } = booted;
    const same = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused text we wrote: ${JSON.stringify(text)}`);
      const back = renderFlow(graph);
      if (back !== text) {
        throw new Error(`${JSON.stringify(text)} -> ${JSON.stringify(back)}`);
      }
    };

    same('flowchart TD\n    A["Start"]');
    same('flowchart LR\n    A["Start"]\n    B{"Choose"}\n    A --> B');
    same('flowchart TD\n    A("Go")\n    B["Stop"]\n    A -->|"yes"| B');
    same('flowchart TD\n    A["a"]\n    B["b"]\n    A --- B'); // the open line
    same('flowchart BT\n    A["a"]\n    B["b"]\n    C["c"]\n    A --> B\n    B --> C');
    // Every shape in the catalog, written and read back as itself. The pairs that share an opener (`[/…/]` against `[/…\\]`) are what this is for.
    same(
      'flowchart TD\n' +
        [
          'a1["rect"]',
          'a2("rounded")',
          'a3{"diamond"}',
          'a4(["stadium"])',
          'a5[["subroutine"]]',
          'a6[("cylinder")]',
          'a7(("circle"))',
          'a8((("double")))',
          'a9{{"hexagon"}}',
          'b1>"flag"]',
          'b2[/"lean right"/]',
          'b3[\\"lean left"\\]',
          'b4[/"trapezoid"\\]',
          'b5[\\"trapezoid alt"/]',
        ]
          .map((line) => '    ' + line)
          .join('\n'),
    );
    // And every connector: three line styles against seven pairs of ends.
    same(
      'flowchart LR\n    A["a"]\n    B["b"]\n' +
        [
          'A --> B',
          'A --- B',
          'A --o B',
          'A --x B',
          'A <--> B',
          'A o--o B',
          'A x--x B',
          'A -.-> B',
          'A -.- B',
          'A -.-o B',
          'A -.-x B',
          'A <-.-> B',
          'A o-.-o B',
          'A x-.-x B',
          'A ==> B',
          'A === B',
          'A ==o B',
          'A ==x B',
          'A <==> B',
          'A o==o B',
          'A x==x B',
        ]
          .map((line) => '    ' + line)
          .join('\n'),
    );
    same('flowchart TD\n    A["a"]\n    B["b"]\n    A -.->|"maybe"| B');
    same('flowchart TD\n    A["a"]\n    B["b"]\n    A ==>|"definitely"| B');
    same('flowchart TD\n    A["say #quot;hi#quot;"]'); // a quote inside a label
    same('flowchart TD\n    A["café 😀"]'); // multi-byte, where the offsets matter
    same('flowchart TD\n    A["one<br/>two"]'); // a line break in a label
    same('flowchart TD\n    A["a"]\n    A --> A'); // a node pointing at itself
    // Front matter, directives and comments are kept exactly, because the canvas models none of them and a save must not be where they go missing.
    same('---\ntitle: Plan\n---\nflowchart TD\n    A["a"]');
    same('%%{init: {"flowchart": {"curve": "linear"}}}%%\nflowchart TD\n    A["a"]');
    same('flowchart TD\n    %% a note\n    accTitle: The plan\n    A["a"]');
    // Hyphens in a box name, against the arrow that starts one character later.
    same('flowchart LR\n    read-file["Read"]\n    write-file["Write"]\n    read-file --> write-file');
    // The thirty-three shapes that have no brackets are written the typed way, and that is the only way they are ever written.
    same('flowchart TD\n    A@{ shape: cloud, label: "Somewhere else" }');
    same(
      'flowchart LR\n' +
        [
          'a@{ shape: sm-circ, label: "" }',
          'b@{ shape: doc, label: "Write it down" }',
          'c@{ shape: lin-cyl, label: "Disk" }',
          'd@{ shape: fr-circ, label: "" }',
        ]
          .map((line) => '    ' + line)
          .join('\n') +
        '\n    a --> b\n    b --> c\n    c --> d',
    );
    // A link, an icon and a picture. The `click` line goes under the boxes because it names one, and the two keys ride in the typed form because that is the only place they can be said.
    same('flowchart TD\n    A["Home"]\n    click A "https://example.com"');
    same('flowchart TD\n    A["Home"]\n    click A "https://example.com" "Opens the site"');
    same('flowchart TD\n    A@{ shape: rect, label: "Back", icon: "leaf:back" }');
    same('flowchart TD\n    A@{ shape: rect, label: "A shot", img: "shot.png" }');
    same('flowchart TD\n    A@{ shape: rect, label: "All three", icon: "leaf:back", img: "shot.png" }\n    click A "./other.md"');
    // The form that names a function is kept whole and does nothing. It goes last because it is not attached to a box at all.
    same('flowchart TD\n    A["Home"]\n    click A call go()');
  });

  // The hardest block the canvas is ever handed: the "everything at once" section of the mermaid test page. A hand-written diagram is not in the shape we write, so the test is that it opens at all and that our own writing of it is stable — the two together are what "every flowchart on that page opens in the editor" means. Kept here as a literal rather than read out of the plan tree next door: nothing else in `just verify` reaches out of this repo, and a boot check that needs a folder beside it fails on a partial clone.
  check('the hardest block on the test page opens on the canvas', () => {
    const { parseFlow, renderFlow, flowRefusal } = booted;
    const settles = (text, why) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`${why}: refused — ${flowRefusal(text)}`);
      const once = renderFlow(graph);
      const twice = renderFlow(parseFlow(once));
      if (once !== twice) throw new Error(`${why}: our own writing of it does not settle\n${once}\n---\n${twice}`);
      return { graph, written: once };
    };

    const everything = [
      '---',
      'title: One file in, one page out',
      '---',
      '%%{init: {"flowchart": {"curve": "basis"}}}%%',
      'flowchart TD',
      '  accTitle: How Leaftext turns a file into a page',
      '  accDescr: A file is read, routed by its format, parsed or shaped into a tree, then shown, edited and written back.',
      '  classDef io fill:#e0f2fe,stroke:#0369a1,color:#082f49',
      '  classDef risk fill:#ffe4e6,stroke:#b91c1c,color:#7f1d1d',
      '  classDef done fill:#dcfce7,stroke:#15803d,color:#14532d',
      '',
      '  %% one file in, one page out',
      '  file@{ shape: lean-r, label: "The file on disk" }',
      '  file --> fmt{Which format?}',
      '',
      '  fmt -->|md| md',
      '  fmt -->|xml, json, yaml| tree',
      '',
      '  subgraph md [Markdown]',
      '    direction TB',
      '    p[Parse to events] --> g[GitHub extras]',
      '    g --> h[Highlight fences]',
      '    h --> s[Sanitize]:::risk',
      '  end',
      '',
      '  subgraph tree [Tree formats]',
      '    direction TB',
      '    t1[Read to one ordered tree] --> t2[Shape rules]',
      '  end',
      '',
      '  s --> page',
      '  t2 ---> page',
      '  page@{ shape: curv-trap, label: "The reading view" }',
      '  page -.->|click a block| edit@{ shape: notch-rect, label: "Edit in place" }',
      '  edit -->|leave it| page',
      '  edit ==>|one splice| buffer@{ shape: cyl, label: "The buffer in Rust" }',
      '  buffer e1@--> file',
      '  watch[The watcher] --> watch',
      '  watch ~~~ file',
      '  e1@{ animate: true }',
      '',
      '  %% a typed shape cannot carry :::class on the same line — see section 22',
      '  class file io',
      '  class page done',
      '  linkStyle 0 stroke:#0369a1,stroke-width:2px',
    ].join('\n');

    const { written } = settles(everything, 'everything at once');
    // Each of the nine things that section was short of, still there after a save.
    for (const kept of [
      'title: One file in, one page out',
      '%%{init:',
      'accTitle: How Leaftext turns a file into a page',
      'accDescr: A file is read',
      '--->', // the stretched arrow
      '~~~', // the invisible line
      'watch --> watch', // the self-loop
      'e1@-->', // the named line
      'e1@{ animate: true }',
      'linkStyle 0 stroke:#0369a1',
    ]) {
      if (!written.includes(kept)) throw new Error(`a save lost ${kept}:\n${written}`);
    }
    // Two lines between the same pair, both kept rather than folded into one.
    if (written.split('\n').filter((line) => /^\s*(page|edit) .* (edit|page)$/.test(line)).length < 2) {
      throw new Error(`the second line between one pair went missing:\n${written}`);
    }

    // `look: handDrawn` is a whole-diagram setting, so the section says it in a block of its own.
    settles(
      [
        '---',
        'title: The same pipeline, still an argument',
        'look: handDrawn',
        '---',
        'flowchart LR',
        '  file@{ shape: lean-r, label: "The file" } --> render[Render] --> page@{ shape: curv-trap, label: "The page" }',
        '  page -.->|edit| render',
      ].join('\n'),
      'the hand-drawn block',
    );
  });

  // Each of the three is written where mermaid reads it, and a box that loses one loses the line with it — the click line goes when the link does, and the key goes from the braces when the icon or the picture does.
  check('a box gives up its link, its icon and its picture cleanly', () => {
    const { parseFlow, renderFlow, flowFindNode } = booted;
    const text = 'flowchart TD\n    A@{ shape: rect, label: "All three", icon: "leaf:back", img: "shot.png" }\n    click A "https://example.com" "Go"';
    const graph = parseFlow(text);
    if (!graph) throw new Error('the three-way box did not parse');
    const node = flowFindNode(graph, 'A');
    if (node.icon !== 'leaf:back') throw new Error(`the icon read as ${node.icon}`);
    if (node.img !== 'shot.png') throw new Error(`the picture read as ${node.img}`);
    if (node.href !== 'https://example.com') throw new Error(`the link read as ${node.href}`);
    if (node.hrefTip !== 'Go') throw new Error(`the tooltip read as ${node.hrefTip}`);

    node.href = null;
    node.hrefTip = null;
    node.icon = null;
    node.img = null;
    const back = renderFlow(graph);
    if (back.includes('click')) throw new Error(`the click line outlived the link: ${back}`);
    if (back.includes('icon:') || back.includes('img:')) throw new Error(`a key outlived its value: ${back}`);
    if (back !== 'flowchart TD\n    A["All three"]') throw new Error(`the box did not go back to brackets: ${back}`);
  });

  // `click A href "…"` is mermaid's long spelling of the same thing, so it is read and written back short — one spelling of a link in the file, the way one shape has one spelling.
  check('both spellings of a click reach the same box', () => {
    const { parseFlow, renderFlow } = booted;
    const short = parseFlow('flowchart TD\n    A["Home"]\n    click A "https://example.com"');
    const long = parseFlow('flowchart TD\n    A["Home"]\n    click A href "https://example.com"');
    if (!short || !long) throw new Error('one of the two spellings was refused');
    if (renderFlow(short) !== renderFlow(long)) throw new Error('the two spellings wrote different text');
  });

  // The canvas has no gesture that draws a box around boxes, so the menu is the whole of it: make a group, join one, leave one, take one away. Each has to leave a diagram that still says something.
  check('the canvas can make and unmake a group', () => {
    const { parseFlow, renderFlow, flowGroupNodes, flowUngroup, flowMoveNodeToGroup, flowFindGroup } = booted;
    const one = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      return graph;
    };

    const graph = one('flowchart TD\n    A["a"]\n    B["b"]\n    C["c"]\n    A --> B\n    B --> C');
    const made = flowGroupNodes(graph, ['A', 'B'], 'First half');
    if (!made) throw new Error('the group was not made');
    if (made.id !== 'g1') throw new Error(`the group is called ${made.id}`);
    const written = renderFlow(graph);
    if (!written.includes('subgraph g1["First half"]')) throw new Error(`no group in ${written}`);
    if (renderFlow(parseFlow(written)) !== written) throw new Error('the made group does not round-trip');

    // A box joins and leaves; the group holds whatever is left.
    flowMoveNodeToGroup(graph, 'C', 'g1');
    if (graph.nodes.find((node) => node.id === 'C').group !== 'g1') throw new Error('C did not join');
    flowMoveNodeToGroup(graph, 'C', null);
    if (graph.nodes.find((node) => node.id === 'C').group !== null) throw new Error('C did not leave');

    // A group inside a group: taking the outer one away leaves the inner one where the outer one was, rather than orphaning it.
    const inner = flowGroupNodes(graph, ['A'], 'Inner');
    if (inner.parent !== 'g1') throw new Error(`the inner group's parent is ${inner.parent}`);
    flowUngroup(graph, 'g1');
    if (flowFindGroup(graph, 'g1')) throw new Error('the outer group is still there');
    if (flowFindGroup(graph, inner.id).parent !== null) throw new Error('the inner group was orphaned');
    if (graph.nodes.find((node) => node.id === 'B').group !== null) throw new Error('B kept a group that is gone');
    if (!renderFlow(graph).includes('A["a"]')) throw new Error('a box went with the group');

    // Boxes from two different groups cannot be gathered into one: there would be no answer to which group the new one goes in.
    const split = one('flowchart TD\n  subgraph one\n    A[a]\n  end\n  subgraph two\n    B[b]\n  end');
    if (flowGroupNodes(split, ['A', 'B'], 'Both')) throw new Error('boxes from two groups should not group');

    // An arrow pointing at a group goes when the group does.
    const aimed = one('flowchart LR\n  X[x] --> g\n  subgraph g [G]\n    A[a]\n  end');
    flowUngroup(aimed, 'g');
    if (aimed.edges.some((edge) => edge.to === 'g')) throw new Error('an arrow still points at the group');
  });

  // A connector can be stretched, and mermaid reads the extra length as a rank hint — so the length is part of what the diagram means, and losing it on a save would redraw the whole layout. The invisible link is the one line style that takes no ends at all.
  check('a connector keeps its length, and the invisible one takes no ends', () => {
    const { parseFlow, renderFlow } = booted;
    const one = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      return graph;
    };
    const same = (text) => {
      const back = renderFlow(one(text));
      if (back !== text) throw new Error(`${JSON.stringify(text)} -> ${JSON.stringify(back)}`);
    };
    const stretch = (spelling, expected) => {
      const graph = one(`flowchart LR\n    A["a"]\n    B["b"]\n    A ${spelling} B`);
      if (graph.edges[0].stretch !== expected) {
        throw new Error(`${spelling} came back stretched ${graph.edges[0].stretch}, wanted ${expected}`);
      }
    };

    stretch('-->', 0);
    stretch('--->', 1);
    stretch('---->', 2);
    stretch('---', 0);
    stretch('----', 1);
    stretch('-.->', 0);
    stretch('-..->', 1);
    stretch('-.....->', 4);
    stretch('==>', 0);
    stretch('===>', 1);
    stretch('<-->', 0);
    stretch('<--->', 1);
    stretch('~~~', 0);
    // Every stretched spelling is written back exactly as long as it was read.
    for (const spelling of ['--->', '---->', '----', '-..->', '===>', '====', '<--->', 'o---o', 'x---x', '~~~~']) {
      same(`flowchart LR\n    A["a"]\n    B["b"]\n    A ${spelling} B`);
    }
    same('flowchart LR\n    A["a"]\n    B["b"]\n    A ~~~ B');
    // A label still rides on a stretched arrow.
    const labeled = one('flowchart LR\n    A --->|"yes"| B');
    if (labeled.edges[0].label !== 'yes' || labeled.edges[0].stretch !== 1) {
      throw new Error(`the label or the length was lost: ${JSON.stringify(labeled.edges[0])}`);
    }
  });

  // A line can be given a name, and the one thing that uses the name is an animation. Both ride on the edge, so deleting the line takes them with it.
  check('a named line keeps its name and its animation', () => {
    const { parseFlow, renderFlow, flowDeleteEdge } = booted;
    const one = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      return graph;
    };
    const same = (text) => {
      const back = renderFlow(one(text));
      if (back !== text) throw new Error(`${JSON.stringify(text)} -> ${JSON.stringify(back)}`);
    };

    const named = one('flowchart LR\n    A["a"]\n    B["b"]\n    A e1@--> B');
    if (named.edges[0].name !== 'e1') throw new Error(`the name came back as ${named.edges[0].name}`);
    same('flowchart LR\n    A["a"]\n    B["b"]\n    A e1@--> B');
    same('flowchart LR\n    A["a"]\n    B["b"]\n    A e1@--> B\n    e1@{ animate: true }');
    same('flowchart LR\n    A["a"]\n    B["b"]\n    A e1@==>|"go"| B\n    e1@{ animation: fast }');
    // The same spelling with a shape in it is a box, not an animation.
    const box = one('flowchart LR\n    A@{ shape: cyl, label: "Cache" }');
    if (box.nodes[0].shape !== 'cyl') throw new Error('a typed box was read as an animation');
    // An animation for a name no line carries is refused, not dropped.
    if (parseFlow('flowchart LR\n    A --> B\n    e1@{ animate: true }')) {
      throw new Error('an animation with no line should be refused');
    }
    // Deleting the line takes its name and its animation with it.
    const doomed = one('flowchart LR\n    A["a"]\n    B["b"]\n    A e1@--> B\n    e1@{ animate: true }');
    flowDeleteEdge(doomed, doomed.edges[0].id);
    if (renderFlow(doomed).includes('e1')) throw new Error('the animation outlived its line');
  });

  // Mermaid's markdown label — backticks inside the quotes — is the label's own text as far as the model is concerned. It is kept whole rather than refused, because a bold word in a box is not a reason to turn the canvas off.
  check('a markdown label survives the round trip', () => {
    const { parseFlow, renderFlow } = booted;
    const same = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      const back = renderFlow(graph);
      if (back !== text) throw new Error(`${JSON.stringify(text)} -> ${JSON.stringify(back)}`);
    };
    same('flowchart TD\n    A["`**bold** and *italic*`"]');
    // Mermaid wraps a markdown label where the break is, so the break is part of the label and the statement is not over until the quote closes.
    same('flowchart TD\n    A["`A longer label that\nwraps where you put the break`"]');
    const broken = parseFlow('flowchart TD\n  A["`one\ntwo`"] --> B[after]');
    if (!broken) throw new Error('a label across two lines was refused');
    if (broken.nodes[0].text !== '`one\ntwo`') throw new Error(`the break was lost: ${JSON.stringify(broken.nodes[0].text)}`);
    if (broken.edges.length !== 1) throw new Error('the arrow after the label went missing');
    // A quote that never closes at all is still refused, and says so.
    if (parseFlow('flowchart TD\n    A["never closed')) throw new Error('an unclosed label should be refused');
    same('flowchart LR\n    A["`a **bold** step`"]\n    B["plain"]\n    A --> B');
    // A bare backtick is still refused: mermaid needs the quotes for markdown, and a label we cannot quote back is one we cannot write.
    if (parseFlow('flowchart TD\n    A[`bold`]')) throw new Error('a bare backtick label should be refused');
  });

  // The picker shows the shapes under headings, and it is built from the families — so a shape whose family is misspelled is a shape nobody can ever choose, and it would go missing quietly.
  check('every shape sits under exactly one heading', () => {
    const { flowShapeCatalog, flowShapeFamilies } = booted;
    const all = flowShapeCatalog();
    const families = flowShapeFamilies();
    const seen = [];
    for (const family of families) {
      if (!family.shapes.length) throw new Error(`the heading "${family.name}" has no shapes under it`);
      const labels = family.shapes.map((shape) => shape.label);
      const sorted = labels.slice().sort((a, b) => a.localeCompare(b));
      if (labels.join('|') !== sorted.join('|')) throw new Error(`"${family.name}" is not alphabetical: ${labels}`);
      seen.push(...family.shapes.map((shape) => shape.id));
    }
    if (seen.length !== all.length) {
      const missing = all.filter((shape) => !seen.includes(shape.id)).map((shape) => shape.id);
      throw new Error(`${all.length} shapes, ${seen.length} under a heading — missing ${missing}`);
    }
    if (new Set(seen).size !== seen.length) throw new Error('a shape is under two headings');
  });

  // A subgraph is a box around boxes, and which one a box is in rides on the box — so dragging a box among its neighbors cannot take it out of its group, and deleting one cannot leave the group holding a name that is gone.
  check('subgraphs keep their boxes, their nesting and their direction', () => {
    const { parseFlow, renderFlow, flowDeleteNode, flowMoveNode, flowAddNode } = booted;
    const one = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      return graph;
    };
    const stable = (text) => {
      const back = renderFlow(one(text));
      if (renderFlow(one(back)) !== back) throw new Error(`${JSON.stringify(back)} is not stable`);
      return back;
    };

    // The three spellings of a group's name, all round-tripping as the same one.
    const named = one('flowchart TD\n  subgraph writing [Writing]\n    A[Draft]\n  end');
    if (named.groups[0].id !== 'writing' || named.groups[0].text !== 'Writing') {
      throw new Error(`the group came back as ${JSON.stringify(named.groups[0])}`);
    }
    if (one('flowchart TD\n  subgraph one\n    A[a]\n  end').groups[0].text !== 'one') {
      throw new Error('a group named only once should use that name as its title');
    }
    if (one('flowchart TD\n  subgraph "The middle"\n    A[a]\n  end').groups[0].text !== 'The middle') {
      throw new Error('a quoted title was not read');
    }

    stable('flowchart TD\n  subgraph writing [Writing]\n    A[Draft] --> B[Revise]\n  end\n  B --> C[Ship]');
    // Nested, each with its own direction.
    const nested = stable(
      'flowchart LR\n' +
        '  subgraph outer [Outer]\n    direction TB\n' +
        '    subgraph inner [Inner]\n      direction LR\n      A --> B\n    end\n' +
        '    inner --> C[After]\n  end\n  C --> D[Outside]',
    );
    if (!nested.includes('        direction LR')) throw new Error(`the inner direction moved: ${nested}`);
    const deep = one(nested);
    if (deep.groups.find((group) => group.id === 'inner').parent !== 'outer') {
      throw new Error('the nesting was lost');
    }
    // An arrow may name the group itself, and §19 points at one declared later. That name is a group, not a box invented for it.
    const grouped = one('flowchart LR\n  A[Input] --> group\n  subgraph group [The middle]\n    B --> C\n  end\n  group --> D[Output]');
    if (grouped.nodes.some((node) => node.id === 'group')) throw new Error('the group was also read as a box');
    if (!grouped.edges.some((edge) => edge.to === 'group')) throw new Error('the arrow into the group went missing');
    stable('flowchart LR\n  A[Input] --> group\n  subgraph group [The middle]\n    B --> C\n  end\n  group --> D[Output]');

    // A box named in passing outside and spelled out inside belongs inside.
    const adopted = one('flowchart TD\n  A --> B\n  subgraph g [G]\n    B[Spelled out here]\n  end');
    if (adopted.nodes.find((node) => node.id === 'B').group !== 'g') throw new Error('the box did not join its group');

    // What the canvas does to a grouped diagram: reordering keeps membership, deleting takes the box out and leaves the group standing.
    const edited = one('flowchart TD\n  subgraph g [G]\n    A[a]\n    B[b]\n  end\n  C[c]');
    flowMoveNode(edited, 'A', null);
    if (edited.nodes.find((node) => node.id === 'A').group !== 'g') throw new Error('a reorder moved a box out of its group');
    if (!renderFlow(edited).includes('        A["a"]')) throw new Error('the box left its group on the page');
    flowDeleteNode(edited, 'A');
    flowDeleteNode(edited, 'B');
    const emptied = renderFlow(edited);
    if (!emptied.includes('subgraph g["G"]') || !emptied.includes('end')) throw new Error('the empty group went missing');
    // A box added on the canvas is added outside every group.
    flowAddNode(edited, 'rect', 'New');
    if (edited.nodes[edited.nodes.length - 1].group !== null) throw new Error('a new box landed in a group');

    // A group takes a class and a style the way a box does.
    stable('flowchart TD\n  classDef zone fill:#eee\n  subgraph g [G]\n    A[a]\n  end\n  class g zone\n  style g stroke:#333');
  });

  // Color is the one part of a diagram the canvas has no way to set, and every way of writing it names something the reader can then delete. So it rides on the box and the line it paints, and is written back off them.
  check('classes and styles ride on what they paint', () => {
    const { parseFlow, renderFlow, flowDeleteNode, flowFlipEdge } = booted;
    const one = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      return graph;
    };
    const stable = (text) => {
      const back = renderFlow(one(text));
      if (renderFlow(one(back)) !== back) throw new Error(`${JSON.stringify(back)} is not stable`);
      return back;
    };

    // `:::` on the box and a `class` line say the same thing, and both come back as the line — the typed form cannot carry `:::`, so there is one spelling.
    const painted = stable(
      'flowchart LR\n' +
        '  classDef warn fill:#ffe4e6\n' +
        '  A[Start] --> B[Careful]:::warn\n' +
        '  B --> C[Fine]\n' +
        '  B --> D[Also fine]\n' +
        '  class C,D ok',
    );
    if (!painted.includes('    classDef warn fill:#ffe4e6')) throw new Error('the classDef went missing');
    if (!painted.includes('    class B warn')) throw new Error(`:::warn was not carried: ${painted}`);
    if (!painted.includes('    class C,D ok')) throw new Error(`the class line was not carried: ${painted}`);

    stable('flowchart LR\n  A[Plain] --> B[Picked out]\n  style B fill:#ffe066,stroke-width:2px');
    stable('flowchart LR\n  classDef default fill:#eef2ff\n  A[a] --> B[b]');
    const lined = stable('flowchart LR\n  A --> B --> C --> D\n  linkStyle 0 stroke:#16a34a\n  linkStyle 2 stroke:#7c3aed');
    if (!lined.includes('    linkStyle 0 stroke:#16a34a') || !lined.includes('    linkStyle 2 stroke:#7c3aed')) {
      throw new Error(`the link styles moved: ${lined}`);
    }
    stable('flowchart LR\n  A --> B\n  linkStyle default stroke:#888');

    // Deleting a box takes its color with it, rather than leaving a rule that paints a box mermaid would then have to invent.
    const doomed = one('flowchart LR\n  A[a] --> B[b]\n  style B fill:#f00\n  class B warn\n  classDef warn color:#fff');
    flowDeleteNode(doomed, 'B');
    const after = renderFlow(doomed);
    if (after.includes('style B') || after.includes('class B')) throw new Error(`B's paint outlived it: ${after}`);
    if (!after.includes('classDef warn')) throw new Error('the classDef should stay — it names no box');

    // A line style follows its own line, not the number it happened to have.
    const flipped = one('flowchart LR\n  A --> B\n  B --> C\n  linkStyle 1 stroke:#f00');
    flowFlipEdge(flipped, flipped.edges[1].id);
    if (!renderFlow(flipped).includes('linkStyle 1 stroke:#f00')) throw new Error('the line lost its color');
  });

  // Typed boxes — `A@{ shape: cyl }` — are the only way to reach the shapes the brackets never covered, and mermaid takes several names for each one. We read them all and write the short one, so a file gains no second spelling.
  check('a typed box is read, and written the shortest way', () => {
    const { parseFlow, renderFlow, flowShapeCatalog } = booted;
    const one = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      return graph;
    };

    // Every shape in the catalog, said the typed way, comes back as itself.
    for (const shape of flowShapeCatalog()) {
      const graph = one(`flowchart TD\n    A@{ shape: ${shape.id}, label: "x" }`);
      if (graph.nodes[0].shape !== shape.id) {
        throw new Error(`typed ${shape.id} came back as ${graph.nodes[0].shape}`);
      }
      // And so does every other name mermaid answers to for it.
      for (const alias of shape.also || []) {
        const aliased = one(`flowchart TD\n    A@{ shape: ${alias}, label: "x" }`);
        if (aliased.nodes[0].shape !== shape.id) {
          throw new Error(`${alias} came back as ${aliased.nodes[0].shape}, not ${shape.id}`);
        }
      }
    }

    // A shape with brackets is written in them, however it was written before.
    if (renderFlow(one('flowchart TD\n  A@{ shape: cylinder, label: "Cache" }')) !== 'flowchart TD\n    A[("Cache")]') {
      throw new Error('a typed cylinder was not written back in brackets');
    }
    // The typed form may follow a box already declared, and changes its shape without touching the label it already had — section 14 of the guide.
    const attached = one('flowchart LR\n  A[Plain] --> B[Becomes a cylinder]\n  B@{ shape: cyl }');
    const b = attached.nodes.find((node) => node.id === 'B');
    if (b.shape !== 'cyl' || b.text !== 'Becomes a cylinder') {
      throw new Error(`the attached shape gave ${JSON.stringify(b)}`);
    }
    // A label with the punctuation the braces are made of.
    const awkward = one('flowchart TD\n    A@{ shape: rect, label: "one, two }" }');
    if (awkward.nodes[0].text !== 'one, two }') throw new Error(`the label came back as ${awkward.nodes[0].text}`);
  });

  check('a flowchart we cannot model is refused whole', () => {
    const { parseFlow, flowRefusal } = booted;
    const refused = (text, why) => {
      const graph = parseFlow(text);
      if (graph) throw new Error(`${why}: parsed ${JSON.stringify(text)} instead of refusing`);
      // Refusing silently is the bug the notice was written to fix: every one of these has to come back with something the reader can act on.
      if (!flowRefusal(text)) throw new Error(`${why}: refused ${JSON.stringify(text)} without saying why`);
    };

    // Shapes past phase 2, and brackets that are a syntax error either way.
    refused('flowchart TD\n    A@{ shape: nosuchshape }', 'a shape mermaid does not have');
    refused('flowchart TD\n    A@{ shape: rect, w: 40, h: 20 }', 'a box given a size');
    refused('flowchart TD\n    A@{ shape: rect, label: "x"', 'braces that never close');
    refused('flowchart TD\n    A[/x]', 'an opener with the wrong closer');
    refused('flowchart TD\n    A[[x]', 'a subroutine missing half its closer');
    refused('flowchart TD\n    A((x)', 'a circle missing half its closer');
    // Edges past phase 2. Everything that changes what the diagram means.
    refused('flowchart TD\n    A["a"]\n    end', 'an end with no subgraph');
    refused('flowchart TD\n    subgraph one\n    A["a"]', 'a subgraph that never ends');
    refused('flowchart TD\n    A["a"]\n    direction LR', 'a direction outside a subgraph');
    refused('flowchart TD\n    A["a"]\n    subgraph A\n    end', 'a subgraph named after a box');
    refused('flowchart TD\n    A["a"]\n    style nosuch fill:#f9f', 'a style for a box that is not there');
    refused('flowchart TD\n    A["a"]\n    class nosuch warn', 'a class for a box that is not there');
    refused('flowchart TD\n    A["a"]\n    B["b"]\n    A --> B\n    linkStyle 3 stroke:#f00', 'a style past the last line');
    refused('flowchart TD\n    click A "https://example.com"', 'a click on a box that is not there');
    refused('flowchart TD\n    A["a"]\n    click A _blank', 'a click written a way we cannot read');
    refused('flowchart TD\n    A["x"]; B["y"]', 'two statements on a line');
    // And things that are not a flowchart at all.
    refused('sequenceDiagram\n    a ->> b: hi', 'another diagram type');
    refused('flowchart TD', 'a header with nothing under it');
    refused('---\ntitle: Plan\nflowchart TD\n    A', 'unterminated front matter');
  });

  // A refusal the reader can do something about: which line, and what on it. The line number is what makes it worth saying at all, so it is counted from the top of the block the way the code pane numbers it — front matter and comments included.
  check('a refusal names the line and the feature', () => {
    const { parseFlow, flowRefusal } = booted;
    const says = (text, ...parts) => {
      const said = flowRefusal(text);
      for (const part of parts) {
        if (!said.includes(part)) throw new Error(`${JSON.stringify(text)} -> ${JSON.stringify(said)}, wanted ${part}`);
      }
    };

    says('flowchart TD\n    A["a"]\n    end', 'Line 3', '`end` with no subgraph');
    says('flowchart TD\n    A["a"]\n    direction LR', 'Line 3', 'a direction outside a subgraph');
    says('flowchart TD\n    A["a"]\n    style nosuch fill:#f9f', 'Line 3', 'a box that isn’t there');
    says('flowchart TD\n    A["a"]\n    B["b"]\n    A --> B\n    linkStyle 9 stroke:#f00', 'Line 5', 'a line that isn’t there');
    says('flowchart TD\n    A@{ shape: nosuchshape }', 'Line 2', 'a shape name mermaid doesn’t have');
    says('flowchart TD\n    A@{ shape: rect, w: 40 }', 'Line 2', 'a size or a place of its own');
    says('flowchart TD\n    A["a"]\n    click A _blank', 'Line 3', 'a click written a way we cannot read');
    says('flowchart TD\n    A["x"]; B["y"]', 'Line 2', 'a semicolon');
    says('flowchart TD\n    A["a"]\n    A{"a"}', 'Line 3', 'a second shape');
    // Front matter is part of the block, so it counts toward the line number.
    says('---\ntitle: Plan\n---\nflowchart TD\n    A["a"]\n    A{"a"}', 'Line 6');
    // The ones with no line to point at say what is wrong with the whole block.
    says('sequenceDiagram\n    a ->> b: hi', 'sequenceDiagram');
    says('pie\n    "a": 1', 'pie');
    says('flowchart TD', 'no boxes');
    says('---\ntitle: Plan\nflowchart TD\n    A', 'front matter');
    // And text the canvas does model says nothing at all.
    const fine = 'flowchart TD\n    A["a"]\n    B["b"]\n    A --> B';
    if (!parseFlow(fine)) throw new Error('the sample diagram did not parse');
    if (flowRefusal(fine)) throw new Error(`a diagram that parses gave ${JSON.stringify(flowRefusal(fine))}`);
  });

  // Deleting the last box leaves a diagram that is legal to be halfway through and illegal to write down — mermaid cannot draw an empty flowchart. That is the reason the canvas never re-reads its own output: round-tripping through the text here would hand back null and leave the canvas with no graph at all, leaving the canvas with nothing to add to.
  check('an emptied diagram is still a graph the canvas can add to', () => {
    const { parseFlow, renderFlow, flowDeleteNode, flowAddNode, flowMoveNode } = booted;
    const graph = parseFlow('flowchart TD\n    n1(["Start"])');
    if (!graph) throw new Error('the starter diagram did not parse');
    flowDeleteNode(graph, 'n1');
    if (graph.nodes.length) throw new Error('the box was not removed');
    const bare = renderFlow(graph);
    if (bare !== 'flowchart TD') throw new Error(`emptied to ${JSON.stringify(bare)}`);
    if (parseFlow(bare) !== null) throw new Error('a header with nothing under it should be refused');
    flowAddNode(graph, 'rect', 'Next');
    const back = renderFlow(graph);
    if (back !== 'flowchart TD\n    n1["Next"]') throw new Error(`came back as ${JSON.stringify(back)}`);

    // The sheet's undo is a copied graph, and it copies with JSON. So the graph has to be plain data all the way down — put a function or a Map on it and stepping back would quietly hand back something that isn't the same graph.
    const rich = parseFlow('---\ntitle: Plan\n---\nflowchart LR\n    %% note\n    A["a"]\n    B{"b"}\n    A -.->|"maybe"| B');
    const copied = JSON.parse(JSON.stringify(rich));
    if (renderFlow(copied) !== renderFlow(rich)) throw new Error('a copied graph is not the same graph');

    // Dragging a box among its neighbors is a reorder of the declarations, and that order is what the layout reads. It has to go the way the pointer did.
    const three = parseFlow('flowchart TD\n    A["a"]\n    B["b"]\n    C["c"]');
    const order = () => three.nodes.map((node) => node.id).join('');
    flowMoveNode(three, 'A', null); // dropped past the end
    if (order() !== 'BCA') throw new Error(`moving A to the end gave ${order()}`);
    flowMoveNode(three, 'A', 'B'); // dropped on B, from below
    if (order() !== 'ABC') throw new Error(`moving A before B gave ${order()}`);
  });

  // The gestures that rewire a chain rather than just add to it. Each one has to leave a diagram that still says something, because the reader is dragging a box around, not editing a graph on purpose.
  check('rewiring a chain leaves it connected', () => {
    const { parseFlow, renderFlow, flowSpliceIntoEdge, flowExtractNode, flowFlipEdge, flowDuplicateNode } = booted;
    const chain = () =>
      parseFlow('flowchart TD\n    A["a"]\n    B["b"]\n    C["c"]\n    X["x"]\n    A --> B\n    B --> C');
    const edges = (graph) => graph.edges.map((edge) => edge.from + '>' + edge.to).join(' ');

    // A loose box dropped on a line goes into that line.
    const into = chain();
    flowSpliceIntoEdge(into, 'X', into.edges[0].id);
    if (edges(into) !== 'A>X X>B B>C') throw new Error(`splice gave ${edges(into)}`);

    // A box taken out of the middle closes the gap behind it, or the chain it was in silently comes apart.
    const out = chain();
    flowExtractNode(out, 'B');
    if (edges(out) !== 'A>C') throw new Error(`extract gave ${edges(out)}`);

    // Out of one chain and into another is those two, in that order.
    const moved = chain();
    flowExtractNode(moved, 'B');
    flowSpliceIntoEdge(moved, 'B', moved.edges[0].id);
    if (edges(moved) !== 'A>B B>C') throw new Error(`move gave ${edges(moved)}`);

    // Flipping keeps the line's look and only turns it around.
    const flipped = chain();
    flipped.edges[0].label = 'yes';
    flipped.edges[0].line = 'dotted';
    flowFlipEdge(flipped, flipped.edges[0].id);
    if (edges(flipped) !== 'B>A B>C') throw new Error(`flip gave ${edges(flipped)}`);
    if (flipped.edges[0].label !== 'yes' || flipped.edges[0].line !== 'dotted') {
      throw new Error('flipping a line changed how it looks');
    }

    // A duplicate is a new box beside the original, joined to nothing.
    const copied = chain();
    const copy = flowDuplicateNode(copied, 'B');
    if (!copy || copy.id === 'B') throw new Error('the copy reused the original id');
    if (edges(copied) !== 'A>B B>C') throw new Error(`duplicating added lines: ${edges(copied)}`);
    if (renderFlow(copied).split('\n')[3] !== '    ' + copy.id + '["b"]') {
      throw new Error('the copy did not land beside the original');
    }
  });

  // A box's four + handles all mean the same thing — the next step, that way — and the chart turns when that way is across the flow. The reading depends entirely on the direction, and getting it backwards would put "the next step" above the one it follows: wrong in a way that still looks like a diagram, so nothing on screen would give it away.
  check('every + handle means the next step, that way', () => {
    const { flowBudIntent } = booted;
    // Where each handle sits is the stylesheet's business now — a handle is placed on its own side of the box mermaid drew. What each one *means* is this file's, and that is what the direction decides.
    const css = readingCss();
    for (const side of ['up', 'down', 'left', 'right']) {
      if (!css.includes('.flow-bud.is-' + side)) throw new Error(`no rule places the ${side} handle`);
    }

    const means = (direction, side, want) => {
      const got = flowBudIntent(direction, side);
      const said = got.step + (got.turn ? ' turning ' + got.turn : '');
      if (said !== want) throw new Error(`${direction} ${side}: ${said}, wanted ${want}`);
    };
    // With the flow, against it, and across it — for each of the four charts.
    means('TD', 'down', 'next');
    means('TD', 'up', 'previous');
    means('TD', 'right', 'next turning LR');
    means('TD', 'left', 'next turning RL');
    means('LR', 'right', 'next');
    means('LR', 'left', 'previous');
    means('LR', 'down', 'next turning TD');
    means('LR', 'up', 'next turning BT');
    means('BT', 'up', 'next');
    means('BT', 'down', 'previous');
    means('RL', 'left', 'next');
    means('RL', 'right', 'previous');
    // TB is TD spelled the older way, and has to read the same.
    means('TB', 'down', 'next');
    means('TB', 'up', 'previous');
  });

  check('only the first box is asked which way the chart runs', () => {
    const { parseFlow, flowBudSidesFor, flowAddNode } = booted;
    const same = (got, want, what) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        throw new Error(`${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
      }
    };
    // One box, no direction settled: all four sides, and taking one settles it.
    const lone = parseFlow('flowchart TD\n    A["a"]');
    same(flowBudSidesFor(lone), ['up', 'down', 'left', 'right'], 'a chart of one box');
    // Two boxes: only the pair along the flow, so nothing can spin the diagram round under the pointer. Turning it is the Flow picker's job from here.
    const pair = parseFlow('flowchart TD\n    A["a"]\n    B["b"]\n    A --> B');
    same(flowBudSidesFor(pair), ['down', 'up'], 'a top-down chart');
    same(flowBudSidesFor(parseFlow('flowchart LR\n    A["a"]\n    B["b"]')), ['right', 'left'], 'left to right');
    same(flowBudSidesFor(parseFlow('flowchart BT\n    A["a"]\n    B["b"]')), ['up', 'down'], 'bottom up');
    same(flowBudSidesFor(parseFlow('flowchart RL\n    A["a"]\n    B["b"]')), ['left', 'right'], 'right to left');
    // And a second box takes the other two away.
    flowAddNode(lone, 'rect', 'b');
    same(flowBudSidesFor(lone), ['down', 'up'], 'once there are two');
  });

  check('a handle across the flow turns the chart and carries on', () => {
    const { parseFlow, renderFlow, flowBudRelation, flowAddNode, flowConnect } = booted;
    const graph = parseFlow('flowchart TD\n    A["a"]\n    B["b"]\n    A --> B');
    // What the canvas does with what the handle asked for.
    const relation = flowBudRelation(graph, 'B', 'right');
    if (relation.turn) graph.direction = relation.turn;
    const added = flowAddNode(graph, 'rect', 'c');
    if (relation.connectFrom) flowConnect(graph, relation.connectFrom, added.id);
    const want = 'flowchart LR\n    A["a"]\n    B["b"]\n    n1["c"]\n    A --> B\n    B --> n1';
    if (renderFlow(graph) !== want) throw new Error(`turning right gave ${JSON.stringify(renderFlow(graph))}`);
    // And the handle it turned toward is now the plain "next step" one.
    if (flowBudRelation(graph, 'n1', 'right').turn) throw new Error('the chart did not stay turned');
  });

  check('a flowchart written by hand is read the way mermaid reads it', () => {
    const { parseFlow, renderFlow } = booted;
    const becomes = (text, want) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      const back = renderFlow(graph);
      if (back !== want) throw new Error(`${JSON.stringify(text)} -> ${JSON.stringify(back)}`);
      // And what we wrote is a fixed point, or Save would keep rewriting the file.
      if (renderFlow(parseFlow(back)) !== back) throw new Error(`${JSON.stringify(back)} is not stable`);
    };

    // The older keyword, no direction, bare ids, an unquoted label, a chain, and the between-the-dashes label form — all normalized on the way out.
    becomes('graph\n  A --> B', 'flowchart TD\n    A["A"]\n    B["B"]\n    A --> B');
    becomes('flowchart LR\n  A[Do it] --> B', 'flowchart LR\n    A["Do it"]\n    B["B"]\n    A --> B');
    becomes(
      'flowchart TD\n  A --> B --> C',
      'flowchart TD\n    A["A"]\n    B["B"]\n    C["C"]\n    A --> B\n    B --> C',
    );
    becomes(
      'flowchart TD\n  A -- yes --> B',
      'flowchart TD\n    A["A"]\n    B["B"]\n    A -->|"yes"| B',
    );
    // The dotted and thick spellings of the same thing, which mermaid writes with different dashes around the label.
    becomes(
      'flowchart TD\n  A -. maybe .-> B',
      'flowchart TD\n    A["A"]\n    B["B"]\n    A -.->|"maybe"| B',
    );
    becomes(
      'flowchart TD\n  A == surely ==> B',
      'flowchart TD\n    A["A"]\n    B["B"]\n    A ==>|"surely"| B',
    );
    becomes(
      'flowchart TD\n  A -. no .- B',
      'flowchart TD\n    A["A"]\n    B["B"]\n    A -.-|"no"| B',
    );
    // The `&` shorthand is read as the edges it means — every pairing of the group before the arrow with the group after it.
    becomes(
      'flowchart LR\n  A & B --> C & D',
      'flowchart LR\n' +
        ['A["A"]', 'B["B"]', 'C["C"]', 'D["D"]', 'A --> C', 'A --> D', 'B --> C', 'B --> D']
          .map((line) => '    ' + line)
          .join('\n'),
    );
  });

  // Double-clicking a shape renames it, and that only works because nothing in the canvas's pointerdown calls preventDefault: on a pointerdown it suppresses the compatibility mouse events, and dblclick is one of them. The failure is silent — every drag still works, the double-click just does nothing — so it is held here rather than left to be found by hand.
  check('the canvas keeps the double-click that renames a box', () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/flow-pointer.js'), 'utf8');
    const opened = fragment.indexOf("flowCanvas.addEventListener('pointerdown'");
    const closed = fragment.indexOf("flowCanvas.addEventListener('pointermove'");
    if (opened < 0 || closed < opened) throw new Error('could not find the canvas pointerdown handler');
    const handler = fragment.slice(opened, closed);
    if (/event\.preventDefault\(\)/.test(handler)) {
      throw new Error('pointerdown calls preventDefault, which kills dblclick on a shape');
    }
    if (!/flowCanvas\.addEventListener\('dblclick'/.test(fragment)) {
      throw new Error('the canvas has no dblclick handler to keep');
    }
    // The stylesheet is what holds text selection off instead, or dragging a box sweeps a selection across the diagram.
    const css = readingCss();
    const rule = css.slice(css.indexOf('.flow-canvas {'), css.indexOf('.flow-canvas.is-disabled'));
    if (!/user-select:\s*none/.test(rule)) throw new Error('.flow-canvas does not turn text selection off');
  });

  // The ring around a selected box stands 8px off the shape and follows its corners — nested corners in reverse, so the outer radius is the inner plus the gap. Mermaid builds its shapes with rough.js, so there is no `rx` to read and the inner radius is measured: walk in along the corner's diagonal until the fill starts. Turning that distance back into a radius is the part that is easy to get wrong and invisible when it is.
  check('a corner radius is recovered from how far in the fill starts', () => {
    const { flowCornerRadiusFrom } = booted;
    // A circular corner of radius r has its center at (r, r), so along the diagonal the fill begins at t = r(1 − 1/√2). Feed that t back in.
    const insetFor = (radius) => radius * (1 - Math.SQRT1_2);
    for (const radius of [0, 5, 20, 28, 30, 64]) {
      const got = flowCornerRadiusFrom(insetFor(radius));
      if (Math.abs(got - radius) > 0.001) {
        throw new Error(`a corner of ${radius} came back as ${got.toFixed(2)}`);
      }
    }
    // The wrong constant — the Euclidean gap r(√2 − 1) — is out by exactly √2, which reads as "the ring did nothing" rather than as a broken number.
    const wrong = insetFor(28) / (Math.SQRT2 - 1);
    if (Math.abs(wrong - 28) < 0.001) throw new Error('the two constants are indistinguishable');

    // And a pill: its inner radius is half its height, so the ring around it — half its height plus the gap — is exactly half the ring's own height.
    const gap = 8;
    const height = 56;
    const ring = flowCornerRadiusFrom(insetFor(height / 2)) + gap;
    if (Math.abs(ring - (height + gap * 2) / 2) > 0.001) throw new Error('a pill does not stay a pill');
  });

  // The radius belongs to a drawing; zoom stays outside the cache.
  check('a corner is probed once per drawing, and the held radius still follows the zoom', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const canvas = read('flowCanvas');
    if (!canvas) throw new Error('the page has no flow canvas');
    const names = ['A', 'B', 'C', 'D'];
    const radii = [0, 5, 12, 28];
    let probes = 0;
    // Match Mermaid's node group, outline, and label plate.
    const drawing = () => {
      const stage = fakeElement('');
      stage.classList.add('flow-stage');
      const svg = fakeElement('');
      svg.tagName = 'svg';
      svg.createSVGPoint = () => ({ x: 0, y: 0 });
      stage.appendChild(svg);
      radii.forEach((radius, at) => {
        const group = fakeElement('flowchart-' + names[at] + '-0');
        group.tagName = 'g';
        group.classList.add('node');
        group.getBoundingClientRect = () => ({ top: 0, left: 0, right: 120, bottom: 56, width: 120, height: 56 });
        const plate = fakeElement('');
        plate.tagName = 'rect';
        plate.getBBox = () => ({ x: 20, y: 16, width: 80, height: 24 });
        const outline = fakeElement('');
        outline.tagName = 'path';
        outline.getBBox = () => ({ x: 0, y: 0, width: 120, height: 56 });
        outline.ownerSVGElement = svg;
        // A circular corner begins on the diagonal at the searched inset.
        const inset = radius * (1 - Math.SQRT1_2);
        outline.isPointInFill = (point) => {
          probes += 1;
          return point.x >= inset;
        };
        group.appendChild(plate);
        group.appendChild(outline);
        svg.appendChild(group);
      });
      return stage;
    };
    const graph = { nodes: names.map((id) => ({ id })), edges: [], groups: [] };
    const first = drawing();
    try {
      read(`flowSession = { save: null, text: '', graph: ${JSON.stringify(graph)} };`);
      read('flowZoom = 1;');
      canvas.appendChild(first);
      booted.measureFlowDiagram();
      const cost = probes;
      if (!cost) throw new Error('the first measurement asked the drawing nothing');
      const drawn = read('flowPlaced').nodes.map((node) => node.radius);
      radii.forEach((radius, at) => {
        if (Math.abs(drawn[at] - radius) > 0.05) throw new Error(`a corner of ${radius} was measured as ${drawn[at].toFixed(3)}`);
      });

      // A drawing's cached radii answer again without probing.
      probes = 0;
      booted.measureFlowDiagram();
      if (probes) throw new Error(`measuring the same drawing again went back for ${probes} fill tests`);
      const again = read('flowPlaced').nodes.map((node) => node.radius);
      if (again.join() !== drawn.join()) throw new Error(`the held radii came back as ${again.join(', ')} rather than ${drawn.join(', ')}`);

      // Zoom and the pill clamp apply after the cached reading.
      for (const zoom of [0.5, 1.5, 2.5]) {
        probes = 0;
        read(`flowZoom = ${zoom};`);
        booted.measureFlowDiagram();
        if (probes) throw new Error(`a zoom to ${zoom} went back for ${probes} fill tests`);
        const scaled = read('flowPlaced').nodes.map((node) => node.radius);
        radii.forEach((radius, at) => {
          const want = Math.min(radius * zoom, 28);
          if (Math.abs(scaled[at] - want) > 0.05) throw new Error(`at ${zoom} a corner of ${radius} read ${scaled[at].toFixed(3)} rather than ${want}`);
        });
      }

      // Fresh groups need fresh probes.
      read('flowZoom = 1;');
      first.remove();
      canvas.appendChild(drawing());
      probes = 0;
      booted.measureFlowDiagram();
      if (probes !== cost) throw new Error(`a new drawing took ${probes} fill tests where the first took ${cost}`);
    } finally {
      read('flowSession = null;');
      read('flowPlaced = null;');
      read('flowZoom = 1;');
      for (const stage of [...canvas.querySelectorAll('.flow-stage')]) stage.remove();
    }
  });

  // The sheet has one picture in it and mermaid draws it. Two would mean one of them is a lie, and it would be ours — so nothing in the flowchart code may draw a shape, and there is no second pane to draw it into.
  check('mermaid is the only thing that draws a flowchart', () => {
    const model = readFileSync(join(root, 'src/assets/shell/flow-model.js'), 'utf8');
    // The whole sheet, not whichever fragment kept the name: a negative guard that shrinks when a file is split goes on reporting green over the lines it no longer reads.
    const canvas = SHEET_FRAGMENTS.map((path) => readFileSync(join(root, path), 'utf8')).join('\n');
    const page = readFileSync(join(root, 'src/assets/app-shell.html'), 'utf8');
    // No outlines of our own, and no layout of ours placing them.
    for (const gone of ['outline:', 'grow:', 'layoutFlow', 'flowNodeSize', 'flowEdgeGeometry']) {
      if (model.includes(gone) || canvas.includes(gone)) throw new Error(`${gone} is back`);
    }
    if (/<(polygon|ellipse)\b/.test(canvas)) throw new Error('the canvas is drawing shapes again');
    // One drawing surface: no preview pane beside it.
    if (page.includes('flowPreview')) throw new Error('the second picture is back in the page');
    if (!canvas.includes("mermaid.render('leafFlowDraw'")) throw new Error('the canvas no longer renders with mermaid');
    // The handles are laid over mermaid's drawing, keyed off what it tags. Mermaid writes a box's id on `id` as `flowchart-<id>-<n>`, not on `data-id` — reading the wrong attribute finds nothing and leaves the canvas with no handles at all, silently. Both spellings are read.
    if (!canvas.includes("svg.querySelectorAll('g.node, g[data-id]')")) {
      throw new Error('nothing reads mermaid’s boxes');
    }
    if (!canvas.includes('flowchart-(.+)-')) throw new Error('the box id is not unwrapped from mermaid’s spelling');
    if (!canvas.includes('flowEdgeDomId')) throw new Error('nothing maps mermaid’s lines back to ours');
  });

  // Nothing here borrows jsoncanvas.org's field names: mermaid cannot draw a `.canvas` file, so there is nothing to be compatible with. A node has a shape; an edge runs from one box to another.
  check('the graph says what it means and borrows nothing', () => {
    const { parseFlow } = booted;
    const graph = parseFlow('flowchart TD\n    A["a"]\n    B["b"]\n    A -.->|"maybe"| B');
    const nodeFields = Object.keys(graph.nodes[0]).sort().join(',');
    if (nodeFields !== 'classes,group,href,hrefTip,icon,id,img,shape,style,text') throw new Error(`a node carries ${nodeFields}`);
    const edgeFields = Object.keys(graph.edges[0]).sort().join(',');
    if (edgeFields !== 'animate,ends,from,id,label,line,name,stretch,style,to') throw new Error(`an edge carries ${edgeFields}`);
    for (const path of ['src/assets/shell/flow-model.js', ...SHEET_FRAGMENTS]) {
      const source = readFileSync(join(root, path), 'utf8');
      for (const borrowed of ['fromNode', 'toNode', 'toEnd', 'jsoncanvas']) {
        // The model's header explains why the names went; that mention is fine.
        const hits = source.split(borrowed).length - 1;
        const allowed = borrowed === 'jsoncanvas' && path.endsWith('flow-model.js') ? 1 : 0;
        if (hits > allowed) throw new Error(`${borrowed} is back in ${path}`);
      }
    }
  });

  // Diagrams are drawn in the theme's own colors, read off :root at render time. A token that does not exist reads as an empty string, mermaid falls back to its own palette, and the diagram quietly stops matching the page — so every name in the maps is held to one that really is defined. A color comes from the contract in theme.rs, which every theme fills; everything else from the stylesheet's own block.
  check('the mermaid theme map only names tokens that exist', () => {
    // Read from the fragment rather than the booted page: a `const` in the shell script is not a property of the context, and the map should not have to become one to be checked.
    const fragment = readFileSync(join(root, 'src/assets/shell/mermaid-theme.js'), 'utf8');
    const maps = fragment.slice(
      fragment.indexOf('const MERMAID_COLOR_MAP'),
      fragment.indexOf('function themeTokenValue'),
    );
    if (!maps) throw new Error('could not find the mermaid theme maps in mermaid-theme.js');
    const used = [...new Set([...maps.matchAll(/'(--[a-z0-9-]+)'/g)].map((m) => m[1]))];
    if (used.length < 15) throw new Error(`expected the whole map, got ${used.length} tokens`);
    const theme = readFileSync(join(root, 'src/theme.rs'), 'utf8');
    const contract = theme.slice(
      theme.indexOf('LEAF_SEMANTIC_TOKEN_CONTRACT'),
      theme.indexOf('fn leak_str'),
    );
    const css = readingCss();
    const tokens = readFileSync(join(root, 'src/assets/tokens.css'), 'utf8');
    const defined = new Set([
      ...[...contract.matchAll(/'?"(--lt-[a-z0-9-]+)"/g)].map((m) => m[1]),
      ...[...tokens.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((m) => m[1]),
      ...[...css.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((m) => m[1]),
    ]);
    if (defined.size < 50) throw new Error(`only found ${defined.size} tokens`);
    const missing = used.filter((token) => !defined.has(token));
    if (missing.length) throw new Error(`no such token: ${missing.join(', ')}`);

    // A token that exists is not a token the text sits on, and the map names the fill purely so the ink can be measured against it. A failed diagram's words were measured against the red of the bomb beside them and printed near-black on a near-black block — legible only if you already knew what it said.
    const printedOn = [...maps.matchAll(/errorTextColor: \['(--[a-z0-9-]+)'\]/g)].map((m) => m[1]);
    const cell = css.slice(css.indexOf('pre.mermaid[data-processed="true"]'));
    const fill = (cell.match(/background-color: var\((--[a-z0-9-]+)\)/) || [])[1];
    if (!fill) throw new Error('the diagram cell no longer names the surface it is drawn on');
    if (printedOn.length !== 1 || printedOn[0] !== fill) {
      throw new Error(`the failed diagram's words are measured against ${printedOn.join(', ') || 'nothing'}, and printed on ${fill}`);
    }
  });
}
