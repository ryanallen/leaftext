#!/usr/bin/env node
// Where the plan tree is, and the still copy of it a public release checks itself against.
//
// The plan tree is `../docs` beside this checkout — the tickets, the running order, the README and the glossary. It is not in this repository, so every check that reads it asks here rather than writing the path out again.
//
// A release takes a still copy because the owner writes that tree while a release is running, and half of somebody else's edit is not a state anybody wrote. The copy is a folder of this run's own; the release points its own child processes at it with `LEAFTEXT_PLAN_ROOT`, which is the only thing that ever sets it.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');

/// Untrimmed and roomy: a status line's first three columns are load-bearing and a big tree outgrows the default pipe.
function gitRaw(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

/// A repository's own top level, or ''. Compared rather than merely asked: a path inside one answers the top level, not itself.
export function repoRoot(dir) {
  try {
    return resolve(gitRaw(dir, ['rev-parse', '--show-toplevel']).trim()) === resolve(dir) ? resolve(dir) : '';
  } catch {
    return '';
  }
}

/// What a public release points the plan-reading checks at instead of the live tree. Set on the gate's own child processes and nothing else, so an ordinary run always answers the owner's folder.
export const PLAN_ROOT_ENV = 'LEAFTEXT_PLAN_ROOT';

/// Where the plan tree is. It is what the eight checks that read `../docs` ask — the document, running-order, spelling, wrapping, box-drawing, shared-rule, snapshot-copy and footprint checks — so the path is written down once, and `planTreeMissing` beside it is what they refuse a checkout without one by.
export function planTree(dir = here) {
  const held = (process.env[PLAN_ROOT_ENV] || '').trim();
  return held || join(resolve(dir), '..', 'docs');
}

/// Why a checkout cannot be gated, where the plan tree is not beside it — or '' where it is. Asked for the running order and the index rather than for the folder, because a folder that is there and holds neither is exactly what an app checkout on its own looks like: the running-order check died there on an uncaught ENOENT reading `done/PLAN.md`, and the document check walked this repo's own 61 files and called every plan rule satisfied having read no plan at all.
export function planTreeMissing(plans = planTree()) {
  const owed = ['PLAN.md', 'README.md'].filter((name) => !existsSync(join(plans, name)));
  if (!owed.length) return '';
  return `no plan tree at ${plans}: it holds no ${owed.join(' and no ')}. The plans and the code are one pair of folders and every check that reads a plan needs both, so an app checkout on its own cannot be gated — clone the plan tree beside it, or point ${PLAN_ROOT_ENV} at one.`;
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

/// Every plan file and what it held — how a release sees the tree move under it instead of failing on half of somebody else's edit.
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

/// A still copy of the plan tree, in a folder of this run's own. The manifest is taken before and after the copy: a tree that changed while it was being read is copied again rather than handed to the gate.
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
    if (attempt >= attempts) throw new Error(`the plan tree changed every time it was copied (${attempts} tries), so there is no one state to check this release against — let the other edit finish and release again`);
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
