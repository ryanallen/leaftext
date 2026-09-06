// Pictures in the lane, and the picture opened to the whole window.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { check, checkSettled, fakeElement, readingCss, record, root } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;
  const clickApp = (target) => {
    const app = booted.document.getElementById('app');
    for (const handler of app.listeners.get('click') || []) handler({ target, preventDefault() {}, stopPropagation() {} });
  };

  // The picture half of the same lane, and the one thing about it that cannot be read off the stylesheet: which paragraphs get the mark. CSS counts elements and never text, so the shapes below are exactly what a `:has(> img:only-child)` selector would have got wrong.
  check('only a paragraph holding one picture and no words is widened to the lane', () => {
    const paragraph = (children, text = '') => {
      const block = fakeElement('p');
      block.tagName = 'P';
      // The text first, then the children it holds: writing text empties an element here, as it does on a real page.
      block.textContent = text;
      block.children = children;
      return block;
    };
    const picture = () => {
      const img = fakeElement('img');
      img.tagName = 'IMG';
      return img;
    };
    const opener = fakeElement('button');
    opener.tagName = 'BUTTON';
    const missing = picture();
    missing.dataset = { imageMissing: 'true' };
    const gone = paragraph([missing], '\n');
    const alone = paragraph([picture()], '\n  ');
    const sentence = paragraph([picture()], 'watch this ');
    const two = paragraph([picture(), picture()]);
    const words = paragraph([], 'an ordinary paragraph');
    // A picture already carrying the whole-window opener: the mark has to survive a second pass, or the button would un-widen the picture it sits on.
    const opened = paragraph([picture(), opener], '\n');
    const table = fakeElement('table');
    table.tagName = 'TABLE';
    const body = fakeElement('body');
    body.children = [alone, sentence, two, words, opened, gone, table];
    booted.laneWidePictures({ querySelector: (selector) => (selector === '.document-body' ? body : null) });
    for (const [name, block, expected] of [
      ['a picture alone', alone, true],
      ['a picture in a sentence', sentence, false],
      ['two pictures', two, false],
      ['a paragraph of words', words, false],
      ['a picture already carrying its opener', opened, true],
      ['a picture marked as missing', gone, false],
      ['a table', table, false],
    ]) {
      if (block.classList.contains('image-lane') !== expected) {
        throw new Error(`${name} was ${expected ? 'not ' : ''}widened to the lane`);
      }
    }
  });

  // Its width rule, read as text: none of it is reachable without a laid-out page, and every way it breaks is silent — a picture back at the text measure, a small one stretched to the lane, or one grown past the strip the block controls need.
  check('a widened picture takes the lane and a small one keeps its own size', () => {
    const css = readingCss();
    const opened = css.indexOf('.document-body > p.image-lane {');
    if (opened < 0) throw new Error('no rule widens a picture to the reader lane');
    const rule = css.slice(opened, css.indexOf('}', opened));
    // `max-content` is the picture's own size: a block box at `auto` would fill the measure, and a `max-width` alone can cap a width but never grant one.
    if (!/width:\s*max-content/.test(rule)) throw new Error('the paragraph no longer sizes to the picture in it');
    if (!rule.includes('max-width: max(100%, calc(100cqi - 2 * var(--reader-lane-inset)))')) {
      throw new Error('a widened picture no longer stops at the lane, less the block controls their strip');
    }
    if (!/transform:\s*translateX\(-50%\)/.test(rule) || !/left:\s*50%/.test(rule)) {
      throw new Error('the widened picture is no longer centered on its own width');
    }
    // The cap that keeps a small picture small, and a big one inside whatever the paragraph was given.
    const image = css.slice(css.indexOf('.document-body img {'), css.indexOf('}', css.indexOf('.document-body img {')));
    if (!/max-width:\s*100%/.test(image)) throw new Error('a picture is no longer capped at what holds it');
    const render = readFileSync(join(root, 'src/assets/shell/render-document.js'), 'utf8');
    if (!render.includes('laneWidePictures();')) throw new Error('nothing calls laneWidePictures on a render');
  });

  // The one place in the app where the hover wash sits on something other than the page. It is a 16% tint over transparent, so a rule that hands it the whole background takes the control's own surface away — beside a table that reads as a tint on the page and is nearly invisible, and over a picture it is a see-through square with the picture showing through it. It rides on a layer of its own, laid over the button's surface rather than written on it, because a background image cannot be faded from nothing however the control is timed.
  check('the pointer never takes a corner opener s surface away', () => {
    const css = readingCss();
    const at = css.indexOf('.table-sheet-open:hover::before,');
    if (at < 0) throw new Error('the two corner openers no longer share one hover wash');
    const rule = css.slice(at, css.indexOf('}', at));
    if (!rule.includes('.image-sheet-open:hover::before')) throw new Error('the picture opener no longer shares the table opener s hover wash');
    if (!rule.includes('.image-export-open:hover::before')) throw new Error('the picture export button no longer shares the corner opener s hover wash');
    const fill = /background:\s*([^;]+);/.exec(rule);
    if (!fill) throw new Error('the corner opener paints nothing under the pointer');
    if (!fill[1].includes('var(--lt-wash-hover)')) throw new Error('the corner opener answers the pointer with something other than the one wash');
    // The layer covers the button and starts at nothing, so the wash is a tint over the surface rather than a fill instead of it.
    const layerAt = css.indexOf('.table-sheet-open::before,');
    if (layerAt < 0) throw new Error('the wash has no layer of its own to be tinted on');
    const layer = css.slice(layerAt, css.indexOf('}', layerAt));
    for (const declaration of ['position: absolute', 'inset: 0', 'background: transparent']) {
      if (!layer.includes(declaration)) throw new Error(`the wash layer no longer covers the button it tints from nothing: ${declaration}`);
    }
    // The button's own hover writes no fill of its own, or the tint is back on top of the surface as a picture that cannot fade.
    const ownAt = css.indexOf('.table-sheet-open:hover,');
    if (ownAt < 0) throw new Error('the three corner openers no longer share one hover rule');
    if (/background(-color)?:/.test(css.slice(ownAt, css.indexOf('}', ownAt)))) {
      throw new Error('the corner opener paints a fill on itself again, so the wash cannot fade in');
    }
    // And the surface the layer is laid over is the one the button rests on, or the hover is a different color from the button.
    const rest = css.slice(css.indexOf('.table-sheet-open,\n.image-sheet-open,\n.image-export-open {'), layerAt);
    if (!rest.includes('background: var(--lt-surface-elevated);')) {
      throw new Error('the opener no longer rests on the surface its hover is painted over');
    }
  });

  // Two controls in one corner, so the corner is what is placed and what appears — a second button pinned at the same top and right would sit on top of the first.
  check('a widened picture s two corner controls sit in a row and appear together', () => {
    const css = readingCss();
    const ruleBody = (selector) => {
      const at = css.indexOf(selector);
      if (at < 0) throw new Error(`no rule for ${selector}`);
      return css.slice(at, css.indexOf('}', at));
    };
    const corner = ruleBody('.image-lane-corner {');
    for (const declaration of ['position: absolute', 'display: flex', 'gap: var(--lt-space-6)']) {
      if (!corner.includes(declaration)) throw new Error(`the picture corner is no longer a placed row: ${declaration}`);
    }
    // The buttons are laid out by the row, so one of them carrying its own corner would be back on top of the other.
    const shape = ruleBody('.table-sheet-open,\n.image-sheet-open,\n.image-export-open {');
    if (/position:\s*absolute/.test(shape)) throw new Error('a corner control places itself again, so the pair stack on one another');
    // Held at the corner rather than at each button, or one of the two would be the only thing that ever showed.
    if (!/opacity:\s*0/.test(corner)) throw new Error('the picture corner is drawn over the picture before the pointer asks for it');
    const shown = ruleBody('.image-lane:hover .image-lane-corner,');
    if (!shown.includes('.image-lane-corner:focus-within')) {
      throw new Error('reaching a widened picture s corner by keyboard no longer reveals both controls');
    }
    if (!/opacity:\s*1/.test(shown)) throw new Error('pointing at a widened picture no longer reveals both controls');
  });

  // The full-window picture is a reader and nothing else: it shows an element the page already holds, so no route from opening or closing it reaches the document buffer, and none of it needs a host.
  check('a full-window picture is safe to open and can never write', () => {
    const whole = readFileSync(join(root, 'src/assets/shell/image-sheet.js'), 'utf8');
    for (const part of ['function bindImageSheet(', 'function openImageSheet(', 'function closeImageSheet()', 'leafFocusForKeyboard(opener)']) {
      if (!whole.includes(part)) throw new Error(`the picture sheet lost: ${part}`);
    }
    // The sheet's own half of the fragment, which is everything above the export beside it: the export does talk to the host, and the claim here is about opening and closing a picture.
    const split = whole.indexOf('// ---- taking a picture out of the document');
    if (split < 0) throw new Error('the fragment no longer separates the full-window picture from the export beside it');
    const fragment = whole.slice(0, split);
    if (!fragment.includes('function openImageSheet(')) throw new Error('the full-window picture is no longer the first half of its fragment');
    if (/\b(?:send|sendEditCommand|ipc\.postMessage)\b/.test(fragment)) {
      throw new Error('opening or closing the picture sheet can still reach the document buffer');
    }
    // The element's live source, never a copy taken earlier: a local picture's address carries a per-render token, so a stale one shows the file as it was before it changed on disk.
    if (!fragment.includes('picture.currentSrc || picture.src')) {
      throw new Error('the full-window picture no longer reads the element it was opened from');
    }
    // No header, no title, no words on the glass — the one full-window view without a panel.
    if (/textContent\s*=/.test(fragment) || fragment.includes('createElement(\'header\')')) {
      throw new Error('the full-window picture grew words of its own');
    }
    // Opening is reading and an export writes a file beside the document, so neither half ever asks the padlock.
    if (/readerEditingAllowed|documentLocked/.test(whole)) {
      throw new Error('opening or exporting a picture now waits on the padlock, and neither one writes the document');
    }
    if ((whole.match(/imageMissing === 'true'/g) || []).length < 2) {
      throw new Error('a marked missing picture can reach the full-window view, or still gets a corner');
    }
    const lib = readFileSync(join(root, 'src/lib.rs'), 'utf8');
    const decorate = lib.indexOf('assets/shell/decorate.js');
    const imageSheet = lib.indexOf('assets/shell/image-sheet.js');
    if (imageSheet < decorate) throw new Error('the picture sheet loads before the paragraph it hangs an opener on is marked');
    const render = readFileSync(join(root, 'src/assets/shell/render-document.js'), 'utf8');
    if (render.indexOf('bindImageSheet();') < render.indexOf('laneWidePictures();')) {
      throw new Error('the opener is bound before the paragraphs it looks for are marked');
    }
  });

  // All four ways out are pressed on the elements that carry them, over a picture of the check's own: a binding matched as a line of text passes whether or not anything ever reaches it.
  check('the full-window picture opens over a picture of its own, wears its open state, and all four ways out take it back down', () => {
    const app = booted.document.getElementById('app');
    const wasQuery = app.querySelector;
    const held = app.children.slice();
    // The whole of what the builder reads off the element it is opened from: no missing mark, a word for the label, an address for the source.
    const standInPicture = () => Object.assign(fakeElement('checkedPicture'), { tagName: 'IMG', dataset: {}, alt: 'A checked picture', currentSrc: 'leaf-asset://checked.png' });
    const opener = fakeElement('checkedPictureOpener');
    const wornBy = (child) => String((child && child.className) || '');
    // The page's class list holds only what the shipped markup declares, so an overlay the open just built is not in it — the one query that finds it is pointed at what landed on the page, the way the checks above point it.
    let standing = null;
    const openOnce = () => {
      standing = null;
      booted.openImageSheet(standInPicture(), opener);
      const fresh = app.children.filter((child) => !held.includes(child));
      standing = fresh.find((child) => wornBy(child).includes('image-sheet-overlay')) || null;
      const scrim = fresh.find((child) => wornBy(child) === 'lt-backdrop') || null;
      if (!standing || !scrim) throw new Error(`opening the full-window picture put ${fresh.length} new things on the page`);
      const [shown, corner] = standing.children;
      // The open state rides on a frame the page asks for, so a sheet born open could never be seen arriving.
      if (standing.classList.contains('open')) throw new Error('the sheet and its dim were built already open');
      booted.__frames.drain();
      if (!standing.classList.contains('open') || !scrim.classList.contains('open')) {
        throw new Error('the frame the page asked for left the sheet or its dim shut');
      }
      return { overlay: standing, scrim, shown, corner };
    };
    const press = (element, event = {}) => (element.listeners.get('click') || []).forEach((handler) => handler(event));
    // Raised on the document's own list rather than called by name: the fragment binds it at load, and a handler nothing ever registered would pass a call.
    const escape = () => {
      const event = { key: 'Escape', preventDefault() {}, stopPropagation() {} };
      for (const handler of booted.document.listeners.get('keydown') || []) handler(event);
    };
    const gone = (...leaving) => leaving.every((one) => !app.children.includes(one));
    try {
      app.querySelector = (selector) => (String(selector) === '.image-sheet-overlay' ? standing : wasQuery.call(app, selector));
      const first = openOnce();
      if (wornBy(first.shown) !== 'image-sheet-picture') throw new Error('the sheet opened holding no picture');
      if (first.shown.src !== 'leaf-asset://checked.png') throw new Error(`the sheet shows ${JSON.stringify(first.shown.src)} rather than the address the element itself carries`);
      if (first.shown.alt !== 'A checked picture') throw new Error('the shown picture lost the word the element was labeled with');
      const cross = first.corner.children[0];
      if (!wornBy(cross).includes('image-sheet-close')) throw new Error('the corner carries no close cross');
      press(cross);
      if (!gone(first.overlay, first.scrim)) throw new Error('the close cross left the sheet or its dim standing on the page');

      const second = openOnce();
      press(second.scrim);
      if (!gone(second.overlay, second.scrim)) throw new Error('a press on the sheet’s own dim left it standing on the page');

      // The glass is the ground the scrim shows through, so the listener closes on anything whose target is not the picture — which makes the press on the picture the one that carries the claim: without it, a listener that closed on every press would pass.
      const third = openOnce();
      press(third.overlay, { target: third.shown });
      if (gone(third.overlay, third.scrim)) throw new Error('a press on the picture itself took the sheet down');
      press(third.overlay, { target: third.corner });
      if (!gone(third.overlay, third.scrim)) throw new Error('a press on the glass beside the picture left the sheet standing on the page');

      const fourth = openOnce();
      escape();
      if (!gone(fourth.overlay, fourth.scrim)) throw new Error('Escape on the document left the sheet or its dim standing on the page');
    } finally {
      app.querySelector = wasQuery;
      for (const child of app.children.slice()) if (!held.includes(child)) child.remove();
    }
  });

  // The one picture no gesture could open big: the corner is hung on a paragraph holding a picture and nothing else, so a picture written inside a sentence had no opener anywhere. The menu is what closes that, and only running it says so — the corner and the menu are two fragments apart and neither one names the gap.
  check('a picture written inside a sentence gets no corner and is opened big from its own menu', () => {
    const app = booted.document.getElementById('app');
    const held = app.children.slice();
    const layout = fakeElement('inlinePictureLayout');
    layout.classList.add('reader-layout');
    const body = fakeElement('inlinePictureBody');
    body.classList.add('document-body');
    layout.appendChild(body);
    const block = fakeElement('inlinePictureBlock');
    block.tagName = 'P';
    block.textContent = 'watch this ';
    body.appendChild(block);
    const picture = Object.assign(fakeElement('inlinePicture'), { tagName: 'IMG', dataset: {} });
    picture.setAttribute('src', 'leaf-image://local/imgs/inline.png');
    picture.currentSrc = 'leaf-image://local/imgs/inline.png';
    block.appendChild(picture);
    try {
      // The two passes a render makes over the page, in that order: neither one reaches a picture sharing its paragraph with words.
      booted.laneWidePictures({ querySelector: (selector) => (selector === '.document-body' ? body : null) });
      booted.bindImageSheet(layout);
      if (block.classList.contains('image-lane')) throw new Error('a picture in a sentence was widened to the lane');
      if (block.children.some((child) => String(child.className || '') === 'image-lane-corner')) {
        throw new Error('a picture in a sentence grew a corner, so this is no longer the picture nothing could open');
      }
      const event = { target: picture, clientX: 300, clientY: 300, preventDefault() {} };
      for (const handler of booted.document.listeners.get('contextmenu') || []) handler(event);
      const menu = vm.runInContext('contextMenu', booted);
      const open = menu.children.find((child) => String(child.textContent || '') === 'Open picture');
      if (!open) throw new Error('the picture nothing else can open big offers no Open picture');
      (open.listeners.get('click') || []).forEach((handler) => handler({}));
      booted.__frames.drain();
      const overlay = app.children.find((child) => !held.includes(child) && String(child.className || '').includes('image-sheet-overlay'));
      if (!overlay) throw new Error('Open picture put no full-window picture on the page');
      const shown = overlay.children[0];
      if (shown.src !== 'leaf-image://local/imgs/inline.png') {
        throw new Error(`the full-window view opened on ${JSON.stringify(shown.src)} rather than the picture that was right-clicked`);
      }
    } finally {
      booted.hideContextMenu();
      for (const child of app.children.slice()) if (!held.includes(child)) child.remove();
    }
  });

  // Which pictures get a corner and what is in it, run rather than read: a marked missing one is holding our glyph over a transparent pixel, so there is nothing behind it to open or to write out, and a picture served from the web has no file on this disk for any of the export's four rows.
  check('a widened picture on this disk draws both corner controls, a remote one draws only the opener, and a marked missing one draws none', () => {
    const paragraph = (picture) => {
      const block = fakeElement('p');
      block.tagName = 'P';
      if (picture) block.appendChild(picture);
      return block;
    };
    const picture = (src, dataset = {}) => {
      const img = Object.assign(fakeElement('img'), { tagName: 'IMG', dataset });
      img.setAttribute('src', src);
      return img;
    };
    const real = paragraph(picture('leaf-image://local/imgs/shot.png'));
    const remote = paragraph(picture('https://example.com/shot.png'));
    const missing = paragraph(picture('leaf-image://local/imgs/gone.png', { imageMissing: 'true' }));
    const empty = paragraph(null);
    booted.bindImageSheet({ querySelectorAll: () => [real, remote, missing, empty] });
    const corner = (block) => block.children.filter((child) => child.className === 'image-lane-corner');
    const controls = (block) => {
      const row = corner(block);
      return row.length === 1 ? row[0].children.map((child) => child.className) : [];
    };
    if (String(controls(real)) !== 'image-sheet-open,image-export-open') {
      throw new Error(`a picture on this disk drew ${JSON.stringify(controls(real))} rather than the opener and the export`);
    }
    if (String(controls(remote)) !== 'image-sheet-open') {
      throw new Error(`a picture served from the web drew ${JSON.stringify(controls(remote))}, and none of the export's rows can reach its file`);
    }
    if (corner(missing).length) throw new Error('a marked missing picture was given a corner');
    if (corner(empty).length) throw new Error('a paragraph with no picture in it was given a corner');
    // Twice over the same page must not stack a second corner on every picture.
    booted.bindImageSheet({ querySelectorAll: () => [real] });
    if (corner(real).length !== 1) throw new Error('a second pass stacked another corner on the same picture');
    // The fetch fails after the page is decorated, so refusing at the bind is not enough on its own: the mark has to take back the lane and the corner the render already gave, and a picture that arrives later has to get both back.
    const decorate = readFileSync(join(root, 'src/assets/shell/decorate.js'), 'utf8');
    const mark = decorate.slice(decorate.indexOf('function markMissingImage'), decorate.indexOf('function restoreMissingImage'));
    for (const wanted of ["classList.remove('image-lane')", "':scope > .image-lane-corner'"]) {
      if (!mark.includes(wanted)) throw new Error(`the missing mark no longer takes back: ${wanted}`);
    }
    const refresh = decorate.slice(decorate.indexOf('window.leafRefreshImages'));
    if (!refresh.includes('laneWidePictures();') || !refresh.includes('bindImageSheet();')) {
      throw new Error('a picture that has arrived at last never gets its lane or its opener back');
    }
  });

  check('a press on a picture corner stays with its button while a press on the picture reaches its block', () => {
    const app = booted.document.getElementById('app');
    const corner = fakeElement('picture-corner');
    corner.className = 'image-lane-corner';
    const button = fakeElement('picture-export');
    button.className = 'image-export-open';
    corner.appendChild(button);
    const picture = fakeElement('picture');
    picture.tagName = 'IMG';
    const stoppedBy = (target) => {
      let stopped = 0;
      for (const handler of app.listeners.get('pointerdown') || []) {
        handler({ button: 0, target, stopPropagation: () => { stopped += 1; } });
      }
      return stopped;
    };
    if (!stoppedBy(button)) throw new Error('a press on the picture corner reached the source block underneath');
    if (stoppedBy(picture)) throw new Error('a press on the picture itself was kept from its source block');
  });

  check('a picture corner restored from markup still exports and opens the picture', () => {
    const app = booted.document.getElementById('app');
    const lane = fakeElement('restored-picture-lane');
    lane.tagName = 'P';
    const picture = Object.assign(fakeElement('restored-picture'), { tagName: 'IMG', alt: 'Restored picture', currentSrc: 'leaf-image://local/imgs/restored.png' });
    picture.setAttribute('src', 'leaf-image://local/imgs/restored.png');
    const corner = fakeElement('restored-picture-corner');
    corner.className = 'image-lane-corner';
    const opener = fakeElement('restored-picture-opener');
    opener.tagName = 'BUTTON';
    opener.className = 'image-sheet-open';
    const exportButton = fakeElement('restored-picture-export');
    exportButton.tagName = 'BUTTON';
    exportButton.className = 'image-export-open';
    corner.append(opener, exportButton);
    lane.append(picture, corner);
    const sent = [];
    const wasSend = booted.ipc.postMessage;
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    try {
      clickApp(exportButton);
      const ask = sent.find((one) => one.command === 'pickPicturePath');
      if (!ask) throw new Error('the restored Export button asked nowhere for a path');
      booted.window.leafPicturePathPicked(ask.token, null);
      clickApp(opener);
      if (!app.querySelector('.image-sheet-overlay')) throw new Error('the restored opener did not open the picture');
    } finally {
      booted.closeImageSheet();
      booted.ipc.postMessage = wasSend;
    }
  });

  // The sheet a picture is printed on. The shipped paper class does the opposite of what this needs on its own — it grows the surface to the whole document — so a print under it alone would be the note with the picture somewhere in it. The cascade decides this and the stand-in page has none, so the rules are read off the stylesheet the way the other CSS checks here are.
  check('a printed picture is the only thing left on the sheet', () => {
    if (!booted.document.getElementById('picturePrint')) throw new Error('the page has no container to print a picture in');
    const css = readingCss();
    // Anchored at the start of a line, so a rule under a wider selector cannot answer for one keyed on the container itself.
    const rule = (selector, paint) => css.includes('\n' + selector + ' {' + '\n' + '  ' + paint + ';');
    if (!rule('.picture-print', 'display: none')) throw new Error('the print container is not out of the layout until an export fills it');
    if (!rule('body.leaf-paper-picture .picture-print', 'display: block')) throw new Error('the print state does not put the container on the sheet');
    if (!rule('body.leaf-paper-picture .app-surface > :not(.picture-print)', 'display: none')) {
      throw new Error('the print state leaves the app frame, the pane and the neighboring blocks on the sheet');
    }
  });

  // The whole gesture, driven: press Export, answer the save window, and read what went to the host. A picture's four rows split two ways — three write a file and the PDF is rendered — so what is proved here is that the ending on the answered path is what picks between them, and that neither row ever runs the other's command.
  check('the ending the reader saved under picks the row, and a PDF prints where Markdown copies', () => {
    const lane = fakeElement('p');
    lane.tagName = 'P';
    const picture = Object.assign(fakeElement('img'), { tagName: 'IMG', dataset: {}, alt: 'The find bar' });
    picture.setAttribute('src', 'leaf-image://local/imgs/find-bar.png');
    picture.currentSrc = 'leaf-image://local/imgs/find-bar.png?leaf-epoch=3';
    // The room the reader's lane had it in, which is not what a sheet is made to: the picture's own pixels are.
    picture.getBoundingClientRect = () => ({ top: 0, left: 0, right: 700, bottom: 240, width: 700, height: 240 });
    picture.naturalWidth = 1888;
    picture.naturalHeight = 1940;
    lane.appendChild(picture);
    booted.bindImageSheet({ querySelectorAll: () => [lane] });
    const corner = lane.children.find((child) => child.className === 'image-lane-corner');
    const button = corner && corner.children.find((child) => child.className === 'image-export-open');
    if (!button) throw new Error('a picture on this disk was left with no way out');

    const was = { send: booted.ipc.postMessage, hold: booted.window.leafHoldAppearance, toast: booted.leafToast };
    const sent = [];
    const said = [];
    const held = [];
    const box = booted.document.getElementById('picturePrint');
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.window.leafHoldAppearance = (on) => held.push(on);
    booted.leafToast = (words) => said.push(words);
    const press = () => clickApp(button);
    const answer = (path) => {
      const ask = sent.filter((one) => one.command === 'pickPicturePath').pop();
      if (!ask) throw new Error('pressing Export asked nowhere for a path');
      if (ask.source !== 'leaf-image://local/imgs/find-bar.png') {
        throw new Error(`the ask carried ${JSON.stringify(ask.source)} rather than the address the picture is drawn from`);
      }
      booted.window.leafPicturePathPicked(ask.token, path);
    };
    try {
      press();
      answer('/out/find-bar.md');
      const copy = sent.filter((one) => one.command === 'exportPicture').pop();
      if (!copy) throw new Error('a name ending in md wrote nothing at all');
      if (copy.format !== 'md') throw new Error(`the Markdown row went out as ${JSON.stringify(copy.format)}`);
      if (copy.path !== '/out/find-bar.md') throw new Error('the write carried a path the reader never gave');
      if (copy.alt !== 'The find bar') throw new Error('the document would be written without the words the note gave the picture');
      if (sent.some((one) => one.command === 'printPicturePdf')) throw new Error('the Markdown row printed a sheet as well as copying the file');

      press();
      answer('/out/find-bar.pdf');
      const print = sent.filter((one) => one.command === 'printPicturePdf').pop();
      if (said.length) throw new Error(`the PDF refused: ${said.join(' / ')}`);
      if (!print) throw new Error('a name ending in pdf asked for no print at all');
      // Nothing the page could have made: a PDF is rendered, so the row that carries bytes must never be the one that runs.
      if (sent.filter((one) => one.command === 'exportPicture').length !== 1) {
        throw new Error('a PDF went out as bytes the page made, which is a .pdf full of something else');
      }
      if (print.width !== 1888 || print.height !== 1940) {
        throw new Error(`the sheet was asked for at ${print.width}x${print.height} rather than the picture's own 1888x1940`);
      }
      if (!box.children.length) throw new Error('the picture was never put anywhere the render could reach it');
      if (!booted.document.body.classList.contains('leaf-paper-picture')) {
        throw new Error('the sheet state was never raised, so the print would be the whole document with the picture somewhere in it');
      }
      if (String(held) !== 'true') throw new Error(`the appearance was held ${held.length} times: ${held.join(', ') || 'never'}`);

      // The host has answered. The page is the reader's document again however the print went — a state left on is a window holding a bare picture.
      booted.window.leafPicturePrinted();
      if (booted.document.body.classList.contains('leaf-paper-picture')) throw new Error('the sheet state stayed on after the host answered');
      if (box.children.length) throw new Error('the print container kept the picture after the host answered');
      if (String(held) !== 'true,false') throw new Error(`the appearance hold was not let go exactly once: ${held.join(', ')}`);
      booted.window.leafPicturePrinted();
      if (String(held) !== 'true,false') throw new Error(`a second answer let the appearance hold go twice: ${held.join(', ')}`);

      // An ending no row names writes nothing and says so, rather than falling into whichever arm happens to be first.
      press();
      answer('/out/find-bar.gif');
      if (!said.length) throw new Error('a name ending in nothing the window offers wrote silently');
      if (sent.filter((one) => one.command === 'exportPicture').length !== 1) throw new Error('an unoffered ending still wrote a file');
    } finally {
      booted.window.leafPicturePrinted();
      booted.ipc.postMessage = was.send;
      booted.window.leafHoldAppearance = was.hold;
      booted.leafToast = was.toast;
    }
  });

  // Copy is the only row that puts a picture on the clipboard, and it does it for every kind the reading view can draw — which is the whole reason it goes through the page's own canvas rather than a decoder on the other side. Driven over a canvas of the check's own, because the way it would break is silent: a source the encoder cannot read comes back as a throw nobody sees, and the reader is left thinking the picture was copied.
  checkSettled('every kind of picture copies through the one PNG encoder, and an encode that fails is said on the page', async () => {
    const sent = [];
    const said = [];
    const asked = [];
    const settle = async () => {
      for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
    };
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.leafToast = (words) => said.push(words);
    booted.pictureCanvas = async (picture, background) => {
      asked.push({ src: picture.getAttribute('src'), background });
      return { width: 8, height: 8, toDataURL: (type) => 'data:' + type + ';base64,UE5H' };
    };
    // The four the app draws that a decoder written against a picture's own bytes would have had to learn separately.
    for (const ending of ['png', 'svg', 'webp', 'avif']) {
      const picture = Object.assign(fakeElement('img'), { tagName: 'IMG', dataset: {} });
      picture.setAttribute('src', `leaf-image://local/imgs/shot.${ending}`);
      await booted.copyPicture(picture);
    }
    await settle();
    const copied = sent.filter((one) => one.command === 'copyImage');
    if (copied.length !== 4) throw new Error(`4 kinds of picture made ${copied.length} copies: ${said.join(' / ') || 'and said nothing'}`);
    if (copied.some((one) => one.data !== 'UE5H')) throw new Error('a copy carried something other than what the canvas wrote');
    // PNG holds transparency, so nothing is painted under any of them — a copy on the page's own surface color would flatten a cutout every reader expects back.
    if (asked.some((one) => one.background)) throw new Error('a picture was drawn onto a color before it was copied');
    if (asked.map((one) => one.src.split('.').pop()).join() !== 'png,svg,webp,avif') {
      throw new Error(`the encoder saw ${JSON.stringify(asked.map((one) => one.src))}`);
    }

    // A source the canvas cannot read: the row says so where the reader is looking, rather than leaving them holding a clipboard that never changed.
    sent.length = 0;
    booted.pictureCanvas = async () => {
      throw new Error('That picture could not be read, so nothing was written.');
    };
    const broken = Object.assign(fakeElement('img'), { tagName: 'IMG', dataset: {} });
    broken.setAttribute('src', 'leaf-image://local/imgs/broken.png');
    await booted.copyPicture(broken);
    await settle();
    if (sent.some((one) => one.command === 'copyImage')) throw new Error('a picture that could not be read was still sent to the clipboard');
    if (!said.some((words) => String(words).includes('could not be read'))) {
      throw new Error(`a failed encode said ${JSON.stringify(said)} on the page`);
    }
  });

  // The two conversion rows, driven over a canvas of the check's own. Every way they break is silent — a PNG saved under a `.webp` name is still a file, and a picture past what the format holds comes back as an empty address rather than as a throw — so what is pressed here is the whole path from the button to what went to the host.
  checkSettled('a picture already in the format asked for is copied, and a conversion is the file the canvas wrote', async () => {
    const lane = fakeElement('p');
    lane.tagName = 'P';
    const picture = Object.assign(fakeElement('img'), { tagName: 'IMG', dataset: {}, alt: 'A photo' });
    picture.setAttribute('src', 'leaf-image://local/imgs/holiday.jpg?leaf-epoch=1');
    picture.naturalWidth = 40;
    picture.naturalHeight = 30;
    lane.appendChild(picture);
    booted.bindImageSheet({ querySelectorAll: () => [lane] });
    const button = lane.children
      .find((child) => child.className === 'image-lane-corner')
      .children.find((child) => child.className === 'image-export-open');

    const sent = [];
    const said = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.leafToast = (words) => said.push(words);
    // A canvas of the check's own: the stand-in page has none, and what is being read back is which type the export asked for and what it did with the answer.
    let drawn = { width: 40, height: 30 };
    let answers = (type) => 'data:' + type + ';base64,QUJD';
    booted.pictureCanvas = async () => ({ width: drawn.width, height: drawn.height, toDataURL: (type) => answers(type) });
    const press = () => clickApp(button);
    const answer = (path) => {
      const ask = sent.filter((one) => one.command === 'pickPicturePath').pop();
      if (!ask) throw new Error('pressing Export asked nowhere for a path');
      booted.window.leafPicturePathPicked(ask.token, path);
    };
    // The rows that convert are two awaits deep, so the turns have to be run out before what went to the host can be read.
    const settle = async () => {
      for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
    };
    const written = () => sent.filter((one) => one.command === 'exportPicture').pop();
    // A JPEG asked for as a PNG: a conversion, so the canvas writes the file and it travels as bytes.
    press();
    answer('/out/holiday.png');
    await settle();
    let file = written();
    if (!file) throw new Error(`converting a JPEG to a PNG wrote nothing: ${said.join(' / ') || 'and said nothing either'}`);
    if (file.format !== 'png' || !file.data) throw new Error('the conversion carried no file for the host to write');
    if (file.data !== 'QUJD') throw new Error(`the host was handed ${JSON.stringify(file.data)} rather than what the canvas wrote`);

    // A PNG asked for as a PNG: nothing is drawn at all, and the host is handed the address to copy the file off.
    picture.setAttribute('src', 'leaf-image://local/imgs/holiday.png?leaf-epoch=1');
    press();
    answer('/out/copy.png');
    await settle();
    file = written();
    if (file.data) throw new Error('a picture already in the format asked for was re-encoded rather than copied');
    if (file.source !== 'leaf-image://local/imgs/holiday.png?leaf-epoch=1') {
      throw new Error('the copy carried no address for the host to read the file off');
    }

    // A canvas answering with a PNG when it was asked for a WebP: saving that under a `.webp` name is a file nobody can open, so the type in the answer is what settles it.
    picture.setAttribute('src', 'leaf-image://local/imgs/holiday.jpg?leaf-epoch=1');
    answers = () => 'data:image/png;base64,QUJD';
    let before = sent.length;
    press();
    answer('/out/holiday.webp');
    await settle();
    if (sent.length !== before + 1) throw new Error('a canvas that could not write WebP still wrote a file under that name');
    if (!said.length) throw new Error('a canvas that could not write WebP said nothing about it');
    said.length = 0;

    // Past what the format holds, the canvas answers an empty address rather than failing, so the refusal has to be ours and it has to come before the encode.
    answers = (type) => 'data:' + type + ';base64,QUJD';
    drawn = { width: 16384, height: 30 };
    before = sent.length;
    press();
    answer('/out/huge.webp');
    await settle();
    if (sent.length !== before + 1) throw new Error('a picture past what WebP holds still wrote a file');
    if (!said.some((words) => /too big for WebP/.test(words))) {
      throw new Error(`a picture past what WebP holds was refused with: ${said.join(' / ') || 'nothing'}`);
    }

    // And the same picture is fine as a PNG, which is what that refusal points a reader at.
    press();
    answer('/out/huge.png');
    await settle();
    if (written().format !== 'png') throw new Error('a picture too wide for WebP could not be written as a PNG either');
  });

  // The JPEG row, driven the same way. It is the third picture in the run and the only one whose format has two spellings, so what is pressed here is what the canvas was asked for and what the row does with a picture already wearing either name.
  checkSettled('the JPEG row is third among the pictures, asks the canvas once at 0.92, and copies a picture already in the format', async () => {
    const lane = fakeElement('p');
    lane.tagName = 'P';
    const picture = Object.assign(fakeElement('img'), { tagName: 'IMG', dataset: {}, alt: 'A photo' });
    picture.setAttribute('src', 'leaf-image://local/imgs/shot.png?leaf-epoch=1');
    picture.naturalWidth = 40;
    picture.naturalHeight = 30;
    lane.querySelector = (selector) => {
      if (selector === ':scope > img') return picture;
      if (selector === ':scope > .image-lane-corner') return lane.children.find((child) => child.className === 'image-lane-corner') || null;
      return null;
    };
    booted.bindImageSheet({ querySelectorAll: () => [lane] });
    const button = lane.children
      .find((child) => child.className === 'image-lane-corner')
      .children.find((child) => child.className === 'image-export-open');

    const sent = [];
    const said = [];
    const asked = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.leafToast = (words) => said.push(words);
    booted.pictureCanvas = async () => ({
      width: 40,
      height: 30,
      toDataURL: (type, quality) => {
        asked.push({ type, quality });
        return 'data:' + type + ';base64,QUJD';
      },
    });
    const press = () => clickApp(button);
    const answer = (path) => {
      const ask = sent.filter((one) => one.command === 'pickPicturePath').pop();
      if (!ask) throw new Error('pressing Export asked nowhere for a path');
      booted.window.leafPicturePathPicked(ask.token, path);
    };
    const settle = async () => {
      for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
    };
    const written = () => sent.filter((one) => one.command === 'exportPicture').pop();
    // A PNG asked for as a JPEG: a conversion, and the encoder is named a quality rather than left to a default a web view update could move under every file already written.
    press();
    answer('/out/shot.jpg');
    await settle();
    const file = written();
    if (!file) throw new Error(`the JPEG row wrote nothing: ${said.join(' / ') || 'and said nothing either'}`);
    if (file.format !== 'jpg' || file.data !== 'QUJD') throw new Error('the JPEG row carried no file for the host to write');
    if (asked.length !== 1) throw new Error(`the canvas was asked ${asked.length} times for one file`);
    if (asked[0].type !== 'image/jpeg') throw new Error(`the canvas was asked for ${JSON.stringify(asked[0].type)} rather than a JPEG`);
    if (asked[0].quality !== 0.92) throw new Error(`the JPEG was written at ${asked[0].quality} rather than at the named 0.92`);

    // Either spelling already on disk, asked for as the row's own word: copied, so nothing is drawn at all and a lossy source is not re-encoded into a bigger file.
    for (const spelled of ['holiday.jpg', 'holiday.jpeg']) {
      picture.setAttribute('src', 'leaf-image://local/imgs/' + spelled + '?leaf-epoch=1');
      asked.length = 0;
      press();
      answer('/out/copy.jpg');
      await settle();
      if (asked.length) throw new Error(`a ${spelled} exported as a JPEG went through the canvas rather than being copied`);
      if (written().data) throw new Error(`a ${spelled} exported as a JPEG was re-encoded rather than copied`);
    }

    // The run the reader is offered, read off the words the page says when the ending is none of them: the rows in the order they are drawn in, which is the order the window offers and the order a bare name is built off. The three pictures together, JPEG under the two it is measured against.
    picture.setAttribute('src', 'leaf-image://local/imgs/shot.png?leaf-epoch=1');
    said.length = 0;
    press();
    answer('/out/shot.gif');
    await settle();
    if (!said.some((words) => words.includes('PNG, WebP, JPEG, PDF, Markdown'))) {
      throw new Error(`the picture export names its rows as: ${said.join(' / ') || 'nothing'}`);
    }

    // A canvas answering with a PNG when it was asked for a JPEG: saving that under a `.jpg` name is a file nobody can open, so the type in the answer is what settles it.
    picture.setAttribute('src', 'leaf-image://local/imgs/shot.png?leaf-epoch=1');
    booted.pictureCanvas = async () => ({ width: 40, height: 30, toDataURL: () => 'data:image/png;base64,QUJD' });
    const before = sent.length;
    said.length = 0;
    press();
    answer('/out/shot.jpg');
    await settle();
    if (sent.length !== before + 1) throw new Error('a canvas that could not write JPEG still wrote a file under that name');
    if (!said.some((words) => /cannot write JPEG/.test(words))) {
      throw new Error(`a canvas that could not write JPEG said: ${said.join(' / ') || 'nothing'}`);
    }
  });

  // What a JPEG does to a picture that came with transparency, driven over the drawing itself rather than over a canvas standing in for it. Every way this breaks is silent: an unpainted canvas encodes as solid black rather than failing, read back off a running window at `0, 0, 0, 255`, so a logo with alpha would come out on a black rectangle and nothing would say so.
  checkSettled('a JPEG is drawn onto the surface color the reader was looking at, and the lossless rows are not', async () => {
    const drawn = [];
    const ink = {
      fillStyle: '',
      fillRect(x, y, width, height) {
        drawn.push({ what: 'fill', color: ink.fillStyle, x, y, width, height });
      },
      drawImage() {
        drawn.push({ what: 'picture' });
      },
    };
    const madeCanvas = { width: 0, height: 0, getContext: () => ink, toDataURL: (type) => 'data:' + type + ';base64,QUJD' };
    const was = { create: booted.document.createElement };
    booted.document.createElement = (tag) => (String(tag) === 'canvas' ? madeCanvas : was.create(tag));
    booted.document.documentElement.style.setProperty('--lt-surface', '#101014');
    const picture = Object.assign(fakeElement('img'), { tagName: 'IMG', dataset: {}, naturalWidth: 40, naturalHeight: 30 });
    picture.currentSrc = 'leaf-image://local/imgs/logo.png?leaf-epoch=1';
    // The page's own picture loads this, off the exact address the conversion asks for, so the load is decided here rather than by a stand-in that called every address good. An address nobody registers takes that same picture's failure branch, which is what the case below drives.
    booted.__pictures.set(picture.currentSrc, { width: 64, height: 48 });
    await booted.pictureFileBase64(picture, 'image/jpeg');
    if (drawn.length !== 2 || drawn[0].what !== 'fill' || drawn[1].what !== 'picture') {
      throw new Error(`a JPEG drew ${JSON.stringify(drawn.map((one) => one.what))} rather than the page under the picture`);
    }
    if (drawn[0].color !== '#101014') {
      throw new Error(`a JPEG was painted onto ${JSON.stringify(drawn[0].color)} rather than onto the surface the reader was looking at`);
    }
    if (drawn[0].width !== 64 || drawn[0].height !== 48) {
      throw new Error('the paint under a JPEG does not cover the whole canvas, so the corners come out black');
    }
    // The picture that arrived, not the element it was read off: a picture in the lane is drawn at whatever width the lane gave it, and a file written at that width is a file the reader never asked to be shrunk.
    if (madeCanvas.width !== 64 || madeCanvas.height !== 48) {
      throw new Error(`the canvas was made ${madeCanvas.width}×${madeCanvas.height} rather than at the pixels the picture came back with`);
    }
    drawn.length = 0;
    for (const type of ['image/png', 'image/webp']) {
      await booted.pictureFileBase64(picture, type);
      if (drawn.some((one) => one.what === 'fill')) {
        throw new Error(`a ${type} was flattened onto the page, and it is a format that keeps what it came with`);
      }
      drawn.length = 0;
    }
  });

  // The other end of that same load, and the one a reader meets: a picture that does not come back. Nothing stands in for the failure, and the whole row is driven from the press to the path, because what matters is that the reader is told and that no file is written under the name they just picked.
  checkSettled("a picture that will not load is refused in the reader's own words and writes no file", async () => {
    const lane = fakeElement('p');
    lane.tagName = 'P';
    const picture = Object.assign(fakeElement('img'), { tagName: 'IMG', dataset: {}, alt: 'A photo' });
    picture.setAttribute('src', 'leaf-image://local/imgs/nowhere.png?leaf-epoch=1');
    // The address the conversion asks for, and the one address the answer map is deliberately not holding.
    picture.currentSrc = 'leaf-image://local/imgs/nowhere.png?leaf-epoch=1';
    picture.naturalWidth = 40;
    picture.naturalHeight = 30;
    lane.querySelector = (selector) => {
      if (selector === ':scope > img') return picture;
      if (selector === ':scope > .image-lane-corner') return lane.children.find((child) => child.className === 'image-lane-corner') || null;
      return null;
    };
    booted.bindImageSheet({ querySelectorAll: () => [lane] });
    const button = lane.children
      .find((child) => child.className === 'image-lane-corner')
      .children.find((child) => child.className === 'image-export-open');
    const sent = [];
    const said = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.leafToast = (words) => said.push(words);
    // A PNG asked for as a JPEG, so the row converts rather than asking the host to copy the file: the load is the first thing it does.
    clickApp(button);
    const ask = sent.filter((one) => one.command === 'pickPicturePath').pop();
    if (!ask) throw new Error('pressing Export asked nowhere for a path');
    booted.window.leafPicturePathPicked(ask.token, '/out/nowhere.jpg');
    for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
    if (sent.some((one) => one.command === 'exportPicture')) {
      throw new Error('a picture that could not be read still sent a file for the host to write');
    }
    if (!said.includes('That picture could not be read, so nothing was written.')) {
      throw new Error(`a picture that could not be read said: ${said.join(' / ') || 'nothing'}`);
    }
  });

  // What the stand-in page cannot be asked: whether the pixels come back. It has no canvas, so what is held here is the request the export makes — anonymous cross-origin, which is what lets a pixel be read back at all, and a fresh request rather than the copy on screen, which is tainted and always will be.
  check('a conversion asks for the picture again in anonymous cross-origin mode', () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/image-sheet.js'), 'utf8');
    const draw = fragment.slice(fragment.indexOf('function pictureCanvas('), fragment.indexOf('async function pictureFileBase64('));
    if (!draw) throw new Error('nothing in the fragment draws a picture for a conversion');
    if (!/new Image\(\)/.test(draw)) {
      throw new Error('the conversion draws the element on the page, whose canvas is tainted and can never be read back');
    }
    if (!/crossOrigin\s*=\s*'anonymous'/.test(draw)) {
      throw new Error('the conversion no longer asks in anonymous cross-origin mode, so no pixel of the picture can be read back');
    }
    // The host half of the same pair: the header is sent for a picture and for nothing else.
    const protocol = readFileSync(join(root, 'src/markdown/image_protocol.rs'), 'utf8');
    const rule = protocol.slice(protocol.indexOf('fn allow_origin_for('), protocol.indexOf('/// True when `path` names a file'));
    if (!rule.includes('content_type.starts_with("image/")')) {
      throw new Error('the picture responder no longer holds its cross-origin header to the pictures the reading view draws');
    }
  });

  // The close mark is the only thing drawn over the picture, so it waits in a corner rather than on the glass: absent until the pointer comes for it, and reachable by keyboard, because Escape and the ground are the other two ways out.
  check('the close mark is hidden until its corner is pointed at', () => {
    const css = readingCss();
    const ruleBody = (selector) => {
      const at = css.indexOf(selector);
      if (at < 0) throw new Error(`no rule for ${selector}`);
      return css.slice(at, css.indexOf('}', at));
    };
    const mark = ruleBody('.image-sheet-close {');
    if (!/opacity:\s*0/.test(mark) || !/pointer-events:\s*none/.test(mark)) {
      throw new Error('the close mark is drawn over the picture before the pointer asks for it');
    }
    const shown = ruleBody('.image-sheet-corner:hover .image-sheet-close,');
    if (!/opacity:\s*1/.test(shown)) throw new Error('pointing at the corner no longer reveals the close mark');
    if (!css.includes('.image-sheet-close:focus-visible {') && !css.includes('.image-sheet-close:focus-visible,')) {
      throw new Error('the close mark cannot be reached by keyboard');
    }
    const corner = ruleBody('.image-sheet-corner {');
    if (!/position:\s*absolute/.test(corner) || !/top:\s*0/.test(corner) || !/right:\s*0/.test(corner)) {
      throw new Error('the close mark waits somewhere other than the overlay top right corner');
    }
    // Fitted whole: never cropped, and never drawn past its own size.
    const picture = ruleBody('.image-sheet-picture {');
    for (const declaration of ['max-width: 100%', 'max-height: 100%', 'width: auto', 'height: auto', 'object-fit: contain']) {
      if (!picture.includes(declaration)) throw new Error(`the full-window picture no longer fits whole: ${declaration}`);
    }
    // No surface of its own: the scrim behind is the ground, which is what makes a press outside the picture read as a press on it.
    const overlay = ruleBody('.image-sheet-overlay {');
    if (/\bbackground/.test(overlay) || /\bborder/.test(overlay)) {
      throw new Error('the full-window picture grew a panel, so the app is no longer the ground behind it');
    }
  });
}
