#!/usr/bin/env node
// UserPromptSubmit hook. Writes this turn's checklist before the message is read: the numbered steps of the skill the message names with its host's sign, one bullet each, so the order is on disk instead of in a memory that drops whichever step came last.
//
// It also holds the two records the rest of the gate reads off a message, because a hook that fires on the prompt is the only place either can be written: the git license, granted only when the message starts with `/git-release` or `$git-release` and read by scripts/gate-git.mjs, which never sees a prompt of its own; and this turn's keycode record, which scripts/gate-voice.mjs holds the turn to.
//
// **A bullet is never work.** It is one step of one skill and it dies with the message; work is the ticket's boxes, which outlive the session. A find that turns up while a bullet is being worked belongs in a ticket, not in a bullet.
//
//   node scripts/gate-checklist.mjs           the hook payload on stdin
//   node scripts/gate-checklist.mjs --check   self-test (`just verify`)
//
// gate-voice.mjs is the other half: it holds the turn while a bullet is un-struck. Never blocks: any failure exits 0, because a hook that can wedge a session is worse than no hook.
//
// The list is one file per session in the OS temp folder, rewritten at the start of every message the way the keycode record is, so it never grows and never reaches a context window.

import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ALWAYS, close, extend, keyedFiles, read, recordPath, requiredFor } from './gate-keycode.mjs';
import { KEEP, LICENSE_DIR, RING, TURN_MS, keep, licensePath, ringLines, sessionOf, sessionTag, sweep } from './hook-payload.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Messages that are host commands rather than work. They owe no keycode, but they still revoke the git license — otherwise a `/clear` after a release keeps it.
const META = ['/clear', '/help', '/config', '/cost', '/compact', '/init', '/skills',
  '/agents', '/permissions', '/status', '/release-notes', '/upgrade', '/mcp',
  '/login', '/logout', '/exit', '/quit'];

export function isMeta(prompt) {
  const first = prompt.split(/\s+/, 1)[0].toLowerCase();
  return META.some((m) => first === m || first.startsWith(m + ':'));
}

// `git-release` typed as this message's command — Claude's slash or Codex's dollar — and nothing else, authorizes a git write. Anchored to the start because a mention anywhere would let a quoted transcript grant one.
export function hasReleaseLicense(prompt) {
  return /^[$\/]git-release\b/i.test(prompt.trim());
}

// This session's license, and no other agent's. With no session id there is nowhere to write it, and the git gate then refuses every write.
function writeLicense(granted, prompt, session) {
  const path = licensePath(session);
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({
      state: granted ? 'granted' : 'denied',
      at: new Date().toISOString(),
      session,
      prompt: prompt.slice(0, 120),
    }) + '\n');
    // Nothing ever deleted a license: a stale one was only ignored on its age when something read it, and one file per session is a folder that grows.
    sweep(LICENSE_DIR, 'git-license');
  } catch {
    // A license that cannot be written reads as denied, which is the safe way round.
  }
}

/// Enough transcript to reach the turn before the message without reading a whole session history.
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;

/// One file per session: two agents can work this checkout at once, and one file for both is cleared by whichever starts a message while the other is halfway through its steps.
export function listPath(session) {
  const tag = sessionTag(session ?? sessionOf(''));
  return join(tmpdir(), tag ? `leaftext-checklist-${tag}.md` : 'leaftext-checklist.md');
}

