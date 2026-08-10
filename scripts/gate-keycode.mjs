#!/usr/bin/env node
// Proof that the rules were read, not remembered.
//
// Every file the flow requires carries a keycode in an HTML comment, at the end, where you only reach it by reading through. Before a turn can end, each keycode this turn required has to be reported:
//
//   node scripts/gate-keycode.mjs AGENTS.md LEAF-4C1D   report one
//   node scripts/gate-keycode.mjs --required            what this turn owes
//   node scripts/gate-keycode.mjs --check               self-test (`just verify`)
//
// A wrong or missing code is refused by the Stop hook, which is the only thing here that can actually stop a turn. gate-rules.mjs sets the demand at the start of each message and clears the record; gate-voice.mjs holds the turn to it.
//
// The record lives in the OS temp folder and is deleted every message, so it never grows and never reaches a context window.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sessionOf, sessionTag, sweep } from './hook-payload.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/// Deleted and rewritten on every message. Temp on purpose: a record kept in the repo would be read back into a context window turn after turn.
///
/// One file per session, because two agents can share this machine: one file for all of them is cleared by whichever starts a message, which holds the other at the end of its turn for codes it did give. With no session id to be found this is a single file again, where the worst that happens is being asked twice for one code.
export function recordPath(session) {
  const tag = sessionTag(session ?? sessionOf(''));
  return join(tmpdir(), tag ? `leaftext-keycode-${tag}.json` : 'leaftext-keycode.json');
}

/// The rule file, required on every message that is not a host command.
export const ALWAYS = 'AGENTS.md';

/// Every file that carries a keycode. A skill is required when the message names it with a slash, which is how a skill gets invoked.
export function keyedFiles() {
  const skills = [
    'add-dependency', 'add-format', 'check', 'code-comments', 'dev',
    'design-tokens', 'git-release', 'done', 'pm', 'design', 'shell-fragment',
    'sync-docs', 'sync-tests', 'ticket',
  ];
  return [ALWAYS, ...skills.map((name) => `.agents/skills/${name}/SKILL.md`)];
}

/// The keycode written into a file, or null when it carries none.
export function codeIn(text) {
  const found = text.match(/<!--\s*keycode:\s*([A-Z0-9-]+)\s*-->/);
  return found ? found[1] : null;
}

function codeOf(file) {
  try {
    return codeIn(readFileSync(join(root, file), 'utf8'));
  } catch {
    return null;
  }
}

