#!/usr/bin/env node
// The shareable workflow article carries an exact copy of every skill it cites, so a reader handed the folder can hold what the article says against the rule itself. The copy is the evidence, which is why it has to be the same file: a copy that has drifted is the article describing a workflow nobody runs, and nothing in the package tells the reader which half is current. All ten had drifted by August 2026 — the `dev` copy was half its source, missing the seven steps the skill is now written as.
//
//   node scripts/check-learn-snapshots.mjs           fail on a copy that differs (`just verify`)
//   node scripts/check-learn-snapshots.mjs --check   self-test the comparison, then check the copies
//   node scripts/check-learn-snapshots.mjs --fix     rewrite every copy from its source
//
// A check with no way to fix what it names is one somebody works around, so `--fix` is here rather than in a second script. It copies bytes, never decoded text, because the copy has to be the source and a re-encoded file is a second thing that looks like one.
//
// The package's own guide already says a copy is replaced from its source rather than edited (`docs/learn/ticket-workflow-medium/AGENTS.md`, "Source and updates"). This enforces a written rule; it does not invent one.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the copies live, and where each one was taken from. Both hold one folder per skill, holding one `SKILL.md`. */
const COPIES = join(root, '..', 'docs', 'learn', 'ticket-workflow-medium', 'skills');
const SOURCES = join(root, '.agents', 'skills');

/** How each side reads in a message, so a failure names a path somebody can open rather than an absolute one off this machine. */
const COPY_LABEL = '../docs/learn/ticket-workflow-medium/skills';
const SOURCE_LABEL = '.agents/skills';

/** The first line the two disagree on, and where in it, or null where the bytes differ and every line decodes the same — a byte-order mark, or an encoding the copy was saved in. */
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

/** A line as it reads in a message: a window around the word the two disagree on rather than the start of the line, because both sides of a one-word change open the same way and quoting their openings twice says nothing. */
function excerpt(text, column) {
  if (text === undefined) return 'the file ends here';
  if (!text.trim()) return 'a blank line';
  const start = Math.max(0, column - 30);
  const end = start + 90;
  const lead = start > 0 ? '…' : '';
  const tail = end < text.length ? '…' : '';
  return `\`${lead}${text.slice(start, end).trim()}${tail}\``;
}

/** Every pair that is not what it claims to be. Each entry is one skill folder, with the bytes on each side or null where that file is not there. */
export function snapshotProblems(entries) {
  const problems = [];
  for (const { name, source, copy } of entries) {
    if (source === null) {
      problems.push(
        `${COPY_LABEL}/${name}/SKILL.md is a copy of a skill this repo does not have — ${SOURCE_LABEL}/${name}/SKILL.md is not there. A retired or renamed skill leaves its copy behind saying the work is still done that way.`
      );
      continue;
    }
    if (copy === null) {
      problems.push(`${COPY_LABEL}/${name}/ holds no SKILL.md, so the article cites a skill it carries no copy of.`);
      continue;
    }
    if (source.equals(copy)) continue;
    const at = firstDifference(source, copy);
    const where = at
      ? `first differs at line ${at.line}: the skill says ${excerpt(at.source, at.column)}, the copy says ${excerpt(at.copy, at.column)}`
      : 'differs in bytes the text does not show — the copy was saved in another encoding';
    problems.push(`${COPY_LABEL}/${name}/SKILL.md has drifted from ${SOURCE_LABEL}/${name}/SKILL.md — ${where}`);
  }
  return problems;
}

/** One entry per folder under the copies, read off the disk. A folder is the unit because that is what both sides are laid out as. */
function fromDisk() {
  const bytes = (path) => {
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  };
  return readdirSync(COPIES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      source: bytes(join(SOURCES, entry.name, 'SKILL.md')),
      copy: bytes(join(COPIES, entry.name, 'SKILL.md')),
    }));
}

const entries = fromDisk();

if (process.argv.includes('--check')) {
  // A check that cannot fail is not a check: the three things it exists to refuse, and the one it has to let through.
  const faults = [];
  const bytes = (text) => Buffer.from(text, 'utf8');
  const same = snapshotProblems([{ name: 'dev', source: bytes('# Dev\n\nOne rule.\n'), copy: bytes('# Dev\n\nOne rule.\n') }]);
  if (same.length) faults.push('the comparison refused a copy that is its source, which is every copy on a good day');
  const drifted = snapshotProblems([{ name: 'dev', source: bytes('# Dev\n\nOne rule.\n'), copy: bytes('# Dev\n\nAnother rule.\n') }]);
  if (drifted.length !== 1) faults.push('the comparison let a copy through that says something its skill does not');
  else if (!drifted[0].includes('line 3')) faults.push(`the comparison found the drift but named the wrong line: ${drifted[0]}`);
  // A skill file is long lines, so a one-word change sits well past where a quote from the start of the line would stop. Both sides then read the same and the message says nothing.
  const opening = 'the same opening words, '.repeat(6);
  const late = snapshotProblems([{ name: 'dev', source: bytes(`${opening}before\n`), copy: bytes(`${opening}after\n`) }]);
  if (late.length !== 1 || !late[0].includes('before') || !late[0].includes('after')) {
    faults.push(`the comparison quoted the openings rather than the change, so both sides read the same: ${late[0] ?? 'nothing was reported'}`);
  }
  const orphan = snapshotProblems([{ name: 'gone', source: null, copy: bytes('# Gone\n') }]);
  if (orphan.length !== 1) faults.push('the comparison let through a copy of a skill that does not exist, which is a retired skill still being taught');
  if (faults.length) {
    console.error('the comparison is wrong, so nothing was read:');
    for (const fault of faults) console.error(`  ${fault}`);
    process.exit(1);
  }
  console.log('comparison: refuses a drifted copy and a copy of nothing, passes a copy that is its source');
}

if (process.argv.includes('--fix')) {
  let written = 0;
  const unfixable = [];
  for (const { name, source } of entries) {
    if (source === null) {
      unfixable.push(name);
      continue;
    }
    // Bytes, never decoded text: the copy has to be the source, and a re-encoded file only looks like one.
    writeFileSync(join(COPIES, name, 'SKILL.md'), source);
    written += 1;
  }
  console.log(`learn snapshots: ${written} copies rewritten from their skills`);
  if (unfixable.length) {
    console.error(`no skill to copy for: ${unfixable.join(', ')} — retire the copy, or bring the skill back.`);
    process.exit(1);
  }
  process.exit(0);
}

const problems = snapshotProblems(entries);
if (problems.length) {
  console.error('the workflow article is teaching a rule its skill no longer says:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('The copies are the reader\'s evidence, so they are replaced from source rather than edited: `node scripts/check-learn-snapshots.mjs --fix`.');
  process.exit(1);
}
console.log(`learn snapshots: ${entries.length} copies, and every one is the skill it was taken from`);
