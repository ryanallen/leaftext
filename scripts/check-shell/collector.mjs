// The collector every front-end check reports through, and the app stylesheet a check reads a rule out of. A failure lands in one list and the report at the foot of the run reads it, so no subject prints its own.
//
// Reached through `shared.mjs`, never imported by a subject file directly.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { whole } from '../reading-css.mjs';
import { record, root } from './script.mjs';

export const failures = [];
export const check = (name, run) => {
  try {
    run();
  } catch (error) {
    failures.push(`${name}: ${error && error.message ? error.message : error}`);
  } finally {
    if (record.restore) record.restore();
  }
};
// For a check that has to let the page's own promises settle before it can look. Its failure lands in the same list, and the report at the foot waits for every one of them.
//
// One queue for all of them, in the order they registered. Every subject shares one booted page, and a body that pauses hands that page to whichever other body was waiting — so a check that opened a menu once made a check three files away fail on state the menu had taken down. Chained, each body owns the page from its first line to its last and puts back whatever it moved. The synchronous checks above cannot be interrupted at all and finish before this queue starts, because a promise body waits for the current call stack.
export const settled = [];
let settlingQueue = Promise.resolve();
export const checkSettled = (name, run) => {
  const mine = settlingQueue.then(run);
  // The next body starts whether this one passed or failed, and still reports its own failure under its own name.
  settlingQueue = mine.catch(() => {});
  settled.push(mine.catch((error) => failures.push(`${name}: ${error && error.message ? error.message : error}`)));
};

// The app stylesheet the way the browser is handed it: every part of it, joined in cascade order. Read here rather than in a subject file, so a part added to the sheet reaches every check at once.
let readingSource = null;
export const readingCss = () => {
  if (readingSource === null) readingSource = whole();
  return readingSource;
};

// What layer a rule is painted on, read as the named token rather than the number in the rule: a layer written by hand is what `check-literals` refuses, so a rule that stopped naming one fails here rather than being read. Shared by every check that compares two layers, because a second copy is a second answer.
let layerSources = null;
export const layerOf = (selector) => {
  if (!layerSources) {
    layerSources = {
      css: readingCss(),
      tokens: readFileSync(join(root, 'src/assets/tokens.css'), 'utf8'),
    };
  }
  const { css, tokens } = layerSources;
  const opened = css.indexOf(`${selector} {`);
  if (opened < 0) throw new Error(`no rule for ${selector}`);
  const named = /z-index:\s*var\((--lt-z-[\w-]+)\)/.exec(css.slice(opened, css.indexOf('}', opened)));
  if (!named) throw new Error(`${selector} takes no named layer`);
  return valueOfLayer(named[1], tokens);
};
const valueOfLayer = (token, tokens) => {
  const value = new RegExp(`${token}:\\s*(-?\\d+);`).exec(tokens);
  if (!value) throw new Error(`${token} is not a layer the token file names`);
  return Number(value[1]);
};

// Every layer the stylesheet paints on, found by walking it rather than by naming the rules: what the selector is, and what its token is worth. A check that says one thing is above everything below it has to be written this way, or a sheet added later climbs over it and nothing says so.
export const layersPainted = () => {
  layerOf('.app-toast');
  const { css, tokens } = layerSources;
  return [...css.matchAll(/z-index:\s*var\((--lt-z-[\w-]+)\)/g)].map((hit) => {
    const before = css.slice(0, css.lastIndexOf('{', hit.index));
    // The rule's own selector list is whatever stands between it and the thing before it — a closed rule, the brace of a media block, or a comment.
    const begins = Math.max(before.lastIndexOf('}') + 1, before.lastIndexOf('{') + 1, before.lastIndexOf('*/') + 2);
    return { selector: before.slice(begins).trim().replace(/\s+/g, ' '), layer: valueOfLayer(hit[1], tokens) };
  });
};