/// What a message has to have read: the rule file always, plus any skill it calls for by name. A host command (`/clear`) requires nothing.
export function requiredFor(prompt) {
  const required = [ALWAYS];
  for (const file of keyedFiles()) {
    const name = file.match(/skills\/(.*?)\//)?.[1];
    if (name && new RegExp(`(^|\\s)/${name}\\b`, 'i').test(prompt)) required.push(file);
  }
  return required;
}

/// Start a turn: forget the last one in this session, and write down what this one owes. The other session's record is left alone, and every other session's is swept once it is a day old — one file per session is a folder that grows otherwise.
export function open(required, session) {
  const record = recordPath(session);
  mkdirSync(dirname(record), { recursive: true });
  writeFileSync(record, JSON.stringify({ required, reported: {} }) + '\n');
  sweep(tmpdir(), 'leaftext-keycode-');
}

export function read(session) {
  try {
    return JSON.parse(readFileSync(recordPath(session), 'utf8'));
  } catch {
    return null;
  }
}

export function close(session) {
  rmSync(recordPath(session), { force: true });
}

/// Every file still owed, and every one reported with the wrong code.
export function outstanding(record) {
  if (!record) return [];
  const problems = [];
  for (const file of record.required || []) {
    const want = codeOf(file);
    if (!want) continue; // A file with no keycode cannot be owed one.
    const got = record.reported?.[file];
    if (!got) problems.push(`${file} — read it and report its keycode`);
    else if (got !== want) problems.push(`${file} — reported ${got}, which is not its keycode`);
  }
  return problems;
}

function report(file, code) {
  const record = read();
  if (!record) {
    console.error('no turn is open — gate-rules.mjs writes the record on each message');
    process.exit(1);
  }
  const want = codeOf(file);
  if (!want) {
    console.error(`${file} carries no keycode`);
    process.exit(1);
  }
  if (code !== want) {
    console.error(`${file}: ${code} is not its keycode`);
    process.exit(1);
  }
  record.reported = { ...record.reported, [file]: code };
  writeFileSync(recordPath(), JSON.stringify(record) + '\n');
  const left = outstanding(record);
  console.log(left.length ? `${file}: ok. Still owed: ${left.length}` : `${file}: ok. Nothing owed.`);
}

function selfTest() {
  const fails = [];

  // Every keyed file really carries one, and no two share a code — a duplicate would let one file's code stand in for another's.
  const seen = new Map();
  for (const file of keyedFiles()) {
    const code = codeOf(file);
    if (!code) fails.push(`${file} has no keycode`);
    else if (seen.has(code)) fails.push(`${file} and ${seen.get(code)} share the keycode ${code}`);
    else seen.set(code, file);
  }

  if (!requiredFor('hello').includes(ALWAYS)) fails.push('the rule file is not always required');
  if (requiredFor('/check it').length !== 2) fails.push('/check did not require the check skill');
  if (requiredFor('run the checker').length !== 1) fails.push('prose required a skill file');
  if (codeIn('<!-- keycode: LEAF-0001 -->') !== 'LEAF-0001') fails.push('codeIn: missed a code');
  if (codeIn('no code here') !== null) fails.push('codeIn: invented a code');

  // The whole cycle, because the part that would hurt is a turn that owes nothing by accident.
  const kept = existsSync(recordPath()) ? readFileSync(recordPath(), 'utf8') : null;
  try {
    open([ALWAYS]);
    if (outstanding(read()).length !== 1) fails.push('a fresh turn owed nothing');
    const record = read();
    record.reported = { [ALWAYS]: 'LEAF-WRONG' };
    writeFileSync(recordPath(), JSON.stringify(record) + '\n');
    if (!outstanding(read())[0]?.includes('not its keycode')) fails.push('a wrong code was accepted');
    record.reported = { [ALWAYS]: codeOf(ALWAYS) };
    writeFileSync(recordPath(), JSON.stringify(record) + '\n');
    if (outstanding(read()).length) fails.push('the right code was refused');
    close();
    if (outstanding(read()).length) fails.push('a closed turn still owes something');
  } finally {
    if (kept === null) close();
    else writeFileSync(recordPath(), kept);
  }

  // The same cycle twice over, under two session ids: a second agent starting a message must not wipe what the first has already reported.
  const ONE = 'aaaaaaaa-1111-1111-1111-111111111111';
  const TWO = 'bbbbbbbb-2222-2222-2222-222222222222';
  if (recordPath(ONE) === recordPath(TWO)) fails.push('two sessions share one record file');
  if (!recordPath('').endsWith('leaftext-keycode.json')) fails.push('no session id did not fall back to the one file');
  try {
    open([ALWAYS], ONE);
    const mine = read(ONE);
    mine.reported = { [ALWAYS]: codeOf(ALWAYS) };
    writeFileSync(recordPath(ONE), JSON.stringify(mine) + '\n');
    open([ALWAYS], TWO);
    if (outstanding(read(ONE)).length) fails.push("a message in one session cleared the other's reported codes");
    if (outstanding(read(TWO)).length !== 1) fails.push('a fresh turn in the second session owed nothing');
    close(TWO);
    if (outstanding(read(ONE)).length) fails.push("one session ending its turn took the other's record");
  } finally {
    close(ONE);
    close(TWO);
  }

  if (fails.length) {
    console.error('gate-keycode: failed');
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`gate-keycode: ok (${keyedFiles().length} keyed files, all distinct)`);
}

// Only act when run directly: gate-rules.mjs and gate-voice.mjs import this for its functions, and an import must not run a self-test or a report.
const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
const args = invoked === import.meta.url ? process.argv.slice(2) : [];
if (args.includes('--check')) {
  selfTest();
} else if (args.includes('--required')) {
  const record = read();
  console.log((record?.required || []).join('\n'));
} else if (args.length === 2) {
  report(args[0].replace(/\\/g, '/'), args[1].toUpperCase());
} else if (args.length) {
  console.error('usage: gate-keycode.mjs <file> <keycode>');
  process.exit(1);
}
