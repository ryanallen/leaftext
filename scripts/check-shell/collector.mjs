// The collector every front-end check reports through, and the app stylesheet a check reads a rule out of. A failure lands in one list and the report at the foot of the run reads it, so no subject prints its own.
//
// Reached through `shared.mjs`, never imported by a subject file directly.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { whole } from '../reading-css.mjs';
import { record, root } from './script.mjs';

export const createCollector = () => {
  const failures = [];
  const check = (name, run) => {
    try {
      run();
    } catch (error) {
      failures.push(`${name}: ${error && error.message ? error.message : error}`);
    } finally {
      if (record.restore) record.restore();
    }
  };
  // Awaiting checks share one queue so each keeps the page until it restores what it moved.
  const settled = [];
  let settlingQueue = Promise.resolve();
  const checkSettled = (name, run) => {
    // The same hand-back a synchronous check gets, on the promise the queue chains: `finally` leaves the rejection alone, so a failing body is still reported under its own name and the next one still starts on the page the boot made.
    const mine = settlingQueue.then(run).finally(() => {
      if (record.restore) record.restore();
    });
    // The next body starts after either result and reports only its own failure.
    settlingQueue = mine.catch(() => {});
    settled.push(mine.catch((error) => failures.push(`${name}: ${error && error.message ? error.message : error}`)));
  };
  return { check, checkSettled, failures, settled };
};

export const { check, checkSettled, failures, settled } = createCollector();

// The complete static cascade: tokens, drawings and every reading rule in order, after the run-time theme colors the Rust host adds. Read here rather than in a subject file, so a static part added to the sheet reaches every check at once.
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
