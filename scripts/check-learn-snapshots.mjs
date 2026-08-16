#!/usr/bin/env node
// Keep workflow skill copies byte-identical so the article remains evidence.
//
//   node scripts/check-learn-snapshots.mjs           fail on a copy that differs (`just verify`)
//   node scripts/check-learn-snapshots.mjs --check   self-test the comparison, then check the copies
//   node scripts/check-learn-snapshots.mjs --fix     rewrite every copy from its source
//
// `--fix` copies bytes so the copy stays exact.

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
  console.log('comparison: refuses a drifted copy and a copy of nothing, passes a copy that is its source');
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
console.log(`learn snapshots: ${entries.length} copies, and every one is the skill it was taken from`);
