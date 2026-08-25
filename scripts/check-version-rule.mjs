#!/usr/bin/env node
// Two files answer whether work takes a version number — the release skill's app-change list and the repo guide's version rule — and a path on one list only is a diff that releases or does not depending which got read first.
//
//   node scripts/check-version-rule.mjs           fail when the two paragraphs name different paths, or disagree with what src/ compiles in out of site/
//   node scripts/check-version-rule.mjs --check   self-test both readings, then check the real files
//
// Only the backticked paths under the prefixes below are read. The two paragraphs say it in deliberately different sentences on purpose, so a check that compared wording would fail on the next honest rewrite of either one. `src/` and `installer/` are read as well as `scripts/` because the four test trees are carve-outs inside them, and a fifth reaching one paragraph and not the other is the drift this exists to catch. `site/` is read because one file under it — the minimap both published sites run — is compiled into the binary and carried by a page somebody exports, so the folder no longer answers itself and can grow a second such file; `wix/` is still left out, because nothing under it is compiled out at all, so the prefix would guard a list that cannot change.
//
// A `site/` path is read twice over: against the other paragraph, the way every prefix is, and against the code. Every `include_str!`/`include_bytes!` under `src/` naming a file in `site/` must be named in both paragraphs, or a file ships in an installer with both answers defensible from the guide as written; and a `site/` path the paragraphs name must be one something actually compiles in, or a stale name makes a website-only edit cut a release identical to the last.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
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

const PREFIXES = ['scripts/', 'src/', 'installer/', 'site/'];

/** Every backticked path under one of `PREFIXES` the paragraph names, deduplicated. */
export function listedPaths(block) {
  const pattern = new RegExp(`\`((?:${PREFIXES.join('|')})[^\`]*)\``, 'g');
  return new Set([...block.matchAll(pattern)].map((m) => m[1]));
}

/** Every `site/` file one Rust source compiles in, resolved from the folder holding the include. */
export function compiledSitePaths(rustFile, source) {
  const from = dirname(rustFile);
  const found = new Set();
  for (const m of source.matchAll(/include_(?:str|bytes)!\s*\(\s*"([^"]+)"/g)) {
    const path = join(from, m[1]).split(sep).join('/');
    if (path.startsWith('site/')) found.add(path);
  }
  return found;
}

/** Every `site/` file compiled into the binary, across the whole of `src/`. */
export function compiledFromSite() {
  const found = new Set();
  const walk = (folder) => {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.rs')) for (const site of compiledSitePaths(path, readFileSync(join(root, path), 'utf8'))) found.add(site);
    }
  };
  walk('src');
  return found;
}