/// The numbered step headings a skill writes for itself — `### 1. Tests first`. The skill file stays the only copy, so there is no second list to drift; a skill with no numbered headings has no order worth holding and writes no list.
export function stepsIn(markdown) {
  const steps = [];
  for (const line of markdown.split('\n')) {
    const found = line.match(/^###\s+(\d+)\.\s+(.+?)\s*$/);
    if (found) steps.push(`${found[1]}. ${found[2]}`);
  }
  return steps;
}

/// The skill this message names with its host's sign, and the steps it writes. The name is matched off the one table of keyed skills, so a skill is named in one place. A message naming two — "/git-release then /done" — takes the one it leads with, which is the one being run now.
export function skillFor(prompt, read = (file) => readFileSync(join(root, file), 'utf8')) {
  const named = [];
  for (const file of keyedFiles()) {
    const name = file.match(/skills\/(.*?)\//)?.[1];
    const at = name ? prompt.search(new RegExp(`(^|\\s)[$/]${name}(?=\\s|$)`, 'i')) : -1;
    if (at >= 0) named.push({ name, file, at });
  }
  for (const { name, file } of named.sort((a, b) => a.at - b.at)) {
    let steps = [];
    try {
      steps = stepsIn(read(file));
    } catch {
      continue; // A skill that cannot be read has no steps to hold anyone to.
    }
    if (steps.length) return { name, steps };
  }
  return null;
}

/// What the file says. The bullets are plain — `- 1. Tests first` — and struck as they are done, which is the one convention both halves read.
export function render(name, steps) {
  return [
    `# Turn checklist — /${name}`,
    '',
    'The steps of the skill this message names, in its own order. Work them in order and strike each one in the same edit as the work it names: `- ~~1. Tests first~~`. A step that legitimately does not apply is struck with its reason: `- ~~4. Build the test~~ — N/A; the phase is a hook with its own self-test`.',
    '',
    '**These are steps, not work.** Work is the ticket\'s boxes, which outlive the session; a bullet here dies with this message. Anything found while working one is a ticket, never a bullet.',
    '',
    ...steps.map((step) => `- ${step}`),
    '',
  ].join('\n');
}

/// A message naming a skill writes that skill's steps over whatever was there. One naming none leaves the list alone: this fires when the message is submitted, which cannot tell a new turn from a sentence typed into a running one, and deleting there took the list out from under the pass halfway through it. The end of the turn is what clears a list, in gate-voice.mjs, because that is the one side that knows a turn has ended.
export function write(prompt, session) {
  const path = listPath(session);
  const found = skillFor(prompt);
  if (!found) return null;
  writeFileSync(path, render(found.name, found.steps));
  sweep(tmpdir(), 'leaftext-checklist-');
  return found;
}

/// Every bullet still un-struck. Nothing to read, nothing left, or a list from a dead turn all answer the same way: hold nobody.
export function pending(session, now = Date.now()) {
  const path = listPath(session);
  try {
    if (now - statSync(path).mtimeMs > TURN_MS) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => /^- /.test(line) && !line.startsWith('- ~~'))
      .map((line) => line.replace(/^- /, '').trim());
  } catch {
    return [];
  }
}

/// The turn stood, so its list has done its job. Left behind it would be read by the next turn until it went stale.
export function clear(session) {
  rmSync(listPath(session), { force: true });
}

function transcriptTail(path, limit = TRANSCRIPT_TAIL_BYTES) {
  const file = openSync(path, 'r');
  try {
    const size = fstatSync(file).size;
    const start = Math.max(0, size - limit);
    const bytes = Buffer.alloc(size - start);
    let length = 0;
    while (length < bytes.length) {
      const read = readSync(file, bytes, length, bytes.length - length, start + length);
      if (!read) break;
      length += read;
    }
    let text = bytes.subarray(0, length).toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text.split('\n').filter(Boolean);
  } finally {
    closeSync(file);
  }
}

function entryText(entry) {
  const content = entry?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part?.type === 'text').map((part) => part.text ?? '').join('\n');
}

/// Whether the transcript entry before this message says the owner stopped the previous turn.
export function interruptedBeforeMessage(path, promptId, readTail = transcriptTail) {
  if (!path || !promptId) return false;
  const lines = readTail(path);
  let sawThisMessage = false;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[index]);
    } catch {
      return false;
    }
    if (entry.promptId === promptId) {
      sawThisMessage = true;
      continue;
    }
    if (!sawThisMessage) return false;
    return Boolean(entry.interruptedMessageId) || entryText(entry).includes('[Request interrupted by user]');
  }
  return false;
}

/// What the Stop hook says when a bullet is left. It names the file, because striking a bullet means editing it.
export function heldBy(left, session) {
  return [
    `${left.length} step${left.length === 1 ? '' : 's'} of this turn's checklist ${left.length === 1 ? 'is' : 'are'} un-struck:`,
    ...left.map((step) => `- ${step}`),
    '',
    `Work each one, or strike it with its reason where it does not apply, in \`${listPath(session)}\`.`,
  ].join('\n');
}

