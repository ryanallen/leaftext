#!/usr/bin/env node
// One session's private copy of the app, so two agents at once cannot take each other's build, index or release.
//
// The app alone is private. The plan tree is the owner's, always: a session ticks its boxes and sets its status in the file already open on their screen, so a build half an hour long can be watched rather than asked about. `leaftext/` is two repositories and only the nested Leaftext one is copied, at the path shape the primary checkout has.
//
//   node scripts/agent-workspace.mjs create      make this session's copy
//   node scripts/agent-workspace.mjs path        where this session's copy is
//   node scripts/agent-workspace.mjs list        every managed workspace
//   node scripts/agent-workspace.mjs private [--session <session>] [message]  hand a named session's finished work over on its own branch
//   node scripts/agent-workspace.mjs submit <s>  apply one session's handoff to the primary app copy
//   node scripts/agent-workspace.mjs plan-open   take the running order to edit, holding it
//   node scripts/agent-workspace.mjs plan-close  write it back and give it up
//   node scripts/agent-workspace.mjs remove      take this session's copy down
//   node scripts/agent-workspace.mjs --check     self-test (`just check-workspace`)
//
// A hook runs `create` before every message; nobody types it. `private` commits, so `scripts/gate-git.mjs` gates that one — the gate reads a command string and cannot see the git a script spawns.
//
// The private parent is outside every repository: Studio work sits inside the Studio tree, which is one too, so a parent under either would be untracked noise in a third status.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sessionOf, sessionTag } from './hook-payload.mjs';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');

/// Where copies are made. Overridable so the self-test gets a folder of its own.
export function workspaceParent() {
  return (process.env.LEAFTEXT_WORKSPACES || '').trim() || join(homedir(), '.leaftext-workspaces');
}

/// One branch name per session: it is one session's work.
export function branchFor(session) {
  const tag = sessionTag(session);
  return tag ? `agent/${tag}` : '';
}

/// The copy's paths. The app keeps its `leaftext/app` seat under plain folders, so every name derived from the path shape holds still.
export function workspacePaths(parent, session) {
  const tag = sessionTag(session);
  if (!tag) return null;
  const home = join(parent, tag);
  return { tag, home, app: join(home, 'leaftext', 'app'), manifest: join(parent, `${tag}.json`) };
}

/// The session a path belongs to, or '' for anywhere outside a workspace. Read off the path rather than the environment, because the tools that address a running copy are started by a person or a recipe rather than by the helper, and where they are is the one thing they always know.
export function sessionInDir(dir) {
  const parent = resolve(workspaceParent());
  const rel = relative(parent, resolve(dir));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return '';
  return sessionTag(rel.split(/[\\/]/)[0]);
}

/// What a development launch's own names and folders hang off, for a command running in that copy. Empty everywhere else, which is what leaves the owner's copy and every installed copy on the names they already answer to.
export function devSuffixInDir(dir) {
  const tag = sessionInDir(dir);
  return tag ? `-dev-${tag}` : '';
}

/// Whether a path really sits under a parent — outside it would mean a worktree in somebody's repository.
export function inside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/// Untrimmed and roomy: a patch needs its last newline, and a binary hunk outgrows the default pipe.
function gitRaw(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

function git(dir, args) {
  return gitRaw(dir, args).trim();
}

/// A repository's own top level, or ''. Compared rather than merely asked: a path inside one answers the top level, not itself.
export function repoRoot(dir) {
  try {
    return resolve(git(dir, ['rev-parse', '--show-toplevel'])) === resolve(dir) ? resolve(dir) : '';
  } catch {
    return '';
  }
}

/// Whether a checkout is a worktree of another — what tells a session's copy from the primary.
export function isManaged(dir) {
  try {
    return resolve(git(dir, ['rev-parse', '--absolute-git-dir'])) !== resolve(git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  } catch {
    return false;
  }
}

/// The app copy the owner reads, asked from either copy: a worktree shares the primary's git directory, so the folder holding that directory is the primary.
export function primaryAppRoot(dir = here) {
  try {
    return resolve(dirname(git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])));
  } catch {
    return resolve(dir);
  }
}

/// What a public release points the plan-reading checks at instead of the live tree. Set on the gate's own child processes and nothing else, so an ordinary run always answers the owner's folder.
export const PLAN_ROOT_ENV = 'LEAFTEXT_PLAN_ROOT';

/// Where the plan tree is, for a command running in either copy: the owner's, always. It is what the six checks that read `../docs` ask, because beside a session's copy there is nothing there to read.
export function planTree(dir = here) {
  const held = (process.env[PLAN_ROOT_ENV] || '').trim();
  return held || join(primaryAppRoot(dir), '..', 'docs');
}

