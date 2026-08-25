// A drawn box's links, and the diagram opened to the whole window.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  check,
  checkSettled,
  diagramStand,
  fakeElement,
  names,
  record,
  root,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;
  const { answeringForItsOwnChildren, drawnDiagram } = diagramStand(booted);

  // v0.1.468: one line in a document took the whole interface away. Mermaid draws `click A "…"` as a real anchor even at its strict level, and writes only `xlink:href` — which `documentLinkFor` does not match, so the click belonged to the web view and the app page navigated to the site with no tabs, no bar and no way back.
  check('a box wired to a link is the app’s click, not the web view’s', () => {
    const { claimMermaidLinks } = booted;
    const anchor = (attributes) => ({
      attributes,
      hasAttribute: (name) => name in attributes,
      getAttribute: (name) => (name in attributes ? attributes[name] : null),
      getAttributeNS: (ns, name) => attributes[ns + '|' + name] || null,
      setAttribute: (name, value) => {
        attributes[name] = value;
      },
    });
    const xlink = 'http://www.w3.org/1999/xlink';
    const linked = anchor({ [xlink + '|href']: 'https://example.com/x' });
    const already = anchor({ href: '/its/own' });
    const plain = anchor({});
    claimMermaidLinks({ querySelectorAll: () => [linked, already, plain] });
    if (linked.attributes.href !== 'https://example.com/x') throw new Error(`the anchor was not claimed: ${linked.attributes.href}`);
    if (already.attributes.href !== '/its/own') throw new Error('an anchor that had its own href was overwritten');
    if ('href' in plain.attributes) throw new Error('an anchor with nowhere to go was given an href');
  });

  // The half of a link click that lives in the page: what it chooses to put in the command. A site is one page, so a resolved href names a document at the top of it, and a link written one folder down points at nothing.
  check('a click on a link sends the href its author wrote, not the one the browser resolved', () => {
    const { bindDocumentLinks } = booted;
    const app = booted.document.getElementById('app');
    const wasContains = app.contains;
    const wasIpc = booted.ipc;
    const posted = [];
    // The binding is once-per-page, so a run where a render already did it would leave nothing to raise. Reset the latch and take the handler this call adds, rather than the neighbors already watching the same element.
    const wasBound = vm.runInContext('documentLinksBound', booted);
    vm.runInContext('documentLinksBound = false;', booted);
    const WATCHED = ['click', 'auxclick', 'mousedown'];
    const before = new Map(WATCHED.map((type) => [type, (app.listeners.get(type) || []).length]));
    // A stand-in link inside a document body, carrying both forms: the attribute as written, and the address the browser resolved it to.
    const anchor = (written, resolved) => {
      const link = {
        getAttribute: (name) => (name === 'href' ? written : null),
        href: resolved,
        closest: (selector) => (selector === '.document-body' ? { id: 'body' } : link),
      };
      return link;
    };
    const clickOn = (link) => {
      posted.length = 0;
      for (const handler of (app.listeners.get('click') || []).slice(before.get('click'))) {
        handler({ target: link, button: 0, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() {} });
      }
      return posted.find((one) => one.command === 'openLink');
    };
    try {
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
      app.contains = () => true;
      bindDocumentLinks();
      if ((app.listeners.get('click') || []).length === before.get('click')) throw new Error('no click listener was bound to the document');

      const relative = clickOn(anchor('volume-3/README.md', 'https://leaf.test/volume-3/README.md'));
      if (!relative) throw new Error('a click on a document link sent no command');
      if (relative.href !== 'volume-3/README.md') throw new Error(`the click sent ${JSON.stringify(relative.href)} rather than the href as written`);

      // A heading in another document rides along on the written href, so the host still has it to cut off.
      const heading = clickOn(anchor('../two.md#how-it-ranks', 'https://leaf.test/two.md'));
      if (!heading || heading.href !== '../two.md#how-it-ranks') throw new Error(`a link naming a heading sent ${JSON.stringify(heading && heading.href)}`);

      // A diagram's box is an SVG anchor, whose `href` property is an SVGAnimatedString rather than a string, so the attribute is the only readable form.
      const drawn = clickOn(anchor('notes/one.md', { baseVal: 'notes/one.md' }));
      if (!drawn || drawn.href !== 'notes/one.md') throw new Error(`a link drawn in a diagram sent ${JSON.stringify(drawn && drawn.href)}`);

      // A link out of the site is written with its own scheme, so it still reaches the host whole.
      const away = clickOn(anchor('https://example.com/x', 'https://example.com/x'));
      if (!away || away.href !== 'https://example.com/x') throw new Error(`a link off the site sent ${JSON.stringify(away && away.href)}`);

      // A link inside a glossary entry is its own listener, and takes the same word for the same reason.
      const sheet = booted.document.getElementById('glossarySheetBody');
      const inSheet = anchor('volume-3/README.md', 'https://leaf.test/volume-3/README.md');
      posted.length = 0;
      for (const handler of sheet.listeners.get('click') || []) handler({ target: inSheet, preventDefault() {} });
      const raised = posted.find((one) => one.command === 'openLink');
      if (!raised || raised.href !== 'volume-3/README.md') throw new Error(`a link in a glossary entry sent ${JSON.stringify(raised && raised.href)}`);
    } finally {
      booted.ipc = wasIpc;
      app.contains = wasContains;
      // Put the page back where it was, so nothing after this is watched twice.
      for (const type of WATCHED) {
        const held = app.listeners.get(type);
        if (held) held.length = before.get(type);
      }
      vm.runInContext(`documentLinksBound = ${wasBound ? 'true' : 'false'};`, booted);
    }
  });

  // Mermaid substitutes its own glyph for an icon it cannot find — an 80x80 rect in a hardcoded #087ebf, the one color a diagram could show that no theme chose. And a picture whose URL will not decode throws from inside mermaid's renderer, where all the catch upstream can do is leave the block wearing mermaid's error. So both are settled before mermaid reads the block.
  check('a box mermaid cannot draw becomes our own mark before it sees it', () => {
    const { mermaidHasIcon, mermaidRewriteTyped } = booted;
    if (!mermaidHasIcon('leaf:back')) throw new Error('the generated set does not carry leaf:back');
    if (mermaidHasIcon('fa:bell')) throw new Error('a set we do not have was taken as ours');
    if (mermaidHasIcon('leaf:nosuchicon')) throw new Error('a name we do not have was taken as ours');
    if (mermaidHasIcon('back')) throw new Error('a name with no prefix was taken as ours');
    if (!mermaidHasIcon('leaf:missing-image')) throw new Error('the mark both failures fall back to is not in the set');

    // The rewrite reaches only inside `@{ … }`: the same word in a label is the reader's own text.
    const swapped = mermaidRewriteTyped('flowchart TD\n  A@{ icon: "fa:bell" }\n  B["icon: fa:bell"]', (key, value) =>
      key === 'icon' && value !== 'leaf:back' ? 'icon: "leaf:missing-image"' : null,
    );
    if (!swapped.includes('A@{ icon: "leaf:missing-image" }')) throw new Error(`the icon was not swapped: ${swapped}`);
    if (!swapped.includes('B["icon: fa:bell"]')) throw new Error(`the label was rewritten: ${swapped}`);
  });

  // Diagrams are drawn three at a time, and mermaid keeps drawing after one of them throws — so the batch comes back with its error picture in the block it failed on and finished drawings in the rest. Marking all three cost two working diagrams their toolbar and their memo entry every time one broken diagram sat beside them.
  checkSettled('a broken diagram is marked on its own, and the batch beside it finishes', async () => {
    const block = (name, drawn) => {
      const element = fakeElement(name);
      element.__mermaidSource = `flowchart TD\n  ${name} --> B`;
      element.innerHTML = drawn.includes('svg') ? `<svg id="${name}"></svg>` : '';
      element.dataset = { diagramWait: 'true' };
      element.children = [];
      element.appendChild = (child) => {
        element.children.push(child);
        return child;
      };
      // Only what mermaid really left behind answers: the error picture it draws into the block it failed on, and the drawing it leaves in every block it drew.
      element.querySelector = (selector) => (drawn.includes(String(selector)) ? fakeElement(String(selector)) : null);
      return element;
    };
    const bad = block('bad', ['svg', '.error-icon']);
    const good = block('good', ['svg']);
    const unreached = block('unreached', []);

    booted.mermaid = {
      registerIconPacks() {},
      initialize() {},
      run() {
        throw new Error('one block in this batch will not draw');
      },
    };
    booted.drawMermaidDiagrams([bad, good, unreached]);
    // The batch's own promises are all microtasks up to the yield it ends on, which the fake page's timer never fires.
    await new Promise((resolve) => setImmediate(resolve));
    delete booted.mermaid;

    if (bad.dataset.mermaidRender !== 'failed') throw new Error('the diagram carrying mermaid’s error was not marked');
    if (unreached.dataset.mermaidRender !== 'failed') throw new Error('a block with neither an error nor a drawing was left spinning');
    if (good.dataset.mermaidRender) throw new Error('a diagram that drew fine was marked failed beside its neighbor');
    if (good.dataset.diagramWait) throw new Error('a diagram that drew fine never reached finish');
    if (!good.children.some((child) => child.className === 'mermaid-view-controls')) throw new Error('a diagram that drew fine got no toolbar');
    if (bad.children.length) throw new Error('the broken diagram was given a toolbar');

    // The memo is the other half of finishing: the drawing comes straight back on the next pass, where a block that was wrongly marked has nothing to come back to.
    const again = block('good', ['svg']);
    again.innerHTML = '';
    booted.drawMermaidDiagrams([again]);
    if (again.innerHTML !== good.innerHTML) throw new Error('a diagram that drew fine left no memo entry');
  });

  // The diagram's labels are set in the theme's body font, which theme.rs emits per family rather than the stylesheet.
  check('the theme compiler emits the font the diagrams ask for', () => {
    const theme = readFileSync(join(root, 'src/theme.rs'), 'utf8');
    if (!theme.includes('--reading-font')) {
      throw new Error('theme.rs no longer emits --reading-font');
    }
  });

  // An icon is a name on a masked span, never a drawing (see the icon rule in AGENTS.md). Code that swaps one and looks for an `svg` finds nothing and fails in silence: a vault on GitHub kept its box for a release because of exactly this. Mermaid's own drawing is the exception, and it is named line by line rather than by file, so a fourth query cannot ride in behind the three.
  check('nothing looks for an svg where the page draws a masked span', () => {
    // The flowchart editor's stage, and the block a batch threw on being asked whether mermaid drew anything into it at all.
    const mermaidsOwn = new Set([
      "const svg = stage && stage.querySelector('svg');",
      "if (diagram.querySelector('.error-icon') || !diagram.querySelector('svg')) diagram.dataset.mermaidRender = 'failed';",
      // The drawing whose sheet is being hoisted into the page, and the one being handed back its sheet after a restore. Both are mermaid's own SVG and neither can be anything else.
      "const svg = diagram.querySelector('svg');",
      "const svg = node && typeof node.querySelector === 'function' ? node.querySelector('svg') : null;",
      // The drawing the card just made, measured to see whether it is still wide enough to read at the size it fits. Mermaid's own, in a block mermaid drew.
      "const drawing = block.querySelector('svg');",
    ]);
    const offenders = [];
    for (const name of names) {
      const text = readFileSync(join(root, 'src/assets', name), 'utf8');
      for (const line of text.split('\n')) {
        if (!/querySelector(All)?\(\s*['"]svg['"]\s*\)/.test(line)) continue;
        if (!mermaidsOwn.has(line.trim())) offenders.push(`${name}: ${line.trim()}`);
      }
    }
    if (offenders.length) throw new Error(`looks for an svg: ${offenders.join(', ')}`);
  });

  // Mermaid sizes a box from its own measurement of the label, so measuring in the fallback face and painting in the theme's takes the last letter off every box in the diagram. v0.1.441 shipped that.
  check('diagrams are measured only once the fonts have landed', () => {
    const decorate = readFileSync(join(root, 'src/assets/shell/decorate.js'), 'utf8');
    const draw = decorate.slice(decorate.indexOf('function drawMermaidBatches'));
    const wait = draw.indexOf('document.fonts.ready');
    const init = draw.indexOf('mermaid.initialize');
    if (wait < 0) throw new Error('the draw path no longer waits for the fonts');
    if (init < 0 || wait > init) throw new Error('the fonts are waited for after the diagrams are measured');
  });

  // The full-window diagram is built per open and torn down by a render, and both halves fail silently: mermaid replaces the stage's contents with the SVG it made, so a control put in before the draw is simply gone, and a variable of this fragment's own is still in its dead zone while theme.js runs the first render — which is one of the things that closes the overlay.
  check('the full-window diagram survives its own draw and the first render', () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/diagram-view.js'), 'utf8');
    const draw = fragment.slice(fragment.indexOf('function drawDiagramStage'));
    const run = draw.indexOf('mermaid.run({ nodes: [stage] })');
    const controls = draw.indexOf('addDiagramStageControls(stage)');
    if (run < 0 || controls < 0) throw new Error('the stage is no longer drawn, or gains no controls');
    if (controls < run) throw new Error('the controls go in before mermaid draws, so the draw wipes them');
    const declarations = [...fragment.matchAll(/^(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    if (declarations.length) {
      throw new Error(`this fragment holds state a first render would read too early: ${declarations.join(', ')}`);
    }
    // Which is why the overlay is found by query, and what it has to put back is held on the element.
    if (!fragment.includes("app.querySelector('.diagram-overlay')")) {
      throw new Error('nothing finds the overlay in the page');
    }
  });

  // The same corner as the page's, minus the fourth view button — a diagram already on the whole window has nothing to expand into — and its menu belongs to the overlay rather than to the surface underneath it, which is what keeps it above the drawing.
  check('the full-window view carries the export button and no fifth view button', () => {
    const overlay = booted.document.createElement('div');
    overlay.className = 'diagram-overlay';
    overlay.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 });
    const block = drawnDiagram('flowchart TD\n  F1 --> F2');
    overlay.__diagramBlock = block;

    const stage = drawnDiagram('flowchart TD\n  F1 --> F2');
    stage.className = 'mermaid diagram-stage';
    overlay.appendChild(stage);
    booted.addDiagramStageControls(stage);

    const row = stage.__find('mermaid-view-controls');
    if (!row) throw new Error('the full-window view has no controls row');
    const chip = row.children[0];
    if (!String(chip.className).includes('mermaid-export')) throw new Error('the export chip is not first in the row');
    const zoom = row.children[1];
    if (!String(zoom.className).includes('mermaid-zoom')) throw new Error('the zoom group did not follow the chip');
    if (zoom.children.length !== 3) throw new Error(`the full-window view carries ${zoom.children.length} view buttons`);
    // The X is the one thing further right, and it is put in first so the row lands left of it.
    if (stage.children.indexOf(row) < stage.children.indexOf(stage.__find('diagram-close'))) {
      throw new Error('the row was put in ahead of the close cross');
    }
    // Built once, so a redraw of the stage does not stack a second row on it.
    booted.addDiagramStageControls(stage);
    if (stage.children.filter((child) => String(child.className).includes('mermaid-view-controls')).length !== 1) {
      throw new Error('drawing the stage again built the row all over again');
    }

    chip.closest = (selector) => (String(selector) === '.diagram-overlay' ? overlay : null);
    chip.getBoundingClientRect = () => ({ left: 700, top: 40, right: 728, bottom: 68, width: 28, height: 28 });
    const wasSend = booted.ipc.postMessage;
    const sent = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    try {
      booted.openMermaidExportMenu(chip);
      // The overlay's Export asks where the file goes like every other one, and on Windows puts nothing over the drawing it is showing.
      const asked = sent.filter((one) => one.command === 'pickDiagramPath');
      if (asked.length !== 1) throw new Error(`the full-window Export asked ${asked.length} times where the file goes`);
      const surface = booted.document.getElementById('appSurface');
      if (overlay.children.some((child) => String(child.className || '') === 'flow-menu')) {
        throw new Error('on Windows the full-window Export opened a menu over the drawing');
      }
      if (surface.children.some((child) => String(child.className || '') === 'flow-menu')) {
        throw new Error('on Windows the full-window Export opened a menu on the surface under the overlay');
      }
    } finally {
      booted.ipc.postMessage = wasSend;
    }
  });

  // Every way out is pressed on the element that carries it, over a diagram of the check's own: a binding matched as a line of text passes whether or not anything ever reaches it. Each exit gets a fresh overlay, because the first close takes the overlay and its dim off the page.
  check('the full-window diagram opens over a diagram of its own, wears its open state, and every way out takes it back down', () => {
    const app = booted.document.getElementById('app');
    const read = (expression) => vm.runInContext(expression, booted);
    const wasQuery = app.querySelector;
    const was = {
      format: read('currentDocumentFormat'),
      unlocked: read('readingUnlocked'),
      sourceEdit: booted.startBlockSourceEdit,
      blockSheet: booted.openMermaidBlockSheet,
    };
    const held = app.children.slice();
    const opener = fakeElement('checkedDiagramOpener');
    const wornBy = (child) => String((child && child.className) || '');
    // The page's class list holds only what the shipped markup declares, so an overlay the open just built is not in it — the one query that finds it is pointed at what landed on the page, the way the checks above point it.
    let standing = null;
    let current = null;
    const openOnce = () => {
      standing = null;
      const block = drawnDiagram('flowchart TD\n  V1 --> V2');
      // The place in the file the corner pair acts on. Without it the pair is not built, and neither handoff has anything to give the document back with.
      block.dataset.srcStart = '0';
      block.dataset.srcEnd = '32';
      booted.openDiagramOverlay(block, opener);
      const fresh = app.children.filter((child) => !held.includes(child));
      standing = fresh.find((child) => wornBy(child).includes('diagram-overlay')) || null;
      const scrim = fresh.find((child) => wornBy(child) === 'lt-backdrop') || null;
      if (!standing || !scrim) throw new Error(`opening the full-window diagram put ${fresh.length} new things on the page`);
      const stage = answeringForItsOwnChildren(standing.children[0]);
      if (!wornBy(stage).includes('diagram-stage')) throw new Error('the overlay opened holding nothing to draw on');
      if (stage.__mermaidSource !== block.__mermaidSource) throw new Error('the stage is not a picture of the diagram it was opened from');
      // The open state rides on a frame the page asks for, so an overlay born open could never be seen arriving.
      if (standing.classList.contains('open')) throw new Error('the overlay and its dim were built already open');
      booted.__frames.drain();
      if (!standing.classList.contains('open') || !scrim.classList.contains('open')) {
        throw new Error('the frame the page asked for left the overlay or its dim shut');
      }
      // The runtime never lands in the stand-in head, so the draw's promise stays pending and the controls that ride on it never arrive. They go in here, which is where the draw would have put them.
      booted.addDiagramStageControls(stage);
      current = { overlay: standing, scrim, stage, block };
      return current;
    };
    const press = (element, event = {}) => (element.listeners.get('click') || []).forEach((handler) => handler(event));
    // Raised on the document's own list rather than called by name: the fragment binds it at load, and a handler nothing ever registered would pass a call.
    const escape = () => {
      const event = { key: 'Escape', preventDefault() {}, stopPropagation() {} };
      for (const handler of booted.document.listeners.get('keydown') || []) handler(event);
    };
    const gone = (...leaving) => leaving.every((one) => !app.children.includes(one));
    // Where each tool button hands the document, and whether the overlay was still standing when it got there: both destinations put something over the page the overlay would otherwise be covering.
    let handedOff = null;
    const recordHandoff = (which) => (block) => {
      handedOff = { which, block, overlayStanding: !gone(current.overlay, current.scrim) };
    };
    const pressTool = (stage, which) => {
      const tools = stage.__find('mermaid-tools');
      if (!tools) throw new Error('the full-window diagram carries no pair of buttons to give the document back with');
      const button = tools.children.find((child) => child.dataset.mermaidTool === which);
      if (!button) throw new Error(`the pair has no ${which} button`);
      // The row is what is listened to, and it asks the press which button it was: a walk up the stand-in cannot do.
      button.closest = (selector) => (String(selector) === '.mermaid-tool' ? button : null);
      press(tools, { target: button, preventDefault() {}, stopPropagation() {} });
    };
    try {
      app.querySelector = (selector) => (String(selector) === '.diagram-overlay' ? standing : wasQuery.call(app, selector));
      // The two conditions the corner pair is built under, so the same open can be pressed either way.
      read('currentDocumentFormat = \'markdown\'; readingUnlocked = true;');
      booted.startBlockSourceEdit = recordHandoff('source');
      booted.openMermaidBlockSheet = recordHandoff('sheet');

      const first = openOnce();
      const cross = first.stage.__find('diagram-close');
      if (!cross) throw new Error('the drawn stage carries no close cross');
      press(cross);
      if (!gone(first.overlay, first.scrim)) throw new Error('the close cross left the overlay or its dim standing on the page');

      const second = openOnce();
      press(second.scrim);
      if (!gone(second.overlay, second.scrim)) throw new Error('a press on the overlay’s own dim left it standing on the page');

      const third = openOnce();
      escape();
      if (!gone(third.overlay, third.scrim)) throw new Error('Escape on the document left the overlay or its dim standing on the page');

      // Both buttons are one listener with two handoffs, so each is pressed on an overlay of its own and read for where it went.
      for (const which of ['source', 'sheet']) {
        const naming = which === 'source' ? 'the button for the diagram’s own text' : 'the button for the flowchart editor';
        const open = openOnce();
        handedOff = null;
        pressTool(open.stage, which);
        if (!gone(open.overlay, open.scrim)) throw new Error(`${naming} left the overlay or its dim standing on the page`);
        if (!handedOff) throw new Error(`${naming} took the overlay down and gave the document to nothing`);
        if (handedOff.which !== which) throw new Error(`${naming} gave the document to the other one`);
        if (handedOff.block !== open.block) throw new Error(`${naming} gave on the stage rather than the block it is a picture of`);
        if (handedOff.overlayStanding) throw new Error(`${naming} opened over an overlay that was still standing`);
      }
    } finally {
      app.querySelector = wasQuery;
      booted.startBlockSourceEdit = was.sourceEdit;
      booted.openMermaidBlockSheet = was.blockSheet;
      read(`currentDocumentFormat = ${JSON.stringify(was.format)}; readingUnlocked = ${JSON.stringify(was.unlocked)};`);
      for (const child of app.children.slice()) if (!held.includes(child)) child.remove();
    }
  });
}
