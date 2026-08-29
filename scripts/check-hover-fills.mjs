#!/usr/bin/env node
// Two rules about what the pointer paints, both of which shipped broken in the field block at the top of a note.
//
//   node scripts/check-hover-fills.mjs   report both faults (`just verify`)
//
// 1. A note's field values paint nothing under the pointer. The page's whole argument is that a document stays a document while it is being edited, so the caret is the cue and a band behind the words is the app drawing a form. Scoped to the value cell rather than the block: the buttons in it do wear a fill.
//
// 2. A control that clears its own fill has to name one for hover as well, or the app-wide `button:hover` paints it primary purple with the control's quiet ink left on top, unreadable. The trap is invisible in the rule being written: `button:hover` is a pseudo-class and an element, so it outranks a rest rule of one class alone, and `background: none` at rest never reaches the hover state. Only a class the design system draws on a button is held to it, and only where the rest rule is outranked — `.something button` weighs the same as the app-wide rule and sits later in the file, so it keeps its own background and is left alone.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { locate, parts, whole } from './reading-css.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Blank the comments, keeping every line's length so the line numbers still point at the right place.
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

const rules = (css) => {
  const flat = strip(css).replace(/@[^{]*\{/g, (m) => ' '.repeat(m.length));
  const out = [];
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]
      .replace(/^\s*\}+/, '')
      .split(',')
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (!selectors.length) continue;
    out.push({ selectors, body: m[2], n: flat.slice(0, m.index).split('\n').length });
  }
  return out;
};

const paintsBackground = (body) => /(^|[\s;])background(-image)?\s*:/.test(body);
const clearsBackground = (body) => /(^|[\s;])background\s*:\s*(none|transparent)\s*(;|$)/.test(body);
const classesIn = (selector) => (selector.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
// A value cell in a note's field block, however it is reached.
const isFieldValue = (selector) =>
  /\.frontmatter(?![\w-])/.test(selector) && /data-leaf-field|\btd\b/.test(selector);

// Enough of the cascade to answer one question: does `button:hover` outrank this?
const specificity = (selector) => [
  (selector.match(/#[\w-]+/g) || []).length,
  (selector.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):[\w-]+(?:\([^)]*\))?/g) || []).length,
  (selector.match(/(?:^|[\s>+~(])([a-z][\w-]*)/g) || []).length,
];
const outranks = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]);
const BUTTON_HOVER = specificity('button:hover');

const check = (css, buttons) => {
  const parsed = rules(css);
  const found = [];

  for (const rule of parsed) {
    if (!paintsBackground(rule.body)) continue;
    for (const selector of rule.selectors) {
      if (!selector.includes(':hover')) continue;
      if (!isFieldValue(selector)) continue;
      found.push({
        n: rule.n,
        why: `${selector} paints behind a field value under the pointer`,
        fix: 'the caret is the cue — a paragraph lower down the page paints nothing either',
      });
    }
  }

  // Every hover rule that names a fill, by the class it hangs off, so a control written `.x:hover:not(:disabled)` still counts as answering for `.x`.
  const answered = new Set();
  for (const rule of parsed) {
    if (!paintsBackground(rule.body)) continue;
    for (const selector of rule.selectors) {
      if (!selector.includes(':hover')) continue;
      for (const cls of classesIn(selector)) answered.add(cls);
    }
  }

  for (const rule of parsed) {
    if (!clearsBackground(rule.body)) continue;
    for (const selector of rule.selectors) {
      if (selector.includes(':hover')) continue;
      const classes = classesIn(selector);
      const subject = classes[classes.length - 1];
      if (!subject || !buttons.has(subject) || answered.has(subject)) continue;
      if (outranks(specificity(selector), BUTTON_HOVER)) continue;
      found.push({
        n: rule.n,
        why: `${selector} clears its fill at rest and never on hover`,
        fix: 'the app-wide button:hover outranks it, so the pointer paints it primary purple — name a background in its own :hover',
      });
    }
  }
  return found;
};

// The classes the design system draws on a button. One that reaches the page on a div is not held to the second rule, and one that reaches design/components.md at all fails `just check-classes` first.
const buttonClasses = () => {
  const set = new Set();
  for (const file of ['design/components.md', 'src/assets/app-shell.html']) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const m of text.matchAll(/<(?:button|summary)[^>]*\sclass="([^"]+)"/g)) {
      for (const cls of m[1].split(/\s+/).filter(Boolean)) set.add(cls);
    }
  }
  if (set.size < 20) throw new Error(`expected the button markup, got ${set.size} class(es)`);
  return set;
};

