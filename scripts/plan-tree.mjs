#!/usr/bin/env node
// Where the plan tree is.
//
// The plan tree is `../docs` beside this checkout — the tickets, the running order, the README and the glossary. It is not in this repository, so every check that reads it asks here rather than writing the path out again.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

/// What points the plan-reading checks at a tree other than the one beside this checkout. Nothing in the workflow sets it; a checkout whose plan tree lives elsewhere does.
export const PLAN_ROOT_ENV = 'LEAFTEXT_PLAN_ROOT';

/// Where the plan tree is. It is what the eight checks that read `../docs` ask — the document, running-order, spelling, wrapping, box-drawing, shared-rule and footprint checks — so the path is written down once, and `planTreeMissing` beside it is what they refuse a checkout without one by.
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
