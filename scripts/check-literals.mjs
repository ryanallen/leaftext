#!/usr/bin/env node
// Every value in the interface comes from a token. This fails on a hand-written one in src/assets/reading/, naming the part and the line — so the next value is a deliberate row in design/tokens.md rather than a number typed into a rule.
//
//   node scripts/check-literals.mjs   report every hit and exit non-zero (`just verify`)
//
// What is checked is the *categories* phase 6 tokenized: color, spacing, interface text size, weight, stroke, line height, letter spacing, opacity, duration, easing, shadow and z-index. Three things are deliberately not:
//
//   - Widths, heights and positional offsets. They are one component's geometry, not
//     a scale — 56 distinct values, each used once. A token per one-off buys a name
//     and a hop and no reuse.
//   - `em` and `rem` inside a document. Those follow the text size, which is the
//     point of them.
//   - The metrics block in `:root` — the app bar's height, the reader's gutter, the
//     minimap's widths. Each is one geometry said once, and its own name already.
//
// A `font` shorthand is refused whole, `font: inherit` excepted: the parts it does not name reset silently, so there is nothing on the line for the rules above to judge.
//
// A @media condition cannot hold a var(), so those lines are exempt by necessity.
//
// It also holds every hover fill to the one wash, or to the app's own dot lattice where a target is too big to take a flat tint. Refused there: a surface color, which a family may set to the very value of the panel behind it; a strength mixed from the theme's ink here rather than in the token; and a lattice drawn in any ink but the hover's, or any other image at all. A control already saying something — pressed, selected, open, disabled — keeps its own fill, and so does one deepening its own accent.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parts } from './reading-css.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The stylesheet is served as ordered parts. Each one is scanned on its own so a hit names the file a reader opens, with that file's own line number.
const stylesheet = parts();