/** Faults in one pair of files read against one set of compiled `site/` paths, each naming what a reader would hit. */
export function faults(guideText, skillText, compiled = new Set()) {
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
  for (const path of compiled) {
    if (!inGuide.has(path)) problems.push(`\`${path}\` is compiled into the binary out of src/ and the version rule in ${GUIDE} does not name it, so an edit to it reads as website-only and ships in an installer nobody announced`);
    if (!inSkill.has(path)) problems.push(`\`${path}\` is compiled into the binary out of src/ and the app-change list in ${SKILL} does not name it, so an edit to it reads as website-only and ships in an installer nobody announced`);
  }
  for (const path of new Set([...inGuide, ...inSkill])) if (path.startsWith('site/') && !compiled.has(path)) problems.push(`\`${path}\` is named as app code and nothing under src/ compiles it in, so a website-only edit reads as an app change and cuts a release identical to the last`);
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
const TREES_GUIDE = `${GUIDE_ANCHOR} \`src/\` and \`installer/\` are the app, and the four test trees inside them — \`src/tests/\`, \`src/app/tests/\`, \`src/store/tests.rs\` and \`installer/src/tests.rs\` — take no number.`;
const TREES_SKILL = `${SKILL_ANCHOR} \`src/\` and \`installer/\`, less \`src/tests/\`, \`src/app/tests/\`, \`src/store/tests.rs\` and \`installer/src/tests.rs\`.`;

// A `site/` pair is read against the compiled set as well as against the other paragraph, which is the second reading no other prefix gets.
const SITE_GUIDE = `${GUIDE_ANCHOR} \`src/\` is the app, and \`site/minimap.js\` with it, because it is compiled into the binary.`;
const SITE_SKILL = `${SKILL_ANCHOR} \`src/\` and \`site/minimap.js\`.`;
const BARE_GUIDE = `${GUIDE_ANCHOR} \`src/\` is the app.`;
const BARE_SKILL = `${SKILL_ANCHOR} \`src/\`.`;
const SITE_COMPILED = new Set(['site/minimap.js']);

const CASES = [
  ['a pair naming the same scripts', AGREES[0], AGREES[1], false],
  ['a pair where the guide is missing a script the skill names', DIFFERS[0], DIFFERS[1], true],
  ['a pair where the skill is missing a script the guide names', AGREES[0], DIFFERS[0].replace(GUIDE_ANCHOR, SKILL_ANCHOR), true],
  ['a pair naming the same four test trees', TREES_GUIDE, TREES_SKILL, false],
  ['a pair where the guide is missing a test tree the skill names', TREES_GUIDE.replace(', `src/store/tests.rs`', ''), TREES_SKILL, true],
  ['a pair where the skill is missing a test tree the guide names', TREES_GUIDE, TREES_SKILL.replace(' and `installer/src/tests.rs`', ''), true],
  ['a guide whose version rule has gone', 'Some other paragraph entirely.', AGREES[1], true],
  ['a skill whose app-change list has gone', AGREES[0], 'Some other paragraph entirely.', true],
  ['a pair naming the site file the binary compiles in', SITE_GUIDE, SITE_SKILL, false, SITE_COMPILED],
  ['a pair where the guide is missing the site file the skill names', BARE_GUIDE, SITE_SKILL, true, SITE_COMPILED],
  ['a pair where the skill is missing the site file the guide names', SITE_GUIDE, BARE_SKILL, true, SITE_COMPILED],
  ['a compiled site file neither paragraph names', BARE_GUIDE, BARE_SKILL, true, SITE_COMPILED, 'site/minimap.js'],
  ['a site file both paragraphs name that nothing compiles in', SITE_GUIDE, SITE_SKILL, true, new Set(), 'site/minimap.js'],
];

// The include scan is the fragile half — a path is matched out of Rust and then resolved from the file holding it, so both halves are pinned.
const SCANS = [
  ['an include of the site minimap', 'src/assets.rs', 'pub(crate) const SITE_MINIMAP_JS: &str = include_str!("../site/minimap.js");', ['site/minimap.js']],
  ['an include of bytes out of the site', 'src/assets.rs', 'const A: &[u8] = include_bytes!("../site/logo.png");', ['site/logo.png']],
  ['an include from a folder deeper in the tree', 'src/web/mod.rs', 'const A: &str = include_str!("../../site/minimap.js");', ['site/minimap.js']],
  ['an include of something that is not a site file', 'src/assets.rs', 'const A: &str = include_str!("assets/tokens.css");', []],
];

const problems = [];
if (process.argv.includes('--check')) {
  for (const [name, guide, skill, shouldFail, compiled = new Set(), mustName = null] of CASES) {
    const found = faults(guide, skill, compiled);
    if (shouldFail && !found.length) problems.push(`this check passes ${name}`);
    if (!shouldFail && found.length) problems.push(`this check refuses ${name}: ${found[0]}`);
    if (mustName && !found.some((problem) => problem.includes(mustName))) problems.push(`this check refuses ${name} without naming \`${mustName}\`, so a reader is told a file is on the wrong side of the line and not which one`);
  }
  for (const [name, file, source, expected] of SCANS) {
    const found = [...compiledSitePaths(file, source)].sort();
    if (found.join() !== [...expected].sort().join()) problems.push(`this check reads ${name} as ${found.length ? found.join(', ') : 'nothing'} rather than ${expected.length ? expected.join(', ') : 'nothing'}`);
  }
}

problems.push(...faults(readFileSync(join(root, GUIDE), 'utf8'), readFileSync(join(root, SKILL), 'utf8'), compiledFromSite()));

if (problems.length) {
  console.error('the two places that answer whether work takes a version number disagree:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`version rule: ${GUIDE} and ${SKILL} name the same paths under ${PREFIXES.join(', ')}, and every site file compiled into the binary is on both`);
