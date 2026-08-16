#!/usr/bin/env node
// Keep workflow skill copies byte-identical so the article remains evidence.
//
//   node scripts/check-learn-snapshots.mjs           fail on a copy that differs (`just verify`)
//   node scripts/check-learn-snapshots.mjs --check   self-test the comparison, then check the copies
//   node scripts/check-learn-snapshots.mjs --fix     rewrite every copy from its source
//
// `--fix` copies bytes so the copy stays exact.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isManaged, manifests, planTree, workspaceParent } from './agent-workspace.mjs';

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

/** Mismatches with names for workspace-holder lookup. */
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

/** Classify a mismatch as cut, held, or drifted. */
export function pairState({ managed, sourceTouched, copyTouched, heldBy = '' }) {
  if (heldBy) return 'held';
  if (managed) return !sourceTouched && !copyTouched ? 'cut' : 'drifted';
  return 'drifted';
}

/** Keep nonblocking cut and held mismatches visible. */
export function splitProblems(problems, states) {
  const cut = [];
  const held = [];
  const drifted = [];
  for (const problem of problems) {
    const state = states.get(problem.name);
    (state === 'cut' ? cut : state === 'held' ? held : drifted).push(problem);
  }
  return { cut, held, drifted };
}

/** Find the workspace whose named skill matches the copy bytes. */
export function heldBySession(name, copy, records, read) {
  if (!copy) return '';
  for (const record of records) {
    if (!record.session || !record.app) continue;
    const skill = read(join(record.app, '.agents', 'skills', name, 'SKILL.md'));
    if (skill && skill.equals(copy)) return record.session;
  }
  return '';
}

