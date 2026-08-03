#!/usr/bin/env node
// Stop hook. Measures the reply against Rule 1 and refuses to end the turn when
// it breaks. Printing a rule does not enforce it: gate-rules.mjs is the reminder,
// this is the check.
//
// Three things are countable, so those are the three it enforces: the
// 500-character ceiling, the sycophancy openers Rule 1 names one by one, and this
// turn's keycodes (gate-keycode.mjs). Everything else in Rule 1 is a judgment call
// and stays a reminder.
//
//   node scripts/gate-voice.mjs           the hook payload on stdin
//   node scripts/gate-voice.mjs --check   self-test (`just verify`)
//
// Never loops: a payload that says a stop hook is already running exits 0.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { close, outstanding, read } from './gate-keycode.mjs';

const LIMIT = 500;

// How long to wait for the reply to reach the transcript. The last thing said is
// written after the turn ends, so reading the file straight away saw only the
// short lines said between tool calls — that is how a 952-character sign-off went
// out unrefused.
const SETTLE_MS = 3000;
const POLL_MS = 100;

// Rule 1 names these. Anchored to the opening, which is where they land.
const SYCOPHANCY = [
  // `exactly` only as the whole opening beat. "Exactly the twelve predicted" is a
  // count, not a compliment, and flagging it taught nothing.
  /^\s*(you(?:'re| are) (?:right|correct)|good (?:question|point|call)|fair (?:point|enough)|great (?:question|point)|nice catch|good catch)\b/i,
  /^\s*exactly\s*[.!,—-]/i,
  /^\s*(i apologi[sz]e|sorry|my apologies)\b/i,
];

/// Each block on its own. Rule 1 caps a response, and a turn that says three
/// things says three of them — joining first would fail a turn for the sum of
/// twelve short lines and pass one that ended in an essay.
export function offenses(blocks) {
  const out = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (trimmed.length > LIMIT) {
      out.push(`${trimmed.length} characters. Rule 1 caps a reply at ${LIMIT}. Cut it to the answer and stop.`);
    }
    if (SYCOPHANCY.some((p) => p.test(trimmed))) {
      out.push('Opens with praise or an apology. Rule 1 forbids both. Delete the opener and lead with the answer.');
    }
  }
  return out;
}

function parse(lines) {
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A half-written line at the tail is not worth failing a turn over.
    }
  }
  return entries;
}

/// Everything said since the last thing the owner actually typed, block by block.
/// Tool results arrive as user turns too, so a turn only counts when it carries
/// plain text.
export function blocksOf(lines) {
  const entries = parse(lines);
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.type !== 'user') continue;
    const content = entry.message?.content;
    const typed = typeof content === 'string'
      || (Array.isArray(content) && content.some((c) => c.type === 'text'));
    if (typed) { start = i + 1; break; }
  }
  const said = [];
  for (const entry of entries.slice(start)) {
    if (entry.type !== 'assistant') continue;
    for (const block of entry.message?.content || []) {
      if (block.type === 'text' && block.text?.trim()) said.push(block.text);
    }
  }
  return said;
}

/// True once the newest message in the transcript is something the assistant
/// said, which is what a finished turn looks like.
export function endsInSpeech(lines) {
  const entries = parse(lines).filter((e) => e.type === 'assistant' || e.type === 'user');
  const last = entries[entries.length - 1];
  if (last?.type !== 'assistant') return false;
  return (last.message?.content || []).some((b) => b.type === 'text' && b.text?.trim());
}

/// Read the transcript, waiting for the last thing said to land in it.
function settled(path, sleep) {
  let lines = [];
  const deadline = Date.now() + SETTLE_MS;
  for (;;) {
    lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    if (endsInSpeech(lines) || Date.now() >= deadline) return lines;
    sleep(POLL_MS);
  }
}

