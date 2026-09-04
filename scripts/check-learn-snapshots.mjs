#!/usr/bin/env node
// What the two giveaway folders hold, and whether either still says what this repo says. Both are the same subject, so they are one file rather than two.
//
//   node scripts/check-learn-snapshots.mjs           fail on a drifted copy, or a system file nothing answers for (`just verify`)
//   node scripts/check-learn-snapshots.mjs --check   self-test both readings, then run them
//   node scripts/check-learn-snapshots.mjs --fix     rewrite every byte copy from its source
//
// The article's skill copies are byte-identical, because the article is evidence about this repository and a copy that reads better than its skill is the copy lying. `--fix` copies bytes so the copy stays exact.
//
// The other giveaway is not that. It is a system written to be dropped into any repository, so its ten skills are rewritten throughout — a human rather than an owner, no path, no script name — and two of them answer to a different name here. Held to the bytes, every one of them would fail for being correct. So it is answered for instead: a row per file saying which of three answers it is, the reason beside every row that is not compared, and the folder walked against the list rather than the list trusted. The download beside it is written from the system rows by bundle-giveaway.mjs and opened entry by entry in the gate.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planTree } from './plan-tree.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Source skills and their copies. */
const COPIES = join(planTree(root), 'learn', 'ticket-workflow-medium', 'skills');
const SOURCES = join(root, '.agents', 'skills');

/** Portable labels for diagnostics. */
const COPY_LABEL = '../docs/learn/ticket-workflow-medium/skills';
const SOURCE_LABEL = '.agents/skills';

/** First visible difference, or null for encoding-only drift. */
export function firstDifference(source, copy) {
  const left = source.toString('utf8').split('\n');
  const right = copy.toString('utf8').split('\n');
  for (let at = 0; at < Math.max(left.length, right.length); at += 1) {
    if (left[at] === right[at]) continue;
    let column = 0;
    while (left[at]?.[column] !== undefined && left[at][column] === right[at]?.[column]) column += 1;
    return { line: at + 1, column, source: left[at], copy: right[at] };
  }
  return null;
}

/** Quote the change rather than the shared opening. */
function excerpt(text, column) {
  if (text === undefined) return 'the file ends here';
  if (!text.trim()) return 'a blank line';
  const start = Math.max(0, column - 30);
  const end = start + 90;
  const lead = start > 0 ? '…' : '';
  const tail = end < text.length ? '…' : '';
  return `\`${lead}${text.slice(start, end).trim()}${tail}\``;
}

/** Mismatches, each named. */
export function snapshotProblemDetails(entries) {
  const problems = [];
  for (const { name, source, copy } of entries) {
    if (source === null) {
      problems.push({ name, message: `${COPY_LABEL}/${name}/SKILL.md is a copy of a skill this repo does not have — ${SOURCE_LABEL}/${name}/SKILL.md is not there. A retired or renamed skill leaves its copy behind saying the work is still done that way.` });
      continue;
    }
    if (copy === null) {
      problems.push({ name, message: `${COPY_LABEL}/${name}/ holds no SKILL.md, so the article cites a skill it carries no copy of.` });
      continue;
    }
    if (source.equals(copy)) continue;
    const at = firstDifference(source, copy);
    const where = at
      ? `first differs at line ${at.line}: the skill says ${excerpt(at.source, at.column)}, the copy says ${excerpt(at.copy, at.column)}`
      : 'differs in bytes the text does not show — the copy was saved in another encoding';
    problems.push({ name, message: `${COPY_LABEL}/${name}/SKILL.md has drifted from ${SOURCE_LABEL}/${name}/SKILL.md — ${where}` });
  }
  return problems;
}

/** Messages for each mismatched pair. */
export function snapshotProblems(entries) {
  return snapshotProblemDetails(entries).map((problem) => problem.message);
}

/** What a repair can write, and what it has no skill to write from. */
export function fixPlan(entries) {
  const writes = [];
  const unfixable = [];
  for (const entry of entries) {
    if (entry.source === null) unfixable.push(entry.name);
    else writes.push(entry);
  }
  return { writes, unfixable };
}