/** Plan repairs without overwriting cut or held copies. */
export function fixPlan(entries, states) {
  const writes = [];
  const skipped = [];
  const held = [];
  const unfixable = [];
  for (const entry of entries) {
    const state = states.get(entry.name);
    if (state === 'cut') {
      skipped.push(entry.name);
    } else if (state === 'held') {
      held.push(entry.name);
    } else if (entry.source === null) {
      unfixable.push(entry.name);
    } else {
      writes.push(entry);
    }
  }
  return { writes, skipped, held, unfixable };
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

/** Ask git whether this checkout changed one half. */
function touched(dir, path) {
  try {
    return execFileSync('git', ['-C', dir, 'status', '--porcelain', '--', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).length > 0;
  } catch {
    return true;
  }
}

/** Find mismatch states after byte comparison. */
function pairStates(problems, entries) {
  const managed = isManaged(root);
  const records = manifests(workspaceParent());
  const copies = new Map(entries.map((entry) => [entry.name, entry.copy]));
  const states = new Map();
  const holders = new Map();
  const changedSources = new Set();
  for (const { name } of problems) {
    const sourceTouched = managed && touched(root, join('.agents', 'skills', name, 'SKILL.md'));
    const heldBy = heldBySession(name, copies.get(name), records, bytesAt);
    if (sourceTouched) changedSources.add(name);
    states.set(name, pairState({
      managed,
      sourceTouched,
      copyTouched: managed && touched(COPIES, join(name, 'SKILL.md')),
      heldBy,
    }));
    if (heldBy) holders.set(name, heldBy);
  }
  return { states, holders, changedSources };
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
  const mismatch = snapshotProblemDetails([{ name: 'dev', source: bytes('# Dev\n\nOne rule.\n'), copy: bytes('# Dev\n\nAnother rule.\n') }]);
  const primary = splitProblems(mismatch, new Map([['dev', pairState({ managed: false, sourceTouched: false, copyTouched: false })]]));
  if (primary.cut.length || primary.drifted.length !== 1) faults.push('a primary checkout did not fail on a mismatch');
  const cut = splitProblems(mismatch, new Map([['dev', pairState({ managed: true, sourceTouched: false, copyTouched: false })]]));
  if (cut.cut.length !== 1 || cut.drifted.length) faults.push('a pair cut across a primary edit still stopped its session');
  const touchedPair = splitProblems(mismatch, new Map([['dev', pairState({ managed: true, sourceTouched: true, copyTouched: false })]]));
  if (touchedPair.cut.length || touchedPair.drifted.length !== 1) faults.push('a mismatch this session touched did not fail');
  const heldWorkspace = pairState({ managed: true, sourceTouched: false, copyTouched: false, heldBy: 'aaaaaaaa' });
  if (heldWorkspace !== 'held') faults.push('a workspace did not name a copy another session holds as held');
  const heldTouchedWorkspace = pairState({ managed: true, sourceTouched: true, copyTouched: false, heldBy: 'aaaaaaaa' });
  if (heldTouchedWorkspace !== 'held') faults.push('a workspace let its own changed skill hide the session holding the copy');
  // A primary must identify a workspace's newer rule.
  const heldPair = splitProblems(mismatch, new Map([['dev', pairState({ managed: false, sourceTouched: false, copyTouched: false, heldBy: 'aaaaaaaa' })]]));
  if (heldPair.held.length !== 1 || heldPair.drifted.length || heldPair.cut.length) faults.push('a copy holding a session\'s newer skill still stopped the primary gate');
  const handEdit = splitProblems(mismatch, new Map([['dev', pairState({ managed: false, sourceTouched: false, copyTouched: false, heldBy: '' })]]));
  if (handEdit.drifted.length !== 1 || handEdit.held.length) faults.push('a copy edited in the plan tree alone was let past the primary gate');
  // Matches use the named skill path from each workspace record.
  const newer = bytes('# Dev\n\nAnother rule.\n');
  const records = [{ session: 'aaaaaaaa', app: join('/private', 'aaaaaaaa', 'leaftext', 'app') }, { session: 'bbbbbbbb', app: join('/private', 'bbbbbbbb', 'leaftext', 'app') }];
  const skills = new Map([[join(records[1].app, '.agents', 'skills', 'dev', 'SKILL.md'), newer]]);
  const reader = (path) => skills.get(path) ?? null;
  if (heldBySession('dev', newer, records, reader) !== 'bbbbbbbb') faults.push('the session whose copy holds the newer skill was not found');
  if (heldBySession('dev', bytes('# Dev\n\nA third rule.\n'), records, reader) !== '') faults.push('a copy no session\'s skill matches was named as held anyway');
  if (heldBySession('check', newer, records, reader) !== '') faults.push('a skill one session changed was read as holding a different skill\'s copy');
  if (heldBySession('dev', null, records, reader) !== '') faults.push('a copy that is not there was read as held by a session');
  const both = splitProblems([...mismatch, { name: 'check', message: 'check drifted' }], new Map([['dev', 'cut'], ['check', 'drifted']]));
  if (both.cut.map((problem) => problem.name).join() !== 'dev' || both.drifted.map((problem) => problem.name).join() !== 'check') faults.push('a mixed run did not keep a cut pair separate from a drifted one');
  const three = [{ name: 'dev', source: bytes('new'), copy: bytes('old') }, { name: 'check', source: bytes('new'), copy: bytes('old') }, { name: 'ticket', source: bytes('older'), copy: bytes('newer') }];
  const fixed = fixPlan(three, new Map([['dev', 'cut'], ['check', 'drifted'], ['ticket', 'held']]));
  if (fixed.skipped.join() !== 'dev' || fixed.writes.map((entry) => entry.name).join() !== 'check') faults.push('a fix did not leave a cut pair alone while repairing a drifted one');
  // Repair must never overwrite a newer held copy.
  if (fixed.held.join() !== 'ticket') faults.push('a fix did not name the copy it left to the session holding the newer skill');
  if (fixed.writes.some((entry) => entry.name === 'ticket')) faults.push('a fix wrote the older skill back over a copy a session is holding');
  const managedFixed = fixPlan([{ name: 'dev', source: bytes('older'), copy: bytes('newer') }], new Map([['dev', heldTouchedWorkspace]]));
  if (managedFixed.held.join() !== 'dev' || managedFixed.writes.length) faults.push('a workspace repair did not leave a pair another session holds alone');
  if (faults.length) {
    console.error('the comparison is wrong, so nothing was read:');
    for (const fault of faults) console.error(`  ${fault}`);
    process.exit(1);
  }
  console.log('comparison: refuses a drifted copy and a copy of nothing, passes a copy that is its source');
}

if (process.argv.includes('--fix')) {
  const problems = snapshotProblemDetails(entries);
  const { states, holders } = pairStates(problems, entries);
  const plan = fixPlan(entries, states);
  let written = 0;
  for (const { name, source } of plan.writes) {
    // Preserve exact bytes.
    writeFileSync(join(COPIES, name, 'SKILL.md'), source);
    written += 1;
  }
  console.log(`learn snapshots: ${written} copies rewritten from their skills`);
  if (plan.skipped.length) console.log(`learn snapshots: left ${plan.skipped.join(', ')} alone because this workspace was cut across an edit uncommitted in the primary`);
  for (const name of plan.held) console.log(`learn snapshots: left ${name} alone — its copy is already what ${holders.get(name)} has that skill saying in its own copy, and rewriting it from the skill here would take that session's work back out`);
  if (plan.unfixable.length) {
    console.error(`no skill to copy for: ${plan.unfixable.join(', ')} — retire the copy, or bring the skill back.`);
    process.exit(1);
  }
  process.exit(0);
}

const details = snapshotProblemDetails(entries);
const { states, holders, changedSources } = pairStates(details, entries);
const { cut, held, drifted } = splitProblems(details, states);
for (const problem of cut) console.log(`${problem.message}\n  This workspace was cut across an edit uncommitted in the primary, and neither half was touched here. Fix it in the primary checkout; this session leaves the pair alone.`);
// Passing held pairs still name the newer rule.
for (const problem of held) {
  const waiting = changedSources.has(problem.name) ? ' This checkout also changes that skill, and its change is not in the article yet.' : '';
  console.log(`${problem.message}\n  ${holders.get(problem.name)} is changing that skill in its own copy, and the copy here is already exactly what that session's skill says.${waiting} This checkout leaves the pair alone; it settles when that work is handed over.`);
}
if (drifted.length) {
  console.error('the workflow article is teaching a rule its skill no longer says:');
  for (const problem of drifted) console.error(`  ${problem.message}`);
  console.error('The copies are the reader\'s evidence, so the pairs this copy changed are replaced from source rather than edited: `node scripts/check-learn-snapshots.mjs --fix`.');
  process.exit(1);
}
console.log(`learn snapshots: ${entries.length} copies, and every pair this checkout owns is the skill it was taken from`);