function nap(ms) {
  // No async in a hook: the process has to hold the turn open while it waits.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function selfTest() {
  const fails = [];
  const check = (text, want, label) => {
    const got = offenses([text]).length > 0;
    if (got !== want) fails.push(`${label}: expected ${want ? 'blocked' : 'allowed'}`);
  };
  check('Log to a file: yes, all three.', false, 'short answer');
  check('x'.repeat(LIMIT + 1), true, 'over the ceiling');
  check('x'.repeat(LIMIT), false, 'exactly at the ceiling');
  check("You're right, the port is Windows only.", true, 'opens with praise');
  check('Good question. It works everywhere.', true, 'opens with a compliment');
  check('I apologize for the confusion.', true, 'opens with an apology');
  check('No. Windows only.', false, 'a flat no');
  check('The right answer is exactly 500 bytes.', false, 'the word mid-sentence');
  check('Exactly the twelve the ticket predicted.', false, 'a count, not a compliment');
  check('Exactly. Windows only.', true, 'agreement as the whole opener');
  check('', false, 'a turn that only ran tools');
  // Twelve short lines said between tool calls are twelve replies, not one long
  // one. Joining them was how the ceiling read as met.
  if (offenses(Array(12).fill('Now the fixes.')).length) fails.push('short lines summed into an offense');
  if (!offenses(['ok', 'x'.repeat(LIMIT + 1)]).length) fails.push('a long last block was missed');

  const transcript = [
    JSON.stringify({ type: 'user', message: { content: 'does it work on mac' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'No.' }] } }),
    'not json at all',
  ];
  if (blocksOf(transcript).join('') !== 'No.') fails.push('blocksOf: did not isolate the reply');
  if (blocksOf([]).length) fails.push('blocksOf: empty transcript should say nothing');
  if (!endsInSpeech(transcript)) fails.push('endsInSpeech: a finished turn read as unfinished');
  if (endsInSpeech(transcript.slice(0, 4))) fails.push('endsInSpeech: a turn mid-tool read as finished');

  // Through the real entry point, because the three things that would hurt most
  // are all in it: a malformed block does nothing and looks like a pass, a hook
  // that blocks while a stop hook is already running spins the turn forever, and
  // a reply that has not landed yet reads as no reply at all.
  const path = join(tmpdir(), 'gate-voice-selftest.jsonl');
  writeFileSync(path, [
    JSON.stringify({ type: 'user', message: { content: 'does it work on mac' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(LIMIT + 1) }] } }),
  ].join('\n') + '\n');
  const run = (active) => execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
    input: JSON.stringify({ stop_hook_active: active, transcript_path: path }),
    encoding: 'utf8',
  });
  try {
    const blocked = JSON.parse(run(false) || '{}');
    if (blocked.decision !== 'block') fails.push('entry point: an over-long reply was not blocked');
    if (!blocked.reason?.includes(String(LIMIT))) fails.push('entry point: the block did not say the limit');
    if (run(true).trim() !== '') fails.push('entry point: blocked again while a stop hook was already running');
  } catch (error) {
    fails.push(`entry point: ${error.message}`);
  } finally {
    rmSync(path, { force: true });
  }

  // The wait has to end on its own, or a turn that legitimately says nothing
  // would hang the hook until the host kills it.
  const unfinished = [
    JSON.stringify({ type: 'user', message: { content: 'go' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } }),
  ];
  writeFileSync(path, unfinished.join('\n') + '\n');
  let waited = 0;
  const lines = settled(path, (ms) => { waited += ms; });
  rmSync(path, { force: true });
  if (waited < SETTLE_MS) fails.push('settled: gave up before the deadline');
  if (lines.length !== 2) fails.push('settled: lost lines while waiting');

  if (fails.length) {
    console.error('gate-voice: failed');
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`gate-voice: ok (${LIMIT}-character ceiling, ${SYCOPHANCY.length} opener patterns, keycodes)`);
}

if (process.argv.includes('--check')) {
  selfTest();
} else {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
  }
  // Already blocked once this turn. Blocking again is how a stop hook spins.
  if (payload.stop_hook_active) process.exit(0);
  let blocks = [];
  try {
    statSync(payload.transcript_path);
    blocks = blocksOf(settled(payload.transcript_path, nap));
  } catch {
    process.exit(0);
  }
  const found = offenses(blocks);
  const owed = blocks.length ? outstanding(read()) : [];
  if (found.length || owed.length) {
    const parts = [];
    if (found.length) parts.push(`Rule 1, from CLAUDE.md:\n${found.map((f) => `- ${f}`).join('\n')}`);
    if (owed.length) {
      parts.push(`Not read yet — report each keycode with \`node scripts/gate-keycode.mjs <file> <code>\`:\n${owed.map((o) => `- ${o}`).join('\n')}`);
    }
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: `${parts.join('\n\n')}\n\nSay it again, shorter. No note about this correction — just the answer.`,
    }));
    process.exit(0);
  }
  // The turn stands. Forget what it owed rather than leave a file behind.
  close();
  process.exit(0);
}