const FIXTURE = [
  ['.frontmatter.is-editable td[data-leaf-field]:hover {\n  background: var(--lt-wash-hover);\n}', 1, 'a band behind a field value'],
  ['.document-body .frontmatter tr:hover td {\n  background: var(--lt-wash-hover);\n}', 1, 'the same band painted off the row'],
  ['.frontmatter.is-editable td[data-leaf-field] {\n  cursor: text;\n}', 0, 'a field value with only a caret'],
  ['.frontmatter-remove:hover {\n  background: var(--lt-wash-hover);\n}', 0, 'a button in the block wearing its own fill'],
  ['.frontmatter-add-button {\n  background: none;\n}\n.frontmatter-add-button:hover {\n  color: var(--lt-foreground);\n}', 1, 'a bare button that never takes its fill back'],
  ['.frontmatter-add-button {\n  background: none;\n}\n.frontmatter-add-button:hover {\n  background: var(--lt-wash-hover);\n}', 0, 'the same button naming its own fill'],
  ['.frontmatter-add-button {\n  background: none;\n}\n.frontmatter-add-button:hover:not(:disabled) {\n  background: var(--lt-wash-hover);\n}', 0, 'a fill named on a narrower hover'],
  ['.leaf-sheet .frontmatter-add-button {\n  background: transparent;\n}', 0, 'a rest rule that outranks the app-wide hover'],
  ['.library-search {\n  background: transparent;\n}', 0, 'a box that is not a button'],
];
const FIXTURE_BUTTONS = new Set(['frontmatter-add-button', 'frontmatter-remove']);
for (const [source, want, label] of FIXTURE) {
  const got = check(source, FIXTURE_BUTTONS).length;
  if (got !== want) {
    console.error(`the hover-fill check is broken: ${label} gave ${got} hit(s), wanted ${want}`);
    process.exit(1);
  }
}

// This is the only caller that turns a place in the whole sheet back into a part, so it proves the reader's membership, separators and arithmetic together. A `locate` off by one sends a reader to the wrong rule and nothing else would say so.
{
  const list = parts();
  const source = whole();
  const expected = list.map((part, index) => part.css + (index < 2 ? '\n' : '')).join('');
  if (source !== expected) {
    console.error('the stylesheet reader no longer uses the binary\'s newline after tokens and drawings and no separator between reading-rule parts');
    process.exit(1);
  }
  let after = -1;
  for (const [needle, label] of [
    ['--lt-radius-xs:', 'a token declaration'],
    ['--lt-icon-back:', 'an icon value'],
    ['.app-surface', 'a reading rule'],
  ]) {
    const at = source.indexOf(needle);
    if (at <= after) {
      console.error(`the complete static stylesheet did not carry ${label} after the part before it`);
      process.exit(1);
    }
    after = at;
  }
  let first = 1;
  for (const [index, part] of list.entries()) {
    const lines = part.css.split('\n').length - 1;
    for (const [line, want] of [[first, 1], [first + lines - 1, lines]]) {
      const got = locate(line);
      if (got.path !== part.path || got.n !== want) {
        console.error(`locate is broken: line ${line} of the whole sheet came back as ${got.path}:${got.n}, wanted ${part.path}:${want}`);
        process.exit(1);
      }
    }
    first += lines;
    if (index < 2) {
      let refused = false;
      try {
        locate(first);
      } catch (error) {
        refused = error.message.includes('separator');
      }
      if (!refused) {
        console.error(`locate called the separator after ${part.path} a source line`);
        process.exit(1);
      }
      first += 1;
    }
  }
  if (first - 1 !== source.split('\n').length - 1) {
    console.error('locate is broken: the parts do not add up to the sheet it maps into');
    process.exit(1);
  }
}

const buttons = buttonClasses();
// The whole cascade at once, not part by part: the second rule pairs a rest rule that clears its fill with the hover rule that has to name one back, and the two are free to sit in different parts. `locate` turns the place it lands on into the part a reader opens.
const found = check(whole(), buttons);
if (found.length) {
  console.error(`${found.length} rule(s) painting what the pointer must not:`);
  for (const hit of found) {
    const where = locate(hit.n);
    console.error(`  ${where.path}:${where.n}  ${hit.why} — ${hit.fix}`);
  }
  process.exit(1);
}
console.log(`hover fills: nothing paints behind a note's field values, and none of the ${buttons.size} button classes the design system draws takes the app-wide fill by accident`);