/** The giveaway system: a folder answered for file by file rather than compared. */
const SYSTEM = join(planTree(root), 'learn', 'ticket-workflow-linkedin');
const SYSTEM_LABEL = '../docs/learn/ticket-workflow-linkedin';

// Every file in that folder and which of three answers it is. `taken` is a byte copy of a skill here and is compared exactly. `rewritten` names the skill here it was written again from, and what is held is that the skill still exists: rename or retire one and the giveaway is teaching a job this repo no longer has. `own` is the giveaway's own writing, which this repo has no source for. **The reason column is what the table is for** — a file left out of the comparison with nothing beside it saying why is a decision nobody was asked to make.
export const SYSTEM_FILES = [
  ['AUDIT.md', 'own', 'the reading that produced the giveaway, about the giveaway'],
  ['README.md', 'own', 'the index for the giveaway folder and its owned writing'],
  ['ryans-product-team-template.zip', 'own', 'the packaged download, written from the system rows by bundle-giveaway.mjs'],
  ['system/DESIGN.md', 'own', 'the system explained to a stranger, in place of the design skill and the checks behind it'],
  ['system/GLOSSARY.md', 'own', 'the planning words, with no part of this app in them'],
  ['system/GUIDE.md', 'own', 'the guide a stranger starts from, holding none of the rules this repo paid for'],
  ['system/HOOKS.md', 'own', 'the hooks described rather than shipped, since none of these scripts travel'],
  ['system/README.md', 'own', 'how the system is used, and the file that told a stranger the wrong thing about a second session'],
  ['system/skills/README.md', 'own', 'the index for the rewritten skills in the giveaway'],
  ['system/skills/check/SKILL.md', 'rewritten', 'check'],
  ['system/skills/design/SKILL.md', 'rewritten', 'design'],
  ['system/skills/design-system/SKILL.md', 'rewritten', 'design-tokens'],
  ['system/skills/dev/SKILL.md', 'rewritten', 'dev'],
  ['system/skills/done/SKILL.md', 'rewritten', 'done'],
  ['system/skills/pm/SKILL.md', 'rewritten', 'pm'],
  ['system/skills/release/SKILL.md', 'rewritten', 'git-release'],
  ['system/skills/sync-docs/SKILL.md', 'rewritten', 'sync-docs'],
  ['system/skills/sync-tests/SKILL.md', 'rewritten', 'sync-tests'],
  ['system/skills/ticket/SKILL.md', 'rewritten', 'ticket'],
  ['system/templates/backlog-readme.md', 'own', 'the ticket index a stranger starts empty'],
  ['system/templates/README.md', 'own', 'the index for the giveaway templates'],
  ['system/templates/design/README.md', 'own', 'the index for the giveaway design templates'],
  ['system/templates/design/colors.md', 'own', 'a design file to start from, not this app'],
  ['system/templates/design/components.md', 'own', 'a design file to start from, not this app'],
  ['system/templates/design/icons.md', 'own', 'a design file to start from, not this app'],
  ['system/templates/design/theme.md', 'own', 'a design file to start from, not this app'],
  ['system/templates/design/tokens.md', 'own', 'a design file to start from, not this app'],
  ['system/templates/plan.md', 'own', 'the running order a stranger starts empty'],
  ['system/templates/ticket.md', 'own', 'the ticket shape, naming none of this repo own sections'],
  ['system/templates/tracks.md', 'own', 'the track list a stranger starts empty'],
];

/** Every file under a folder, as forward-slashed paths from it, sorted. A folder that is not there reads as empty, which the walk reports as every row naming nothing. */
export function filesUnder(dir, prefix = '') {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...filesUnder(join(dir, entry.name), path));
    else found.push(path);
  }
  return found.sort();
}

