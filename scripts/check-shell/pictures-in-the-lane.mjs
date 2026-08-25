// Pictures in the lane, and the picture opened to the whole window.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, fakeElement, readingCss, record, root, source } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

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

  // The one place in the app where the hover wash sits on something other than the page. It is a 16% tint over transparent, so a rule that hands it the whole background takes the control's own surface away — beside a table that reads as a tint on the page and is nearly invisible, and over a picture it is a see-through square with the picture showing through it.
  check('the pointer never takes a corner opener s surface away', () => {
    const css = readingCss();
    const at = css.indexOf('.table-sheet-open:hover,');
    if (at < 0) throw new Error('the two corner openers no longer share one hover rule');
    const rule = css.slice(at, css.indexOf('}', at));
    if (!rule.includes('.image-sheet-open:hover')) throw new Error('the picture opener no longer shares the table opener s hover');
    const fill = /background:\s*([^;]+);/.exec(rule);
    if (!fill) throw new Error('the corner opener paints nothing under the pointer');
    if (!fill[1].includes('var(--lt-surface-elevated)')) {
      throw new Error('the wash replaces the opener s own surface, so a picture shows through the control');
    }
    if (!fill[1].includes('var(--lt-wash-hover)')) throw new Error('the corner opener answers the pointer with something other than the one wash');
    // And the surface it is painted over is the one the button rests on, or the hover is a different color from the button.
    const rest = css.slice(css.indexOf('.table-sheet-open,\n.image-sheet-open {'), css.indexOf('.table-sheet-open .lt-icon'));
    if (!rest.includes('background: var(--lt-surface-elevated);')) {
      throw new Error('the opener no longer rests on the surface its hover is painted over');
    }
  });

  // The full-window picture is a reader and nothing else: it shows an element the page already holds, so no route from opening or closing it reaches the document buffer, and none of it needs a host.
  check('a full-window picture is safe to open and can never write', () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/image-sheet.js'), 'utf8');
    for (const part of ['function bindImageSheet(', 'function openImageSheet(', 'function closeImageSheet()', 'leafFocusForKeyboard(opener)']) {
      if (!fragment.includes(part)) throw new Error(`the picture sheet lost: ${part}`);
    }
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
    // Opening is reading, so the padlock is never asked; a marked missing picture has nothing behind the mark to show.
    if (/readerEditingAllowed|documentLocked/.test(fragment)) {
      throw new Error('opening a picture now waits on the padlock, and opening is reading');
    }
    if ((fragment.match(/imageMissing === 'true'/g) || []).length < 2) {
      throw new Error('a marked missing picture can reach the full-window view, or still gets an opener');
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

  // Which pictures get an opener, run rather than read: a marked missing one is holding our glyph over a transparent pixel, so there is nothing behind it to open.
  check('a marked missing picture gets no opener', () => {
    const paragraph = (picture) => {
      const block = fakeElement('p');
      block.tagName = 'P';
      block.querySelector = (selector) => {
        if (selector === ':scope > img') return picture;
        if (selector === ':scope > .image-sheet-open') return block.children.find((child) => child.className === 'image-sheet-open') || null;
        return null;
      };
      return block;
    };
    const real = paragraph(Object.assign(fakeElement('img'), { tagName: 'IMG', dataset: {} }));
    const missing = paragraph(Object.assign(fakeElement('img'), { tagName: 'IMG', dataset: { imageMissing: 'true' } }));
    const empty = paragraph(null);
    booted.bindImageSheet({ querySelectorAll: () => [real, missing, empty] });
    const openers = (block) => block.children.filter((child) => child.className === 'image-sheet-open').length;
    if (openers(real) !== 1) throw new Error('a picture did not get its opener');
    if (openers(missing)) throw new Error('a marked missing picture was given an opener');
    if (openers(empty)) throw new Error('a paragraph with no picture in it was given an opener');
    // Twice over the same page must not stack a second button on every picture.
    booted.bindImageSheet({ querySelectorAll: () => [real] });
    if (openers(real) !== 1) throw new Error('a second pass stacked another opener on the same picture');
    // The fetch fails after the page is decorated, so refusing at the bind is not enough on its own: the mark has to take back the lane and the opener the render already gave, and a picture that arrives later has to get both back.
    const decorate = readFileSync(join(root, 'src/assets/shell/decorate.js'), 'utf8');
    const mark = decorate.slice(decorate.indexOf('function markMissingImage'), decorate.indexOf('function restoreMissingImage'));
    for (const wanted of ["classList.remove('image-lane')", "':scope > .image-sheet-open'"]) {
      if (!mark.includes(wanted)) throw new Error(`the missing mark no longer takes back: ${wanted}`);
    }
    const refresh = decorate.slice(decorate.indexOf('window.leafRefreshImages'));
    if (!refresh.includes('laneWidePictures();') || !refresh.includes('bindImageSheet();')) {
      throw new Error('a picture that has arrived at last never gets its lane or its opener back');
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
