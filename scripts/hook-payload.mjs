#!/usr/bin/env node
// What the host actually sends a hook, and the one thing every gate reads out of it: which session it belongs to.
//
// Two agents can work this checkout at once, so a record keyed on the machine is read by whoever asks first — that is how a release license granted to one message became usable by the other. The session id is what tells the two apart. A hook has it in its payload; `node scripts/gate-keycode.mjs <file> <code>` is a plain shell command and gets no payload at all, so it has it only in its own environment, and the two are the same string.
//
// The ring is the other half: the last 20 payloads per hook, in `.tmp`, untracked. The license and the keycode record both turn on what the host put in a payload, and a turn where that went wrong is otherwise unreconstructable — which is what it was already doing for the prompt alone before the other two hooks needed it.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/// Untracked, beside the license the same payloads decide.
export const RING = join(root, '.tmp', 'hook-payloads.jsonl');

/// Per hook, not in total: the tool gate fires on every command, and a busy hook must not push the one turn's prompt out of the file.
export const KEEP = 20;

/// The session id in a payload, or '' when it carries none.
export function sessionIn(raw) {
  try {
    const { session_id: id } = JSON.parse(raw);
    return typeof id === 'string' ? id.trim() : '';
  } catch {
    return '';
  }
}

/// The session a script is acting for: the payload's id, or the environment's when there is no payload. '' when neither has one, which every caller has to treat as the safe answer rather than as a session of its own.
export function sessionOf(raw) {
  return sessionIn(raw) || (process.env.CLAUDE_CODE_SESSION_ID ?? '').trim();
}

/// A session id as a file name part. Hex and dashes are all a real one has; anything else is squeezed out rather than trusted, because this ends up in a path.
export function sessionTag(session) {
  const clean = (session || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
  return clean || '';
}

/// Where the release license for one session is written and read. **One file per session, not one file naming a session:** a single file carrying the id would still be overwritten by the other agent's very next message, which would revoke a live license in the middle of the turn that was granted it. '' when there is no id at all — nothing is written then, and the git gate refuses every write, because an environment that changed shape must not turn the gate off.
export function licensePath(session) {
  const tag = sessionTag(session ?? sessionOf(''));
  return tag ? join(root, '.tmp', `git-license-${tag}`) : '';
}

/// The folder the licenses sit in, for the sweep.
export const LICENSE_DIR = join(root, '.tmp');

/// How long a file belonging to one session is kept. Longer than the four hours a release license is good for, so the sweep never takes one that still counts.
export const STALE_MS = 24 * 60 * 60 * 1000;

/// Throw away every file of one kind that is past the window. One file per session is one file per agent per day otherwise: nothing ever deleted the license, which was only ignored on its age when something read it.
export function sweep(dir, starts, now = Date.now()) {
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(starts)) continue;
      try {
        const full = join(dir, name);
        if (now - statSync(full).mtimeMs > STALE_MS) rmSync(full, { force: true });
      } catch {
        // A file that vanished under the sweep, or one nothing here may read, is not this hook's problem.
      }
    }
  } catch {
    // No folder to sweep is nothing to sweep.
  }
}

function hookOf(line) {
  try {
    return JSON.parse(line).hook ?? '';
  } catch {
    return '';
  }
}

/// Keep one payload, dropping the oldest of that hook once it is over the limit. Order stays as it happened, so two agents interleaving read back in the order they ran.
export function ringLines(lines, hook, entry) {
  const room = new Map([[hook, KEEP - 1]]);
  const kept = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const which = hookOf(lines[i]);
    const left = room.has(which) ? room.get(which) : KEEP;
    if (left <= 0) continue;
    room.set(which, left - 1);
    kept.unshift(lines[i]);
  }
  kept.push(entry);
  return kept;
}

/// Write down what this hook was handed. Nothing arrived means nothing to record — an empty stdin says only that the host sent nothing, and a line saying so every turn would push out the ones that carry an answer.
export function keep(hook, raw) {
  if (!raw || !raw.trim()) return;
  try {
    mkdirSync(dirname(RING), { recursive: true });
    const lines = existsSync(RING) ? readFileSync(RING, 'utf8').split('\n').filter(Boolean) : [];
    const entry = JSON.stringify({
      at: new Date().toISOString(),
      hook,
      session: sessionIn(raw),
      env: (process.env.CLAUDE_CODE_SESSION_ID ?? '').trim(),
      raw: raw.slice(0, 4000),
    });
    writeFileSync(RING, ringLines(lines, hook, entry).join('\n') + '\n');
  } catch {
    // A diagnostic that cannot be written is not worth failing a turn over.
  }
}