function selfTest() {
  const fails = [];

  // The license, which scripts/gate-git.mjs reads and nothing else writes.
  const licenseCases = [
    ['plain message', false],
    ['$git-release', true],
    ['$git-release 0.1.441', true],
    ['  $git-release  ', true],
    ['/git-release', true],
    ['/git-release 0.1.441', true],
    // v0.1.442: the release ran off a message that only quoted the transcript. A mention is not an instruction, wherever in the message it sits.
    ['ship it with $git-release please', false],
    ['i ran $git-release and you refused, why', false],
    ['> $git-release\n\n● Running the pre-steps', false],
    ['read .agents/skills/git-release/SKILL.md', false],
    ['tell me about git-release', false],
  ];
  for (const [prompt, want] of licenseCases) {
    if (hasReleaseLicense(prompt) !== want) fails.push(`license: ${JSON.stringify(prompt)} -> ${!want}`);
  }
  if (!isMeta('/clear')) fails.push('meta: /clear not recognized');
  if (isMeta('clear the cache')) fails.push('meta: prose treated as a command');

  // The ring every hook writes to. Per hook, because the tool gate fires on every command and would otherwise push the one prompt of the turn out before anyone read it back.
  const line = (hook, n) => JSON.stringify({ hook, n });
  const crowded = [];
  for (let n = 0; n < 30; n += 1) crowded.push(line('PreToolUse', n));
  crowded.push(line('Stop', 0));
  const rung = ringLines(crowded, 'PreToolUse', line('PreToolUse', 30));
  const mine = rung.filter((l) => JSON.parse(l).hook === 'PreToolUse');
  if (mine.length !== KEEP) fails.push(`ring: kept ${mine.length} payloads of one hook, not ${KEEP}`);
  if (JSON.parse(mine.at(-1)).n !== 30) fails.push('ring: the newest payload was not kept');
  if (JSON.parse(mine[0]).n !== 30 - KEEP + 1) fails.push('ring: it dropped the newest end, not the oldest');
  if (!rung.some((l) => JSON.parse(l).hook === 'Stop')) fails.push('ring: one hook pushed another hook out');

  // Nothing arrived is not an answer worth a line, and a line every turn would push out the ones that carry one.
  const beforeRing = existsSync(RING) ? readFileSync(RING, 'utf8') : null;
  keep('SelfTest', '   ');
  const afterRing = existsSync(RING) ? readFileSync(RING, 'utf8') : null;
  if (afterRing !== beforeRing) fails.push('ring: an empty payload still wrote a line');

  // The keycode record and the license, through the real entry point. A record still standing is a turn still running, and this is the one place that decision is wired: swapping the fold back to `open` passes every test that reaches the record directly, so it is proved here by firing the hook twice.
  const MID = `gate-checklist-record-${process.pid}`;
  const DEV = '.agents/skills/dev/SKILL.md';
  const fire = (prompt) => execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
    input: JSON.stringify({ session_id: MID, prompt }),
    encoding: 'utf8',
  });
  try {
    fire('/dev the ticket');
    const opened = read(MID);
    if (!opened?.required?.includes(DEV)) fails.push('hook: a skill-named message did not owe that skill');
    if (!existsSync(licensePath(MID))) fails.push('hook: no license was written for the message');
    else if (JSON.parse(readFileSync(licensePath(MID), 'utf8')).state !== 'denied') fails.push('hook: a message with no release command was licensed');
    fire('/git-release 1.2.3');
    if (JSON.parse(readFileSync(licensePath(MID), 'utf8')).state !== 'granted') fails.push('hook: a release command was not licensed');
    fire('/clear');
    if (JSON.parse(readFileSync(licensePath(MID), 'utf8')).state !== 'denied') fails.push('hook: a host command after a release kept the license');
    opened.reported = { [ALWAYS]: 'LEAF-REPORTED' };
    writeFileSync(recordPath(MID), JSON.stringify(opened) + '\n');
    fire('also check the footer wording');
    const sentence = read(MID);
    if (sentence?.reported?.[ALWAYS] !== 'LEAF-REPORTED') fails.push('hook: a sentence typed mid-turn wiped a code already reported');
    if (sentence?.startedAt !== opened.startedAt) fails.push('hook: a sentence typed mid-turn moved the stamp the turn began at');
    if (!sentence?.required?.includes(DEV)) fails.push('hook: a sentence typed mid-turn dropped the skill the pass is running');
  } catch (error) {
    fails.push(`hook: ${error.message}`);
  } finally {
    close(MID);
    clear(MID);
    rmSync(licensePath(MID), { force: true });
  }

  const skill = ['---', 'name: check', '---', '', '# Check', '', 'Prose.', '', '## Process', '', '### 1. Tests first', '', 'Run it.', '', '### 2. `just verify`', '', '## Reference', '', '- a link'].join('\n');
  const steps = stepsIn(skill);
  if (steps.length !== 2) fails.push(`stepsIn: found ${steps.length} steps, not 2`);
  if (steps[0] !== '1. Tests first') fails.push('stepsIn: lost a step title');
  if (steps[1] !== '2. `just verify`') fails.push('stepsIn: a step written in code did not survive');
  if (stepsIn('# A skill\n\n## A section\n\nProse.').length) fails.push('stepsIn: invented steps for a skill with no numbered headings');

  // Every invocable skill owns an ordered pass. Each is read out of its own file, which is the whole point: there is no second copy to drift.
  const skillFiles = keyedFiles().filter((file) => /skills\/[^/]+\/SKILL\.md$/.test(file));
  for (const file of skillFiles) {
    const name = file.match(/skills\/(.*?)\//)?.[1];
    const source = readFileSync(join(root, file), 'utf8');
    const found = skillFor(`/${name} the ticket`);
    if (!found) fails.push(`${name}: names no steps, so the hook would write nothing`);
    else if (found.name !== name) fails.push(`${name}: matched ${found.name} instead`);
    const withoutHeadings = source.replace(/^###\s+\d+\.\s+.+$/gm, '');
    const mutated = skillFor(`/${name} the ticket`, (candidate) => candidate === file ? withoutHeadings : readFileSync(join(root, candidate), 'utf8'));
    if (mutated) fails.push(`${name}: removing its numbered headings still produced an enforced list`);
  }
  const requiredClosingSteps = new Map([
    ['git-release', ['Mark every shipped ticket Released and finish']],
    ['done', ['Remove the live row', 'Rerank with /pm', 'Read the running order back']],
  ]);
  for (const [name, required] of requiredClosingSteps) {
    const found = skillFor(`/${name} the ticket`);
    for (const title of required) {
      if (!found?.steps.some((step) => step.endsWith(title))) fails.push(`${name}: lost its ${title} step`);
      const source = readFileSync(join(root, `.agents/skills/${name}/SKILL.md`), 'utf8');
      const without = stepsIn(source.replace(new RegExp(`^### \\d+\\. ${title.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`, 'm'), ''));
      if (without.some((step) => step.endsWith(title))) fails.push(`${name}: removing its ${title} heading did not remove the enforced step`);
    }
  }
  if (skillFor('run the checker')) fails.push('skillFor: prose named a skill');
  if (skillFor('hello')) fails.push('skillFor: a message naming nothing got a list');
  if (skillFor('$check it')?.name !== 'check') fails.push("skillFor: the dollar sign did not name a skill");
  if (skillFor('$design-tokens change it')?.name !== 'design-tokens') fails.push('skillFor: a hyphenated skill fell back to its shorter prefix');
  // A message naming two runs the one it leads with, whichever order the table happens to hold them in.
  if (skillFor('/dev the ticket then /check')?.name !== 'dev') fails.push('skillFor: took the second skill named');
  if (skillFor('/check it then /dev the next one')?.name !== 'check') fails.push('skillFor: took the second skill named');

  const drawn = render('check', ['1. Tests first', '2. `just verify`']);
  if (!drawn.includes('- 1. Tests first')) fails.push('render: a step did not become a bullet');
  if (!/not work/i.test(drawn)) fails.push('render: the list does not say it is not a work list');

  // The whole cycle, under two session ids, because a second agent starting a message must not take the list the first is halfway through — the fault two-agents-at-once already paid for.
  //
  // Both belong to this check run: under fixed made-up names, two gates running at once wrote and removed the same two lists and each reported a fault the tree did not have.
  const ONE = `selftest-${process.pid}-one`;
  const TWO = `selftest-${process.pid}-two`;
  if (listPath(ONE) === listPath(TWO)) fails.push('two sessions share one list');
  for (const session of [ONE, TWO]) {
    if (!listPath(session).includes(String(process.pid))) fails.push(`${session} names a list two check runs would share`);
  }
  try {
    if (!write('/check it', ONE)) fails.push('write: a message naming a skill wrote no list');
    const left = pending(ONE);
    if (!left.length) fails.push('pending: a fresh list held nobody');
    if (!heldBy(left, ONE).includes(listPath(ONE))) fails.push('heldBy: did not say where the list is');

    write('/dev the ticket', TWO);
    if (!pending(ONE).length) fails.push("a message in one session cleared the other's list");

    // Struck, one at a time: the turn is held until the last one goes.
    const path = listPath(ONE);
    const struck = readFileSync(path, 'utf8').split('\n')
      .map((line) => (/^- /.test(line) ? `- ~~${line.slice(2)}~~` : line)).join('\n');
    writeFileSync(path, struck);
    if (pending(ONE).length) fails.push('pending: a fully struck list still held the turn');

    // A step marked skipped reads as struck, with its reason left in the line.
    writeFileSync(path, '- ~~1. Tests first~~ — N/A; the phase is a hook\n');
    if (pending(ONE).length) fails.push('pending: a step skipped with its reason still held the turn');

    // A dead turn's list must not hold a live one, and neither must a missing one.
    writeFileSync(path, '- 1. Tests first\n');
    if (!pending(ONE).length) fails.push('pending: an un-struck bullet did not hold the turn');
    if (pending(ONE, Date.now() + TURN_MS + 1000).length) fails.push('pending: a stale list still held the turn');
    rmSync(path, { force: true });
    if (pending(ONE).length) fails.push('pending: a missing list held the turn');

    // A message naming no skill leaves the standing list where it is. It is submitted while the last turn may still be running, so deleting here took the list out from under the pass halfway through working it.
    write('/check it', ONE);
    const partly = readFileSync(listPath(ONE), 'utf8').replace(/^- (1\. .*)$/m, '- ~~$1~~');
    writeFileSync(listPath(ONE), partly);
    const before = pending(ONE);
    if (!partly.includes('- ~~') || !before.length) fails.push('write: the list was not left part-struck, so the case below proves nothing');
    write('what does the pager do', ONE);
    if (!existsSync(listPath(ONE))) fails.push('write: a message naming no skill deleted the standing list');
    if (readFileSync(listPath(ONE), 'utf8') !== partly) fails.push('write: a message naming no skill rewrote the standing list');
    if (pending(ONE).join('|') !== before.join('|')) fails.push('write: the steps left after a message naming no skill are not the ones that were left before it');
    if (pending(ONE, Date.now() + TURN_MS + 1000).length) fails.push('pending: a standing list past the staleness window still held the turn');
  } catch (error) {
    fails.push(`cycle: ${error.message}`);
  } finally {
    rmSync(listPath(ONE), { force: true });
    rmSync(listPath(TWO), { force: true });
  }

  const promptId = `prompt-${process.pid}`;
  const stopped = `selftest-${process.pid}-stopped`;
  const running = `selftest-${process.pid}-running`;
  const currentOnly = `selftest-${process.pid}-current-only`;
  const unreadable = `selftest-${process.pid}-unreadable`;
  const stoppedTranscript = join(tmpdir(), `${stopped}.jsonl`);
  const runningTranscript = join(tmpdir(), `${running}.jsonl`);
  const currentOnlyTranscript = join(tmpdir(), `${currentOnly}.jsonl`);
  const missingTranscript = join(tmpdir(), `${unreadable}-missing.jsonl`);
  const standing = '- 1. Belongs to the turn still running\n';
  const runPrompt = (session, transcript) => execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
    input: JSON.stringify({ prompt: 'what does the pager do', prompt_id: promptId, session_id: session, transcript_path: transcript }),
    encoding: 'utf8',
  });
  try {
    writeFileSync(listPath(stopped), standing);
    writeFileSync(stoppedTranscript, [
      JSON.stringify({ type: 'user', interruptedMessageId: 'stopped-message', message: { content: '[Request interrupted by user]' } }),
      JSON.stringify({ type: 'user', promptId, message: { content: 'what does the pager do' } }),
    ].join('\n') + '\n');
    runPrompt(stopped, stoppedTranscript);
    if (existsSync(listPath(stopped))) fails.push('interrupted turn: the next message left the stopped turn\'s list behind');

    const oldShape = [
      JSON.stringify({ type: 'user', message: { content: '[Request interrupted by user]' } }),
      JSON.stringify({ type: 'user', promptId, message: { content: 'what does the pager do' } }),
    ];
    if (!interruptedBeforeMessage('unused', promptId, () => oldShape)) fails.push('interrupted turn: the older text-only stop shape was missed');

    writeFileSync(listPath(running), standing);
    writeFileSync(runningTranscript, [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working.' }] } }),
      JSON.stringify({ type: 'user', promptId, message: { content: 'what does the pager do' } }),
    ].join('\n') + '\n');
    runPrompt(running, runningTranscript);
    if (!existsSync(listPath(running))) fails.push('running turn: the next message cleared the standing list');
    else if (readFileSync(listPath(running), 'utf8') !== standing) fails.push('running turn: the next message rewrote the standing list');

    writeFileSync(listPath(currentOnly), standing);
    writeFileSync(currentOnlyTranscript, [
      JSON.stringify({ type: 'user', promptId, message: { content: 'what does the pager do' } }),
      JSON.stringify({ type: 'user', promptId, message: { content: 'the same incoming message' } }),
    ].join('\n') + '\n');
    runPrompt(currentOnly, currentOnlyTranscript);
    if (!existsSync(listPath(currentOnly))) fails.push('current-only tail: the standing list was cleared without a previous turn to read');
    else if (readFileSync(listPath(currentOnly), 'utf8') !== standing) fails.push('current-only tail: the standing list was rewritten');

    writeFileSync(listPath(unreadable), standing);
    runPrompt(unreadable, missingTranscript);
    if (!existsSync(listPath(unreadable))) fails.push('unreadable tail: the standing list was cleared');
    else if (readFileSync(listPath(unreadable), 'utf8') !== standing) fails.push('unreadable tail: the standing list was rewritten');
  } catch (error) {
    fails.push(`interrupted turn: ${error.message}`);
  } finally {
    clear(stopped);
    clear(running);
    clear(currentOnly);
    clear(unreadable);
    rmSync(stoppedTranscript, { force: true });
    rmSync(runningTranscript, { force: true });
    rmSync(currentOnlyTranscript, { force: true });
    rmSync(missingTranscript, { force: true });
  }

  if (fails.length) {
    console.error('gate-checklist: failed');
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`gate-checklist: ok (${keyedFiles().length - 1} skills read for their own steps)`);
}

