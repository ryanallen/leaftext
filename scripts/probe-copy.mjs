#!/usr/bin/env node
// Which copy of the app a build is talking to. The one place that reads and writes `.tmp/probe-copy.json`, and it holds two things: the account name `just probe-copy` launched under, and that launcher's process id.
//
// A pointer file rather than a flag on the ask, because the nine asks reach an agent as MCP tools rather than as shell lines: `.mcp.json` spawns the wrapper once with a fixed environment, so neither an environment line nor a per-call name exists unless every tool schema grows an argument the caller must remember. Which copy is being worked is a fact about the whole probe run, not about one question, so it belongs in one place.
//
// The process id is the whole safety of it. A session that crashes with a probe up leaves the file behind, and without that guard every later ask would point silently at a pipe nobody is listening on — the same false answer this exists to remove. A pointer naming a process that is gone is no pointer.
//
// `.tmp` is ignored (.gitignore) and is per-checkout, so the two sessions this checkout runs share this one pointer and whichever launches a probe second takes it.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const POINTER = join(root, '.tmp/probe-copy.json');

/** The launcher's own record, or null when there is none and when what is there cannot be read. */
export function readPointer(file = POINTER) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed.name !== 'string' || !parsed.name || !Number.isInteger(parsed.pid)) return null;
  return { name: parsed.name, pid: parsed.pid };
}

/** Signal 0 kills nothing; it asks whether the process is there. EPERM is a process this account may not signal, which is still a process. */
export function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// Off Windows there is nothing to point at: the ask socket on macOS is named after the home folder rather than the account, so a copy launched under a name of its own cannot be addressed there at all.
//
// LEAFTEXT_ASK_ACCOUNT_ONLY is for a caller that has already set the account name to the copy it means, which is a stronger statement than a pointer left lying about: without it, the quit that closes a documentation shot would land on whatever probe copy happened to be up, and the shot copy would stay on screen.
export function probeName({
  pointer = readPointer(),
  platform = process.platform,
  running = isRunning,
  accountOnly = Boolean(process.env.LEAFTEXT_ASK_ACCOUNT_ONLY),
} = {}) {
  if (platform !== 'win32') return null;
  if (accountOnly) return null;
  if (!pointer) return null;
  if (!running(pointer.pid)) return null;
  return pointer.name;
}

export function remember({ name, pid }, file = POINTER) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ name, pid }, null, 2)}\n`);
}

export function forget(file = POINTER) {
  rmSync(file, { force: true });
}
