#!/usr/bin/env node
// A few rules are written out in full in more than one file on purpose, because a reader of any one of them needs the answer there rather than a pointer — and nothing held the copies to each other, so one of them rewritten in a single file left the others teaching the rule it replaced and every check stayed green.
//
//   node scripts/check-shared-rules.mjs           fail on a copy whose marked sentence is not the owner's (`just verify`)
//   node scripts/check-shared-rules.mjs --check   self-test the comparison, then check the real files
//   node scripts/check-shared-rules.mjs --fix     rewrite every marked sentence from its owner
//
// Only the bytes between the markers are compared. Each file keeps its own explanation around the sentence, because the whole reason the rule is repeated is that the build guide says when to stop, the retirement guide says why, the glossary defines the term and the article teaches the workflow — a check that compared whole paragraphs would fail on the next honest rewrite of any of them. One marked sentence per file, so `--fix` knows what it is rewriting and never touches a word of the context.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planTree } from './plan-tree.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every rule written in more than one file, its owner first. A path opening `../docs/` is in the plan tree next door. */
const RULES = [
  {
    marker: 'struck-owners-box',
    what: "what a struck owner's box does and does not say",
    owner: '.agents/skills/dev/SKILL.md',
    copies: [
      '.agents/skills/done/SKILL.md',
      '.agents/skills/ticket/SKILL.md',
      '.agents/skills/git-release/SKILL.md',
      '../docs/GLOSSARY.md',
      '../docs/learn/ticket-workflow-medium/README.md',
    ],
  },
];

const CLOSE = '<!-- /shared-rule -->';

/** The opening marker for one rule. */
const opener = (marker) => `<!-- shared-rule: ${marker} -->`;

/** `1 copy`, `5 copies`. */
const count = (many, one, more) => `${many} ${many === 1 ? one : more}`;

/** Which line of `text` the byte at `index` is on. */
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** Every marked passage for one rule: `body` is the compared bytes, or null where the marker was opened and never closed. */
export function passages(text, marker) {
  const open = opener(marker);
  const found = [];
  let at = 0;
  for (;;) {
    const start = text.indexOf(open, at);
    if (start === -1) return found;
    const from = start + open.length;
    const close = text.indexOf(CLOSE, from);
    // A later opening before the close means this one was never closed, whichever rule that opening belongs to.
    const next = text.indexOf('<!-- shared-rule:', from);
    if (close === -1 || (next !== -1 && next < close)) {
      found.push({ body: null, line: lineOf(text, start), start: from, end: null });
      return found;
    }
    found.push({ body: text.slice(from, close), line: lineOf(text, start), start: from, end: close });
    at = close + CLOSE.length;
  }
}

/** Faults in one rule, each naming what a reader of the wrong copy would be told. */
export function faults(rule, ownerText, copies) {
  const problems = [];
  const owner = passages(ownerText, rule.marker);
  if (!owner.length) return [`${rule.owner} carries no \`${rule.marker}\` marker, so the sentence the other files copy has no source — put the markers back around it, or retire the rule from scripts/check-shared-rules.mjs`];
  if (owner[0].body === null) return [`${rule.owner} opens \`${rule.marker}\` on line ${owner[0].line} and never closes it, so there is no sentence to hold the copies to`];
  if (owner.length > 1) problems.push(`${rule.owner} marks \`${rule.marker}\` ${owner.length} times, on lines ${owner.map((one) => one.line).join(' and ')} — a rule with two sources has none`);
  const source = owner[0].body;
  for (const { path, text } of copies) {
    const found = passages(text, rule.marker);
    if (!found.length) {
      problems.push(`${path} states ${rule.what} and carries no \`${rule.marker}\` marker, so nothing holds it to ${rule.owner} — the rule can be rewritten in one file and left standing here`);
      continue;
    }
    if (found[0].body === null) {
      problems.push(`${path} opens \`${rule.marker}\` on line ${found[0].line} and never closes it, so there is nothing to compare`);
      continue;
    }
    if (found.length > 1) problems.push(`${path} marks \`${rule.marker}\` ${found.length} times, on lines ${found.map((one) => one.line).join(' and ')} — one marked sentence per file, so a repair knows which one it is rewriting`);
    if (found[0].body === source) continue;
    problems.push(`${path} line ${found[0].line} says "${found[0].body.trim()}" where ${rule.owner} says "${source.trim()}"`);
  }
  return problems;
}

/** `text` with its marked sentence rewritten from `source`, or null where there is nothing this can repair. Everything outside the markers is left byte for byte. */
export function repaired(text, marker, source) {
  const found = passages(text, marker);
  if (!found.length || found[0].body === null || found[0].body === source) return null;
  return text.slice(0, found[0].start) + source + text.slice(found[0].end);
}

/** Where a listed path is on disk. */
function pathOf(listed) {
  return listed.startsWith('../docs/') ? join(planTree(root), listed.slice('../docs/'.length)) : join(root, listed);
}

/** Read one listed file, or '' where it is not there — a missing file reads as a missing marker, which says the same thing. */
function read(listed) {
  try {
    return readFileSync(pathOf(listed), 'utf8');
  } catch {
    return '';
  }
}

