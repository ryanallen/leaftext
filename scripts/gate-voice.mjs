#!/usr/bin/env node
// Stop hook. Measures the reply against Rule 1 and refuses to end the turn when it breaks. Printing a rule does not enforce it: gate-rules.mjs is the reminder, this is the check.
//
// It enforces the half of Rule 1 that names its own words: the 500-character ceiling, the sycophancy openers, the four connectives that walk a bare answer back, the five phrases that hand a filing back to the owner, and this turn's keycodes (gate-keycode.mjs). The rest of Rule 1 is a judgment call and stays a reminder.
//
// Finished work is handed back as the owner's own message repeated word for word, so a block they typed is measured against nothing — the ceiling included, since the owner sets the length of their own message, and the phrases included, since a message asking whether something is out of scope would otherwise refuse its own echo.
//
// It also refuses a build whose boxes did not go in one at a time while its code was landing. `/dev` says to tick each box in the same edit as its code, and a rule nothing reads is one a build forgets — which leaves the owner asking whether one is happening at all, the question the plan tree exists to answer without being asked. Read off the samples gate-sample.mjs takes after every edit and every shell command, never off the ticket alone: a phase ticked all at once at the end leaves a file identical to one filled in as the work finished, so only the order can tell them apart. The rule is written per box, so the reading is the run rather than a count — every rise is exactly one box, and no two rises touch. Nothing is left over to make up at the end.
//
// Where no build message named a ticket there are no samples, and the older reading stands in: code moved in this checkout and nothing under the plan tree did. That one is satisfied by any plan file, which is why it is the weaker of the two and why the samples replace it wherever the exact ticket is known.
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clear, heldBy, listPath, pending } from './gate-checklist.mjs';
import { buildRecord, buildingPath, forget } from './gate-design.mjs';
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

function countsIn(sample) {
  return Array.isArray(sample) ? sample.filter((p) => p && typeof p.phase === 'string' && Number.isFinite(p.ticked)) : [];
}

/// The phase whose ticks the samples say a build is on: the last sample's first phase still carrying an open box, and the last phase it knows of once every box is ticked.
function buildingIn(samples) {
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const open = countsIn(samples[i]).find((p) => p.open > 0);
    if (open) return open.phase;
  }
  const last = countsIn(samples[samples.length - 1]);
  return last.length ? last[last.length - 1].phase : 'the phase being built';
}

/// The phase a build swept, or null when its boxes went in one at a time. The rule is per box — a box goes from empty to ticked at the moment its code and its test are both in, and at no other moment — and a tick is itself an edit, sampled once it has landed, so the rule is a shape the run of samples either has or has not: **every rise is exactly one box, and no two rises touch.** Both halves are facts about an edit rather than about a phase, so the samples are walked once, edit by edit, summing the rise in every phase since the edit before: more than one box in a single edit is boxes ticked together whichever phases they landed in, and a rise in the edit straight after another rise is a box with none of its own work behind it wherever the two landed. Read per phase instead, the boundary between two phases is where either half can be crossed with the turn standing. No rise anywhere is code that moved with nothing said about it. A box whose whole work is a note in the ticket needs no allowance — the note is its own flat sample, so its tick is a rise with work before it exactly like any other box's.
export function sweptPhase(held) {
  const samples = Array.isArray(held?.samples) ? held.samples : [];
  if (!samples.length) return null;
  // A record whose samples name no phase says nothing about any box, and a gate that cannot read must refuse nothing.
  if (!samples.some((sample) => countsIn(sample).length)) return null;
  const last = new Map();
  for (const { phase, ticked } of countsIn(samples[0])) last.set(phase, ticked);
  let previous = -2;
  let before = null;
  let rose = false;
  for (let i = 1; i < samples.length; i += 1) {
    const risen = [];
    for (const { phase, ticked } of countsIn(samples[i])) {
      // A phase first seen part-way through the turn is that phase's baseline and never a rise, or writing one into the ticket reads as a tick nobody made.
      if (!last.has(phase)) { last.set(phase, ticked); continue; }
      const rise = ticked - last.get(phase);
      last.set(phase, ticked);
      if (rise > 0) risen.push({ phase, rise });
    }
    const boxes = risen.reduce((sum, one) => sum + one.rise, 0);
    if (!boxes) continue;
    const phase = risen[risen.length - 1].phase;
    // A refusal naming one of two phases sends a build to the wrong series, so an edit that crossed a boundary names both.
    if (boxes > 1) {
      const together = risen.map((one) => `${one.rise} in "${one.phase}"`).join(' and ');
      return { phase, fault: risen.length > 1 ? `${boxes} boxes were ticked in one edit, ${together}` : `${boxes} of its boxes were ticked in one edit`, edits: samples.length };
    }
    if (previous === i - 1) {
      const fault = before === phase ? "two of its boxes were ticked one edit after another, with none of the second one's work in between" : `its box was ticked in the edit straight after a box in "${before}", with none of its own work in between`;
      return { phase, fault, edits: samples.length };
    }
    previous = i;
    before = phase;
    rose = true;
  }
  if (!rose) return { phase: buildingIn(samples), fault: 'no box was ticked at all', edits: samples.length };
  return null;
}

