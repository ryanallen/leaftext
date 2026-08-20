#!/usr/bin/env node
// Two files answer whether work takes a version number — the release skill's app-change list and the repo guide's version rule — and a path on one list only is a diff that releases or does not depending which got read first.
//
//   node scripts/check-version-rule.mjs           fail when the two paragraphs name different paths
//   node scripts/check-version-rule.mjs --check   self-test the comparison, then check the real files
//
// Only the backticked paths under the prefixes below are read. The two paragraphs say it in deliberately different sentences on purpose, so a check that compared wording would fail on the next honest rewrite of either one. `src/` and `installer/` are read as well as `scripts/` because the four test trees are carve-outs inside them, and a fifth reaching one paragraph and not the other is the drift this exists to catch. `wix/` is left out: nothing under it is compiled out, so the prefix would guard a list that cannot change.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const GUIDE = 'AGENTS.md';
const SKILL = '.agents/skills/git-release/SKILL.md';

// Each paragraph is found by the sentence it opens with, so a rewrite inside it is free and losing it is loud.
const GUIDE_ANCHOR = '**Only a change somebody running the app can meet gets a version and a tag.**';
const SKILL_ANCHOR = 'An app change is one that touches';

/** The paragraph opening with `anchor`, or null. */
export function paragraph(text, anchor) {
  return text.split(/\n\s*\n/).find((block) => block.trimStart().startsWith(anchor)) ?? null;
}

const PREFIXES = ['scripts/', 'src/', 'installer/'];

/** Every backticked path under one of `PREFIXES` the paragraph names, deduplicated. */
export function listedPaths(block) {
  const pattern = new RegExp(`\`((?:${PREFIXES.join('|')})[^\`]*)\``, 'g');
  return new Set([...block.matchAll(pattern)].map((m) => m[1]));
}

/** Faults in one pair of files, each naming what a reader would hit. */
export function faults(guideText, skillText) {
  const problems = [];
  const guide = paragraph(guideText, GUIDE_ANCHOR);
  const skill = paragraph(skillText, SKILL_ANCHOR);
  if (guide === null) problems.push(`${GUIDE} has no paragraph opening "${GUIDE_ANCHOR}", so the version rule this compares has been renamed or lost`);
  if (skill === null) problems.push(`${SKILL} has no paragraph opening "${SKILL_ANCHOR}", so the app-change list this compares has been renamed or lost`);
  if (guide === null || skill === null) return problems;
  const inGuide = listedPaths(guide);
  const inSkill = listedPaths(skill);
  for (const path of inSkill) if (!inGuide.has(path)) problems.push(`the app-change list in ${SKILL} names \`${path}\` and the version rule in ${GUIDE} does not, so a change to it releases or does not depending which file was read first`);
  for (const path of inGuide) if (!inSkill.has(path)) problems.push(`the version rule in ${GUIDE} names \`${path}\` and the app-change list in ${SKILL} does not, so a change to it releases or does not depending which file was read first`);
  return problems;
}

const AGREES = [
  `${GUIDE_ANCHOR} \`src/\` is the app. The machinery — the checks, every script under \`scripts/\` but one — takes no number. The one that is not machinery is \`scripts/build-windows-release.ps1\`.`,
  `${SKILL_ANCHOR} \`src/\`, \`wix/\`, \`scripts/build-windows-release.ps1\`. Everything else — every other script under \`scripts/\` — is site-only.`,
];
const DIFFERS = [
  `${GUIDE_ANCHOR} The machinery — the checks, \`scripts/\` — takes no number.`,
  AGREES[1],
];

// The four test trees are carve-outs inside `src/` and `installer/`, so both sides of these pairs name those two prefixes and only a missing tree differs.
const TREES_GUIDE = `${GUIDE_ANCHOR} \`src/\` and \`installer/\` are the app, and the four test trees inside them — \`src/tests/\`, \`src/app/tests.rs\`, \`src/store/tests.rs\` and \`installer/src/tests.rs\` — take no number.`;
const TREES_SKILL = `${SKILL_ANCHOR} \`src/\` and \`installer/\`, less \`src/tests/\`, \`src/app/tests.rs\`, \`src/store/tests.rs\` and \`installer/src/tests.rs\`.`;

const CASES = [
  ['a pair naming the same scripts', AGREES[0], AGREES[1], false],
  ['a pair where the guide is missing a script the skill names', DIFFERS[0], DIFFERS[1], true],
  ['a pair where the skill is missing a script the guide names', AGREES[0], DIFFERS[0].replace(GUIDE_ANCHOR, SKILL_ANCHOR), true],
  ['a pair naming the same four test trees', TREES_GUIDE, TREES_SKILL, false],
  ['a pair where the guide is missing a test tree the skill names', TREES_GUIDE.replace(', `src/store/tests.rs`', ''), TREES_SKILL, true],
  ['a pair where the skill is missing a test tree the guide names', TREES_GUIDE, TREES_SKILL.replace(' and `installer/src/tests.rs`', ''), true],
  ['a guide whose version rule has gone', 'Some other paragraph entirely.', AGREES[1], true],
  ['a skill whose app-change list has gone', AGREES[0], 'Some other paragraph entirely.', true],
];

const problems = [];
if (process.argv.includes('--check')) {
  for (const [name, guide, skill, shouldFail] of CASES) {
    const found = faults(guide, skill);
    if (shouldFail && !found.length) problems.push(`this check passes ${name}`);
    if (!shouldFail && found.length) problems.push(`this check refuses ${name}: ${found[0]}`);
  }
}

problems.push(...faults(readFileSync(join(root, GUIDE), 'utf8'), readFileSync(join(root, SKILL), 'utf8')));

if (problems.length) {
  console.error('the two places that answer whether work takes a version number disagree:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`version rule: ${GUIDE} and ${SKILL} name the same paths under ${PREFIXES.join(', ')}`);
