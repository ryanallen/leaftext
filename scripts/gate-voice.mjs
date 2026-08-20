#!/usr/bin/env node
// Stop hook. Measures the reply against Rule 1 and refuses to end the turn when it breaks. Printing a rule does not enforce it: gate-rules.mjs is the reminder, this is the check.
//
// It enforces the half of Rule 1 that names its own words: the 500-character ceiling, the sycophancy openers, the four connectives that walk a bare answer back, the five phrases that hand a filing back to the owner, and this turn's keycodes (gate-keycode.mjs). The rest of Rule 1 is a judgment call and stays a reminder.
//
// It also refuses a turn that moved code and left the ticket where it was. `/dev` says to tick each box in the same edit as its code, and nothing read that, so twenty-five files of test code moved across a dozen turns with every box still open and the owner had to ask whether a build was happening — which is the one question the whole plan tree is written to answer without being asked. The read is the one already here for the filing phrases, pointed at the other tree.
//
// A phrase is matched on what the reply says in its own voice: quoted material — fenced blocks, inline code, quotation marks, blockquote lines — is stripped first, so a reply quoting Rule 1 or naming a ticket by a phrase is not refused for the words it is quoting.
//
//   node scripts/gate-voice.mjs           the hook payload on stdin
//   node scripts/gate-voice.mjs --check   self-test (`just verify`)
//
// Never loops: a payload that says a stop hook is already running exits 0.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clear, heldBy, listPath, pending } from './gate-checklist.mjs';
import { close, outstanding, read } from './gate-keycode.mjs';
import { keep, sessionOf } from './hook-payload.mjs';
import { dirtyPaths } from './plan-tree.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/// Where the tickets live, beside this repo. A file written here this turn is the work being filed.
const PLAN_TREE = join(root, '..', 'docs');

const LIMIT = 500;

// How long to wait for the reply to reach the transcript. The last thing said is written after the turn ends, so reading the file straight away saw only the short lines said between tool calls — that is how a 952-character sign-off went out unrefused.
const SETTLE_MS = 3000;
const POLL_MS = 100;