/// Every path a checkout has work in. Read raw: trimming eats the first line's status column and cuts a letter off the path.
export function dirtyPaths(dir) {
  try {
    return gitRaw(dir, ['status', '--porcelain'])
      .split('\n')
      .filter((line) => line.length > 3)
      // A rename reports both halves; where the file is now is the one that matters.
      .map((line) => line.slice(3).replace(/^.* -> /, '').replace(/^"(.*)"$/, '$1'))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/// The revision a copy is cut from, so a handoff can be checked against it.
export function baseOf(dir) {
  try {
    return git(dir, ['rev-parse', 'HEAD']);
  } catch {
    return '';
  }
}

/// Why a copy may not be made, or ''. Pure, so refusals are proved without breaking a checkout.
export function creationRefusal(state) {
  const { session, appRoot, parent, target, managed } = state;
  if (!sessionTag(session)) return 'no session id, so there is nothing to keep one agent\'s work apart from another\'s';
  if (managed) return 'this is already a managed workspace — a session makes its own and never another\'s';
  if (!appRoot) return 'the Leaftext app path is not a repository\'s own top level';
  if (!inside(parent, target)) return `the workspace path ${target} is outside the private worktree parent ${parent}`;
  return '';
}

/// Said, not refused: a copy is cut at the primary's revision and never carries its loose work, and refusing would strand every session while a handoff waits to be released.
export function creationWarnings(state) {
  const { appDirty = [], assigned = [] } = state;
  const held = new Set(assigned);
  const loose = appDirty.map((p) => `app: ${p}`).filter((p) => !held.has(p));
  if (!loose.length) return [];
  return [`the app copy the owner reads has work no handoff has taken, and this copy is cut without it: ${loose.slice(0, 8).join(', ')}${loose.length > 8 ? ` and ${loose.length - 8} more` : ''}`];
}

/// Every path a handoff has already claimed.
export function assignedPaths(parent) {
  const found = [];
  for (const record of manifests(parent)) {
    for (const path of record.handoff?.paths || []) found.push(path);
  }
  return found;
}

/// What every managed workspace under one parent says about itself.
export function manifests(parent) {
  try {
    return readdirSync(parent)
      // A leading dot belongs to a submit, not to a copy.
      .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
      .map((name) => {
        try {
          return JSON.parse(readFileSync(join(parent, name), 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/// Read each manifest's app path, never a folder tree.
export function workspaceStatus(record) {
  const appPaths = dirtyPaths(record.app);
  return { record, appPaths, hasWork: appPaths.length > 0 };
}

export function workspaceStatuses(parent) {
  return manifests(parent).map(workspaceStatus);
}

export function workspaceLine(status) {
  const { record, appPaths, hasWork } = status;
  const state = hasWork ? `work waiting (${appPaths.length} app path${appPaths.length === 1 ? '' : 's'})` : 'clear';
  return `${record.session}  ${record.branch}  ${record.app}  ${state}`;
}

/// Whether a repository already has a branch by that name.
function hasBranch(root, branch) {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/// Cut a new branch, or reattach to the one this session has. Reattach, never reset: a handoff is on it.
function attach(root, branch, path, base) {
  if (hasBranch(root, branch)) git(root, ['worktree', 'add', path, branch]);
  else git(root, ['worktree', 'add', '-b', branch, path, base]);
}

/// Make a copy: plain folders down to `leaftext/`, then the app worktree inside them.
export function create({ session, appRoot, parent }) {
  const paths = workspacePaths(parent, session);
  const state = {
    session,
    appRoot,
    parent,
    target: paths ? paths.home : parent,
    managed: isManaged(appRoot),
    appDirty: dirtyPaths(appRoot),
    assigned: assignedPaths(parent),
  };
  const refusal = creationRefusal(state);
  if (refusal) throw new Error(refusal);
  const warnings = creationWarnings(state);
  if (existsSync(paths.home)) throw new Error(`${paths.home} is already there — remove this session's workspace before making another`);

  const branch = branchFor(session);
  const appBase = baseOf(appRoot);
  mkdirSync(dirname(paths.app), { recursive: true });
  attach(appRoot, branch, paths.app, appBase);

  const record = { session: paths.tag, branch, home: paths.home, app: paths.app, appRoot, appBase, planTree: planTree(appRoot), warnings };
  writeFileSync(paths.manifest, JSON.stringify(record, null, 2) + '\n');
  return record;
}

/// This session's copy, made if it is not there. What the hook calls before every message.
export function ensure({ session, appRoot, parent }) {
  const tag = sessionTag(session);
  if (!tag) throw new Error('no session id, so there is nothing to keep one agent\'s work apart from another\'s');
  const already = manifests(parent).find((m) => m.session === tag);
  if (already && already.home && existsSync(already.app)) return { ...already, made: false };
  if (already) remove({ session, parent });
  return { ...create({ session, appRoot, parent }), made: true };
}

/// Take a copy down. The branch stays: the handoff is on it.
export function remove({ session, parent }) {
  const paths = workspacePaths(parent, session);
  if (!paths) throw new Error('no session id, so there is no workspace to name');
  const record = manifests(parent).find((m) => m.session === paths.tag);
  if (!record) throw new Error(`no managed workspace for this session under ${parent}`);
  // The second pair is a copy made before the plan half was dropped: it still has a plan worktree to let go of.
  const trees = [[record.appRoot, record.app]];
  if (record.studioRoot && record.studio) trees.push([record.studioRoot, record.studio]);
  for (const [root, tree] of trees) {
    try {
      git(root, ['worktree', 'remove', '--force', tree]);
    } catch {
      // A tree git will not let go of is finished off below.
    }
    rmSync(tree, { recursive: true, force: true });
    try {
      git(root, ['worktree', 'prune']);
    } catch {
      // Nothing to prune is nothing to report.
    }
  }
  rmSync(record.home || record.studio, { recursive: true, force: true });
  rmSync(paths.manifest, { force: true });
  return record;
}

/// What marks a commit as a handoff rather than ordinary work on the branch. The commit is the record, so a copy that is gone still leaves the handoff readable.
export const HANDOFF_TRAILER = 'Leaftext-handoff';

/// Deliver privately: one commit on this session's own branch, in the session's copy. Never pushed, never tagged, no version moved, and no word to any remote.
export function releasePrivate({ session, parent, from = process.cwd(), message = '' }) {
  const tag = sessionTag(session);
  if (!tag) throw new Error('no session id, so there is no workspace to release');
  if (!isManaged(from)) throw new Error('a private release runs inside a managed workspace — the primary copy makes the public one');
  const record = manifests(parent).find((m) => m.session === tag);
  if (!record) throw new Error(`no managed workspace for this session under ${parent}`);
  if (!isManaged(record.app)) throw new Error(`${record.app} is not a managed copy any more`);

  // Staged first, so a file the work added travels with the ones it changed.
  git(record.app, ['add', '-A']);
  if (!git(record.app, ['diff', '--cached', '--name-only', record.appBase])) {
    const waiting = workspaceStatuses(parent).filter((status) => status.record.session !== tag && status.hasWork);
    const elsewhere = waiting.length ? ` Work is waiting in ${waiting.map((status) => status.record.session).join(', ')}; run private --session <session> to hand one over.` : '';
    throw new Error(`this workspace has no work in it, so there is nothing to hand over.${elsewhere}`);
  }

  // One commit on the revision the copy was cut from, however many times this runs: the submit reads the base off that commit's parent, and a second commit would hide the first one's work from it.
  const amend = baseOf(record.app) !== record.appBase ? ['--amend'] : [];
  const subject = message || `Private handoff ${tag}`;
  // Unsigned: nobody publishes this branch, and a machine with no key must still hand work over.
  git(record.app, ['-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign', ...amend, '-m', `${subject}\n\n${HANDOFF_TRAILER}: ${tag}`]);

  const handoff = handoffOn(record.appRoot, record.branch);
  if (!handoff) throw new Error('the handoff commit was made and could not be read back off the branch');
  writeFileSync(join(parent, `${tag}.json`), JSON.stringify({ ...record, handoff }, null, 2) + '\n');
  return handoff;
}

/// A named target is deliberate; the current session remains the default.
export function privateArguments(args, currentSession) {
  if (args[0] !== '--session') return { session: currentSession, message: args.join(' ') };
  return { session: args[1] || '', message: args.slice(2).join(' ') };
}

/// Read a handoff off the branch: the base is the commit's parent and the changed paths are its own diff. A branch sitting where it was cut carries none, which is what the trailer says.
export function handoffOn(appRoot, branch) {
  try {
    if (!git(appRoot, ['log', '-1', '--format=%B', branch]).includes(`${HANDOFF_TRAILER}:`)) return null;
    const appBase = git(appRoot, ['rev-parse', `${branch}^`]);
    const appPaths = git(appRoot, ['diff', '--name-only', appBase, branch]).split('\n').filter(Boolean);
    return { branch, appBase, appPaths, paths: appPaths.map((p) => `app: ${p}`) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Submitting one private handoff to the primary app copy.
// ---------------------------------------------------------------------------

/// The claim on the primary copy. A folder: making one is the cheapest atomic act both platforms have.
export function reservationPath(parent) {
  return join(parent, '.reservation');
}

/// What the primary copy held before a submit touched it. One file, because one reservation means one submit.
export function journalPath(parent) {
  return join(parent, '.journal.json');
}

/// Match the running order claim, so a killed run does not stop the next handoff for an hour.
export const RESERVATION_STALE_MS = 2 * 60 * 1000;

/// Take the claim, waiting for a live holder and taking over one a killed run left behind.
export function reserve(parent, holder, { waitMs = 10 * 1000, clock = Date.now, sleep = sleepSync, stale = RESERVATION_STALE_MS } = {}) {
  mkdirSync(parent, { recursive: true });
  const path = reservationPath(parent);
  const until = clock() + waitMs;
  for (;;) {
    try {
      mkdirSync(path);
      break;
    } catch {
      let held = { holder: 'another session', at: 0 };
      try {
        held = JSON.parse(readFileSync(join(path, 'held-by.json'), 'utf8'));
      } catch {
        // An unreadable claim waits out the window like any other.
      }
      if (clock() - Date.parse(held.at || 0) >= stale) break;
      if (clock() >= until) throw new Error(`${held.holder} holds the primary reservation — one handoff reaches the primary copy at a time`);
      sleep(100);
    }
  }
  writeFileSync(join(path, 'held-by.json'), JSON.stringify({ holder: sessionTag(holder) || 'unknown', at: new Date(clock()).toISOString() }) + '\n');
}

/// Give the claim back, on every result.
export function releaseReservation(parent) {
  rmSync(reservationPath(parent), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// The running order, which is the one plan file two sessions write at once.
// ---------------------------------------------------------------------------

/// The claim on the running order. A folder, the same atomic act the submit reservation is.
export function planClaimPath(parent) {
  return join(parent, '.plan-claim');
}

/// Where one session's copy of the running order waits between the read and the write.
export function planScratchPath(parent, session) {
  return join(parent, `.plan-${sessionTag(session) || 'unknown'}.md`);
}

/// What that session took its copy from, beside the copy. The claim folder is the one place it cannot live: a second session opening the running order would write over it, and the first would then be told its own copy is somebody else's.
export function planOpenedPath(parent, session) {
  return join(parent, `.plan-${sessionTag(session) || 'unknown'}.json`);
}

/// Short on purpose: a claim is held across one edit, not across a build, so a run killed holding one wedges the next ranking pass for two minutes rather than an hour.
export const PLAN_CLAIM_STALE_MS = 2 * 60 * 1000;

/// Wait out another run's claim rather than refusing it: a status nobody wrote is one somebody has to notice is missing.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/// So a turn that pauses says what it is pausing for.
function warn(message) {
  process.stderr.write(`agent-workspace: ${message}\n`);
}

/// Take the running order's claim, waiting for the run that holds it and taking over one a killed run left behind.
///
/// No deadline by default. A hold lasts as long as an agent's edit, which has no ceiling, so any fixed wait is a number somebody exceeds — ten seconds refused three sessions in a row on 16 August 2026 and lost each one's status. The ceiling is the holder's own record going stale, which is a killed run rather than a slow one. `waitMs` refuses on demand and is the self-test's.
export function claimPlan(parent, holder, { waitMs = null, clock = Date.now, stale = PLAN_CLAIM_STALE_MS, sleep = sleepSync, notify = warn } = {}) {
  mkdirSync(parent, { recursive: true });
  const path = planClaimPath(parent);
  const began = clock();
  const until = waitMs === null ? null : began + waitMs;
  let said = false;
  for (;;) {
    try {
      mkdirSync(path);
      break;
    } catch {
      let held = { holder: 'another session', at: 0 };
      try {
        held = JSON.parse(readFileSync(join(path, 'held-by.json'), 'utf8'));
      } catch {
        // An unreadable claim waits out the window like any other.
      }
      if (clock() - Date.parse(held.at || 0) >= stale) break;
      if (until !== null && clock() >= until) throw new Error(`${held.holder} is writing the running order — nothing was changed after waiting ${Math.round((clock() - began) / 1000)}s`);
      // Once, not every pass.
      if (!said) notify(`waiting for ${held.holder} to finish writing the running order`);
      said = true;
      sleep(100);
    }
  }
  writeFileSync(join(path, 'held-by.json'), JSON.stringify({ holder: sessionTag(holder) || 'unknown', at: new Date().toISOString() }) + '\n');
}

/// Give the running order back, on every result.
export function releasePlan(parent) {
  rmSync(planClaimPath(parent), { recursive: true, force: true });
}

/// What the running order held when a session took its copy, so a write that would land on somebody else's rows is refused instead.
export function planFingerprint(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/// One read-edit-write of the running order, the claim held from the read to the write. A lock file on its own binds nobody, so this is the thing that does the editing.
export function writePlanRow(parent, holder, edit, options = {}) {
  const file = join(options.plans || planTree(), 'PLAN.md');
  claimPlan(parent, holder, options);
  try {
    const was = readFileSync(file, 'utf8');
    const now = edit(was);
    if (typeof now !== 'string') throw new Error('a running-order edit answers the whole file back, and this one answered nothing');
    if (now !== was) writeFileSync(file, now);
    return now;
  } finally {
    releasePlan(parent);
  }
}

/// Take a copy of the running order to edit. What a skill runs when the edit is a person's rather than a function's.
///
/// Nothing is held while it is open. The claim would have to span an agent's edit, and nothing is running to renew one — the command exits the moment it hands the copy back. What decides the write instead is the fingerprint the copy was taken at, which is the same test the app runs on a document written through its own pipe.
export function openPlan({ session, parent, plans = null }) {
  const file = join(plans || planTree(), 'PLAN.md');
  const scratch = planScratchPath(parent, session);
  mkdirSync(parent, { recursive: true });
  const text = readFileSync(file, 'utf8');
  writeFileSync(scratch, text);
  writeFileSync(planOpenedPath(parent, session), JSON.stringify({ file, scratch, was: planFingerprint(text) }) + '\n');
  return { scratch, file };
}

/// Write the copy back, the claim held across the read, the test and the write alone. Refused where the running order moved underneath, because the copy was taken before whatever moved it — and the copy is kept where it is, since it holds an edit nobody else has.
export function closePlan({ session, parent, options = {} }) {
  const scratch = planScratchPath(parent, session);
  const record = planOpenedPath(parent, session);
  let opened = null;
  try {
    opened = JSON.parse(readFileSync(record, 'utf8'));
  } catch {
    throw new Error('this session is not holding the running order — open it before writing it back');
  }
  claimPlan(parent, session, options);
  try {
    if (planFingerprint(readFileSync(opened.file, 'utf8')) !== opened.was) {
      throw new Error(`the running order moved while this copy was open, so writing it back would take the other rows with it — this session's copy is still at ${scratch}; open the running order again and redo the row`);
    }
    writeFileSync(opened.file, readFileSync(scratch, 'utf8'));
  } finally {
    releasePlan(parent);
  }
  // Only once it landed: a refused copy is the only place that edit exists.
  rmSync(scratch, { force: true });
  rmSync(record, { force: true });
  return opened.file;
}

// ---------------------------------------------------------------------------
// One still copy of the plan tree, for a public release to check itself against.
// ---------------------------------------------------------------------------

/// Every plan file and what it held. The claim only covers the running order, so a ticket, a README row or a skill copy is written straight into the shared tree — this is how a release sees that happen instead of failing on half of somebody else's edit.
export function planManifest(root) {
  const found = [];
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === '.git') continue;
      const full = join(dir, entry.name);
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, path);
      else {
        try {
          found.push(`${path} ${createHash('sha256').update(readFileSync(full)).digest('hex')}`);
        } catch {
          // A file that vanished between the listing and the read is a moving tree, which is what the caller compares for.
          found.push(`${path} gone`);
        }
      }
    }
  };
  walk(root, '');
  return found.join('\n');
}

/// How many times a moving tree is copied again before the release gives up.
export const SNAPSHOT_ATTEMPTS = 3;

/// A still copy of the plan tree, in a folder of this run's own. The manifest is taken before and after the copy: a tree that changed while it was being read is copied again rather than handed to the gate, because half of somebody else's edit is not a state anybody wrote.
export function snapshotPlanTree({ plans = planTree(), attempts = SNAPSHOT_ATTEMPTS, copy = null } = {}) {
  const take = copy || ((from, to) => cpSync(from, to, { recursive: true }));
  for (let attempt = 1; ; attempt += 1) {
    const root = mkdtempSync(join(tmpdir(), `leaf-plan-${process.pid}-`));
    const before = planManifest(plans);
    try {
      take(plans, root);
    } catch (error) {
      rmSync(root, { recursive: true, force: true });
      throw error;
    }
    if (planManifest(plans) === before) return { root, plans };
    rmSync(root, { recursive: true, force: true });
    if (attempt >= attempts) throw new Error(`the plan tree changed every time it was copied (${attempts} tries), so there is no one state to check this release against — let the other session finish its edit and release again`);
  }
}

/// Run something against a still copy of the plan tree and take the copy down afterwards, whichever way it ends. The signal handlers are for a run somebody stops: without them a killed release leaves a whole plan tree in the temp folder.
export function withPlanSnapshot(fn, options = {}) {
  const snapshot = snapshotPlanTree(options);
  const drop = () => rmSync(snapshot.root, { recursive: true, force: true });
  const stopped = () => {
    drop();
    process.exit(130);
  };
  process.once('SIGINT', stopped);
  process.once('SIGTERM', stopped);
  try {
    return fn(snapshot);
  } finally {
    process.removeListener('SIGINT', stopped);
    process.removeListener('SIGTERM', stopped);
    drop();
  }
}

function bytesAt(path) {
  try {
    return readFileSync(path).toString('base64');
  } catch {
    return null;
  }
}

/// What the primary copy holds where a handoff will write. `null` is a path that was not there.
export function journalFor(appRoot, handoff) {
  return (handoff.appPaths || []).map((path) => ({ root: appRoot, path, was: bytesAt(join(appRoot, path)) }));
}

/// Put every journaled path back the way it was found.
export function restoreFrom(entries) {
  for (const { root, path, was } of entries) {
    const full = join(root, path);
    if (was === null) rmSync(full, { force: true });
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, Buffer.from(was, 'base64'));
    }
  }
}

/// Why a handoff may not be applied, or ''. Pure, so a stale base and an overlap are proved cheaply.
export function submitRefusal(state) {
  const { managed, handoff, appHead, appDirty = [] } = state;
  if (managed) return 'a handoff is submitted from the primary checkout — a workspace hands its work over, it does not take another\'s';
  if (!handoff) return 'that branch carries no handoff';
  if (handoff.appBase !== appHead) return `the handoff was written on app revision ${handoff.appBase.slice(0, 8)} and the primary copy is on ${appHead.slice(0, 8)} — release it again from a fresh workspace`;
  const clash = (handoff.appPaths || []).filter((p) => appDirty.includes(p)).map((p) => `app: ${p}`);
  if (clash.length) return `${handoff.branch} overlaps work already sitting in the primary app copy: ${clash.join(', ')}`;
  return '';
}

/// Apply one handoff and leave the primary app copy dirty. Nothing here commits, tags or pushes.
export function submit({ session, parent, appRoot, from = process.cwd() }) {
  const tag = sessionTag(session);
  if (!tag) throw new Error('no session named, so there is no handoff to submit');
  const managed = isManaged(from);
  if (managed) throw new Error(submitRefusal({ managed }));

  reserve(parent, tag);
  let journal = [];
  try {
    // A journal left behind is a killed submit. Roll it back, or every check below reads a half-applied tree.
    try {
      restoreFrom(JSON.parse(readFileSync(journalPath(parent), 'utf8')));
      rmSync(journalPath(parent), { force: true });
    } catch {
      // No journal is the ordinary case.
    }

    const branch = branchFor(session);
    const handoff = handoffOn(appRoot, branch);
    const refusal = submitRefusal({ managed, handoff, appHead: baseOf(appRoot), appDirty: dirtyPaths(appRoot) });
    if (refusal) throw new Error(refusal);

    journal = journalFor(appRoot, handoff);
    writeFileSync(journalPath(parent), JSON.stringify(journal) + '\n');

    if (handoff.appPaths.length) {
      const patch = gitRaw(appRoot, ['diff', '--binary', handoff.appBase, branch]);
      execFileSync('git', ['-C', appRoot, 'apply', '-'], { input: patch, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    }

    rmSync(journalPath(parent), { force: true });
    return handoff;
  } catch (error) {
    restoreFrom(journal);
    rmSync(journalPath(parent), { force: true });
    throw error;
  } finally {
    releaseReservation(parent);
  }
}

// ---------------------------------------------------------------------------
// Self-test, on throwaway repositories.
// ---------------------------------------------------------------------------

function run(dir, args) {
  execFileSync('git', ['-C', dir, '-c', 'user.name=check', '-c', 'user.email=check@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function read(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/// A stand-in of the real shape: a Studio repository holding the plan tree, with the app repository at its own ignored `leaftext/app/`. Each has a bare remote, so what is pushed is a fact rather than a promise.
function fixtures(home) {
  const studioRoot = join(home, 'work');
  const appRoot = join(studioRoot, 'leaftext', 'app');
  const studioRemote = join(home, 'work.git');
  const appRemote = join(home, 'app.git');
  write(join(studioRoot, '.gitignore'), 'leaftext/app/\n');
  write(join(studioRoot, 'leaftext', 'docs', 'PLAN.md'), '# primary plan\n');
  write(join(appRoot, '.gitignore'), 'target/\n');
  write(join(appRoot, 'src', 'lib.rs'), '// primary app\n');
  for (const [root, remote, what] of [[studioRoot, studioRemote, 'plan'], [appRoot, appRemote, 'app']]) {
    execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: ['ignore', 'pipe', 'pipe'] });
    run(root, ['init', '-b', 'main']);
    // Into the repository, not per command: the helper runs plain git, and a worktree shares this.
    run(root, ['config', 'user.name', 'check']);
    run(root, ['config', 'user.email', 'check@example.com']);
    run(root, ['config', 'commit.gpgsign', 'false']);
    // The real copy is LF by `.gitattributes`; without this Windows rewrites every applied patch to CRLF.
    run(root, ['config', 'core.autocrlf', 'false']);
    run(root, ['remote', 'add', 'origin', remote]);
    run(root, ['add', '-A']);
    run(root, ['commit', '-m', what]);
    run(root, ['push', 'origin', 'main']);
  }
  return { studioRoot, appRoot, studioRemote, appRemote };
}

/// Every ref a bare repository holds, so an unwanted push shows up.
function refsIn(bare) {
  return execFileSync('git', ['-C', bare, 'for-each-ref', '--format=%(refname)'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').filter(Boolean).sort();
}

function refusalCases() {
  const fails = [];
  const ok = {
    session: 'aaaaaaaa-1111-1111-1111-111111111111',
    appRoot: '/repo/work/leaftext/app',
    parent: '/private',
    target: '/private/aaaaaaaa-1111-1111-1111-111111111111',
    managed: false,
  };
  const wants = [
    ['a workspace with everything in place is allowed', ok, ''],
    ['no session id', { ...ok, session: '' }, 'no session id'],
    ['an app path that is not a repository', { ...ok, appRoot: '' }, 'not a repository'],
    ['a target outside the private parent', { ...ok, target: '/elsewhere/x' }, 'outside the private worktree parent'],
    ['a target that is the parent itself', { ...ok, target: '/private' }, 'outside the private worktree parent'],
    ['a managed workspace starting another', { ...ok, managed: true }, 'already a managed workspace'],
    // Said, never refused.
    ['a primary app copy with work in it', { ...ok, appDirty: ['src/lib.rs'] }, ''],
  ];
  for (const [name, state, want] of wants) {
    const got = creationRefusal(state);
    if (want === '' && got) fails.push(`${name}: refused with "${got}"`);
    if (want !== '' && !got.includes(want)) fails.push(`${name}: said "${got || 'nothing'}", wanted "${want}"`);
  }
  if (creationWarnings(ok).length) fails.push('a clean primary copy was warned about');
  if (!creationWarnings({ ...ok, appDirty: ['src/lib.rs'] })[0]?.includes('src/lib.rs')) fails.push('work in the primary copy was not said out loud');
  if (creationWarnings({ ...ok, appDirty: ['src/lib.rs'], assigned: ['app: src/lib.rs'] }).length) fails.push('work a handoff has already taken was warned about again');
  if (inside('/private', '/private/../other')) fails.push('inside: a path that climbs out was read as being under the parent');
  if (!inside('/private', '/private/a/b')) fails.push('inside: a path well under the parent was read as outside it');
  if (branchFor('') !== '') fails.push('branchFor: no session id still named a branch');
  if (branchFor('a-1') === branchFor('b-2')) fails.push('branchFor: two sessions share one branch');

  const handoff = { branch: 'agent/one', appBase: 'aaa', appPaths: ['src/lib.rs'] };
  const fine = { managed: false, handoff, appHead: 'aaa' };
  const submits = [
    ['a handoff on the primary revision is applied', fine, ''],
    ['a handoff submitted from a workspace', { ...fine, managed: true }, 'submitted from the primary checkout'],
    ['a branch with no handoff on it', { ...fine, handoff: null }, 'carries no handoff'],
    ['a handoff written on an older app revision', { ...fine, appHead: 'zzz' }, 'the primary copy is on'],
    ['an app path another handoff already put there', { ...fine, appDirty: ['src/lib.rs'] }, 'overlaps work already sitting'],
    ['work in the primary copy that this handoff does not touch', { ...fine, appDirty: ['src/other.rs'] }, ''],
  ];
  for (const [name, state, want] of submits) {
    const got = submitRefusal(state);
    if (want === '' && got) fails.push(`${name}: refused with "${got}"`);
    if (want !== '' && !got.includes(want)) fails.push(`${name}: said "${got || 'nothing'}", wanted "${want}"`);
  }
  return fails;
}

/// `scripts/prepare-release.mts` must keep reading a session's copy and the plan snapshot through the readers tested above. A second implementation there would pass its own check and let a copy tag, or gate against the live plan tree. The order the release runs in is proved by its own self-test, on a fixture host that runs nothing.
function publicReleaseGuard() {
  const fails = [];
  const text = readFileSync(join(here, 'scripts', 'prepare-release.mts'), 'utf8');
  const imports = /import \{([^}]*)\} from "\.\/agent-workspace\.mjs"/.exec(text);
  for (const name of ['isManaged', 'withPlanSnapshot', 'PLAN_ROOT_ENV']) {
    if (!imports || !imports[1].includes(name)) fails.push(`the public release path does not read ${name} from this helper`);
  }
  if (!text.includes('assertPrimaryCheckout(host)')) fails.push('the public release path never asks whether it is in a managed workspace');
  if (!text.includes('host.withSnapshot(')) fails.push('the public release path no longer checks itself against a still copy of the plan tree');
  if (!/\[PLAN_ROOT_ENV\]: root/.test(text)) fails.push('the public release path does not point the check suite at the plan copy it made');
  return fails;
}

/// The six checks that read the plan tree have to ask this helper where it is, or a release pointing at a still copy hands it to some of them and not the rest.
const PLAN_READERS = ['check-ascii-art.mjs', 'check-docs.mjs', 'check-learn-snapshots.mjs', 'check-plan.mjs', 'check-spelling.mjs', 'check-wrapping.mjs'];

function planSnapshotCases() {
  const fails = [];

  for (const reader of PLAN_READERS) {
    const text = readFileSync(join(here, 'scripts', reader), 'utf8');
    const imports = /import \{([^}]*)\} from '\.\/agent-workspace\.mjs'/.exec(text);
    if (!imports || !imports[1].includes('planTree')) fails.push(`${reader} does not ask this helper where the plan tree is, so a release cannot point it at a still copy`);
  }

  // The override the release sets, and nothing else, moves the answer.
  const was = process.env[PLAN_ROOT_ENV];
  try {
    delete process.env[PLAN_ROOT_ENV];
    const live = planTree(here);
    process.env[PLAN_ROOT_ENV] = join(tmpdir(), `a-still-copy-${process.pid}`);
    if (planTree(here) !== join(tmpdir(), `a-still-copy-${process.pid}`)) fails.push('a release pointing the checks at a still copy of the plan tree was ignored');
    delete process.env[PLAN_ROOT_ENV];
    if (planTree(here) !== live) fails.push('the plan tree stayed on the release override after it was taken away');
  } finally {
    if (was === undefined) delete process.env[PLAN_ROOT_ENV];
    else process.env[PLAN_ROOT_ENV] = was;
  }

  // This run's own folder: two suites at once must not share fixtures.
  const home = mkdtempSync(join(tmpdir(), `leaf-plan-check-${process.pid}-`));
  const plans = join(home, 'docs');
  const taken = [];
  try {
    write(join(plans, 'PLAN.md'), '# one\n');
    write(join(plans, 'refactor', 'workflow', 'a.md'), '# a\n');

    // A tree holding still is copied whole, and the copy is bytes rather than a listing.
    const still = snapshotPlanTree({ plans });
    taken.push(still.root);
    if (read(join(still.root, 'PLAN.md')) !== '# one\n') fails.push('the still copy did not carry the running order');
    if (read(join(still.root, 'refactor', 'workflow', 'a.md')) !== '# a\n') fails.push('the still copy did not carry a ticket in a subject folder');
    if (planManifest(still.root) !== planManifest(plans)) fails.push('the still copy and the plan tree do not hold the same bytes');
    rmSync(still.root, { recursive: true, force: true });

    // A tree written to on every attempt is refused rather than handed to the gate: half of somebody else's edit is not a state anybody wrote.
    let writes = 0;
    let moving = '';
    try {
      snapshotPlanTree({
        plans,
        copy: (from, to) => {
          writes += 1;
          write(join(from, 'PLAN.md'), `# edit ${writes}\n`);
          cpSync(from, to, { recursive: true });
        },
      });
    } catch (error) {
      moving = error.message;
    }
    if (!moving.includes('changed every time it was copied')) fails.push(`a plan tree written to while it was copied was still handed to the gate: ${moving || 'it was allowed'}`);
    if (writes !== SNAPSHOT_ATTEMPTS) fails.push(`a moving plan tree was copied ${writes} times rather than ${SNAPSHOT_ATTEMPTS}`);

    // The other session finishes: the next attempt settles, and what the gate reads is the finished state.
    let attempts = 0;
    const settled = snapshotPlanTree({
      plans,
      copy: (from, to) => {
        attempts += 1;
        if (attempts === 1) write(join(from, 'PLAN.md'), '# the other session\n');
        cpSync(from, to, { recursive: true });
      },
    });
    taken.push(settled.root);
    if (attempts !== 2) fails.push(`a plan tree that settled was copied ${attempts} times rather than twice`);
    if (read(join(settled.root, 'PLAN.md')) !== '# the other session\n') fails.push('the still copy does not hold the plan state the other session finished writing');
    rmSync(settled.root, { recursive: true, force: true });

    // The copy goes on every result, because a release that fails must not leave a plan tree in the temp folder.
    let held = '';
    withPlanSnapshot((snapshot) => {
      held = snapshot.root;
    }, { plans });
    if (!held || existsSync(held)) fails.push('a finished release left its copy of the plan tree on disk');
    let threw = '';
    let heldOnThrow = '';
    try {
      withPlanSnapshot((snapshot) => {
        heldOnThrow = snapshot.root;
        throw new Error('the gate failed');
      }, { plans });
    } catch (error) {
      threw = error.message;
    }
    if (threw !== 'the gate failed') fails.push('a failing gate did not come back out of the plan copy');
    if (!heldOnThrow || existsSync(heldOnThrow)) fails.push('a failed release left its copy of the plan tree on disk');
  } catch (error) {
    fails.push(`plan snapshot: ${error.message}`);
  } finally {
    for (const root of taken) rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
  return fails;
}

function selfTest() {
  const fails = [...refusalCases(), ...publicReleaseGuard(), ...planSnapshotCases()];
  // This run's own folder: two suites at once must not share fixtures.
  const home = mkdtempSync(join(tmpdir(), `leaf-workspace-${process.pid}-`));
  const parent = join(home, 'private');
  const ONE = 'aaaaaaaa-1111-1111-1111-111111111111';
  const TWO = 'bbbbbbbb-2222-2222-2222-222222222222';
  try {
    const { studioRoot, appRoot, studioRemote, appRemote } = fixtures(home);
    const ownersPlan = join(studioRoot, 'leaftext', 'docs');
    const appRefsBefore = refsIn(appRemote);
    const studioRefsBefore = refsIn(studioRemote);
    if (!repoRoot(appRoot)) fails.push('repoRoot: the fixture app repository was not read as one');
    if (repoRoot(join(appRoot, 'src'))) fails.push('repoRoot: a folder inside a repository was read as its own top level');
    if (isManaged(appRoot)) fails.push('isManaged: a primary checkout was read as a workspace');
    if (resolve(planTree(appRoot)) !== resolve(ownersPlan)) fails.push('the primary checkout did not answer the plan tree beside it');

    const one = create({ session: ONE, appRoot, parent });
    const two = create({ session: TWO, appRoot, parent });
    if (one.app === two.app) fails.push('two sessions were given one app copy');
    if (!isManaged(one.app)) fails.push('isManaged: a made copy was not read as one');
    if (one.appBase !== baseOf(appRoot)) fails.push('the app base revision was not recorded');

    // The copy is the app alone: nothing makes a second plan tree, and the one it answers is the owner's.
    if (existsSync(join(one.home, 'leaftext', 'docs'))) fails.push('a session was given a copy of the plan tree');
    if (repoRoot(one.home)) fails.push('a session\'s workspace folder is a repository of its own');
    if (resolve(planTree(one.app)) !== resolve(ownersPlan)) fails.push('a session\'s copy did not answer the plan tree the owner reads');
    if (resolve(one.planTree) !== resolve(ownersPlan)) fails.push('the record of a copy does not name the plan tree the owner reads');

    // A box ticked while the build runs lands where the owner can watch it.
    write(join(planTree(one.app), 'PLAN.md'), '# ticked\n');
    if (read(join(ownersPlan, 'PLAN.md')) !== '# ticked\n') fails.push('a box ticked in a session\'s copy did not reach the plan the owner reads');
    write(join(ownersPlan, 'PLAN.md'), '# primary plan\n');

    // The app source, where a shared checkout let one build hold another.
    const lib = (w) => join(w.app, 'src', 'lib.rs');
    write(lib(one), '// one\n');
    write(lib(two), '// two\n');
    if (read(lib(one)) !== '// one\n') fails.push('one session\'s app edit did not survive the other\'s');
    if (read(join(appRoot, 'src', 'lib.rs')) !== '// primary app\n') fails.push('a workspace app edit reached the primary copy');

    // The index, which a version bump staged in one session and released from another rode on.
    run(one.app, ['add', 'src/lib.rs']);
    const staged = (dir) => git(dir, ['diff', '--cached', '--name-only']);
    if (staged(one.app) !== 'src/lib.rs') fails.push('a staged app change was not in the session that staged it');
    if (staged(two.app) !== '') fails.push('one session\'s staged app change appeared in the other\'s index');
    if (staged(appRoot) !== '') fails.push('one session\'s staged app change appeared in the primary index');

    // The build folder, where a shared checkout made two agents wait.
    write(join(one.app, 'target', 'build.txt'), 'one\n');
    write(join(two.app, 'target', 'build.txt'), 'two\n');
    if (read(join(one.app, 'target', 'build.txt')) !== 'one\n') fails.push('one session\'s build output was overwritten by the other\'s');
    if (existsSync(join(appRoot, 'target', 'build.txt'))) fails.push('a workspace build wrote into the primary checkout');

    // A second copy for a session that has one.
    let second = '';
    try {
      create({ session: ONE, appRoot, parent });
    } catch (error) {
      second = error.message;
    }
    if (!second.includes('already there')) fails.push('a session was given a second workspace over its first');

    // Two copies of edited, staged and built work leave the primary app copy clean.
    if (dirtyPaths(appRoot).length) fails.push(`a workspace left work in the primary app copy: ${dirtyPaths(appRoot).join(', ')}`);

    // Said and stepped around, never refused.
    const THREE = 'cccccccc-3333-3333-3333-333333333333';
    write(join(appRoot, 'src', 'half-done.rs'), '// mid-edit\n');
    const third = create({ session: THREE, appRoot, parent });
    if (!third.warnings.join(' ').includes('src/half-done.rs')) fails.push('a copy cut while the primary had work in it did not say so');
    if (existsSync(join(third.app, 'src', 'half-done.rs'))) fails.push('a copy was cut carrying work the primary had not committed');
    remove({ session: THREE, parent });
    rmSync(join(appRoot, 'src', 'half-done.rs'), { force: true });

    // What the hook calls.
    const againOne = ensure({ session: ONE, appRoot, parent });
    if (againOne.made) fails.push('a session that already had a copy was given a second one');
    if (againOne.app !== one.app) fails.push('a session was answered with somebody else\'s copy');
    const FIVE = 'aaaaaaaa-7777-7777-7777-777777777777';
    const fresh = ensure({ session: FIVE, appRoot, parent });
    if (!fresh.made) fails.push('a session with no copy was not given one');
    if (!existsSync(fresh.app)) fails.push('the copy a session was given is not on disk');
    // A record pointing at a deleted copy is replaced, not handed back.
    rmSync(fresh.app, { recursive: true, force: true });
    if (!ensure({ session: FIVE, appRoot, parent }).made) fails.push('a record pointing at a copy that is gone was handed back as one');
    remove({ session: FIVE, parent });

    // ---- The private handoff. ----
    // A branch sitting where it was cut carries none.
    if (handoffOn(appRoot, two.branch)) fails.push('a branch with no handoff commit on it was read as carrying one');

    let wrongPlace = '';
    try {
      releasePrivate({ session: ONE, parent, from: appRoot });
    } catch (error) {
      wrongPlace = error.message;
    }
    if (!wrongPlace.includes('inside a managed workspace')) fails.push('a private release was allowed from a primary checkout');
    let stranger = '';
    try {
      releasePrivate({ session: 'dddddddd-4444-4444-4444-444444444444', parent, from: one.app });
    } catch (error) {
      stranger = error.message;
    }
    if (!stranger.includes('no managed workspace')) fails.push('a session with no workspace was allowed to release one');

    const named = privateArguments(['--session', ONE, 'named handoff'], TWO);
    if (named.session !== ONE || named.message !== 'named handoff') fails.push('a named private handoff did not keep its target and message apart');
    const ordinary = privateArguments(['ordinary handoff'], TWO);
    if (ordinary.session !== TWO || ordinary.message !== 'ordinary handoff') fails.push('a private handoff without a target did not keep the running session and message');

    const handoff = releasePrivate({ ...named, parent, from: two.app });
    if (handoff.appBase !== one.appBase) fails.push('the handoff did not carry the app revision it was written on');
    if (!handoff.appPaths.includes('src/lib.rs')) fails.push('the handoff did not name the app file the work changed');
    if (git(appRoot, ['rev-list', '--count', `${one.appBase}..${one.branch}`]) !== '1') fails.push('a private release did not leave exactly one commit on the session\'s branch');
    if (staged(two.app) !== '') fails.push('a named private handoff staged the caller\'s copy');
    if (read(lib(two)) !== '// two\n') fails.push('a named private handoff changed the caller\'s file');

    // Released twice: still one commit, so the base stays the revision the copy was cut from.
    write(lib(one), '// one again\n');
    const again = releasePrivate({ session: ONE, parent, from: one.app });
    if (git(appRoot, ['rev-list', '--count', `${one.appBase}..${one.branch}`]) !== '1') fails.push('a second private release stacked another commit on the session\'s branch');
    if (again.appBase !== one.appBase) fails.push('a second private release moved the revision the handoff is written on');

    // Read back off the branch from the primary copy, which is where a submit reads it.
    const readBack = handoffOn(appRoot, one.branch);
    if (!readBack || readBack.appBase !== one.appBase) fails.push('the handoff could not be read back off the branch');
    if (!readBack?.appPaths.includes('src/lib.rs')) fails.push('the handoff read off the branch does not name the app file the work changed');

    // What a private release must never touch.
    if (refsIn(appRemote).join(' ') !== appRefsBefore.join(' ')) fails.push('a private release pushed to the app remote');
    if (refsIn(studioRemote).join(' ') !== studioRefsBefore.join(' ')) fails.push('a private release pushed to the plan remote');
    if (git(appRoot, ['tag', '-l'])) fails.push('a private release made a tag');
    if (git(one.app, ['tag', '-l'])) fails.push('a private release made a tag in the workspace');
    if (baseOf(appRoot) !== one.appBase) fails.push('a private release committed in the primary app copy');

    // Work a handoff has taken is no longer warned about.
    const assigned = assignedPaths(parent);
    if (!assigned.includes('app: src/lib.rs')) fails.push('a released handoff did not claim the app work it carries');
    if (assignedPaths(parent).length !== handoff.paths.length) fails.push('a session\'s handoff claimed work no session had released');
    const listed = workspaceStatuses(parent);
    const oneStatus = listed.find((status) => status.record.session === sessionTag(ONE));
    const twoStatus = listed.find((status) => status.record.session === sessionTag(TWO));
    if (oneStatus?.hasWork) fails.push('a clean handed-off copy was listed as holding work');
    if (!twoStatus?.hasWork || !workspaceLine(twoStatus).includes('work waiting')) fails.push('a dirty copy was not marked as holding work');
    const EMPTY = 'aaaaaaaa-8888-8888-8888-888888888888';
    const empty = create({ session: EMPTY, appRoot, parent });
    let emptyMessage = '';
    try {
      releasePrivate({ session: EMPTY, parent, from: empty.app });
    } catch (error) {
      emptyMessage = error.message;
    }
    if (!emptyMessage.includes(sessionTag(TWO)) || emptyMessage.includes(sessionTag(ONE))) fails.push('an empty handoff did not name only the other copy holding work');
    if (staged(two.app) !== '' || read(lib(two)) !== '// two\n') fails.push('an empty handoff changed the suggested copy');
    remove({ session: EMPTY, parent });
    // The overlapping half: the same file from the other session.
    releasePrivate({ session: TWO, parent, from: two.app });

    // ---- Submitting a handoff to the primary copy. ----
    const PLAIN = 'eeeeeeee-5555-5555-5555-555555555555';
    const OTHER = 'ffffffff-6666-6666-6666-666666666666';
    const three = create({ session: PLAIN, appRoot, parent });
    const four = create({ session: OTHER, appRoot, parent });
    write(join(three.app, 'src', 'three.rs'), '// three\n');
    write(join(four.app, 'src', 'four.rs'), '// four\n');
    const threeHandoff = releasePrivate({ session: PLAIN, parent, from: three.app });
    releasePrivate({ session: OTHER, parent, from: four.app });
    if (!threeHandoff.appPaths.includes('src/three.rs')) fails.push(`a handoff lost the app file its session added: ${JSON.stringify(threeHandoff.appPaths)}`);

    let fromWorkspace = '';
    try {
      submit({ session: PLAIN, parent, appRoot, from: three.app });
    } catch (error) {
      fromWorkspace = error.message;
    }
    if (!fromWorkspace.includes('from the primary checkout')) fails.push('a workspace was allowed to submit a handoff to the primary copy');

    submit({ session: PLAIN, parent, appRoot, from: appRoot });
    submit({ session: OTHER, parent, appRoot, from: appRoot });
    if (read(join(appRoot, 'src', 'three.rs')) !== '// three\n') fails.push('the first handoff did not reach the primary app copy');
    if (read(join(appRoot, 'src', 'four.rs')) !== '// four\n') fails.push('the second handoff did not reach the primary app copy');
    if (read(join(appRoot, 'src', 'three.rs')) !== '// three\n') fails.push('the second handoff took the first one\'s work');
    // Dirty on purpose: what arrived is read before it is committed.
    if (!dirtyPaths(appRoot).includes('src/three.rs')) fails.push('a submitted handoff left the primary app copy clean, so nothing is there to check');
    if (baseOf(appRoot) !== one.appBase) fails.push('a submit committed in the primary app copy');
    if (refsIn(appRemote).join(' ') !== appRefsBefore.join(' ')) fails.push('a submit pushed to the app remote');

    // Two handoffs on the same file: the second must change nothing.
    submit({ session: ONE, parent, appRoot, from: appRoot });
    const watched = ['src/lib.rs', 'src/three.rs', 'src/four.rs'].map((p) => join(appRoot, p));
    const before = JSON.stringify(watched.map(read));
    let overlap = '';
    try {
      submit({ session: TWO, parent, appRoot, from: appRoot });
    } catch (error) {
      overlap = error.message;
    }
    if (!overlap.includes('overlaps work already sitting')) fails.push(`an overlapping handoff was applied over one already there: ${overlap || 'it was allowed'}`);
    if (JSON.stringify(watched.map(read)) !== before) fails.push('a refused handoff still changed the primary copy');
    if (existsSync(reservationPath(parent))) fails.push('a refused submit kept the primary reservation');
    if (existsSync(journalPath(parent))) fails.push('a refused submit left its recovery journal behind');

    // A submit killed halfway: the next one reads its journal and puts the root back.
    write(join(appRoot, 'src', 'three.rs'), '// half-written\n');
    write(join(appRoot, 'src', 'never-asked-for.rs'), '// half-written\n');
    writeFileSync(journalPath(parent), JSON.stringify([
      { root: appRoot, path: 'src/three.rs', was: Buffer.from('// three\n').toString('base64') },
      { root: appRoot, path: 'src/never-asked-for.rs', was: null },
    ]) + '\n');
    mkdirSync(reservationPath(parent), { recursive: true });
    writeFileSync(join(reservationPath(parent), 'held-by.json'), JSON.stringify({ holder: 'killed', at: new Date(Date.now() - RESERVATION_STALE_MS - 1000).toISOString() }) + '\n');
    let afterKill = '';
    try {
      submit({ session: TWO, parent, appRoot, from: appRoot });
    } catch (error) {
      afterKill = error.message;
    }
    if (read(join(appRoot, 'src', 'three.rs')) !== '// three\n') fails.push('an interrupted submit left the primary app copy half-written');
    if (existsSync(join(appRoot, 'src', 'never-asked-for.rs'))) fails.push('an interrupted submit left behind a file it had added');
    if (!afterKill.includes('overlaps work already sitting')) fails.push('the submit after a recovery did not read the root it had just put back');
    if (existsSync(reservationPath(parent))) fails.push('a stale reservation was not taken over and released');

    // ---- The running order, which is the one plan file two sessions write at once. ----
    const order = join(ownersPlan, 'PLAN.md');
    write(order, '| 1 | first | Designed |\n| 2 | second | Designed |\n');
    const status = (row, was, now) => (text) => {
      if (!text.includes(`| ${row} | ${was} |`)) throw new Error(`the row for ${row} did not read ${was}`);
      return text.replace(`| ${row} | ${was} |`, `| ${row} | ${now} |`);
    };
    writePlanRow(parent, ONE, status('first', 'Designed', 'Dev'), { plans: ownersPlan });
    writePlanRow(parent, TWO, status('second', 'Designed', 'Released'), { plans: ownersPlan });
    if (!read(order).includes('| first | Dev |')) fails.push('one session\'s status did not land in the running order');
    if (!read(order).includes('| second | Released |')) fails.push('the second session\'s status did not land beside the first');
    if (existsSync(planClaimPath(parent))) fails.push('a finished running-order edit kept the claim');

    // The claim really is held across the read and the write: a second run inside the first one's edit waits it out rather than reading the rows it is halfway through.
    let held = '';
    writePlanRow(parent, ONE, (text) => {
      try {
        writePlanRow(parent, TWO, (inner) => inner, { plans: ownersPlan, waitMs: 0 });
      } catch (error) {
        held = error.message;
      }
      return text;
    }, { plans: ownersPlan });
    if (!held.includes('is writing the running order')) fails.push('two sessions edited the running order at the same moment');
    if (existsSync(planClaimPath(parent))) fails.push('a running-order edit that threw inside kept the claim');

    // A claim left behind by a killed run is taken over rather than wedging the next pass. On the shipped default, which is what a session actually runs.
    mkdirSync(planClaimPath(parent), { recursive: true });
    writeFileSync(join(planClaimPath(parent), 'held-by.json'), JSON.stringify({ holder: 'killed', at: new Date(Date.now() - PLAN_CLAIM_STALE_MS - 1000).toISOString() }) + '\n');
    writePlanRow(parent, TWO, status('first', 'Dev', 'Released'), { plans: ownersPlan });
    if (!read(order).includes('| first | Released |')) fails.push('a claim a killed run left behind wedged the next session');

    // The wait ends when the holder gives the claim up, not on a stopwatch: the clock is well past the ten seconds that used to refuse, and the holder lets go on the first pass.
    mkdirSync(planClaimPath(parent), { recursive: true });
    writeFileSync(join(planClaimPath(parent), 'held-by.json'), JSON.stringify({ holder: 'the other session', at: new Date().toISOString() }) + '\n');
    const said = [];
    let ticked = 0;
    const started = Date.now();
    claimPlan(parent, ONE, {
      clock: () => started + (ticked += 20 * 1000),
      sleep: () => releasePlan(parent),
      notify: (message) => said.push(message),
    });
    const holds = JSON.parse(read(join(planClaimPath(parent), 'held-by.json')) || '{}');
    if (holds.holder !== sessionTag(ONE)) fails.push('a session that waited out the holder was refused instead of ending up with the running order');
    if (said.length !== 1) fails.push(`a waiting session said so ${said.length} times rather than once`);
    if (!said[0]?.includes('the other session')) fails.push('a waiting session did not say who it was waiting for');
    releasePlan(parent);

    // The refusal is still there for a caller that asks for one, and says how long it held on.
    mkdirSync(planClaimPath(parent), { recursive: true });
    writeFileSync(join(planClaimPath(parent), 'held-by.json'), JSON.stringify({ holder: 'the other session', at: new Date().toISOString() }) + '\n');
    let atOnce = '';
    try {
      claimPlan(parent, TWO, { waitMs: 0, notify: () => {} });
    } catch (error) {
      atOnce = error.message;
    }
    if (!atOnce.includes('after waiting 0s')) fails.push(`a refusal on a caller's own deadline did not say how long it waited: ${atOnce || 'it was allowed'}`);
    releasePlan(parent);

    // The copy a skill edits by hand. Nothing is held while it is open — the fingerprint it was taken at is what decides the write.
    const taken = openPlan({ session: ONE, parent, plans: ownersPlan });
    if (read(taken.scratch) !== read(order)) fails.push('the copy taken to edit is not the running order');
    if (existsSync(planClaimPath(parent))) fails.push('a copy handed back to edit held the claim across the edit, which nothing is running to renew');
    write(taken.scratch, read(taken.scratch).replace('| second | Released |', '| second | Dev |'));
    closePlan({ session: ONE, parent });
    if (!read(order).includes('| second | Dev |')) fails.push('an edited copy did not reach the running order');
    if (existsSync(taken.scratch)) fails.push('a written-back copy was left behind');
    if (existsSync(planOpenedPath(parent, ONE))) fails.push('a written-back copy left its record behind');
    if (existsSync(planClaimPath(parent))) fails.push('writing a copy back kept the claim');

    // A copy written back over rows it never read takes them with it, so it is refused instead — and kept, because it is the only place that edit exists.
    const stale = openPlan({ session: ONE, parent, plans: ownersPlan });
    write(stale.scratch, read(stale.scratch).replace('| second | Dev |', '| second | Ready |'));
    write(order, '| 1 | first | Released |\n| 2 | second | Dev |\n| 3 | third | Ready |\n');
    let moved = '';
    try {
      closePlan({ session: ONE, parent });
    } catch (error) {
      moved = error.message;
    }
    if (!moved.includes('moved while this copy was open')) fails.push('a copy taken before another session\'s row was written back over it');
    if (!moved.includes(stale.scratch)) fails.push('a refused write back did not say where the copy it refused is');
    if (!existsSync(stale.scratch)) fails.push('a refused write back deleted the copy it told the session to redo the row from');
    if (!read(order).includes('third')) fails.push('a refused write back took the row another session had just added');
    if (existsSync(planClaimPath(parent))) fails.push('a refused write back kept the claim');
    rmSync(stale.scratch, { force: true });
    rmSync(planOpenedPath(parent, ONE), { force: true });

    // Two sessions hold a copy at the same moment: neither blocks the other, the first to write back lands, and the second is refused with its own copy still there to redo the row from.
    write(order, '| 1 | first | Released |\n| 2 | second | Dev |\n');
    const bothOne = openPlan({ session: ONE, parent, plans: ownersPlan });
    const bothTwo = openPlan({ session: TWO, parent, plans: ownersPlan });
    if (read(bothTwo.scratch) !== read(bothOne.scratch)) fails.push('two sessions opening the running order were given different copies of it');
    write(bothOne.scratch, read(bothOne.scratch).replace('| first | Released |', '| first | Dev |'));
    write(bothTwo.scratch, read(bothTwo.scratch).replace('| second | Dev |', '| second | Released |'));
    closePlan({ session: ONE, parent });
    if (!read(order).includes('| first | Dev |')) fails.push('the first of two open copies did not reach the running order');
    let secondBack = '';
    try {
      closePlan({ session: TWO, parent });
    } catch (error) {
      secondBack = error.message;
    }
    if (!secondBack.includes('moved while this copy was open')) fails.push('the second of two open copies was written back over the first one\'s row');
    if (!existsSync(bothTwo.scratch)) fails.push('the second session\'s copy was deleted rather than kept to redo the row from');
    if (!read(order).includes('| first | Dev |')) fails.push('a refused write back took the row the other session had just written');
    rmSync(bothTwo.scratch, { force: true });
    rmSync(planOpenedPath(parent, TWO), { force: true });

    let unheld = '';
    try {
      closePlan({ session: TWO, parent });
    } catch (error) {
      unheld = error.message;
    }
    if (!unheld.includes('not holding the running order')) fails.push('a session that had taken no copy was allowed to write one back');

    // A live reservation waits for its holder rather than refusing the next handoff.
    reserve(parent, ONE);
    let retries = 0;
    const waitingNow = Date.now();
    reserve(parent, TWO, {
      clock: () => waitingNow,
      sleep: () => {
        retries += 1;
        releaseReservation(parent);
      },
    });
    if (retries !== 1) fails.push('a live primary reservation was not retried once before it was released');
    if (JSON.parse(readFileSync(join(reservationPath(parent), 'held-by.json'), 'utf8')).holder !== TWO) fails.push('a retried primary reservation did not reach the waiting session');
    let timedOut = '';
    try {
      reserve(parent, ONE, { waitMs: 0 });
    } catch (error) {
      timedOut = error.message;
    }
    if (!timedOut.includes(`${TWO} holds the primary reservation`)) fails.push('a timed-out primary reservation did not name its holder');
    if (JSON.parse(readFileSync(join(reservationPath(parent), 'held-by.json'), 'utf8')).holder !== TWO) fails.push('a timed-out primary reservation took the live claim');
    releaseReservation(parent);

    // A killed reservation is taken over after the same two-minute window as the running order claim.
    mkdirSync(reservationPath(parent), { recursive: true });
    writeFileSync(join(reservationPath(parent), 'held-by.json'), JSON.stringify({ holder: 'killed', at: new Date(Date.now() - RESERVATION_STALE_MS - 1).toISOString() }) + '\n');
    reserve(parent, TWO);
    if (JSON.parse(readFileSync(join(reservationPath(parent), 'held-by.json'), 'utf8')).holder !== TWO) fails.push('a primary reservation older than two minutes was not taken over');
    releaseReservation(parent);
    reserve(parent, ONE);
    let stillHeld = '';
    try {
      reserve(parent, TWO, { waitMs: 0 });
    } catch (error) {
      stillHeld = error.message;
    }
    if (!stillHeld.includes(`${ONE} holds the primary reservation`)) fails.push('a primary reservation inside two minutes was taken over');
    releaseReservation(parent);

    for (const session of [PLAIN, OTHER]) remove({ session, parent });

    remove({ session: ONE, parent });
    if (existsSync(one.home)) fails.push('a removed workspace left its folder on disk');
    if (existsSync(one.app)) fails.push('a removed workspace left its app copy on disk');
    if (!existsSync(two.app)) fails.push('removing one session\'s copy took the other\'s');
    if (read(lib(two)) !== '// two\n') fails.push('removing one session\'s copy took the other\'s app edit');
    remove({ session: TWO, parent });
  } catch (error) {
    fails.push(`workspace: ${error.message}`);
  } finally {
    for (const session of [ONE, TWO, 'eeeeeeee-5555-5555-5555-555555555555', 'ffffffff-6666-6666-6666-666666666666']) {
      try {
        remove({ session, parent });
      } catch {
        // Already down, or never up.
      }
    }
    rmSync(home, { recursive: true, force: true });
  }

  if (fails.length) {
    console.error('agent-workspace: failed');
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('agent-workspace: ok (private app copies keeping source, index and build apart while the plan stays the owner\'s; one-commit handoffs that reach no remote; two arriving at the primary copy, an overlap refused, and an interrupted submit put back; two sessions writing the running order one at a time, a killed run\'s claim taken over, a session waiting out the run holding it rather than a stopwatch, two copies open at once with nothing held between them, and a copy taken before somebody else\'s row refused and kept; a release reading one still copy of the plan tree, a moving tree refused, and the copy gone on every result)');
}

function main(args) {
  const parent = workspaceParent();
  const session = sessionOf('');
  const appRoot = repoRoot(here);
  const command = args[0] || 'path';
  if (command === 'create') {
    const record = create({ session, appRoot, parent });
    console.log(record.app);
    console.log(record.planTree);
    return;
  }
  if (command === 'private') {
    const target = privateArguments(args.slice(1), session);
    const handoff = releasePrivate({ ...target, parent });
    console.log(`${sessionTag(target.session)}  ${handoff.branch}  ${handoff.appPaths.length} app paths on ${handoff.appBase.slice(0, 8)}`);
    return;
  }
  if (command === 'submit') {
    const handoff = submit({ session: args[1] || '', parent, appRoot: primaryAppRoot() });
    console.log(`${handoff.branch}  ${handoff.appPaths.length} app paths — the primary app copy is dirty now, so check it before releasing`);
    return;
  }
  if (command === 'plan-open') {
    console.log(openPlan({ session, parent }).scratch);
    return;
  }
  if (command === 'plan-close') {
    console.log(closePlan({ session, parent }));
    return;
  }
  if (command === 'remove') {
    console.log(remove({ session, parent }).app);
    return;
  }
  if (command === 'list') {
    for (const status of workspaceStatuses(parent)) console.log(workspaceLine(status));
    return;
  }
  if (command === 'path') {
    const record = manifests(parent).find((m) => m.session === sessionTag(session));
    if (!record) {
      console.error(`no managed workspace for this session under ${parent}`);
      process.exit(1);
    }
    console.log(record.app);
    return;
  }
  console.error('usage: agent-workspace.mjs create | path | list | private [--session <session>] [message] | submit <session> | plan-open | plan-close | remove | --check');
  process.exit(1);
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
const args = invoked === import.meta.url ? process.argv.slice(2) : null;
if (!args) {
  // Imported, not run.
} else if (args.includes('--check')) {
  selfTest();
} else {
  try {
    main(args);
  } catch (error) {
    console.error(`agent-workspace: ${error.message}`);
    process.exit(1);
  }
}
