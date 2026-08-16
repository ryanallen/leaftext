#!/usr/bin/env node
// One session's private pair of worktrees, so two agents at once cannot take each other's work.
//
// `leaftext/` is two repositories: Studio owns the plan tree, the nested Leaftext repository owns the app at Studio's own ignored `leaftext/app/`. A pair is one worktree of each, at the path shape the primary checkout has.
//
//   node scripts/agent-workspace.mjs create      make this session's pair
//   node scripts/agent-workspace.mjs path        where this session's pair is
//   node scripts/agent-workspace.mjs list        every managed workspace
//   node scripts/agent-workspace.mjs private     hand this session's finished work over on its own private branch
//   node scripts/agent-workspace.mjs submit <s>  apply one session's private handoff to the primary copies
//   node scripts/agent-workspace.mjs remove      take this session's pair down
//   node scripts/agent-workspace.mjs --check     self-test (`just check-workspace`)
//
// A hook runs `create` before every message; nobody types it. `private` commits and pushes, so `scripts/gate-git.mjs` gates that one — the gate reads a command string and cannot see the git a script spawns.
//
// The private parent is outside every repository: Studio work sits inside the Studio tree, which is one too, so a parent under either would be untracked noise in a third status.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sessionOf, sessionTag } from './hook-payload.mjs';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');

/// Where pairs are made. Overridable so the self-test gets a folder of its own.
export function workspaceParent() {
  return (process.env.LEAFTEXT_WORKSPACES || '').trim() || join(homedir(), '.leaftext-workspaces');
}

/// One branch name in both repositories: it is one session's work.
export function branchFor(session) {
  const tag = sessionTag(session);
  return tag ? `agent/${tag}` : '';
}