/// Each block on its own. Rule 1 caps a response, and a turn that says three things says three of them — joining first would fail a turn for the sum of twelve short lines and pass one that ended in an essay.
///
/// `filed` is whether the plan tree was written this turn; it is the one thing here that is not in the reply, and it decides only the filing phrases. `echo` is what the owner typed, and a block they wrote is not a block the reply wrote.
export function offenses(blocks, filed = true, echo = '') {
  const out = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    // The message back, word for word. Nothing in it is the reply's own words, so nothing in it is measured.
    if (echo && echo.includes(trimmed)) {
      // Word for word is the whole message. A reply that is a piece of it has cut the front or the tail off what the owner wrote — the skill's own name most often — and hands them something they never typed.
      if (trimmed !== echo.trim()) {
        out.push('The message back, with part of it cut. Rule 1 echoes the owner\'s whole message, first character to last: the skill name, its argument and every line of it. Send it whole.');
      }
      continue;
    }
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

/// A message naming a skill reaches the transcript as tags rather than as the line the owner pressed enter on, and the skill's whole text arrives behind it as another turn of theirs. So the words are rebuilt: `/name argument` per command, in the order they were sent, which is what the owner has in front of them and what a hand-back has to come back as.
function typedCommands(text) {
  const out = [];
  const names = /<command-name>([^<]*)<\/command-name>/g;
  for (let found = names.exec(text); found; found = names.exec(text)) {
    const name = found[1].trim();
    if (!name) continue;
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text.slice(found.index));
    const written = name.startsWith('/') || name.startsWith('$') ? name : `/${name}`;
    const argument = args ? args[1].trim() : '';
    out.push(argument ? `${written} ${argument}` : written);
  }
  return out;
}

