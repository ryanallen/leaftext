#!/usr/bin/env node
// PreToolUse and PostToolUse hooks. Write down every file this session changes, so a release can stage its own work and leave another session's alone.
//
//   node scripts/gate-touched.mjs --before  the shell command's PreToolUse payload on stdin
//   node scripts/gate-touched.mjs --after   its PostToolUse payload on stdin
//   node scripts/gate-touched.mjs --check   self-test (`just verify`)
//
// A release stages what is dirty in the checkout by name, and two agents share this checkout on an ordinary morning — so v1.21.2 published eighty-five lines of measuring code a second session was mid-experiment on, and v1.21.5 carried a whole second ticket under a commit message naming a different one. Nothing in the gate could have caught either: they compiled, they broke no test, and a gate proves a tree is correct rather than wanted. The missing fact was who wrote a file, and this event already carries it — `session_id`, `tool_name` and `tool_input` arrive together, which is the same payload the git gate already reads.
//
// Nothing here refuses and nothing waits. A release that stopped while somebody else was typing is a release that never runs; `scripts/prepare-release.mts` subtracts this record from what is dirty and commits the rest.
//
// Edit tools name their file directly. Shell commands get their dirty paths before and after they run. Files the release itself generates are still unclaimed, because the release runner is not a shell tool call.
//
// One file per session in the OS temp folder, beside the keycode record and the turn checklist, swept on the same 24-hour window. A stale entry costs nothing: a path that has been committed is not dirty, so it is not in the list being subtracted from.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { keep, sessionOf, sessionTag, sweep } from './hook-payload.mjs';
import { dirtyPaths } from './plan-tree.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/// What every record of this kind is named with, and what the sweep and the release both look for.
export const TOUCHED = 'leaftext-touched-';
export const SHELL_TOOLS = /^(bash|powershell|shell)$/i;
const BEFORE = 'leaftext-before-touched-';

/// The tools that write a file. A name outside this list touches nothing on disk, so it has nothing to record — the settings row narrows it as well, and this is the half that holds if the row is ever widened.
export const EDIT_TOOLS = /^(write|edit|multiedit|notebookedit)$/i;

/// One file per session: two agents work this checkout at once, and a single file naming a session is overwritten by the other agent's very next edit. '' when there is no session id at all — nothing is written then, and the release stages everything dirty, which is what it does today.
export function touchedPath(session, dir = tmpdir()) {
  const tag = sessionTag(session ?? sessionOf(''));
  return tag ? join(dir, `${TOUCHED}${tag}.json`) : '';
}

/// One shell command's before state. The tool call id distinguishes parallel commands in one session.
export function beforePath(session, toolUseId, dir = tmpdir()) {
  const tag = sessionTag(session ?? sessionOf(''));
  const call = sessionTag(toolUseId);
  return tag && call ? join(dir, `${BEFORE}${tag}-${call}.json`) : '';
}

/// A path inside this checkout, written the way `git status --porcelain` writes one. Anything outside is dropped rather than recorded: the plan tree next door is a different repository, and a release stages only this one.
export function repoRelative(file, from = root) {
  const named = String(file ?? '').trim();
  if (!named) return null;
  const rel = relative(from, resolve(from, named)).split(sep).join('/');
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return null;
  return rel;
}

function pathsIn(record) {
  try {
    const held = JSON.parse(readFileSync(record, 'utf8'));
    return Array.isArray(held?.paths) ? held.paths.filter((path) => typeof path === 'string' && path) : [];
  } catch {
    return [];
  }
}

/// Add one path to this session's record, keeping what is already there. A turn edits the same file a dozen times and a record that replaced rather than added would remember only the last one.
export function record(file, session, dir = tmpdir(), from = root) {
  const path = touchedPath(session, dir);
  if (!path) return null;
  const rel = repoRelative(file, from);
  if (!rel) return null;
  const paths = pathsIn(path);
  if (!paths.includes(rel)) paths.push(rel);
  writeFileSync(path, JSON.stringify({ session: sessionTag(session), paths }) + '\n');
  return rel;
}

/// Keep one shell command's dirty paths until its result arrives.
export function snapshotBefore(session, toolUseId, dir = tmpdir(), from = root, paths = dirtyPaths(from)) {
  const path = beforePath(session, toolUseId, dir);
  if (!path) return null;
  writeFileSync(path, JSON.stringify({ paths }) + '\n');
  return path;
}

/// Add only paths that became dirty while one shell command ran, then forget its snapshot.
export function recordAfter(session, toolUseId, dir = tmpdir(), from = root, paths = dirtyPaths(from)) {
  const path = beforePath(session, toolUseId, dir);
  if (!path) return [];
  const before = pathsIn(path);
  rmSync(path, { force: true });
  return paths.filter((file) => !before.includes(file)).filter((file) => record(file, session, dir, from));
}

