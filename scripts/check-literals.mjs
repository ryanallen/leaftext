#!/usr/bin/env node
// Every value in the interface comes from a token. This fails on a hand-written one
// in src/assets/reading.css, naming the line — so the next value is a deliberate row
// in design/tokens.md rather than a number typed into a rule.
//
//   node scripts/check-literals.mjs   report every hit and exit non-zero (`just verify`)
//
// What is checked is the *categories* phase 6 tokenized: color, spacing, interface
// text size, weight, stroke, line height, letter spacing, opacity, duration, easing,
// shadow and z-index. Three things are deliberately not:
//
//   - Widths, heights and positional offsets. They are one component's geometry, not
//     a scale — 56 distinct values, each used once. A token per one-off buys a name
//     and a hop and no reuse.
//   - `em` and `rem` inside a document. Those follow the text size, which is the
//     point of them.
//   - The metrics block in `:root` — the app bar's height, the reader's gutter, the
//     minimap's widths. Each is one geometry said once, and its own name already.
//
// A @media condition cannot hold a var(), so those lines are exempt by necessity.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const relative = 'src/assets/reading.css';
const css = readFileSync(join(root, relative), 'utf8');

// Comments and @media conditions are not declarations.
let inComment = false;
const code = css.split('\n').map((line, index) => {
  let text = line;
  if (inComment) {
    const end = text.indexOf('*/');
    if (end < 0) return { n: index + 1, text: '' };
    text = text.slice(end + 2);
    inComment = false;
  }
  text = text.replace(/\/\*.*?\*\//g, '');
  const open = text.indexOf('/*');
  if (open >= 0) {
    inComment = true;
    text = text.slice(0, open);
  }
  if (/@media|@container|@supports/.test(text)) text = '';
  return { n: index + 1, text };
});

// The metrics that are one geometry, named once, and stay in the stylesheet.
const METRICS = /^\s*--(?:app-bar-height|reader-|library-|minimap-|cv-|tab-|sheet-|flow-|mermaid-|block-|selection-|card-|sw-|code-|glossary-|graph-|type-)/;

const RULES = [
  ['a color', /(#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\))/g, () => true],
  [
    'spacing',
    /\b(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)*\s*:\s*([^;]+);/g,
    // `0px` is zero, not a spacing decision — usually a var()'s fallback.
    (value) => /(?<![\w.-])-?(?!0px\b)\d*\.?\d+px/.test(value),
  ],
  ['a font size', /font-size\s*:\s*([^;]+);/g, (value) => /\d\s*px/.test(value)],
  ['a weight', /font-weight\s*:\s*(\d+)\s*;/g, () => true],
  [
    'a stroke width',
    /\b(?:border|outline|column-rule)(?:-[a-z]+)*\s*:\s*([^;]+);/g,
    (value, prop) => !/radius/.test(prop) && /\d\s*px/.test(value),
  ],
  ['a line height', /line-height\s*:\s*([\d.]+)\s*;/g, () => true],
  ['letter spacing', /letter-spacing\s*:\s*(-?[\d.]+(?:em|px|rem))\s*;/g, () => true],
  ['an opacity', /opacity\s*:\s*(0?\.\d+)\s*;/g, () => true],
  [
    'a duration or easing',
    /\b(?:transition|animation)(?:-(?:duration|delay|timing-function))?\s*:\s*([^;]+);/g,
    (value) => /(?<![\w.-])\d*\.?\d+m?s\b/.test(value) || /(?<![\w-])(?:ease(?:-in|-out|-in-out)?|linear|cubic-bezier)(?![\w-])/.test(value),
  ],
  ['a shadow', /box-shadow\s*:\s*([^;]+);/g, (value) => !/^(?:var\(|none|inherit)/.test(value.trim())],
  ['a layer', /z-index\s*:\s*(\d+)\s*;/g, (value) => Number(value) >= 20],
];

const hits = [];
for (const { n, text } of code) {
  if (METRICS.test(text)) continue;
  for (const [what, pattern, offends] of RULES) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1];
      if (!offends(value, match[0])) continue;
      hits.push(`${relative}:${n}  ${what} written by hand: ${value.trim()}`);
    }
  }
}

if (hits.length) {
  console.error(`Hand-written values in ${hits.length} place(s) — every one comes from a token:`);
  for (const hit of hits) console.error(`  ${hit}`);
  console.error('Add a row to design/tokens.md (or design/colors.md for a color), then `just bundle-tokens`.');
  process.exit(1);
}
console.log(`literals: none in ${relative} — every value comes from a token`);