/// The last thing the owner actually typed, as one string. The same read `blocksOf` makes from the same end, and for the same reason: tool results arrive as user turns too, so a turn only counts when it carries plain text.
export function typedPrompt(lines) {
  const spoken = parse(lines).map((entry) => {
    if (entry.type !== 'user') return '';
    const content = entry.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n');
    return '';
  });
  let last = -1;
  for (let i = spoken.length - 1; i >= 0; i -= 1) {
    if (spoken[i].trim()) { last = i; break; }
  }
  if (last < 0) return '';
  // One message reaches the transcript as several turns of the owner's in a row, so the run is taken whole rather than only the last turn of it.
  const said = [];
  for (let i = last; i >= 0 && spoken[i].trim(); i -= 1) said.unshift(spoken[i]);
  // The skill's own text rides in behind the tags as another turn of theirs, so where a message names a skill the tags are the message and the rest of the run is the host talking.
  const commands = said.flatMap(typedCommands);
  return commands.length ? commands.join('\n') : said[said.length - 1];
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
  const check = (text, want, label, filed = true, echo = '') => {
    const got = offenses([text], filed, echo).length > 0;
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

  // The message back, word for word. Every rule above is the reply's own words, and none of these words are the reply's.
  const long = `fix the pager ${'x'.repeat(LIMIT)}`;
  check(long, false, 'the message back, over the ceiling', true, long);
  check('is the strip out of scope', false, 'the filing phrase in the message back', false, 'is the strip out of scope');
  check('No. But the pane still opens.', true, 'a walk-back the owner never typed', true, 'does the pane open');
  check('x'.repeat(LIMIT + 1), true, 'a long reply against a short message', true, 'go');

  // Word for word is the whole message. Echoing the argument without the skill that carried it is the way this goes wrong.
  const asked = '/dev C:\\work\\docs\\fixes\\reading\\the-bar-icons.md';
  check(asked, false, 'the whole message back', true, asked);
  check('C:\\work\\docs\\fixes\\reading\\the-bar-icons.md', true, 'the argument back without the skill name', true, asked);
  check('/dev', true, 'the skill name back without its argument', true, asked);
  check('first line', true, 'one line back out of a message of two', true, 'first line\nsecond line');

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
  if (typedPrompt(transcript) !== 'does it work on mac') fails.push('typedPrompt: did not find what the owner typed');
  if (typedPrompt([]) !== '') fails.push('typedPrompt: an empty transcript should say nothing');

  // A message naming a skill arrives as tags with the skill's own text behind it, so the words the owner pressed enter on are rebuilt rather than read; without this the echo is measured as the reply's own and refused for length.
  const commanded = [
    JSON.stringify({ type: 'user', message: { content: '<command-message>git-release</command-message>\n<command-name>/git-release</command-name>\n<command-args>one.md and two.md</command-args>' } }),
    JSON.stringify({ type: 'user', message: { content: '<command-message>done</command-message>\n<command-name>/done</command-name>\n<command-args>one.md and two.md</command-args>' } }),
    JSON.stringify({ type: 'user', message: { content: 'Base directory for this skill: x\n\n# Done\n\nThe skill itself, which the owner never typed.' } }),
  ];
  const sent = '/git-release one.md and two.md\n/done one.md and two.md';
  if (typedPrompt(commanded) !== sent) fails.push(`typedPrompt: a message naming two skills read as ${JSON.stringify(typedPrompt(commanded))}`);
  if (offenses(['x'.repeat(LIMIT + 1)], true, sent).length !== 1) fails.push('typedPrompt: a long reply against a rebuilt message should still be measured');
  if (offenses([sent], true, sent).length) fails.push('typedPrompt: the whole of a rebuilt message came back refused');
  // The argument alone is still part of the message and nothing else, so it is refused for being cut rather than passed for being inside it.
  if (offenses(['one.md and two.md'], true, sent).length !== 1) fails.push('typedPrompt: the argument alone should be refused as part of the message');
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

  // Whether the boxes went in one at a time while the code was landing, which is the whole of what a build turn is held on. One sample per edit, each carrying every phase of the ticket — so a series is read straight off the counts and nothing is inferred at the end.
  const PHASE = 'Phase 1 — the first one';
  const NEXT = 'Phase 2 — the second one';
  const turn = (...counts) => ({ ticket: '/plans/a.md', samples: counts.map((ticked) => [{ phase: PHASE, ticked, open: 5 - ticked }]) });
  // Both phases in every sample, which is what a real one carries: `[[1, 0], [1, 1]]` is two edits, the second of which ticked the second phase's first box.
  const both = (...pairs) => ({ ticket: '/plans/a.md', samples: pairs.map(([one, two]) => [{ phase: PHASE, ticked: one, open: 5 - one }, { phase: NEXT, ticked: two, open: 3 - two }]) });
  // The loop: code, test, tick, code, test, tick. Every rise is one box and none of them touch.
  if (sweptPhase(turn(0, 0, 1, 1, 1, 2))) fails.push('swept: a build that ticked one box at a time was held');
  // A box whose whole work is a note in the ticket, which is one edit rather than two. The note is its own flat sample, so its tick is a rise with work behind it exactly like any other box's — no mark, no allowance, and one flat sample is enough.
  if (sweptPhase(turn(0, 0, 1, 1, 2))) fails.push('swept: a box whose work was a note in the ticket was held');
  // The sweep, in one edit, with another edit after it.
  if (!sweptPhase(turn(0, 0, 0, 0, 0, 5, 5))) fails.push('swept: a phase swept in one edit was let through');
  // The same sweep written as five tick edits back to back, again with an edit after them.
  if (!sweptPhase(turn(0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 5))) fails.push('swept: a phase swept as ticks back to back was let through');
  // Two boxes ticked in one edit, which is the rule's own sentence broken at its grain.
  if (!sweptPhase(turn(0, 0, 2))) fails.push('swept: two boxes ticked in one edit were let through');
  // Two ticks with none of the second box's work between them.
  if (!sweptPhase(turn(0, 0, 1, 2))) fails.push('swept: two ticks one edit apart were let through');
  // Code moved and nothing was ever said about it.
  if (!sweptPhase(turn(0, 0, 0))) fails.push('swept: a turn that ticked nothing was let through');
  if (sweptPhase(turn(0, 0, 0))?.phase !== PHASE) fails.push('swept: a turn that ticked nothing did not name the phase being built');
  if (!/no box was ticked/.test(sweptPhase(turn(0, 0, 0))?.fault ?? '')) fails.push('swept: a turn that ticked nothing did not say which of the three it was');
  // A one-box turn: the tick is the first rise there is, so nothing is adjacent to it.
  if (sweptPhase(turn(0, 0, 1))) fails.push('swept: a single box ticked after its work was held');
  // A turn that finishes one phase and opens the next is read on both. Phase 1's last box goes in honestly and phase 2 is swept, so the refusal has to name phase 2.
  if (both([4, 0], [4, 0], [5, 0], [5, 0], [5, 2])?.samples.length !== 5) fails.push('swept: the two-phase sample builder is wrong');
  if (sweptPhase(both([4, 0], [4, 0], [5, 0], [5, 0], [5, 0]))) fails.push('swept: a turn was held on the phase it had already finished');
  if (sweptPhase(both([4, 0], [4, 0], [5, 0], [5, 0], [5, 1], [5, 1], [5, 2]))) fails.push('swept: a turn that finished one phase and worked the next one box at a time was held');
  if (sweptPhase(both([4, 0], [4, 0], [5, 0], [5, 0], [5, 2]))?.phase !== NEXT) fails.push('swept: a phase swept after another one finished was not caught, or was named as the wrong phase');
  // The boundary: phase 1's last box, then phase 2's first box in the very next edit. Adjacency is a fact about the edit, so the second tick has none of its own work behind it wherever the two landed.
  if (!sweptPhase(both([4, 0], [4, 0], [5, 0], [5, 1]))) fails.push('swept: two ticks one edit apart across a phase boundary were let through');
  if (sweptPhase(both([4, 0], [4, 0], [5, 0], [5, 1]))?.phase !== NEXT) fails.push('swept: a tick across a phase boundary was not named on the phase its own box is in');
  if (!sweptPhase(both([4, 0], [4, 0], [5, 0], [5, 1]))?.fault.includes(PHASE)) fails.push('swept: a tick across a phase boundary did not say which phase the earlier tick was in');
  // The same two ticks with an edit of work between them, which is a build finishing one phase and opening the next honestly.
  if (sweptPhase(both([4, 0], [4, 0], [5, 0], [5, 0], [5, 1]))) fails.push('swept: a phase finished and the next one opened with its own work in between was held');
  // One box ticked in each of two phases in one edit. Each phase's own series rises by exactly one, so only the edit sees them together, and the refusal has to name both.
  if (!sweptPhase(both([4, 0], [4, 0], [5, 1]))) fails.push('swept: one box ticked in each of two phases in one edit was let through');
  const acrossTwo = sweptPhase(both([4, 0], [4, 0], [5, 1]))?.fault ?? '';
  if (!acrossTwo.includes(PHASE) || !acrossTwo.includes(NEXT)) fails.push('swept: one box ticked in each of two phases in one edit did not name both');
  // A phase written into the ticket part-way through the turn, already carrying a box struck as not applicable. Its first appearance is its baseline, or writing a phase down reads as a tick nobody made.
  const late = { ticket: '/plans/a.md', samples: [[{ phase: PHASE, ticked: 4, open: 1 }], [{ phase: PHASE, ticked: 4, open: 1 }], [{ phase: PHASE, ticked: 5, open: 0 }], [{ phase: PHASE, ticked: 5, open: 0 }, { phase: NEXT, ticked: 1, open: 2 }]] };
  if (sweptPhase(late)) fails.push('swept: a phase first seen part-way through the turn with a box already ticked was held');
  if (sweptPhase(null)) fails.push('swept: a turn with no build record was held');
  if (sweptPhase({ ticket: '/plans/a.md', samples: [] })) fails.push('swept: a build that edited nothing was held');
  // A sample naming no phase at all says nothing about any box, so it holds nothing — which is also how a record left by an older shape of sample reads out.
  if (sweptPhase({ ticket: '/plans/a.md', samples: [[], [{ ticked: 2 }], 'not a sample'] })) fails.push('swept: a record whose samples name no phase held the turn');

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
    clear(mine);

    // The build record through the real entry point: the wiring, not only the reading. The reading does not open the ticket — every count it needs is in the samples — so the path here only has to name one.
    const ticket = join(tmpdir(), `gate-voice-ticket-${process.pid}.md`);
    writeFileSync(buildingPath(mine), JSON.stringify({ session: mine, ticket, samples: turn(0, 0, 0, 0, 0, 5, 5).samples }) + '\n');
    const swung = JSON.parse(stop() || '{}');
    if (swung.decision !== 'block') fails.push('build: a swept phase did not hold the turn');
    if (!swung.reason?.includes(PHASE)) fails.push('build: the block did not name the phase');
    if (buildRecord(mine)) fails.push('build: the record survived the turn it held');
    if (stop().trim() !== '') fails.push('build: the turn was held again after its record was cleared');
    writeFileSync(buildingPath(mine), JSON.stringify({ session: mine, ticket, samples: turn(0, 0, 1, 1, 2).samples }) + '\n');
    if (stop().trim() !== '') fails.push('build: a build that ticked one box at a time was held through the real entry point');
    forget(mine);
  } catch (error) {
    fails.push(`checklist: ${error.message}`);
  } finally {
    clear(mine);
    forget(mine);
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
  console.log(`gate-voice: ok (${LIMIT}-character ceiling, ${SYCOPHANCY.length} opener patterns, the walk-back, ${FILING.length} filing phrases, the owner's own message measured against nothing, code moving without its ticket, a build whose boxes did not go in one at a time — every rise one box and no two rises touching, read edit by edit so a phase boundary is no place to cross either half — keycodes)`);
}

// Only act when run directly: anything importing this for a function would otherwise read a stream nobody is writing, and the importer hangs with no message.
const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
const args = invoked === import.meta.url ? process.argv.slice(2) : null;
if (!args) {
  // Imported, not run.
} else if (args.includes('--check')) {
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
  let echo = '';
  try {
    statSync(payload.transcript_path);
    const lines = settled(payload.transcript_path, nap);
    blocks = blocksOf(lines);
    echo = typedPrompt(lines);
  } catch {
    process.exit(0);
  }
  // This session's record, not the other agent's: it owes its own codes and holds its own turn.
  const session = sessionOf(raw);
  const record = read(session);
  const filed = filedSince(record?.startedAt);
  const found = offenses(blocks, filed, echo);
  // The boxes did not go in one at a time while the code was landing. Held whatever the reply says, because the reply is not where a box is ticked, and read off the run of samples rather than off the ticket — a phase swept at the end leaves a file identical to one filled in as the work finished, so only the order can tell them apart.
  const held = buildRecord(session);
  const swept = held ? sweptPhase(held) : null;
  // The same fault where no build prompt named a ticket: the code moved and nothing under the plan tree did. This is the whole of what a turn outside a build is still held on.
  const moved = held || filed ? null : movedSince(record?.startedAt);
  const owed = blocks.length ? outstanding(record) : [];
  // The turn checklist's other half. One Stop hook holds all three, because a second one would spend the same single block the host allows.
  const left = pending(session);
  if (found.length || owed.length || left.length || moved || swept) {
    const parts = [];
    if (found.length) parts.push(`Rule 1, from CLAUDE.md:\n${found.map((f) => `- ${f}`).join('\n')}`);
    if (owed.length) {
      parts.push(`Not read yet — report each keycode with \`node scripts/gate-keycode.mjs <file> <code>\`:\n${owed.map((o) => `- ${o}`).join('\n')}`);
    }
    if (left.length) parts.push(heldBy(left, session));
    if (moved) {
      parts.push(`${moved} changed and nothing under the plan tree did. Tick the box in the same edit as its code: open the ticket, tick what this turn built, and say on the box what the file now does where it came out different from the plan. A phase whose boxes are still open is one nobody can read the build against.`);
    }
    if (swept) {
      parts.push(`${held.ticket}\n"${swept.phase}" — ${swept.fault}, across ${swept.edits} edits this turn. A box goes from empty to ticked in the same edit as the code and test that finish it, and at no other moment, so every rise is one box and no two rises touch. The ticket is where the owner watches a build happen: a box filled in ahead of its work, or once its work has stopped moving, says nothing was happening while it was.`);
    }
    // Only a reply that broke a rule is written again. A turn held for a step or a keycode says nothing new.
    if (found.length) parts.push('Say it again, shorter. No note about this correction — just the answer.');
    // The samples belong to the turn that made them. Kept past the block, they would hold the turn that fixes the ticket for the sweep it is repairing.
    forget(session);
    process.stdout.write(JSON.stringify({ decision: 'block', reason: parts.join('\n\n') }));
    process.exit(0);
  }
  // The turn stands. Forget what it owed rather than leave a file behind.
  close(session);
  clear(session);
  forget(session);
  process.exit(0);
}