/// What one session has edited.
export function touchedBy(session, dir = tmpdir()) {
  const path = touchedPath(session, dir);
  return path ? pathsIn(path) : [];
}

/// What every *other* session has edited, each under the session it belongs to. **No session id answers nothing**, because a run that cannot tell its own record from anybody else's would subtract its own work: a host that changed shape must not start dropping files, and staging everything dirty is what happens today.
export function othersTouched(mine, dir = tmpdir()) {
  const tag = sessionTag(mine ?? '');
  if (!tag) return [];
  const found = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(TOUCHED) || !name.endsWith('.json')) continue;
      const session = name.slice(TOUCHED.length, -'.json'.length);
      if (!session || session === tag) continue;
      const paths = pathsIn(join(dir, name));
      if (paths.length) found.push({ session, paths });
    }
  } catch {
    // No temp folder to read is nobody else working, which stages everything dirty exactly as it does today.
  }
  return found;
}

function selfTest() {
  const fails = [];
  const ONE = 'aaaaaaaa-1111-1111-1111-111111111111';
  const TWO = 'bbbbbbbb-2222-2222-2222-222222222222';
  const THREE = 'cccccccc-3333-3333-3333-333333333333';
  const CALL = 'toolu-11111111111111111111111111111111';

  // A folder of its own, so nothing here reads or writes a live session's record. The name is the OS's, which is what keeps two runs of the gate off each other.
  const dir = mkdtempSync(join(tmpdir(), 'leaftext-touchtest-'));
  try {
    if (touchedPath(ONE, dir) === touchedPath(TWO, dir)) fails.push('two sessions share one record');
    if (touchedPath('', dir) !== '') fails.push('no session id still named a file to write');

    // Inside the checkout, however the path arrives.
    if (repoRelative(join(root, 'src', 'lib.rs')) !== 'src/lib.rs') fails.push('a path inside the checkout was not made repo-relative');
    if (repoRelative('src/lib.rs') !== 'src/lib.rs') fails.push('a path already relative to the checkout was dropped');
    if (repoRelative(join(root, 'scripts', '..', 'Cargo.toml')) !== 'Cargo.toml') fails.push('a path with a step back in it was not resolved');
    // Outside it: the plan tree is a different repository and the release stages only this one.
    if (repoRelative(join(root, '..', 'docs', 'README.md')) !== null) fails.push('a path outside the checkout was recorded');
    if (repoRelative(join(root, '..', '..', 'elsewhere.md')) !== null) fails.push('a path well outside the checkout was recorded');
    if (repoRelative('') !== null || repoRelative(null) !== null) fails.push('an empty path was read as a file');
    if (repoRelative(root) !== null) fails.push('the checkout itself was recorded as a file');

    // The record adds rather than replaces: a turn edits one file many times and only the last would survive otherwise.
    if (record(join(root, 'src', 'lib.rs'), ONE, dir) !== 'src/lib.rs') fails.push('an edit inside the checkout was not recorded');
    record(join(root, 'Cargo.toml'), ONE, dir);
    record(join(root, 'src', 'lib.rs'), ONE, dir);
    const mine = touchedBy(ONE, dir);
    if (mine.join(' ') !== 'src/lib.rs Cargo.toml') fails.push(`a record answered ${mine.join(' ') || 'nothing'} rather than both paths once each`);
    if (record(join(root, '..', 'docs', 'README.md'), ONE, dir) !== null) fails.push('an edit outside the checkout was recorded');
    if (touchedBy(ONE, dir).length !== 2) fails.push('an edit outside the checkout still grew the record');
    if (record(join(root, 'src', 'lib.rs'), '', dir) !== null) fails.push('an edit with no session id was written down anyway');

    // The other half: whose work is not mine.
    record(join(root, 'src', 'app', 'event_loop.rs'), TWO, dir);
    const others = othersTouched(ONE, dir);
    if (others.length !== 1) fails.push(`one session saw ${others.length} other sessions rather than 1`);
    if (others[0]?.paths.join(' ') !== 'src/app/event_loop.rs') fails.push("the other session's paths did not come back");
    if (!others[0]?.session.includes('bbbbbbbb')) fails.push('the other session was not named, so nothing can say whose file was left out');
    if (othersTouched(ONE, dir).some(({ paths }) => paths.includes('Cargo.toml'))) fails.push("a session's own record was read as somebody else's");
    if (othersTouched('', dir).length) fails.push('no session id subtracted every record, including its own');
    if (othersTouched(TWO, join(dir, 'gone')).length) fails.push('a temp folder that is not there was not read as nobody else working');

    // A record with nothing in it is nobody to subtract, so it never reaches the release as an empty entry.
    writeFileSync(join(dir, `${TOUCHED}cccccccc.json`), JSON.stringify({ session: 'cccccccc', paths: [] }) + '\n');
    writeFileSync(join(dir, `${TOUCHED}dddddddd.json`), 'not json at all');
    if (othersTouched(ONE, dir).length !== 1) fails.push('an empty or unreadable record was counted as a session with work in it');

    // Shell tools name no file, so their before and after dirty sets decide which path to add.
    if (!snapshotBefore(THREE, CALL, dir, root, ['src/lib.rs'])) fails.push('a shell command did not keep its before state');
    if (recordAfter(THREE, CALL, dir, root, ['src/lib.rs', 'scripts/gate-touched.mjs']).join(' ') !== 'scripts/gate-touched.mjs') fails.push('a shell command did not record the path it made dirty');
    if (touchedBy(THREE, dir).join(' ') !== 'scripts/gate-touched.mjs') fails.push('a shell command wrote the wrong session record');
    if (existsSync(beforePath(THREE, CALL, dir))) fails.push('a shell command kept its before state after recording it');
    if (!snapshotBefore(THREE, `${CALL}-failed`, dir, root, ['scripts/gate-touched.mjs'])) fails.push('a failed shell command did not keep its before state');
    if (recordAfter(THREE, `${CALL}-failed`, dir, root, ['scripts/gate-touched.mjs', 'Cargo.toml']).join(' ') !== 'Cargo.toml') fails.push('a failed shell command did not record the path it changed');
    if (!snapshotBefore(THREE, `${CALL}-nothing`, dir, root, ['scripts/gate-touched.mjs', 'Cargo.toml'])) fails.push('a no-op shell command did not keep its before state');
    if (recordAfter(THREE, `${CALL}-nothing`, dir, root, ['scripts/gate-touched.mjs', 'Cargo.toml']).length) fails.push('a shell command that changed nothing grew the record');
    if (touchedBy(THREE, dir).join(' ') !== 'scripts/gate-touched.mjs Cargo.toml') fails.push('a shell command left the wrong paths in its record');

    // The sweep this hook runs on every edit clears a day-old record and leaves a live one.
    const stale = join(dir, `${TOUCHED}eeeeeeee.json`);
    writeFileSync(stale, JSON.stringify({ session: 'eeeeeeee', paths: ['src/lib.rs'] }) + '\n');
    const aDayBack = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(stale, aDayBack, aDayBack);
    sweep(dir, TOUCHED);
    if (existsSync(stale)) fails.push('a day-old record survived the sweep');
    if (!existsSync(touchedPath(ONE, dir))) fails.push('the sweep took a record written a moment ago');
  } catch (error) {
    fails.push(`cycle: ${error.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  for (const name of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'edit']) {
    if (!EDIT_TOOLS.test(name)) fails.push(`${name} writes a file and would not be recorded`);
  }
  for (const name of ['Bash', 'PowerShell', 'Shell']) {
    if (!SHELL_TOOLS.test(name)) fails.push(`${name} changes files but would not be measured around its command`);
  }
  for (const name of ['Read', 'TodoWrite', 'Grep']) {
    if (EDIT_TOOLS.test(name) || SHELL_TOOLS.test(name)) fails.push(`${name} was read as a file-changing tool`);
  }

  if (fails.length) {
    console.error('gate-touched: failed');
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('gate-touched: ok (edits and shell commands write the paths they changed under their own session, a no-op command grows nothing, one outside the checkout is dropped, no session id records nothing and subtracts nothing, and a day-old record is swept)');
}

// Only act when run directly: the release imports this for `othersTouched`, and a hook body that read stdin on import would swallow whatever payload the importing hook was handed.
const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
const args = invoked === import.meta.url ? process.argv.slice(2) : null;
if (!args) {
  // Imported, not run.
} else if (args.includes('--check')) {
  selfTest();
} else {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    process.exit(0);
  }
  const before = args.includes('--before');
  const after = args.includes('--after');
  keep(after ? 'PostToolUse' : 'PreToolUse', raw);
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // An unreadable payload records nothing, which stages everything dirty exactly as it does today.
  }
  if (EDIT_TOOLS.test(payload.tool_name ?? '')) {
    try {
      record(payload.tool_input?.file_path ?? payload.tool_input?.notebook_path ?? '', sessionOf(raw));
      sweep(tmpdir(), TOUCHED);
    } catch {
      // A record that cannot be written subtracts nothing. Never block: a hook that can wedge a session is worse than no hook.
    }
  } else if (SHELL_TOOLS.test(payload.tool_name ?? '')) {
    try {
      if (before) snapshotBefore(sessionOf(raw), payload.tool_use_id);
      if (after) recordAfter(sessionOf(raw), payload.tool_use_id);
      sweep(tmpdir(), TOUCHED);
      sweep(tmpdir(), BEFORE);
    } catch {
      // A command that cannot be measured leaves the record unchanged rather than blocking work.
    }
  }
  process.exit(0);
}
