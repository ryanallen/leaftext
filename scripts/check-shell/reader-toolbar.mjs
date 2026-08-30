// The view buttons hold their place while editing actions enter and leave the floating bar, and the view's own tools ride in a tray parked behind it.

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { check, readingCss, record, root } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  check("the parked tray is the nub, keeps the padlock in the Tab order, and follows the view you are in", () => {
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
    const middles = { reading: 40, code: 70, graph: 100 };
    const place = (id, middle) => {
      const button = booted.document.getElementById(id);
      button.offsetParent = toolbar;
      button.offsetLeft = middle - 12;
      button.offsetWidth = 24;
      return button;
    };
    place('viewReadingButton', middles.reading);
    place('viewCodeButton', middles.code);
    place('viewGraphButton', middles.graph);
    // The map's tools are one named list wider than a button, so that tray takes the bar's own middle rather than the graph button's — centered on the button it hangs off the end of the bar.
    toolbar.offsetWidth = 130;
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

    // And the padlock is still a real element in both editable views, which is what Tab walks.
    for (const view of ['reading', 'code']) {
      booted.renderViewTools(view);
      if (padlock.hidden) throw new Error(`the ${view} view took the padlock out of the page`);
    }
  });

  check('the nub grows into the tray in place, quick and with a spring at the top', () => {
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
    if (!/bottom:\s*calc\(100% - \d+px\);/.test(parked)) {
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
    const lengthOf = (value) => {
      const named = /^var\((--[\w-]+)\)$/.exec(value.trim());
      // Doubled on purpose: a template literal eats a single backslash, so `\s` written here would reach the pattern as a bare `s`.
      const literal = named
        ? new RegExp(`${named[1]}:\\s*(-?[\\d.]+)px;`).exec(tokens)
        : /^(-?[\d.]+)px$/.exec(value.trim());
      if (!literal) throw new Error(`not a length this check can read: ${value}`);
      return Number(literal[1]);
    };
    const px = (rule, property) => {
      const found = new RegExp(`${property}:\\s*([^;]+);`).exec(rule);
      if (!found) throw new Error(`${property} is not declared: ${rule}`);
      return lengthOf(found[1]);
    };
    const sunk = /bottom:\s*calc\(100% - (\d+)px\);/.exec(parked);
    if (!sunk) throw new Error(`the tray does not say how far it sinks into the bar: ${parked}`);
    const inset = /padding:\s*(var\(--lt-space-\d+\));/.exec(parked);
    if (!inset) throw new Error(`the tray is not inset the same step on every edge: ${parked}`);
    const top = lengthOf(inset[1]);
    const proud = px(parked, 'height') - Number(sunk[1]);
    // The nub stands proud of the bar rather than level with it, or there is nothing to say the tools are in there — which is what evening the insets cost once, before the tools were carried out of the nub instead of held below it.
    if (proud < 1) {
      throw new Error(`the nub stands ${proud}px proud of the bar, so nothing peeks`);
    }
    // And the tools reach the bar's own top edge rather than being cut by it: the tray's foot is inside the bar, so the step under them has to be no deeper than the sink.
    if (top > Number(sunk[1])) {
      throw new Error(`the tools are set ${top}px above a foot only ${sunk[1]}px inside the bar, so the bottom one is cut by its face`);
    }
    // Nothing of the tools is in the nub, and it is the carry rather than the inset that keeps them out — so how proud the nub stands and how far they are inset are free of each other, which is what evening the insets cost when they were not.
    const recess = body('.reader-view-tools');
    const carried = /transform: translateY\(calc\((.+) - (\d+)px\)\);/.exec(recess);
    if (!carried) throw new Error(`the tools are not carried out of the nub while it is parked: ${recess}`);
    if (!carried[1].includes('var(--reader-tray-height')) {
      throw new Error(`the tools are carried by something other than the height the tray grows by: ${carried[0]}`);
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