/// The pair's two paths. The app sits at Studio's own ignored one, keeping the ownership boundary.
export function workspacePaths(parent, session) {
  const tag = sessionTag(session);
  if (!tag) return null;
  const studio = join(parent, tag);
  return { tag, studio, app: join(studio, 'leaftext', 'app'), manifest: join(parent, `${tag}.json`) };
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

/// The revision a pair is cut from, so a handoff can be checked against it.
export function baseOf(dir) {
  try {
    return git(dir, ['rev-parse', 'HEAD']);
  } catch {
    return '';
  }
}

/// Why a pair may not be made, or ''. Pure, so refusals are proved without breaking a checkout.
export function creationRefusal(state) {
  const { session, studioRoot, appRoot, parent, target, managed } = state;
  if (!sessionTag(session)) return 'no session id, so there is nothing to keep one agent\'s work apart from another\'s';
  if (managed) return 'this is already a managed workspace — a session makes its own and never another\'s';
  if (!studioRoot) return 'the Studio work path is not a repository\'s own top level';
  if (!appRoot) return 'the Leaftext app path is not a repository\'s own top level';
  if (resolve(studioRoot) === resolve(appRoot)) return 'the plan and the app answered one repository, and a pair needs two';
  if (!inside(parent, target)) return `the workspace path ${target} is outside the private worktree parent ${parent}`;
  return '';
}

/// Said, not refused: a copy is cut at the primary's revision and never carries its loose work, and refusing would strand every session while a handoff waits to be released.
export function creationWarnings(state) {
  const { studioDirty = [], appDirty = [], assigned = [] } = state;
  const held = new Set(assigned);
  const loose = [...studioDirty.map((p) => `plan: ${p}`), ...appDirty.map((p) => `app: ${p}`)].filter((p) => !held.has(p));
  if (!loose.length) return [];
  return [`the copy the owner reads has work no handoff has taken, and this pair is cut without it: ${loose.slice(0, 8).join(', ')}${loose.length > 8 ? ` and ${loose.length - 8} more` : ''}`];
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
      // A leading dot belongs to a submit, not to a pair.
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

/// The primary pair: the app is where this script lives, Studio two folders above it.
export function primaryRoots() {
  return { appRoot: repoRoot(here), studioRoot: repoRoot(join(here, '..', '..')) };
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

/// Make a pair. Studio first — the app worktree goes inside it.
export function create({ session, studioRoot, appRoot, parent }) {
  const paths = workspacePaths(parent, session);
  const state = {
    session,
    studioRoot,
    appRoot,
    parent,
    target: paths ? paths.studio : parent,
    managed: isManaged(appRoot) || isManaged(studioRoot),
    studioDirty: dirtyPaths(studioRoot),
    appDirty: dirtyPaths(appRoot),
    assigned: assignedPaths(parent),
  };
  const refusal = creationRefusal(state);
  if (refusal) throw new Error(refusal);
  const warnings = creationWarnings(state);
  if (existsSync(paths.studio)) throw new Error(`${paths.studio} is already there — remove this session's workspace before making another`);

  const branch = branchFor(session);
  const studioBase = baseOf(studioRoot);
  const appBase = baseOf(appRoot);
  mkdirSync(parent, { recursive: true });
  attach(studioRoot, branch, paths.studio, studioBase);
  mkdirSync(dirname(paths.app), { recursive: true });
  attach(appRoot, branch, paths.app, appBase);

  const record = { session: paths.tag, branch, studio: paths.studio, app: paths.app, studioRoot, appRoot, studioBase, appBase, warnings };
  writeFileSync(paths.manifest, JSON.stringify(record, null, 2) + '\n');
  return record;
}

/// This session's pair, made if it is not there. What the hook calls before every message.
export function ensure({ session, studioRoot, appRoot, parent }) {
  const tag = sessionTag(session);
  if (!tag) throw new Error('no session id, so there is nothing to keep one agent\'s work apart from another\'s');
  const already = manifests(parent).find((m) => m.session === tag);
  if (already && existsSync(already.app) && existsSync(already.studio)) return { ...already, made: false };
  if (already) remove({ session, parent });
  return { ...create({ session, studioRoot, appRoot, parent }), made: true };
}

/// Take a pair down, app first — it lives inside Studio. The branches stay: the handoff is on them.
export function remove({ session, parent }) {
  const paths = workspacePaths(parent, session);
  if (!paths) throw new Error('no session id, so there is no workspace to name');
  const record = manifests(parent).find((m) => m.session === paths.tag);
  if (!record) throw new Error(`no managed workspace for this session under ${parent}`);
  for (const [root, tree] of [[record.appRoot, record.app], [record.studioRoot, record.studio]]) {
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
  rmSync(paths.manifest, { force: true });
  return record;
}

/// Where the patch and its record sit. Out of the plan tree: delivery is not planning.
export function handoffPaths(studio, tag) {
  const folder = join(studio, '.handoff', tag);
  return { folder, patch: join(folder, 'app.patch'), record: join(folder, 'handoff.json') };
}

/// Deliver privately: plan changes and app patch on this session's Studio branch. No tag, no version, no word to the Leaftext remote.
export function releasePrivate({ session, parent, from = process.cwd(), message = '' }) {
  const tag = sessionTag(session);
  if (!tag) throw new Error('no session id, so there is no workspace to release');
  if (!isManaged(from)) throw new Error('a private release runs inside a managed workspace — the primary copy makes the public one');
  const record = manifests(parent).find((m) => m.session === tag);
  if (!record) throw new Error(`no managed workspace for this session under ${parent}`);
  if (!isManaged(record.studio) || !isManaged(record.app)) throw new Error(`${record.studio} is not a managed pair any more`);

  // Staged first, so a file the work added travels with the ones it changed.
  git(record.app, ['add', '-A']);
  const appPaths = git(record.app, ['diff', '--cached', '--name-only', record.appBase]).split('\n').filter(Boolean);
  const patch = gitRaw(record.app, ['diff', '--cached', '--binary', record.appBase]);
  // Read before the handoff is written, or it counts itself.
  git(record.studio, ['add', '-A']);
  const planPaths = git(record.studio, ['diff', '--cached', '--name-only', record.studioBase]).split('\n').filter(Boolean);
  if (!appPaths.length && !planPaths.length) throw new Error('this workspace has no work in it, so there is nothing to hand over');

  const where = handoffPaths(record.studio, tag);
  mkdirSync(where.folder, { recursive: true });
  writeFileSync(where.patch, patch);
  const handoff = {
    session: tag,
    branch: record.branch,
    studioBase: record.studioBase,
    appBase: record.appBase,
    planPaths,
    appPaths,
    paths: [...planPaths.map((p) => `plan: ${p}`), ...appPaths.map((p) => `app: ${p}`)],
    patch: `.handoff/${tag}/app.patch`,
  };
  writeFileSync(where.record, JSON.stringify(handoff, null, 2) + '\n');

  git(record.studio, ['add', '-A']);
  // Unsigned: nobody publishes this branch, and a machine with no key must still hand work over.
  git(record.studio, ['-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign', '-m', message || `Private handoff ${tag}`]);
  handoff.commit = baseOf(record.studio);

  const remotes = git(record.studio, ['remote']).split('\n').filter(Boolean);
  if (!remotes.includes('origin')) throw new Error('the private Studio repository has no origin to push the handoff to');
  git(record.studio, ['push', 'origin', `${record.branch}:${record.branch}`]);

  writeFileSync(join(parent, `${tag}.json`), JSON.stringify({ ...record, handoff }, null, 2) + '\n');
  return handoff;
}

// ---------------------------------------------------------------------------
// Submitting one private handoff to the primary copies.
// ---------------------------------------------------------------------------

/// The claim on the primary pair. A folder: making one is the cheapest atomic act both platforms have.
export function reservationPath(parent) {
  return join(parent, '.reservation');
}

/// What the primary copies held before a submit touched them. One file, because one reservation means one submit.
export function journalPath(parent) {
  return join(parent, '.journal.json');
}

/// Past this a claim belonged to a killed run. Taking it over is safe — the journal is rolled back first.
export const RESERVATION_STALE_MS = 60 * 60 * 1000;

/// Take the claim, or say who holds it.
export function reserve(parent, holder, now = Date.now()) {
  mkdirSync(parent, { recursive: true });
  const path = reservationPath(parent);
  try {
    mkdirSync(path);
  } catch {
    let held = { holder: 'another session', at: 0 };
    try {
      held = JSON.parse(readFileSync(join(path, 'held-by.json'), 'utf8'));
    } catch {
      // An unreadable claim waits out the window like any other.
    }
    if (now - Date.parse(held.at || 0) < RESERVATION_STALE_MS) {
      throw new Error(`${held.holder} holds the primary reservation — one handoff reaches the primary copies at a time`);
    }
  }
  writeFileSync(join(path, 'held-by.json'), JSON.stringify({ holder: sessionTag(holder) || 'unknown', at: new Date().toISOString() }) + '\n');
}

/// Give the claim back, on every result.
export function releaseReservation(parent) {
  rmSync(reservationPath(parent), { recursive: true, force: true });
}

function bytesAt(path) {
  try {
    return readFileSync(path).toString('base64');
  } catch {
    return null;
  }
}

/// What the primary copies hold where a handoff will write. `null` is a path that was not there.
export function journalFor(roots, handoff) {
  const entries = [];
  for (const [root, paths] of [[roots.studioRoot, handoff.planPaths], [roots.appRoot, handoff.appPaths]]) {
    for (const path of paths) entries.push({ root, path, was: bytesAt(join(root, path)) });
  }
  return entries;
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
  const { managed, handoff, studioHead, appHead, planDirty = [], appDirty = [] } = state;
  if (managed) return 'a handoff is submitted from the primary checkout — a workspace hands its work over, it does not take another\'s';
  if (!handoff) return 'that branch carries no handoff';
  if (handoff.studioBase !== studioHead) return `the handoff was written on plan revision ${handoff.studioBase.slice(0, 8)} and the primary copy is on ${studioHead.slice(0, 8)} — release it again from a fresh workspace`;
  if (handoff.appBase !== appHead) return `the handoff was written on app revision ${handoff.appBase.slice(0, 8)} and the primary copy is on ${appHead.slice(0, 8)} — release it again from a fresh workspace`;
  const clash = [
    ...(handoff.planPaths || []).filter((p) => planDirty.includes(p)).map((p) => `plan: ${p}`),
    ...(handoff.appPaths || []).filter((p) => appDirty.includes(p)).map((p) => `app: ${p}`),
  ];
  if (clash.length) return `${handoff.branch} overlaps work already sitting in a primary copy: ${clash.join(', ')}`;
  return '';
}

/// Read off the branch, not the record beside the pair: the branch is what was pushed.
export function handoffOn(studioRoot, branch, tag) {
  try {
    return JSON.parse(git(studioRoot, ['show', `${branch}:.handoff/${tag}/handoff.json`]));
  } catch {
    return null;
  }
}

/// Apply one handoff and leave the primary copies dirty. Nothing here commits, tags or pushes.
export function submit({ session, parent, studioRoot, appRoot, from = process.cwd(), now = Date.now() }) {
  const tag = sessionTag(session);
  if (!tag) throw new Error('no session named, so there is no handoff to submit');
  const managed = isManaged(from);
  if (managed) throw new Error(submitRefusal({ managed }));

  reserve(parent, tag, now);
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
    const handoff = handoffOn(studioRoot, branch, tag);
    const refusal = submitRefusal({
      managed,
      handoff,
      studioHead: baseOf(studioRoot),
      appHead: baseOf(appRoot),
      planDirty: dirtyPaths(studioRoot),
      appDirty: dirtyPaths(appRoot),
    });
    if (refusal) throw new Error(refusal);

    journal = journalFor({ studioRoot, appRoot }, handoff);
    writeFileSync(journalPath(parent), JSON.stringify(journal) + '\n');

    // A path the branch does not have is one the work deleted.
    for (const path of handoff.planPaths) {
      const full = join(studioRoot, path);
      let content = null;
      try {
        content = execFileSync('git', ['-C', studioRoot, 'show', `${branch}:${path}`], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
      } catch {
        content = null;
      }
      if (content === null) rmSync(full, { force: true });
      else {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
    }

    // The app half is the patch, against the revision just checked.
    if (handoff.appPaths.length) {
      const patch = git(studioRoot, ['show', `${branch}:${handoff.patch}`]);
      execFileSync('git', ['-C', appRoot, 'apply', '-'], { input: patch + '\n', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
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

/// A stand-in pair, each half with a bare remote — so what is pushed is a fact rather than a promise.
function fixtures(home) {
  const studioRoot = join(home, 'work');
  const appRoot = join(home, 'app');
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
    // The real pair is LF by `.gitattributes`; without this Windows rewrites every applied patch to CRLF.
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
    studioRoot: '/repo/work',
    appRoot: '/repo/app',
    parent: '/private',
    target: '/private/aaaaaaaa-1111-1111-1111-111111111111',
    managed: false,
  };
  const wants = [
    ['a workspace with everything in place is allowed', ok, ''],
    ['no session id', { ...ok, session: '' }, 'no session id'],
    ['a root that is not a repository', { ...ok, studioRoot: '' }, 'not a repository'],
    ['an app path that is not a repository', { ...ok, appRoot: '' }, 'not a repository'],
    ['one repository answering for both', { ...ok, appRoot: '/repo/work' }, 'one repository'],
    ['a target outside the private parent', { ...ok, target: '/elsewhere/x' }, 'outside the private worktree parent'],
    ['a target that is the parent itself', { ...ok, target: '/private' }, 'outside the private worktree parent'],
    ['a managed workspace starting another', { ...ok, managed: true }, 'already a managed workspace'],
    // Said, never refused.
    ['a primary plan copy with work in it', { ...ok, studioDirty: ['docs/PLAN.md'] }, ''],
    ['a primary app copy with work in it', { ...ok, appDirty: ['src/lib.rs'] }, ''],
  ];
  for (const [name, state, want] of wants) {
    const got = creationRefusal(state);
    if (want === '' && got) fails.push(`${name}: refused with "${got}"`);
    if (want !== '' && !got.includes(want)) fails.push(`${name}: said "${got || 'nothing'}", wanted "${want}"`);
  }
  if (creationWarnings(ok).length) fails.push('a clean primary pair was warned about');
  if (!creationWarnings({ ...ok, appDirty: ['src/lib.rs'] })[0]?.includes('src/lib.rs')) fails.push('work in a primary copy was not said out loud');
  if (creationWarnings({ ...ok, appDirty: ['src/lib.rs'], assigned: ['app: src/lib.rs'] }).length) fails.push('work a handoff has already taken was warned about again');
  if (inside('/private', '/private/../other')) fails.push('inside: a path that climbs out was read as being under the parent');
  if (!inside('/private', '/private/a/b')) fails.push('inside: a path well under the parent was read as outside it');
  if (branchFor('') !== '') fails.push('branchFor: no session id still named a branch');
  if (branchFor('a-1') === branchFor('b-2')) fails.push('branchFor: two sessions share one branch');

  const handoff = { branch: 'agent/one', studioBase: 'sss', appBase: 'aaa', planPaths: ['leaftext/docs/PLAN.md'], appPaths: ['src/lib.rs'] };
  const fine = { managed: false, handoff, studioHead: 'sss', appHead: 'aaa' };
  const submits = [
    ['a handoff on both primary revisions is applied', fine, ''],
    ['a handoff submitted from a workspace', { ...fine, managed: true }, 'submitted from the primary checkout'],
    ['a branch with no handoff on it', { ...fine, handoff: null }, 'carries no handoff'],
    ['a handoff written on an older plan revision', { ...fine, studioHead: 'zzz' }, 'the primary copy is on'],
    ['a handoff written on an older app revision', { ...fine, appHead: 'zzz' }, 'the primary copy is on'],
    ['a plan path another handoff already put there', { ...fine, planDirty: ['leaftext/docs/PLAN.md'] }, 'overlaps work already sitting'],
    ['an app path another handoff already put there', { ...fine, appDirty: ['src/lib.rs'] }, 'overlaps work already sitting'],
    ['work in a primary copy that this handoff does not touch', { ...fine, appDirty: ['src/other.rs'] }, ''],
  ];
  for (const [name, state, want] of submits) {
    const got = submitRefusal(state);
    if (want === '' && got) fails.push(`${name}: refused with "${got}"`);
    if (want !== '' && !got.includes(want)) fails.push(`${name}: said "${got || 'nothing'}", wanted "${want}"`);
  }
  return fails;
}

/// `scripts/prepare-release.mts` must keep refusing a session's copy through the reader tested above. A second implementation there would pass its own check and let a copy tag.
function publicReleaseGuard() {
  const fails = [];
  const text = readFileSync(join(here, 'scripts', 'prepare-release.mts'), 'utf8');
  if (!/import \{[^}]*\bisManaged\b[^}]*\} from "\.\/agent-workspace\.mjs"/.test(text)) fails.push('the public release path does not read a managed workspace with this helper');
  const asks = text.indexOf('assertPrimaryCheckout();');
  const checks = text.indexOf('runRequired("just", ["verify"]);');
  const commits = text.indexOf('runRequired("git", commitArgs)');
  if (asks < 0) fails.push('the public release path never asks whether it is in a managed workspace');
  else if (commits < 0 || asks > commits) fails.push('the public release path asks about the workspace after it has already committed');
  // A handoff arrives unchecked, so the suite runs before anything is tagged.
  if (checks < 0) fails.push('the public release path no longer runs the check suite');
  else if (commits < 0 || checks > commits) fails.push('the public release path checks after it has already committed');
  return fails;
}

function selfTest() {
  const fails = [...refusalCases(), ...publicReleaseGuard()];
  // This run's own folder: two suites at once must not share fixtures.
  const home = mkdtempSync(join(tmpdir(), `leaf-workspace-${process.pid}-`));
  const parent = join(home, 'private');
  const ONE = 'aaaaaaaa-1111-1111-1111-111111111111';
  const TWO = 'bbbbbbbb-2222-2222-2222-222222222222';
  try {
    const { studioRoot, appRoot, studioRemote, appRemote } = fixtures(home);
    const appRefsBefore = refsIn(appRemote);
    if (!repoRoot(studioRoot)) fails.push('repoRoot: the fixture Studio repository was not read as one');
    if (repoRoot(join(studioRoot, 'leaftext'))) fails.push('repoRoot: a folder inside a repository was read as its own top level');
    if (isManaged(studioRoot)) fails.push('isManaged: a primary checkout was read as a workspace');

    const one = create({ session: ONE, studioRoot, appRoot, parent });
    const two = create({ session: TWO, studioRoot, appRoot, parent });
    if (one.studio === two.studio) fails.push('two sessions were given one Studio worktree');
    if (one.app === two.app) fails.push('two sessions were given one app worktree');
    if (!isManaged(one.app)) fails.push('isManaged: a made workspace was not read as one');
    if (one.studioBase !== baseOf(studioRoot)) fails.push('the Studio base revision was not recorded');
    if (one.appBase !== baseOf(appRoot)) fails.push('the app base revision was not recorded');

    // The plan tree, which two rankings at once reset under each other.
    const plan = (w) => join(w.studio, 'leaftext', 'docs', 'PLAN.md');
    write(plan(one), '# one\n');
    write(plan(two), '# two\n');
    if (read(plan(one)) !== '# one\n') fails.push('one session\'s plan edit did not survive the other\'s');
    if (read(plan(two)) !== '# two\n') fails.push('one session\'s plan edit took the other\'s');
    if (read(join(studioRoot, 'leaftext', 'docs', 'PLAN.md')) !== '# primary plan\n') fails.push('a workspace plan edit reached the primary copy');

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

    // A second pair for a session that has one.
    let second = '';
    try {
      create({ session: ONE, studioRoot, appRoot, parent });
    } catch (error) {
      second = error.message;
    }
    if (!second.includes('already there')) fails.push('a session was given a second workspace over its first');

    // Two pairs of edited, staged and built work leave the primary copies clean.
    if (dirtyPaths(appRoot).length) fails.push(`a workspace left work in the primary app copy: ${dirtyPaths(appRoot).join(', ')}`);
    if (dirtyPaths(studioRoot).length) fails.push(`a workspace left work in the primary plan copy: ${dirtyPaths(studioRoot).join(', ')}`);

    // Said and stepped around, never refused.
    const THREE = 'cccccccc-3333-3333-3333-333333333333';
    write(join(appRoot, 'src', 'half-done.rs'), '// mid-edit\n');
    const third = create({ session: THREE, studioRoot, appRoot, parent });
    if (!third.warnings.join(' ').includes('src/half-done.rs')) fails.push('a workspace cut while a primary copy had work in it did not say so');
    if (existsSync(join(third.app, 'src', 'half-done.rs'))) fails.push('a workspace was cut carrying work the primary copy had not committed');
    remove({ session: THREE, parent });
    rmSync(join(appRoot, 'src', 'half-done.rs'), { force: true });

    // What the hook calls.
    const againOne = ensure({ session: ONE, studioRoot, appRoot, parent });
    if (againOne.made) fails.push('a session that already had a copy was given a second one');
    if (againOne.studio !== one.studio) fails.push('a session was answered with somebody else\'s copy');
    const FIVE = 'aaaaaaaa-7777-7777-7777-777777777777';
    const fresh = ensure({ session: FIVE, studioRoot, appRoot, parent });
    if (!fresh.made) fails.push('a session with no copy was not given one');
    if (!existsSync(fresh.app)) fails.push('the copy a session was given is not on disk');
    // A record pointing at a deleted copy is replaced, not handed back.
    rmSync(fresh.app, { recursive: true, force: true });
    if (!ensure({ session: FIVE, studioRoot, appRoot, parent }).made) fails.push('a record pointing at a copy that is gone was handed back as one');
    remove({ session: FIVE, parent });

    // ---- Phase 2: the private handoff. ----
    // A private release runs from inside a copy.
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

    const handoff = releasePrivate({ session: ONE, parent, from: one.app });
    if (handoff.appBase !== one.appBase) fails.push('the handoff did not carry the app revision it was written on');
    if (!handoff.appPaths.includes('src/lib.rs')) fails.push('the handoff did not name the app file the work changed');
    if (!handoff.planPaths.includes('leaftext/docs/PLAN.md')) fails.push('the handoff did not name the plan file the work changed');

    // Read off the remote, not the tree that pushed it.
    const onBranch = (path) => {
      try {
        return execFileSync('git', ['-C', studioRemote, 'show', `${one.branch}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch {
        return null;
      }
    };
    if (onBranch('leaftext/docs/PLAN.md') !== '# one\n') fails.push('the private branch does not carry the plan change');
    const carried = onBranch(`.handoff/${one.session}/app.patch`);
    if (!carried) fails.push('the private branch does not carry the app patch');
    else if (!carried.includes('src/lib.rs')) fails.push('the app patch does not carry the app change');
    const carriedRecord = onBranch(`.handoff/${one.session}/handoff.json`);
    if (!carriedRecord || JSON.parse(carriedRecord).appBase !== one.appBase) fails.push('the private branch does not carry the app base revision beside its patch');
    if (onBranch('src/lib.rs') !== null) fails.push('the private branch carries the app source itself rather than a patch of it');

    // What a private release must never touch.
    if (refsIn(appRemote).join(' ') !== appRefsBefore.join(' ')) fails.push('a private release pushed to the Leaftext remote');
    if (git(appRoot, ['tag', '-l'])) fails.push('a private release made a tag');
    if (git(one.app, ['tag', '-l'])) fails.push('a private release made a tag in the workspace');
    if (baseOf(one.app) !== one.appBase) fails.push('a private release committed in the app worktree instead of packaging a patch');
    if (!refsIn(studioRemote).includes(`refs/heads/${one.branch}`)) fails.push('a private release pushed no private branch');
    if (refsIn(studioRemote).some((ref) => ref.startsWith('refs/tags/'))) fails.push('a private release tagged the private repository');

    // Work a handoff has taken is no longer warned about.
    const assigned = assignedPaths(parent);
    if (!assigned.includes('app: src/lib.rs')) fails.push('a released handoff did not claim the app work it carries');
    if (assigned.some((p) => p.startsWith('plan: ') && !handoff.planPaths.includes(p.slice(6)))) fails.push("one session's handoff claimed another session's work");
    if (assignedPaths(parent).length !== handoff.paths.length) fails.push("a session's handoff claimed work no session had released");
    // The overlapping half: the same two files from the other session.
    releasePrivate({ session: TWO, parent, from: two.app });

    // ---- Phase 3: submitting a handoff to the primary copies. ----
    // Two more sessions, each on files of its own.
    const PLAIN = 'eeeeeeee-5555-5555-5555-555555555555';
    const OTHER = 'ffffffff-6666-6666-6666-666666666666';
    const three = create({ session: PLAIN, studioRoot, appRoot, parent });
    const four = create({ session: OTHER, studioRoot, appRoot, parent });
    write(join(three.studio, 'leaftext', 'docs', 'THREE.md'), '# three\n');
    write(join(three.app, 'src', 'three.rs'), '// three\n');
    write(join(four.studio, 'leaftext', 'docs', 'FOUR.md'), '# four\n');
    write(join(four.app, 'src', 'four.rs'), '// four\n');
    const threeHandoff = releasePrivate({ session: PLAIN, parent, from: three.app });
    releasePrivate({ session: OTHER, parent, from: four.app });
    if (!threeHandoff.appPaths.includes('src/three.rs')) fails.push(`a handoff lost the app file its session added: ${JSON.stringify(threeHandoff.appPaths)}`);

    let fromWorkspace = '';
    try {
      submit({ session: PLAIN, parent, studioRoot, appRoot, from: three.app });
    } catch (error) {
      fromWorkspace = error.message;
    }
    if (!fromWorkspace.includes('from the primary checkout')) fails.push('a workspace was allowed to submit a handoff to the primary copies');

    submit({ session: PLAIN, parent, studioRoot, appRoot, from: appRoot });
    submit({ session: OTHER, parent, studioRoot, appRoot, from: appRoot });
    if (read(join(studioRoot, 'leaftext', 'docs', 'THREE.md')) !== '# three\n') fails.push('the first handoff did not reach the primary plan copy');
    if (read(join(appRoot, 'src', 'three.rs')) !== '// three\n') fails.push('the first handoff did not reach the primary app copy');
    if (read(join(studioRoot, 'leaftext', 'docs', 'FOUR.md')) !== '# four\n') fails.push('the second handoff did not reach the primary plan copy');
    if (read(join(appRoot, 'src', 'four.rs')) !== '// four\n') fails.push('the second handoff did not reach the primary app copy');
    if (read(join(studioRoot, 'leaftext', 'docs', 'THREE.md')) !== '# three\n') fails.push('the second handoff took the first one\'s plan work');
    // Dirty on purpose: what arrived is read before it is committed.
    if (!dirtyPaths(studioRoot).includes('leaftext/docs/THREE.md')) fails.push('a submitted handoff left the primary plan copy clean, so nothing is there to check');
    if (!dirtyPaths(appRoot).includes('src/three.rs')) fails.push('a submitted handoff left the primary app copy clean, so nothing is there to check');
    if (baseOf(studioRoot) !== one.studioBase) fails.push('a submit committed in the primary plan copy');
    if (baseOf(appRoot) !== one.appBase) fails.push('a submit committed in the primary app copy');
    if (refsIn(appRemote).join(' ') !== appRefsBefore.join(' ')) fails.push('a submit pushed to the Leaftext remote');

    // Two handoffs on the same files: the second must change nothing.
    submit({ session: ONE, parent, studioRoot, appRoot, from: appRoot });
    const watched = ['leaftext/docs/PLAN.md', 'leaftext/docs/THREE.md', 'leaftext/docs/FOUR.md'].map((p) => join(studioRoot, p))
      .concat(['src/lib.rs', 'src/three.rs', 'src/four.rs'].map((p) => join(appRoot, p)));
    const before = JSON.stringify(watched.map(read));
    let overlap = '';
    try {
      submit({ session: TWO, parent, studioRoot, appRoot, from: appRoot });
    } catch (error) {
      overlap = error.message;
    }
    if (!overlap.includes('overlaps work already sitting')) fails.push(`an overlapping handoff was applied over one already there: ${overlap || 'it was allowed'}`);
    if (JSON.stringify(watched.map(read)) !== before) fails.push('a refused handoff still changed a primary copy');
    if (existsSync(reservationPath(parent))) fails.push('a refused submit kept the primary reservation');
    if (existsSync(journalPath(parent))) fails.push('a refused submit left its recovery journal behind');

    // A submit killed halfway: the next one reads its journal and puts both roots back.
    write(join(studioRoot, 'leaftext', 'docs', 'THREE.md'), '# half-written\n');
    write(join(appRoot, 'src', 'three.rs'), '// half-written\n');
    write(join(appRoot, 'src', 'never-asked-for.rs'), '// half-written\n');
    writeFileSync(journalPath(parent), JSON.stringify([
      { root: studioRoot, path: 'leaftext/docs/THREE.md', was: Buffer.from('# three\n').toString('base64') },
      { root: appRoot, path: 'src/three.rs', was: Buffer.from('// three\n').toString('base64') },
      { root: appRoot, path: 'src/never-asked-for.rs', was: null },
    ]) + '\n');
    mkdirSync(reservationPath(parent), { recursive: true });
    writeFileSync(join(reservationPath(parent), 'held-by.json'), JSON.stringify({ holder: 'killed', at: new Date(Date.now() - RESERVATION_STALE_MS - 1000).toISOString() }) + '\n');
    let afterKill = '';
    try {
      submit({ session: TWO, parent, studioRoot, appRoot, from: appRoot });
    } catch (error) {
      afterKill = error.message;
    }
    if (read(join(studioRoot, 'leaftext', 'docs', 'THREE.md')) !== '# three\n') fails.push('an interrupted submit left the primary plan copy half-written');
    if (read(join(appRoot, 'src', 'three.rs')) !== '// three\n') fails.push('an interrupted submit left the primary app copy half-written');
    if (existsSync(join(appRoot, 'src', 'never-asked-for.rs'))) fails.push('an interrupted submit left behind a file it had added');
    if (!afterKill.includes('overlaps work already sitting')) fails.push('the submit after a recovery did not read the roots it had just put back');
    if (existsSync(reservationPath(parent))) fails.push('a stale reservation was not taken over and released');

    // One handoff through the reservation at a time.
    reserve(parent, ONE);
    let contended = '';
    try {
      reserve(parent, TWO);
    } catch (error) {
      contended = error.message;
    }
    if (!contended.includes('holds the primary reservation')) fails.push('two sessions took the primary reservation at once');
    releaseReservation(parent);
    reserve(parent, TWO);
    releaseReservation(parent);

    for (const session of [PLAIN, OTHER]) remove({ session, parent });

    remove({ session: ONE, parent });
    if (existsSync(one.studio)) fails.push('a removed workspace left its Studio worktree on disk');
    if (existsSync(one.app)) fails.push('a removed workspace left its app worktree on disk');
    if (!existsSync(two.studio)) fails.push('removing one session\'s workspace took the other\'s');
    if (read(plan(two)) !== '# two\n') fails.push('removing one session\'s workspace took the other\'s plan edit');
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
  console.log('agent-workspace: ok (paired workspaces keeping plan, app, index and build apart; private handoffs that never reach the Leaftext remote; two arriving at the primary copies, an overlap refused, and an interrupted submit put back)');
}

function main(args) {
  const parent = workspaceParent();
  const session = sessionOf('');
  const { studioRoot, appRoot } = primaryRoots();
  const command = args[0] || 'path';
  if (command === 'create') {
    const record = create({ session, studioRoot, appRoot, parent });
    console.log(record.studio);
    console.log(record.app);
    return;
  }
  if (command === 'private') {
    const handoff = releasePrivate({ session, parent, message: args.slice(1).join(' ') });
    console.log(`${handoff.branch}  ${handoff.paths.length} paths  app patch on ${handoff.appBase.slice(0, 8)}`);
    return;
  }
  if (command === 'submit') {
    const handoff = submit({ session: args[1] || '', parent, studioRoot, appRoot });
    console.log(`${handoff.branch}  ${handoff.planPaths.length} plan paths, ${handoff.appPaths.length} app paths — both primary copies are dirty now, so check them before releasing`);
    return;
  }
  if (command === 'remove') {
    console.log(remove({ session, parent }).studio);
    return;
  }
  if (command === 'list') {
    for (const record of manifests(parent)) console.log(`${record.session}  ${record.branch}  ${record.studio}`);
    return;
  }
  if (command === 'path') {
    const record = manifests(parent).find((m) => m.session === sessionTag(session));
    if (!record) {
      console.error(`no managed workspace for this session under ${parent}`);
      process.exit(1);
    }
    console.log(record.studio);
    return;
  }
  console.error('usage: agent-workspace.mjs create | path | list | private [message] | submit <session> | remove | --check');
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