// Comments and @media conditions are not declarations.
function strip(source) {
  let inComment = false;
  return source.split('\n').map((line, index) => {
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
}

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
    // Refused whole, tokens or not: the shorthand resets every part it does not name, so an unnamed line height silently becomes `normal`, read off whichever face is loaded. Only `font: inherit` stays — it takes the parent's values, which somebody chose. The lookbehind keeps `--app-font:` out of it.
    'a font shorthand',
    /(?<![-\w])font\s*:\s*([^;]+);/g,
    (value) => value.trim() !== 'inherit',
  ],
  [
    'a stroke width',
    /\b(?:border|outline|column-rule)(?:-[a-z]+)*\s*:\s*([^;]+);/g,
    (value, prop) => !/radius/.test(prop) && /\d\s*px/.test(value),
  ],
  [
    // A drawn line rather than a box's edge: the flowchart picker's own vectors, and the marks laid over mermaid's. Unitless counts — in SVG that is a user unit.
    'a stroke width',
    /\bstroke-width\s*:\s*([^;]+);/g,
    (value) => /(?<![\w.-])\d*\.?\d+(?:px)?(?![\w.-])/.test(value),
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

// A function rather than a loop inlined over the file, so the fixture below can prove each rule still fires.
function propertyHits(lines) {
  const out = [];
  for (const { n, text } of lines) {
    if (METRICS.test(text)) continue;
    for (const [what, pattern, offends] of RULES) {
      for (const match of text.matchAll(pattern)) {
        const value = match[1];
        if (!offends(value, match[0])) continue;
        out.push({ n, what, value });
      }
    }
  }
  return out;
}

const hits = [];
for (const { path, css } of stylesheet) {
  for (const { n, what, value } of propertyHits(strip(css))) {
    const hint = what === 'a font shorthand' ? ' — write font-family, font-size, font-weight and line-height, each from the table' : '';
    hits.push(`${path}:${n}  ${what} written by hand: ${value.trim()}${hint}`);
  }
}

// A hover fill is one wash, and only that wash. Two ways of writing one leave a row under the pointer invisible: naming a surface color, which a family is free to set to the very value of the panel behind it, and mixing a percentage here, which is a strength nothing checks — it reached five different numbers across nine rules before this.
const HOVERED = /:hover|:focus-visible/;
// A control that is already saying something — pressed, selected, the open file, a button with nowhere to go. Its fill is an accent, a recess or its own rest state, and it shares a selector with :hover so that reading holds while the pointer is elsewhere.
const ALREADY_ON = /\[aria-pressed|\[aria-selected|\[aria-current|:disabled|\.is-open|\.is-active|\.is-selected/;
const A_SURFACE = /^var\(--lt-(?:background|surface|surface-elevated|surface-muted|surface-sunken)\)$/;
// A wash is neutral: the theme's ink or its paper, thinned. A hover mixed from the accent is a colored state deepening its own rest fill — the sync chip, the chrome buttons — which is a decision about that control, not a strength nobody checked.
const A_NEUTRAL = /var\(--lt-(?:foreground|muted-foreground|background|surface|surface-elevated|surface-muted|surface-sunken)\)/;
// The other legal fill: the app's own dot lattice, for a target too big to take a flat tint. Only this exact shape counts, and only in the one ink a hover has — a lattice in the chrome's own grain, or any other image, is a strength nobody chose.
const A_LATTICE = /^radial-gradient\(circle,\s*var\(--lt-grain-dot\)\s+0\s+0\.6px,\s*transparent\s+0\.7px\)$/;
const A_HOVER_INK = 'var(--lt-grain-hover)';
// The wash written as an image, which is how a control keeps a fill of its own underneath it — the destructive button's red.
const A_WASH_IMAGE = /^linear-gradient\(var\(--lt-wash-hover\),\s*var\(--lt-wash-hover\)\)$/;

function hoverFills(lines) {
  const out = [];
  let selector = '';
  let pending = '';
  // A block's ink and its images are only judged against each other, so both are held until the closing brace — the rule may set either one first.
  let ink = '';
  let images = [];
  const close = () => {
    for (const image of images) {
      if (A_WASH_IMAGE.test(image.value)) continue;
      if (!A_LATTICE.test(image.value)) out.push({ n: image.n, why: 'fills with an image of its own', value: image.value });
      else if (ink !== A_HOVER_INK) out.push({ n: image.n, why: 'draws the lattice in another ink', value: ink || 'no --lt-grain-dot of its own' });
    }
    ink = '';
    images = [];
  };
  for (const { n, text } of lines) {
    const brace = text.indexOf('{');
    if (brace >= 0) {
      selector = (pending + ' ' + text.slice(0, brace)).trim();
      pending = '';
    } else if (!selector) {
      pending = (pending + ' ' + text).trim();
    }
    if (selector && HOVERED.test(selector) && !ALREADY_ON.test(selector)) {
      for (const match of text.matchAll(/\bbackground(?:-color)?\s*:\s*([^;]+);/g)) {
        const value = match[1].trim();
        if (A_SURFACE.test(value)) out.push({ n, why: 'fills with a surface color', value });
        else if (/^color-mix\(/.test(value) && /\d\s*%/.test(value) && A_NEUTRAL.test(value)) {
          out.push({ n, why: 'mixes its own strength', value });
        }
      }
      for (const match of text.matchAll(/--lt-grain-dot\s*:\s*([^;]+);/g)) ink = match[1].trim();
      for (const match of text.matchAll(/\bbackground-image\s*:\s*([^;]+);/g)) images.push({ n, value: match[1].trim() });
    }
    if (text.includes('}')) {
      close();
      selector = '';
      pending = '';
    }
  }
  return out;
}

// The check proves it fires every time it runs: a rule matching nothing passes silently for ever. The property rules first — a shorthand with a value typed in, one written wholly from tokens, the one form that stays, the longhand door, and the custom property the lookbehind keeps out.
const PROPERTY_FIXTURE = [
  ['.a {\n  font: 600 13px var(--app-font);\n}', 1, 'a font shorthand with a size typed in'],
  ['.a {\n  font: var(--lt-weight-600) var(--lt-text-13) / var(--lt-leading-1-45) var(--app-font);\n}', 1, 'a font shorthand written wholly from tokens'],
  ['.a {\n  font: inherit;\n}', 0, 'font: inherit'],
  ['.a {\n  font-size: 13px;\n}', 1, 'a longhand size typed in'],
  ['.a {\n  --app-font: sans-serif;\n}', 0, 'the font custom property'],
];
for (const [source, want, label] of PROPERTY_FIXTURE) {
  const got = propertyHits(strip(source)).length;
  if (got !== want) {
    console.error(`the property check is broken: ${label} gave ${got} hit(s), wanted ${want}`);
    process.exit(1);
  }
}

const FIXTURE = [
  ['.a:hover {\n  background: var(--lt-surface-elevated);\n}', 1, 'a surface named under :hover'],
  ['.a:focus-visible {\n  background: var(--lt-surface-muted);\n}', 1, 'a surface named under :focus-visible'],
  ['.a:hover {\n  background: color-mix(in srgb, var(--lt-muted-foreground) 16%, transparent);\n}', 1, 'a strength mixed by hand'],
  ['.a:hover {\n  background: color-mix(in srgb, var(--lt-foreground) 10%, transparent);\n}', 1, 'a strength mixed from the body ink'],
  ['.a:hover {\n  background: var(--lt-wash-hover);\n}', 0, 'the wash itself'],
  ['.a:hover {\n  background: color-mix(in srgb, var(--lt-accent) 26%, transparent);\n}', 0, 'a chip deepening its own accent'],
  ['.a[aria-pressed="true"]:hover {\n  background: color-mix(in srgb, var(--lt-background) 88%, var(--lt-foreground));\n}', 0, 'a pressed control'],
  ['.a:disabled:hover {\n  background: var(--lt-surface-elevated);\n}', 0, 'a button with nowhere to go'],
  ['.a {\n  background: var(--lt-surface);\n}', 0, 'a rest state'],
  ['.a:hover,\n.b:hover {\n  background: var(--lt-surface);\n}', 1, 'a selector split over two lines'],
  ['.a:hover {\n  --lt-grain-dot: var(--lt-grain-hover);\n  background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);\n}', 0, 'the shared lattice in the hover ink'],
  ['.a:hover {\n  background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);\n}', 1, 'the lattice in whatever ink was inherited'],
  ['.a:hover {\n  --lt-grain-dot: var(--lt-grain-dark);\n  background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);\n}', 1, 'the lattice in the chrome ink'],
  ['.a:hover {\n  --lt-grain-dot: var(--lt-grain-hover);\n  background-image: linear-gradient(var(--lt-grain-dot), transparent);\n}', 1, 'an image that is not the lattice'],
  ['.a:hover {\n  background-image: linear-gradient(var(--lt-wash-hover), var(--lt-wash-hover));\n}', 0, 'the wash laid over a fill of its own'],
  ['.a {\n  --lt-grain-dot: var(--reader-surface-grain);\n  background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);\n}', 0, 'a grained surface at rest'],
];
for (const [source, want, label] of FIXTURE) {
  const got = hoverFills(strip(source)).length;
  if (got !== want) {
    console.error(`the hover check is broken: ${label} gave ${got} hit(s), wanted ${want}`);
    process.exit(1);
  }
}

for (const { path, css } of stylesheet) {
  for (const { n, why, value } of hoverFills(strip(css))) {
    hits.push(`${path}:${n}  a hover ${why}: ${value} — every hover fill is var(--lt-wash-hover)`);
  }
}

if (hits.length) {
  console.error(`Hand-written values in ${hits.length} place(s) — every one comes from a token:`);
  for (const hit of hits) console.error(`  ${hit}`);
  console.error('Add a row to design/tokens.md (or design/colors.md for a color), then `just bundle-tokens`.');
  process.exit(1);
}
console.log(`literals: none across ${stylesheet.length} stylesheet part(s) — every value comes from a token, and every hover fill is the one wash`);