// Rule 1 names these. Anchored to the opening, which is where they land.
const SYCOPHANCY = [
  // `exactly` only as the whole opening beat. "Exactly the twelve predicted" is a count, not a compliment, and flagging it taught nothing.
  /^\s*(you(?:'re| are) (?:right|correct)|good (?:question|point|call)|fair (?:point|enough)|great (?:question|point)|nice catch|good catch)\b/i,
  /^\s*exactly\s*[.!,—-]/i,
  /^\s*(i apologi[sz]e|sorry|my apologies)\b/i,
];

// One answer, never a yes and a no. Only a reply that leads with a bare answer can walk one back, and only a connective that starts a sentence is walking it back — after a comma it is still the one answer, which Rule 1 allows.
const BARE_ANSWER = /^\s*(yes|no|done)\b/i;
const WALKBACK = /(?:[.!?;:]["'’”)\]]?\s+|\n\s*)(but|however|though|that said)\b/i;

// Rule 1 names these five, because a phrase is recognized where a category is argued with. Refused only when nothing under the plan tree was written this turn: the sentence is allowed once the file exists, and then it names the file.
const FILING = [
  /\bneeds? a ticket\b/i,
  /\bnot covered\b/i,
  /\bout of scope\b/i,
  /\bwould be its own\b/i,
  /\ba different feature\b/i,
];

/// The reply in its own voice: quoted material out, so the words a reply quotes are not read as the words it says. Each removal leaves a space behind, or stripping would join the text either side of it into a phrase neither one said.
export function unquoted(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/^[ \t]*>.*$/gm, ' ')
    .replace(/“[^”]*”/g, ' ')
    .replace(/"[^"]*"/g, ' ');
}

/// True when something under the plan tree was written since the turn began — a ticket, its README row, the running order. Unreadable reads as filed: a gate that cannot see the tree must refuse nothing rather than refuse everything.
export function filedSince(startedAt, dir = PLAN_TREE) {
  if (!Number.isFinite(startedAt)) return true;
  const stack = [dir];
  try {
    while (stack.length) {
      const here = stack.pop();
      for (const entry of readdirSync(here, { withFileTypes: true })) {
        const full = join(here, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name.endsWith('.md') && statSync(full).mtimeMs >= startedAt) return true;
      }
    }
  } catch {
    return true;
  }
  return false;
}

/// The first file in this checkout the turn changed, or null. Dirty and stamped at or after the turn began, which is the same read `filedSince` makes on the tree next door — so there is no second record of who wrote what to keep in step. A tree it cannot read reads as untouched: a gate that cannot see must refuse nothing.
export function movedSince(startedAt, dir = root) {
  if (!Number.isFinite(startedAt)) return null;
  for (const path of dirtyPaths(dir)) {
    try {
      if (statSync(join(dir, path)).mtimeMs >= startedAt) return path;
    } catch {
      // Deleted, or a path git spells in a way this machine cannot open. Either way it says nothing about the ticket.
    }
  }
  return null;
}

/// Each block on its own. Rule 1 caps a response, and a turn that says three things says three of them — joining first would fail a turn for the sum of twelve short lines and pass one that ended in an essay.
///
/// `filed` is whether the plan tree was written this turn; it is the one thing here that is not in the reply, and it decides only the filing phrases.
export function offenses(blocks, filed = true) {
  const out = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    // The ceiling counts everything said. The phrases count only what the reply says in its own voice.
    if (trimmed.length > LIMIT) {
      out.push(`${trimmed.length} characters. Rule 1 caps a reply at ${LIMIT}. Cut it to the answer and stop.`);
    }
    const said = unquoted(trimmed);
    if (SYCOPHANCY.some((p) => p.test(said))) {
      out.push('Opens with praise or an apology. Rule 1 forbids both. Delete the opener and lead with the answer.');
    }
    if (BARE_ANSWER.test(said) && WALKBACK.test(said)) {
      out.push('Answers, then walks the answer back. Rule 1 allows one answer. Cut the sentence that qualifies it; if it is a real fact about the work, it belongs in the ticket.');
    }
    if (!filed && FILING.some((p) => p.test(said))) {
      out.push('Names work instead of filing it, and nothing under the plan tree was written this turn. Write the ticket with `/ticket`, give it its README row, rank it, then name the file.');
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

/// Everything said since the last thing the owner actually typed, block by block. Tool results arrive as user turns too, so a turn only counts when it carries plain text.
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

/// True once the newest message in the transcript is something the assistant said, which is what a finished turn looks like.
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
  const check = (text, want, label, filed = true) => {
    const got = offenses([text], filed).length > 0;
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

  // One answer, never a yes and a no. A pattern that fires on any "but" would refuse most of what is correctly said, so the anchor is both ends: a bare answer at the front and a sentence at the back that starts with a connective.
  check('No. But the pane still opens.', true, 'a bare no walked back');
  check('Yes.\n\nHowever, only on the second click.', true, 'a bare yes walked back over a break');
  check('Done. That said, the strip still waits.', true, 'a bare done walked back');
  check('No, but only on the second click.', false, 'one sentence, one answer');
  check('Yes. Windows only.', false, 'a bare answer left alone');
  check('The pager is off by one. However you look at it, the strip is wrong.', false, 'no bare answer to walk back');

  // Naming work in place of filing it, which is only an offense when nothing was filed.
  check('That needs a ticket.', true, 'a filing handed back with nothing written', false);
  check('The second fault is out of scope here.', true, 'the scope phrase with nothing written', false);
  check('That would be its own work.', true, 'the own-work phrase with nothing written', false);
  check('That is a different feature.', true, 'the different-feature phrase with nothing written', false);
  check('The strip is not covered.', true, 'the not-covered phrase with nothing written', false);
  check('Filed as the pager ticket; the strip is out of scope for this one.', false, 'the same phrase once something was written', true);
  check('The pane opens on the second click.', false, 'a reply naming no work at all', false);

  // Quoted material is not what the reply says. Rule 1 itself carries every phrase above, so a reply naming the rule would refuse itself.
  check('Rule 1 says a reply may not say "that needs a ticket".', false, 'the phrase inside quotation marks', false);
  check('The gate refuses `out of scope`.', false, 'the phrase in inline code', false);
  check('> No. But the pane still opens.\n\nThat line is the one it caught.', false, 'a quoted line as a blockquote', false);
  check('```\nout of scope\n```\n\nThat is the fenced case.', false, 'the phrase in a fenced block', false);
  if (unquoted('a `b` c').includes('b')) fails.push('unquoted: inline code survived');
  if (unquoted('one "two" three') !== 'one   three') fails.push('unquoted: a removal did not leave a space behind');
  if (!unquoted('keep this').includes('keep this')) fails.push('unquoted: ate text nothing quoted');

  // Whether the work was filed, read off the tree rather than off a line the reply writes for itself.
  const tree = join(tmpdir(), `gate-voice-plan-${process.pid}`);
  try {
    mkdirSync(join(tree, 'refactor', 'workflow'), { recursive: true });
    const older = join(tree, 'README.md');
    writeFileSync(older, 'a row\n');
    const stamp = Date.now() + 1000;
    if (filedSince(stamp, tree)) fails.push('filedSince: a tree nothing touched read as filed');
    const fresh = join(tree, 'refactor', 'workflow', 'new-ticket.md');
    writeFileSync(fresh, 'a plan\n');
    const past = Date.now() - 1000;
    if (!filedSince(past, tree)) fails.push('filedSince: a file written this turn was missed');
    if (!filedSince(undefined, tree)) fails.push('filedSince: no stamp should refuse nothing');
    if (!filedSince(past, join(tree, 'nowhere'))) fails.push('filedSince: an unreadable tree should refuse nothing');
  } catch (error) {
    fails.push(`filedSince: ${error.message}`);
  } finally {
    rmSync(tree, { force: true, recursive: true });
  }
  // Twelve short lines said between tool calls are twelve replies, not one long one. Joining them was how the ceiling read as met.
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

  // Through the real entry point, because the three things that would hurt most are all in it: a malformed block does nothing and looks like a pass, a hook that blocks while a stop hook is already running spins the turn forever, and a reply that has not landed yet reads as no reply at all. This run's own: `just verify` beside another `just verify` would otherwise have one deleting the transcript the other is reading.
  const path = join(tmpdir(), `gate-voice-selftest-${process.pid}.jsonl`);
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

  // The code moving with the ticket left where it was. A scratch checkout of its own, because the answer is about what git calls dirty and the tree this runs in is dirty on purpose.
  try {
    const tree = mkdtempSync(join(tmpdir(), `gate-voice-moved-${process.pid}-`));
    execFileSync('git', ['init', '--quiet'], { cwd: tree, stdio: 'ignore' });
    writeFileSync(join(tree, 'kept.rs'), 'fn main() {}\n');
    const began = statSync(join(tree, 'kept.rs')).mtimeMs + 1;
    if (movedSince(began, tree) !== null) fails.push('moved: a file written before the turn began was read as this turn\'s');
    const moved = join(tree, 'built.rs');
    writeFileSync(moved, 'fn built() {}\n');
    utimesSync(moved, new Date(began + 1000), new Date(began + 1000));
    if (movedSince(began, tree) !== 'built.rs') fails.push('moved: a file changed this turn was not found');
    if (movedSince(undefined, tree) !== null) fails.push('moved: a turn with no start was held');
    if (movedSince(began, join(tree, 'gone')) !== null) fails.push('moved: an unreadable tree held the turn');
    rmSync(tree, { recursive: true, force: true });
  } catch (error) {
    fails.push(`moved: ${error.message}`);
  }

  // The checklist's other half, through the real entry point: a step left un-struck has to actually hold the turn, and a turn held for a step alone must not be told to say its reply again. Its own session id, so a `just verify` beside another one does not hold the agent running it to a list this test wrote.
  const mine = `gate-voice-selftest-${process.pid}`;
  writeFileSync(path, [
    JSON.stringify({ type: 'user', message: { content: 'go' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } }),
  ].join('\n') + '\n');
  const stop = (extra) => execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
    input: JSON.stringify({ stop_hook_active: false, transcript_path: path, session_id: mine, ...extra }),
    encoding: 'utf8',
  });
  try {
    if (stop().trim() !== '') fails.push('checklist: a turn with no list was held');
    writeFileSync(listPath(mine), '- 1. Tests first\n- ~~2. `just verify`~~\n');
    const held = JSON.parse(stop() || '{}');
    if (held.decision !== 'block') fails.push('checklist: an un-struck step did not hold the turn');
    if (!held.reason?.includes('1. Tests first')) fails.push('checklist: the block did not say which step');
    if (/say it again/i.test(held.reason || '')) fails.push('checklist: a turn held for a step was told to rewrite the reply');
    writeFileSync(listPath(mine), '- ~~1. Tests first~~ — N/A; a hook with its own self-test\n');
    if (stop().trim() !== '') fails.push('checklist: a fully struck list still held the turn');
    writeFileSync(listPath(mine), '- 1. Tests first\n');
    if (stop({ stop_hook_active: true }).trim() !== '') fails.push('checklist: held again while a stop hook was already running');
  } catch (error) {
    fails.push(`checklist: ${error.message}`);
  } finally {
    clear(mine);
    rmSync(path, { force: true });
  }

  // The wait has to end on its own, or a turn that legitimately says nothing would hang the hook until the host kills it.
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
  console.log(`gate-voice: ok (${LIMIT}-character ceiling, ${SYCOPHANCY.length} opener patterns, the walk-back, ${FILING.length} filing phrases, code moving without its ticket, keycodes)`);
}

if (process.argv.includes('--check')) {
  selfTest();
} else {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    process.exit(0);
  }
  keep('Stop', raw);
  let payload = {};
  try {
    payload = JSON.parse(raw);
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
  // This session's record, not the other agent's: it owes its own codes and holds its own turn.
  const session = sessionOf(raw);
  const record = read(session);
  const filed = filedSince(record?.startedAt);
  const found = offenses(blocks, filed);
  // The code moved and the ticket did not. Held whatever the reply says, because the reply is not where a box is ticked.
  const moved = filed ? null : movedSince(record?.startedAt);
  const owed = blocks.length ? outstanding(record) : [];
  // The turn checklist's other half. One Stop hook holds all three, because a second one would spend the same single block the host allows.
  const left = pending(session);
  if (found.length || owed.length || left.length || moved) {
    const parts = [];
    if (found.length) parts.push(`Rule 1, from CLAUDE.md:\n${found.map((f) => `- ${f}`).join('\n')}`);
    if (owed.length) {
      parts.push(`Not read yet — report each keycode with \`node scripts/gate-keycode.mjs <file> <code>\`:\n${owed.map((o) => `- ${o}`).join('\n')}`);
    }
    if (left.length) parts.push(heldBy(left, session));
    if (moved) {
      parts.push(`${moved} changed and nothing under the plan tree did. Tick the box in the same edit as its code: open the ticket, tick what this turn built, and say on the box what the file now does where it came out different from the plan. A phase whose boxes are still open is one nobody can read the build against.`);
    }
    // Only a reply that broke a rule is written again. A turn held for a step or a keycode says nothing new.
    if (found.length) parts.push('Say it again, shorter. No note about this correction — just the answer.');
    process.stdout.write(JSON.stringify({ decision: 'block', reason: parts.join('\n\n') }));
    process.exit(0);
  }
  // The turn stands. Forget what it owed rather than leave a file behind.
  close(session);
  clear(session);
  process.exit(0);
}