/** What is wrong with the giveaway system, each named. `read` answers bytes for a path in the system and for a skill here, so the self-test can hand it a tree of its own. */
export function systemProblems(rows, onDisk, read) {
  const problems = [];
  const named = new Set(rows.map(([path]) => path));
  for (const [path, answer, reason] of rows) {
    if (!onDisk.includes(path)) {
      problems.push(`${SYSTEM_LABEL}/${path} is named in the table and is not in the folder — a row naming no file is a row nothing reads.`);
      continue;
    }
    if (!reason) {
      problems.push(`${SYSTEM_LABEL}/${path} is \`${answer}\` with nothing beside it saying why — a file left out of the comparison is a decision somebody has to be able to read.`);
      continue;
    }
    if (answer === 'own') continue;
    const skill = read.skill(reason);
    if (skill === null) {
      problems.push(`${SYSTEM_LABEL}/${path} is written from the \`${reason}\` skill and ${SOURCE_LABEL}/${reason}/SKILL.md is not there — a renamed or retired skill leaves the giveaway teaching a job this repo no longer has.`);
      continue;
    }
    if (answer !== 'taken') continue;
    const copy = read.system(path);
    if (copy === null || !copy.equals(skill)) {
      problems.push(`${SYSTEM_LABEL}/${path} is a byte copy of the \`${reason}\` skill and no longer matches it — copy it again, or say in the table that it is a rewrite and why.`);
    }
  }
  for (const path of onDisk) {
    if (!named.has(path)) problems.push(`${SYSTEM_LABEL}/${path} is in the folder and in no row — say which of the three it is, and why, or nothing looks at it.`);
  }
  return problems;
}

/** Read bytes or return null. */
function bytesAt(path) {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

/** Read the skill-copy folders. */
function fromDisk() {
  return readdirSync(COPIES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      source: bytesAt(join(SOURCES, entry.name, 'SKILL.md')),
      copy: bytesAt(join(COPIES, entry.name, 'SKILL.md')),
    }));
}

/** The two trees the system reading asks about, off the disk. */
const onDisk = {
  system: (path) => bytesAt(join(SYSTEM, path)),
  skill: (name) => bytesAt(join(SOURCES, name, 'SKILL.md')),
};