const OWNER = "**<!-- shared-rule: rule -->One sentence.<!-- /shared-rule -->** And the build guide's own reason for it.";
const RULE = { marker: 'rule', what: 'the rule', owner: 'owner.md', copies: ['copy.md'] };

const CASES = [
  ['a copy whose marked sentence is the owner\'s', OWNER, 'The glossary defines the term. <!-- shared-rule: rule -->One sentence.<!-- /shared-rule -->', 0],
  ['a copy still carrying the sentence the owner replaced', OWNER, 'The glossary defines the term. <!-- shared-rule: rule -->Another sentence.<!-- /shared-rule -->', 1],
  ['a copy with no marker at all', OWNER, 'The glossary defines the term in its own words.', 1],
  ['a copy that opens the marker and never closes it', OWNER, '<!-- shared-rule: rule -->One sentence.', 1],
  ['a copy that marks the rule twice', OWNER, '<!-- shared-rule: rule -->One sentence.<!-- /shared-rule --> and again <!-- shared-rule: rule -->One sentence.<!-- /shared-rule -->', 1],
  ['an owner with no marker', '**One sentence.** And the reason.', 'The glossary defines the term. <!-- shared-rule: rule -->One sentence.<!-- /shared-rule -->', 1],
  ['an owner that opens the marker and never closes it', '<!-- shared-rule: rule -->One sentence.', 'The glossary defines the term. <!-- shared-rule: rule -->One sentence.<!-- /shared-rule -->', 1],
];

const problems = [];

if (process.argv.includes('--check')) {
  const wrong = [];
  for (const [name, ownerText, copyText, expected] of CASES) {
    const found = faults(RULE, ownerText, [{ path: 'copy.md', text: copyText }]);
    if (found.length !== expected) wrong.push(`the comparison reports ${found.length} faults on ${name} rather than ${expected}: ${found.join('; ') || 'nothing'}`);
  }
  // The drifted copy has to be named with the line it is on, or a reader has to hunt for it.
  const drifted = faults(RULE, OWNER, [{ path: 'copy.md', text: `A first line.\nThe glossary defines the term. <!-- shared-rule: rule -->Another sentence.<!-- /shared-rule -->` }]);
  if (!drifted[0]?.includes('copy.md line 2')) wrong.push(`the comparison found the drift and did not name the file and line: ${drifted[0] ?? 'nothing was reported'}`);
  if (!drifted[0]?.includes('Another sentence.') || !drifted[0]?.includes('One sentence.')) wrong.push(`the comparison named the file and did not say which sentence is which: ${drifted[0]}`);
  // A repair rewrites the sentence and nothing around it.
  const before = 'The glossary defines the term. <!-- shared-rule: rule -->Another sentence.<!-- /shared-rule --> Then its own last word.';
  const after = repaired(before, 'rule', 'One sentence.');
  if (after !== 'The glossary defines the term. <!-- shared-rule: rule -->One sentence.<!-- /shared-rule --> Then its own last word.') wrong.push(`a repair rewrote more than the marked sentence: ${after}`);
  if (repaired(after, 'rule', 'One sentence.') !== null) wrong.push('a repair offered to rewrite a copy that already says what its owner says');
  if (repaired('No marker here.', 'rule', 'One sentence.') !== null) wrong.push('a repair offered to write a sentence into a file with no markers, which would put it wherever the file happens to start');
  if (wrong.length) {
    console.error('the comparison is wrong, so nothing was read:');
    for (const fault of wrong) console.error(`  ${fault}`);
    process.exit(1);
  }
  console.log('comparison: refuses a drifted copy, a missing marker and an unclosed one, and repairs only the marked sentence');
}

if (process.argv.includes('--fix')) {
  let written = 0;
  const unfixable = [];
  for (const rule of RULES) {
    const owner = passages(read(rule.owner), rule.marker);
    if (!owner.length || owner[0].body === null) {
      unfixable.push(`${rule.owner} has no closed \`${rule.marker}\` marker to copy from`);
      continue;
    }
    for (const listed of rule.copies) {
      const text = read(listed);
      const fixed = repaired(text, rule.marker, owner[0].body);
      if (fixed === null) {
        if (!passages(text, rule.marker).length) unfixable.push(`${listed} has no \`${rule.marker}\` marker, so there is nowhere to write the sentence — put the markers around the sentence it already states`);
        continue;
      }
      writeFileSync(pathOf(listed), fixed);
      written += 1;
    }
  }
  console.log(`shared rules: ${written} copies rewritten from their owners`);
  if (unfixable.length) {
    for (const fault of unfixable) console.error(`  ${fault}`);
    process.exit(1);
  }
  process.exit(0);
}

let copies = 0;
for (const rule of RULES) {
  copies += rule.copies.length;
  problems.push(...faults(rule, read(rule.owner), rule.copies.map((listed) => ({ path: listed, text: read(listed) }))));
}

if (problems.length) {
  console.error('a rule written in more than one file no longer says the same thing in each:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('Change the rule in its owner, then carry it out: `node scripts/check-shared-rules.mjs --fix`.');
  process.exit(1);
}
console.log(`shared rules: ${count(RULES.length, 'rule', 'rules')}, ${count(copies, 'copy', 'copies')}, and every one says what its owner says`);
