#!/usr/bin/env node
// The app's stylesheet is also what leaftext.com and empty.guru are handed, so a rule in it keyed on nothing is a rule that reaches somebody else's page. This fails on one that would take that page's frame, naming the file and the line.
//
//   node scripts/check-page-frame.mjs           report every hit and exit non-zero (`just verify`)
//   node scripts/check-page-frame.mjs --check   self-test the scanner, then check the files
//
// Refused: `overflow`, `position` and `touch-action` — in any of their forms — on a bare `html`, `body` or `:root`. Those three are what freeze or unmoor a page rather than restyle something in it. `body { overflow: hidden }` is the one that shipped: where the root element's own overflow is `visible` a browser takes the viewport's from `body`, so both published sites had no scrollport at all from v1.5.0 and could not be scrolled on any device.
//
// Out of reach on purpose: a selector carrying a class, an attribute, a pseudo-class or a combinator — `body.frameless`, `body:has(.app-surface)`, `body::before` — which is how the app's own window keeps every rule it needs. Element rules like `button` and `::selection` are out too: they restyle what a page already has, and both sites have shipped under them since v1.5.0.
//
// The compiled themes are not read here. `theme.rs` emits one custom property per row of `design/colors.md` and can emit nothing else, and `src/tests/reading_css_layout.rs` walks the concatenated result the browser actually gets.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { partPaths } from './reading-css.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The stylesheets `reading_mode_css()` concatenates, in its order — the two generated ones, then every part of the app's own sheet. Each is read on its own, so a hit names the file a reader opens. */
const FILES = ['src/assets/tokens.css', 'src/assets/icons.css', ...partPaths()];

/** Nothing else in a page belongs to the page's frame. A class, an attribute, a pseudo-class or a combinator scopes a rule to something; these three name whatever document the stylesheet lands in. */
const BARE = new Set(['html', 'body', ':root']);

/** What takes a frame rather than restyling something inside it. */
const TAKES_THE_FRAME = /^(overflow(-[xy])?|position|touch-action)$/;

/** Comments are not declarations, and a selector inside one is not a selector. Blanked rather than dropped, so the line numbers still point at the right place. */
function strip(css) {
  let inComment = false;
  return css
    .split('\n')
    .map((line) => {
      let text = line;
      if (inComment) {
        const end = text.indexOf('*/');
        if (end < 0) return '';
        text = ' '.repeat(end + 2) + text.slice(end + 2);
        inComment = false;
      }
      text = text.replace(/\/\*.*?\*\//g, (match) => ' '.repeat(match.length));
      const open = text.indexOf('/*');
      if (open >= 0) {
        inComment = true;
        text = text.slice(0, open);
      }
      return text;
    })
    .join('\n');
}

/** Every rule in the sheet, at any depth: a `@media` block holds rules too, and one of these inside it reaches just as far. */
function rules(css) {
  const source = strip(css);
  const found = [];
  const open = [];
  let start = 0;
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at];
    if (char === '{') {
      open.push({ selector: source.slice(start, at), body: at + 1 });
      start = at + 1;
      continue;
    }
    if (char === '}') {
      const rule = open.pop();
      if (rule) {
        const selector = rule.selector.replace(/^[\s;}]*/, '').trim();
        // An at-rule holds rules, not declarations. Its own children were pushed and popped already.
        if (selector && !selector.startsWith('@')) {
          found.push({
            selector,
            body: source.slice(rule.body, at),
            line: source.slice(0, rule.body).split('\n').length,
          });
        }
      }
      start = at + 1;
    }
  }
  return found;
}

/** What a rule declares, by property name. A nested block's own text was already taken out as its own rule. */
function properties(body) {
  return body
    .replace(/\{[^}]*\}/g, '')
    .split(';')
    .map((declaration) => declaration.split(':')[0].trim().toLowerCase())
    .filter(Boolean);
}

/** Every rule that names a bare page element and takes its frame. */
export function frameGrabs(css, label = '') {
  const hits = [];
  for (const rule of rules(css)) {
    const bare = rule.selector
      .split(',')
      .map((one) => one.trim())
      .filter((one) => BARE.has(one));
    if (!bare.length) continue;
    for (const property of properties(rule.body)) {
      if (!TAKES_THE_FRAME.test(property)) continue;
      hits.push({ label, line: rule.line, selector: bare.join(', '), property });
    }
  }
  return hits;
}

const problems = [];

if (process.argv.includes('--check')) {
  // A check that cannot fail is not a check: the rule that took both sites, and the scope that keeps them.
  const broken = frameGrabs('body {\n  overflow: hidden;\n}\n', 'fixture');
  if (broken.length !== 1 || broken[0].property !== 'overflow') {
    problems.push('the scanner let `body { overflow: hidden }` through — the rule that made both sites unreadable');
  }
  const fixed = frameGrabs('body:has(.app-surface) {\n  overflow: hidden;\n}\n', 'fixture');
  if (fixed.length) problems.push("the scanner refused a rule scoped to the app's own page, which is where the window needs it");
  // The scopes the app already uses, and the element rules both sites have always carried.
  const allowed = 'body.frameless {\n  position: fixed;\n}\nbody::before {\n  position: fixed;\n}\nbutton {\n  touch-action: none;\n}\n';
  if (frameGrabs(allowed, 'fixture').length) problems.push("the scanner refused a scoped or element rule, which is not a page's frame");
  // Inside a media query it reaches exactly as far.
  const nested = frameGrabs('@media (max-width: 600px) {\n  :root {\n    overflow: hidden;\n  }\n}\n', 'fixture');
  if (nested.length !== 1) problems.push('the scanner does not read inside a media query, where the same rule reaches just as far');
  if (!problems.length) console.log('scanner: refuses the rule that shipped, passes the scope that fixed it');
}

for (const file of FILES) {
  for (const hit of frameGrabs(readFileSync(join(root, file), 'utf8'), file)) {
    problems.push(`${hit.label}:${hit.line} — \`${hit.selector}\` sets \`${hit.property}\`, which takes the frame of every page handed this stylesheet`);
  }
}

if (problems.length) {
  console.error("the app is taking a published page's frame:");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("Scope it to the app's own page — `body:has(.app-surface)` — so leaftext.com and empty.guru keep their own scroll.");
  process.exit(1);
}
console.log(`page frame: ${FILES.length} stylesheets, and none of them takes a published page's scroll, place or touch`);