function main() {
const entries = fromDisk();

if (process.argv.includes('--check')) {
  // Cover both refusals and the passing case.
  const faults = [];
  const bytes = (text) => Buffer.from(text, 'utf8');
  const same = snapshotProblems([{ name: 'dev', source: bytes('# Dev\n\nOne rule.\n'), copy: bytes('# Dev\n\nOne rule.\n') }]);
  if (same.length) faults.push('the comparison refused a copy that is its source, which is every copy on a good day');
  const drifted = snapshotProblems([{ name: 'dev', source: bytes('# Dev\n\nOne rule.\n'), copy: bytes('# Dev\n\nAnother rule.\n') }]);
  if (drifted.length !== 1) faults.push('the comparison let a copy through that says something its skill does not');
  else if (!drifted[0].includes('line 3')) faults.push(`the comparison found the drift but named the wrong line: ${drifted[0]}`);
  // The diagnostic must quote a late difference.
  const opening = 'the same opening words, '.repeat(6);
  const late = snapshotProblems([{ name: 'dev', source: bytes(`${opening}before\n`), copy: bytes(`${opening}after\n`) }]);
  if (late.length !== 1 || !late[0].includes('before') || !late[0].includes('after')) {
    faults.push(`the comparison quoted the openings rather than the change, so both sides read the same: ${late[0] ?? 'nothing was reported'}`);
  }
  const orphan = snapshotProblems([{ name: 'gone', source: null, copy: bytes('# Gone\n') }]);
  if (orphan.length !== 1) faults.push('the comparison let through a copy of a skill that does not exist, which is a retired skill still being taught');
  const missing = snapshotProblems([{ name: 'dev', source: bytes('# Dev\n'), copy: null }]);
  if (missing.length !== 1) faults.push('the comparison let through a skill the article carries no copy of');
  const plan = fixPlan([{ name: 'dev', source: bytes('new'), copy: bytes('old') }, { name: 'gone', source: null, copy: bytes('old') }]);
  if (plan.writes.map((entry) => entry.name).join() !== 'dev') faults.push('a fix did not offer to rewrite a drifted copy from its skill');
  if (plan.unfixable.join() !== 'gone') faults.push('a fix did not name the copy it has no skill to write from');
  if (faults.length) {
    console.error('the comparison is wrong, so nothing was read:');
    for (const fault of faults) console.error(`  ${fault}`);
    process.exit(1);
  }
  // The second reading, against a made-up system tree, so a fault is driven rather than waited for.
  const stand = {
    system: (path) => (path === 'a/SKILL.md' ? Buffer.from('one', 'utf8') : Buffer.from('x', 'utf8')),
    skill: (name) => (name === 'gone' ? null : Buffer.from('one', 'utf8')),
  };
  const held = [['a/SKILL.md', 'taken', 'dev'], ['b.md', 'own', 'the giveaway own writing']];
  const clean = systemProblems(held, ['a/SKILL.md', 'b.md'], stand);
  if (clean.length) faults.push(`the system reading refused a folder every row answers for: ${clean[0]}`);
  const rowless = systemProblems(held, ['a/SKILL.md', 'b.md', 'c.md'], stand);
  if (rowless.length !== 1 || !rowless[0].includes('c.md')) faults.push('the system reading let through a file no row names, which is the whole reason the folder is walked');
  const fileless = systemProblems([...held, ['d.md', 'own', 'nothing']], ['a/SKILL.md', 'b.md'], stand);
  if (fileless.length !== 1 || !fileless[0].includes('d.md')) faults.push('the system reading let through a row naming no file');
  const reasonless = systemProblems([['a/SKILL.md', 'taken', ''], ...held.slice(1)], ['a/SKILL.md', 'b.md'], stand);
  if (reasonless.length !== 1) faults.push('the system reading let through a row exempt from the comparison with no reason beside it');
  const retired = systemProblems([['a/SKILL.md', 'rewritten', 'gone'], ...held.slice(1)], ['a/SKILL.md', 'b.md'], stand);
  if (retired.length !== 1 || !retired[0].includes('gone')) faults.push('the system reading let through a rewrite of a skill this repo no longer has');
  const moved = systemProblems([['e/SKILL.md', 'taken', 'dev'], ...held.slice(1)], ['b.md', 'e/SKILL.md'], stand);
  if (moved.length !== 1 || !moved[0].includes('no longer matches')) faults.push('the system reading let a byte copy drift from its skill');
  if (faults.length) {
    console.error('the comparison is wrong, so nothing was read:');
    for (const fault of faults) console.error(`  ${fault}`);
    process.exit(1);
  }
  console.log('comparison: refuses a drifted copy and a copy of nothing, passes a copy that is its source');
  console.log('system: refuses a file no row names, a row naming no file, an exempt row with no reason, a rewrite of a retired skill, and a byte copy that drifted');
}

if (process.argv.includes('--fix')) {
  const plan = fixPlan(entries);
  let written = 0;
  for (const { name, source } of plan.writes) {
    // Preserve exact bytes.
    writeFileSync(join(COPIES, name, 'SKILL.md'), source);
    written += 1;
  }
  console.log(`learn snapshots: ${written} copies rewritten from their skills`);
  if (plan.unfixable.length) {
    console.error(`no skill to copy for: ${plan.unfixable.join(', ')} — retire the copy, or bring the skill back.`);
    process.exit(1);
  }
  process.exit(0);
}

const drifted = snapshotProblemDetails(entries);
if (drifted.length) {
  console.error('the workflow article is teaching a rule its skill no longer says:');
  for (const problem of drifted) console.error(`  ${problem.message}`);
  console.error('The copies are the reader\'s evidence, so a drifted pair is replaced from source rather than edited: `node scripts/check-learn-snapshots.mjs --fix`.');
  process.exit(1);
}

const unanswered = systemProblems(SYSTEM_FILES, filesUnder(SYSTEM), onDisk);
if (unanswered.length) {
  console.error('the giveaway system holds something nothing in this repo answers for:');
  for (const problem of unanswered) console.error(`  ${problem}`);
  console.error('Every file there is a byte copy of a skill here, a rewrite of one with the reason beside it, or the giveaway\'s own writing — say which in SYSTEM_FILES.');
  process.exit(1);
}
console.log(`learn snapshots: ${entries.length} copies, every one the skill it was taken from, and ${SYSTEM_FILES.length} giveaway-system files each answered for`);
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/')}`) main();
