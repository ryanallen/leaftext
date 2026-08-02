#!/usr/bin/env node
// Stop hook. Measures the reply against Rule 1 and refuses to end the turn when
// it breaks. Printing a rule does not enforce it: gate-rules.mjs is the reminder,
// this is the check.
//
// Two things are countable, so those are the two it enforces: the 500-character
// ceiling, and the sycophancy openers Rule 1 names one by one. Everything else in
// Rule 1 is a judgment call and stays a reminder.
//
//   node scripts/gate-voice.mjs           the hook payload on stdin
//   node scripts/gate-voice.mjs --check   self-test (`just verify`)
//
// Never loops: a payload that says a stop hook is already running exits 0.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 500;

// Rule 1 names these. Anchored to the opening, which is where they land.
const SYCOPHANCY = [
  /^\s*(you(?:'re| are) (?:right|correct)|good (?:question|point|call)|fair (?:point|enough)|exactly|great (?:question|point)|nice catch|good catch)\b/i,
  /^\s*(i apologi[sz]e|sorry|my apologies)\b/i,
];

export function offenses(text) {
  const out = [];
  const trimmed = text.trim();
  if (!trimmed) return out;
  if (trimmed.length > LIMIT) {
    out.push(`${trimmed.length} characters. Rule 1 caps a reply at ${LIMIT}. Cut it to the answer and stop.`);
  }
  if (SYCOPHANCY.some((p) => p.test(trimmed))) {
    out.push('Opens with praise or an apology. Rule 1 forbids both. Delete the opener and lead with the answer.');
  }
  return out;
}

// The assistant text since the last thing the owner actually typed. Tool results
// arrive as user turns too, so a turn only counts when it carries plain text.
export function replyOf(lines) {
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A half-written line at the tail is not worth failing a turn over.
    }
  }
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
      if (block.type === 'text' && block.text) said.push(block.text);
    }
  }
  return said.join('\n').trim();
}

function selfTest() {
  const fails = [];
  const check = (text, want, label) => {
    const got = offenses(text).length > 0;
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
  check('', false, 'a turn that only ran tools');

  const transcript = [
    JSON.stringify({ type: 'user', message: { content: 'does it work on mac' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'No.' }] } }),
    'not json at all',
  ];
  if (replyOf(transcript) !== 'No.') fails.push('replyOf: did not isolate the reply');
  if (replyOf([]) !== '') fails.push('replyOf: empty transcript should be empty');

  // Through the real entry point, because the two things that would hurt most are
  // both in it: a malformed block does nothing and looks like a pass, and a hook
  // that blocks while a stop hook is already running spins the turn forever.
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

  if (fails.length) {
    console.error('gate-voice: failed');
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`gate-voice: ok (${LIMIT}-character ceiling, ${SYCOPHANCY.length} opener patterns)`);
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
  let reply = '';
  try {
    reply = replyOf(readFileSync(payload.transcript_path, 'utf8').split('\n').filter(Boolean));
  } catch {
    process.exit(0);
  }
  const found = offenses(reply);
  if (found.length) {
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: `Rule 1, from CLAUDE.md:\n${found.map((f) => `- ${f}`).join('\n')}\n\nSay it again, shorter. No note about this correction — just the answer.`,
    }));
  }
  process.exit(0);
}
