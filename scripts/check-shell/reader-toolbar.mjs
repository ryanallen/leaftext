// The view buttons hold their place while editing actions enter and leave the floating bar, and the view's own tools ride in a tray parked behind it.

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { check, readingCss, record, root } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;
  const standViewButtons = () => {
    booted.document.getElementById('viewReadingButton').dataset.view = 'reading';
    booted.document.getElementById('viewCodeButton').dataset.view = 'code';
    booted.document.getElementById('viewGraphButton').dataset.view = 'graph';
  };

  check('a view press leaves the floating bar visible while the document wait is up', () => {
    const toolbar = booted.document.getElementById('readerToolbar');
    const wait = booted.document.getElementById('readerLoading');
    try {
      vm.runInContext("currentState = { tabs: [{ path: 'notes.md' }], active: 0 }; setReaderView('code');", booted);
      if (toolbar.hidden) throw new Error('the source press hid the floating bar');
      if (wait.hidden) throw new Error('the source press raised no document wait');
    } finally {
      vm.runInContext('clearReaderLoading(); currentState = null;', booted);
    }
  });

  check('pressing source lights its chip before the host answers', () => {
    const code = booted.document.getElementById('viewCodeButton');
    try {
      standViewButtons();
      vm.runInContext("currentState = { tabs: [{ path: 'notes.md' }], active: 0 }; graphViewOpen = false; codeViewActive = false; pendingReaderView = null; setReaderView('code');", booted);
      if (code.getAttribute('aria-pressed') !== 'true') throw new Error('the reading chip stayed lit while source was pending');
      if (vm.runInContext('codeViewActive', booted)) throw new Error('the host answered inside the press stand');
    } finally {
      vm.runInContext('clearReaderLoading(); pendingReaderView = null; currentState = null;', booted);
    }
  });

  check('a map-to-source press lights source while the map is still up', () => {
    const code = booted.document.getElementById('viewCodeButton');
    const graph = booted.document.getElementById('readerGraph');
    try {
      standViewButtons();
      vm.runInContext("currentState = { tabs: [{ path: 'notes.md' }], active: 0 }; graphViewOpen = true; codeViewActive = false; pendingReaderView = null; applyGraphView(); setReaderView('code');", booted);
      if (graph.hidden) throw new Error('the map left before source arrived');
      if (code.getAttribute('aria-pressed') !== 'true') throw new Error('the map chip stayed lit while source was pending');
    } finally {
      vm.runInContext('clearReaderLoading(); graphViewOpen = false; graphExitPending = false; pendingReaderView = null; currentState = null;', booted);
    }
  });

  check('a source view that will not open restores the reading chip', () => {
    const reading = booted.document.getElementById('viewReadingButton');
    try {
      standViewButtons();
      vm.runInContext("currentState = { tabs: [{ path: 'notes.md' }], active: 0 }; graphViewOpen = false; codeViewActive = false; pendingReaderView = null; setReaderView('code'); abandonCodeView('test refusal', new Error('refused'));", booted);
      if (reading.getAttribute('aria-pressed') !== 'true') throw new Error('the refused source view left its chip lit');
      if (vm.runInContext('pendingReaderView', booted) !== null) throw new Error('the refused source view stayed pending');
    } finally {
      vm.runInContext('clearReaderLoading(); pendingReaderView = null; currentState = null;', booted);
    }
  });

  check('a host that never answers restores the rendered chip with the wait timeout', () => {
    const reading = booted.document.getElementById('viewReadingButton');
    try {
      standViewButtons();
      vm.runInContext("currentState = { tabs: [{ path: 'notes.md' }], active: 0 }; graphViewOpen = false; codeViewActive = false; pendingReaderView = null; setReaderView('code');", booted);
      const safety = booted.__timers.armed().find((timer) => timer.delay === 30000);
      if (!safety) throw new Error('the document wait armed no safety timeout');
      booted.__timers.run(safety.id);
      if (reading.getAttribute('aria-pressed') !== 'true') throw new Error('the timed-out source view left its chip lit');
      if (vm.runInContext('pendingReaderView', booted) !== null) throw new Error('the timed-out source view stayed pending');
    } finally {
      vm.runInContext('clearReaderLoading(); pendingReaderView = null; currentState = null;', booted);
    }
  });

  check('the view chip sits at the pressed button inside its group', () => {
    const group = booted.document.getElementById('readerToolbar').querySelector('.reader-tool-group');
    const buttons = {
      reading: booted.document.getElementById('viewReadingButton'),
      code: booted.document.getElementById('viewCodeButton'),
      graph: booted.document.getElementById('viewGraphButton'),
    };
    standViewButtons();
    buttons.reading.offsetLeft = 0;
    buttons.code.offsetLeft = 32;
    buttons.graph.offsetLeft = 64;
    for (const [view, button] of Object.entries(buttons)) {
      vm.runInContext(`pendingReaderView = '${view}'; renderReaderToolbar(true);`, booted);
      const at = group.style.getPropertyValue('--reader-tool-chip-x');
      if (at !== `${button.offsetLeft}px`) throw new Error(`the ${view} chip sat at ${at || 'nothing'} instead of ${button.offsetLeft}px`);
    }
    vm.runInContext('pendingReaderView = null;', booted);
  });

  check('all six view trips move one chip and editing actions leave it in place', () => {
    const toolbar = booted.document.getElementById('readerToolbar');
    const group = toolbar.querySelector('.reader-tool-group');
    const save = booted.document.getElementById('saveButton');
    const undo = booted.document.getElementById('undoButton');
    const buttons = {
      reading: booted.document.getElementById('viewReadingButton'),
      code: booted.document.getElementById('viewCodeButton'),
      graph: booted.document.getElementById('viewGraphButton'),
    };
    standViewButtons();
    buttons.reading.offsetLeft = 0;
    buttons.code.offsetLeft = 32;
    buttons.graph.offsetLeft = 64;
    for (const [from, to] of [['reading', 'code'], ['reading', 'graph'], ['code', 'reading'], ['code', 'graph'], ['graph', 'reading'], ['graph', 'code']]) {
      vm.runInContext(`graphViewOpen = ${from === 'graph'}; codeViewActive = ${from === 'code'}; pendingReaderView = '${to}'; renderReaderToolbar(true);`, booted);
      if (buttons[to].getAttribute('aria-pressed') !== 'true') throw new Error(`${from} to ${to} left another chip lit`);
      if (group.style.getPropertyValue('--reader-tool-chip-x') !== `${buttons[to].offsetLeft}px`) throw new Error(`${from} to ${to} left the chip behind`);
      save.hidden = false;
      undo.hidden = false;
      booted.renderReaderToolbar(true);
      if (group.style.getPropertyValue('--reader-tool-chip-x') !== `${buttons[to].offsetLeft}px`) throw new Error(`editing actions moved the ${to} chip`);
      save.hidden = true;
      undo.hidden = true;
    }
    vm.runInContext('graphViewOpen = false; codeViewActive = false; pendingReaderView = null;', booted);
  });

  check("the nub follows each view button in the toolbar's coordinates", () => {
    const toolbar = booted.document.getElementById('readerToolbar');
    const tray = booted.document.getElementById('readerToolTray');
    const tools = booted.document.getElementById('readerViewTools');
    const padlock = booted.document.getElementById('readerLockButton');
    if (!tray) throw new Error('the bar carries no tray for the view tools');

    // Parked it is clipped to the nub, which is the only part a press can reach — a tray nobody can see must not take the press meant for the page under it, and clipping is what holds both the pointer and the tools. Never taken out of the layout: display:none and visibility:hidden both drop the padlock out of the Tab order, and focus arriving is one of the two ways the tray comes out.
    const css = readingCss();
    const parked = css.slice(css.indexOf('.reader-tool-tray {'), css.indexOf('}', css.indexOf('.reader-tool-tray {')));
    if (!parked.includes('overflow: hidden;')) throw new Error(`the parked tray does not hold its tools inside the nub: ${parked}`);
    if (!/height:\s*\d+px;/.test(parked)) throw new Error(`the parked tray is not clipped to a nub at all: ${parked}`);
    if (parked.includes('display: none;') || parked.includes('visibility: hidden;')) {
      throw new Error(`the parked tray is out of the Tab order: ${parked}`);
    }

    // Where each view's button stands, so the anchor can be read back against the one that is on.
    const group = toolbar.querySelector('.reader-tool-group');
    group.offsetParent = toolbar;
    group.offsetLeft = 4;
    const middles = { reading: 40, code: 70, graph: 100 };
    const place = (id, middle) => {
      const button = booted.document.getElementById(id);
      button.offsetParent = group;
      button.offsetLeft = middle - group.offsetLeft - 12;
      button.offsetWidth = 24;
      return button;
    };
    place('viewReadingButton', middles.reading);
    place('viewCodeButton', middles.code);
    place('viewGraphButton', middles.graph);
    // The map's tools are one named list wider than a button, so that tray takes the bar's own middle rather than the graph button's — centered on the button it hangs off the end of the bar.
    toolbar.offsetWidth = 132;
    toolbar.clientWidth = 130;
    middles.graph = 65;

    // The graph view fills the tray with a named list and the other two with stacked icons, so how far the nub grows has to be measured rather than declared — and a clipped box cannot report its own content height, which is why it is scrollHeight.
    const heights = { reading: 54, code: 54, graph: 31 };
    for (const view of ['reading', 'code', 'graph']) {
      vm.runInContext('currentDocumentBindsAnything = true;', booted);
      tools.offsetHeight = heights[view];
      booted.renderViewTools(view);
      if (tray.hidden) throw new Error(`the ${view} view drew no tray`);
      if (tools.hidden) throw new Error(`the ${view} view left the recess out of the tray`);
      // The nub stands over the button of the view whose tools it holds, so it says where they went.
      const at = toolbar.style.getPropertyValue('--reader-tray-left');
      if (at !== `${middles[view]}px`) {
        throw new Error(`the ${view} view anchored the tray at ${at || 'nothing'} rather than ${middles[view]}px`);
      }
      // And it grows to what it holds, or the tools are cut off in the view whose tray is a different shape.
      const tall = toolbar.style.getPropertyValue('--reader-tray-height');
      if (tall !== `${heights[view]}px`) {
        throw new Error(`the ${view} view grows the nub to ${tall || 'nothing'} against ${heights[view]}px of tools`);
      }
    }

    const reading = booted.document.getElementById('viewReadingButton');
    const prior = toolbar.style.getPropertyValue('--reader-tray-left');
    reading.offsetParent = group;
    group.offsetParent = null;
    booted.renderViewTools('reading');
    if (toolbar.style.getPropertyValue('--reader-tray-left') !== prior) {
      throw new Error('a button outside the toolbar chain replaced the last good tray anchor');
    }
    group.offsetParent = toolbar;

    // And the padlock is still a real element in both editable views, which is what Tab walks.
    for (const view of ['reading', 'code']) {
      booted.renderViewTools(view);
      if (padlock.hidden) throw new Error(`the ${view} view took the padlock out of the page`);
    }
  });

  check("the map nub uses the toolbar's padding-box middle", () => {
    const toolbar = booted.document.getElementById('readerToolbar');
    const group = toolbar.querySelector('.reader-tool-group');
    const graph = booted.document.getElementById('viewGraphButton');
    group.offsetParent = toolbar;
    graph.offsetParent = group;
    toolbar.offsetWidth = 132;
    toolbar.clientWidth = 130;
    vm.runInContext('currentDocumentBindsAnything = true;', booted);
    booted.renderViewTools('graph');
    const at = toolbar.style.getPropertyValue('--reader-tray-left');
    if (at !== '65px') throw new Error(`the map nub used ${at || 'nothing'} instead of the toolbar's 65px inner middle`);
  });

  check('the open tray leaves equal steps above and below its tools', () => {
    const css = readingCss();
    // The rule that opens a line, never one that merely ends with the same name: `.reader-tool-tray:hover .reader-view-tools {` would otherwise answer for `.reader-view-tools`.
    const body = (selector) => {
      const opened = css.indexOf(`\n${selector} {`);
      if (opened < 0) throw new Error(`no rule for ${selector}`);
      return css.slice(opened + 1, css.indexOf('}', opened));
    };
    const parked = body('.reader-tool-tray');
    const out = body(`.reader-toolbar:has(.reader-tool.is-active:hover) .reader-tool-tray,
.reader-tool-tray:hover,
.reader-tool-tray:has(:focus-visible),
.reader-tool-tray:has(select:focus)`);

    // A press leaves plain focus on the button it landed on, so `:focus-within` held the tray out until the reader clicked somewhere else. `:focus-visible` is the distinction — Tab sets it and a press does not — and the graph size is the one press that still has to hold it, because its list is a window of its own the pointer leaves the tray to reach.
    if (css.includes('.reader-tool-tray:focus-within')) {
      throw new Error('a press inside the tray pins it open');
    }
    if (!css.includes('.reader-tool-tray:has(select:focus)')) {
      throw new Error('the graph size does not hold the tray out while its list is up');
    }

    // The nub is the tray at its shortest, so nothing else may be drawn above the bar to stand under it once it has grown.
    if (css.includes('.reader-tool-handle')) {
      throw new Error('a second element still draws above the bar beside the tray');
    }
    // The whole motion is one box getting taller in one place. A transform or a fade is what the owner met as a second panel arriving over the page.
    for (const [name, rule] of [['parked', parked], ['out', out]]) {
      if (/opacity:/.test(rule)) throw new Error(`the ${name} tray fades rather than grows: ${rule}`);
      if (/transform:\s*translate\(/.test(rule) || /translateY/.test(rule)) {
        throw new Error(`the ${name} tray moves rather than grows: ${rule}`);
      }
    }
    // Anchored inside the bar's border box, so its foot goes behind the opaque face and the nub meets the bar with no seam.
    if (!/bottom:\s*calc\(100% - var\(--reader-tray-foot\)\);/.test(parked)) {
      throw new Error(`the tray does not sink its foot into the bar: ${parked}`);
    }
    // It grows to what it holds, measured beside the anchor — a height that is not a number cannot be animated to, so `none` or `max-content` would snap.
    if (!out.includes('height: calc(var(--reader-tray-height')) {
      throw new Error(`the grown tray does not take the height that was measured for it: ${out}`);
    }
    // Quick, and springing about a tenth past its mark before it settles, which is the rubberband at the top.
    if (!out.includes('var(--lt-ease-overshoot)')) {
      throw new Error(`the tray comes out with no spring in it: ${out}`);
    }
    if (!/transition:[^;]*height/.test(out) || !/transition:[^;]*height/.test(parked)) {
      throw new Error('the tray does not animate the height it grows by');
    }
    // The tools are held inside it rather than hidden, and they sit below the bar's own top edge while it is the nub, so the nub is a clean edge rather than a sliver of the padlock.
    if (!parked.includes('overflow: hidden;') || !parked.includes('justify-content: flex-start;')) {
      throw new Error(`the tools are not held inside the tray behind its own edge: ${parked}`);
    }
    // A length, whether it is written out or named. The token file is read rather than the sheet, because the sheet the checks are handed carries the rules and not the values behind them.
    const tokens = readFileSync(join(root, 'src/assets/tokens.css'), 'utf8');
    const componentLength = (name) => new RegExp(`${name}:\\s*(-?[\\d.]+)px;`).exec(parked);
    const lengthOf = (value) => {
      const named = /^var\((--[\w-]+)\)$/.exec(value.trim());
      // Doubled on purpose: a template literal eats a single backslash, so `\s` written here would reach the pattern as a bare `s`.
      const literal = named
        ? componentLength(named[1]) || new RegExp(`${named[1]}:\\s*(-?[\\d.]+)px;`).exec(tokens)
        : /^(-?[\d.]+)px$/.exec(value.trim());
      if (!literal) throw new Error(`not a length this check can read: ${value}`);
      return Number(literal[1]);
    };
    const px = (rule, property) => {
      const found = new RegExp(`${property}:\\s*([^;]+);`).exec(rule);
      if (!found) throw new Error(`${property} is not declared: ${rule}`);
      return lengthOf(found[1]);
    };
    const sunk = /bottom:\s*calc\(100% - (var\(--reader-tray-foot\))\);/.exec(parked);
    if (!sunk) throw new Error(`the tray does not say how far it sinks into the bar: ${parked}`);
    const inset = /padding:\s*(var\(--lt-space-\d+\))\s+var\(--lt-space-\d+\)\s+calc\(([^)]+\)[^;]*)\);/.exec(parked);
    if (!inset) throw new Error(`the tray does not name its top and bottom steps: ${parked}`);
    const top = lengthOf(inset[1]);
    const bottom = inset[2].split(/\s*\+\s*/).reduce((sum, value) => sum + lengthOf(value), 0);
    const foot = lengthOf(sunk[1]);
    const barStroke = lengthOf('var(--lt-stroke-1)');
    const proud = px(parked, 'height') - foot;
    // The nub stands proud of the bar rather than level with it, or there is nothing to say the tools are in there — which is what evening the insets cost once, before the tools were carried out of the nub instead of held below it.
    if (proud < 1) {
      throw new Error(`the nub stands ${proud}px proud of the bar, so nothing peeks`);
    }
    // The hidden foot and the bar's stroke come back off the bottom padding, leaving the same visible step as the top.
    const visibleBottom = bottom - foot - barStroke;
    if (top !== visibleBottom) {
      throw new Error(`the tray leaves ${top}px above its tools and ${visibleBottom}px below them`);
    }
    // Nothing of the tools is in the nub, and it is the carry rather than the inset that keeps them out — so how proud the nub stands and how far they are inset are free of each other, which is what evening the insets cost when they were not.
    const recess = body('.reader-view-tools');
    const carried = /transform: translateY\(calc\((.+) - (\d+)px\)\);/.exec(recess);
    if (!carried) throw new Error(`the tools are not carried out of the nub while it is parked: ${recess}`);
    const verticalPieces = 'var(--reader-tray-height, 80px) + var(--lt-space-2) * 2 + var(--reader-tray-foot) + var(--lt-stroke-1) * 2';
    if (!out.includes(`height: calc(${verticalPieces});`)) {
      throw new Error(`the grown tray does not count every vertical piece: ${out}`);
    }
    if (carried[1] !== verticalPieces) {
      throw new Error(`the parked tools do not travel by the tray's full grown height: ${carried[0]}`);
    }
    // And by exactly the growth, so they land where the grown tray's own inset puts them: the nub's own height is what comes back off.
    if (Number(carried[2]) !== px(parked, 'height')) {
      throw new Error(`the carry takes ${carried[2]}px back off against a nub ${px(parked, 'height')}px tall`);
    }
  });

  check('Save arriving and leaving does not move the view buttons', () => {
    const toolbar = booted.document.getElementById('readerToolbar');
    const viewGroup = toolbar.querySelector('.reader-tool-group');
    const wasComputedStyle = booted.getComputedStyle;
    let writes = 0;
    const setProperty = toolbar.style.setProperty.bind(toolbar.style);
    toolbar.style.setProperty = (name, value) => {
      writes += 1;
      setProperty(name, value);
    };
    booted.getComputedStyle = () => ({ paddingRight: '8px' });
    viewGroup.getBoundingClientRect = () => ({ right: 220 });
    try {
      vm.runInContext("currentState = { tabs: [{ path: 'notes.md' }], active: 0 }; dirtyByPath.clear(); undoableByPath.clear(); redoableByPath.clear();", booted);
      toolbar.getBoundingClientRect = () => ({ right: 300 });
      booted.setDirtyState('notes.md', true);
      if (toolbar.style.getPropertyValue('--reader-toolbar-edits') !== '72px') {
        throw new Error(`Save left an offset of ${toolbar.style.getPropertyValue('--reader-toolbar-edits') || 'nothing'}`);
      }
      const afterSave = writes;
      booted.holdViewButtonsStill();
      if (writes !== afterSave) throw new Error('an unchanged editing half was written again');

      toolbar.getBoundingClientRect = () => ({ right: 228 });
      booted.setDirtyState('notes.md', false);
      if (toolbar.style.getPropertyValue('--reader-toolbar-edits') !== '0px') {
        throw new Error(`an empty editing half left ${toolbar.style.getPropertyValue('--reader-toolbar-edits') || 'nothing'} reserved`);
      }
    } finally {
      booted.getComputedStyle = wasComputedStyle;
      toolbar.style.setProperty = setProperty;
      vm.runInContext('currentState = null; dirtyByPath.clear(); undoableByPath.clear(); redoableByPath.clear();', booted);
    }
  });
}