// Only act when run directly: gate-voice.mjs imports this for its functions, and an import that read stdin and exited would take the Stop hook's own payload out from under it.
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
  keep('UserPromptSubmit', raw);
  let payload = {};
  let prompt = '';
  try {
    payload = JSON.parse(raw);
    prompt = (payload.prompt ?? '').trim();
  } catch {
    process.exit(0);
  }
  const session = sessionOf(raw);
  writeLicense(hasReleaseLicense(prompt), prompt, session);
  if (prompt && !isMeta(prompt)) {
    // What this message owes, folded into this session's record. A record still standing is a turn still running, because the reply gate deletes it when one ends — so a sentence typed into a running pass adds to what is owed and leaves the codes it has given and the moment it began where they are.
    try {
      extend(requiredFor(prompt), session);
    } catch {
      // A record that cannot be written owes nothing, which is the safe way round: a broken hook must never stop a turn.
    }
  }
  try {
    if (interruptedBeforeMessage(payload.transcript_path, payload.prompt_id)) clear(session);
  } catch {
    // An unreadable tail leaves the list because the hour still bounds it.
  }
  let found = null;
  try {
    found = prompt ? write(prompt, session) : null;
  } catch {
    // A list that cannot be written holds nobody, which is the safe way round.
    process.exit(0);
  }
  if (found) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: [
          `This turn's checklist is \`${listPath(session)}\` — the ${found.steps.length} steps of /${found.name}, in its order.`,
          'Work them in order and strike each one in the same edit as the work it names. A step that does not apply is struck with its reason. The turn cannot end while one is un-struck.',
          'They are steps, not work: anything found while working one is a ticket.',
        ].join('\n'),
      },
    }));
  }
  process.exit(0);
}
