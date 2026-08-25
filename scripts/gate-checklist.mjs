#!/usr/bin/env node
// UserPromptSubmit hook. Writes this turn's checklist before the message is read: the numbered steps of the skill the message names with its host's sign, one bullet each, so the order is on disk instead of in a memory that drops whichever step came last.
//
// **A bullet is never work.** It is one step of one skill and it dies with the message; work is the ticket's boxes, which outlive the session. A find that turns up while a bullet is being worked belongs in a ticket, not in a bullet.
//
//   node scripts/gate-checklist.mjs           the hook payload on stdin
//   node scripts/gate-checklist.mjs --check   self-test (`just verify`)
//
// gate-voice.mjs is the other half: it holds the turn while a bullet is un-struck. Never blocks: any failure exits 0, because a hook that can wedge a session is worse than no hook.
//
// The list is one file per session in the OS temp folder, rewritten at the start of every message the way the keycode record is, so it never grows and never reaches a context window.

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { keyedFiles } from './gate-keycode.mjs';
import { keep, sessionOf, sessionTag, sweep } from './hook-payload.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/// A list older than this is a dead turn's, and holding a live turn to it would wedge the session. Same window the studio tree's own pair uses.
export const STALE_MS = 60 * 60 * 1000;

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

/// Start a turn: this session's last list goes, and this one's is written in its place. No skill named means no list, which is the common case and costs nothing.
export function write(prompt, session) {
  const path = listPath(session);
  const found = skillFor(prompt);
  if (!found) {
    rmSync(path, { force: true });
    return null;
  }
  writeFileSync(path, render(found.name, found.steps));
  sweep(tmpdir(), 'leaftext-checklist-');
  return found;
}

/// Every bullet still un-struck. Nothing to read, nothing left, or a list from a dead turn all answer the same way: hold nobody.
export function pending(session, now = Date.now()) {
  const path = listPath(session);
  try {
    if (now - statSync(path).mtimeMs > STALE_MS) return [];
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
  const ONE = 'aaaaaaaa-1111-1111-1111-111111111111';
  const TWO = 'bbbbbbbb-2222-2222-2222-222222222222';
  if (listPath(ONE) === listPath(TWO)) fails.push('two sessions share one list');
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
    if (pending(ONE, Date.now() + STALE_MS + 1000).length) fails.push('pending: a stale list still held the turn');
    rmSync(path, { force: true });
    if (pending(ONE).length) fails.push('pending: a missing list held the turn');

    // A message naming no skill clears the last one rather than leaving it to hold the next turn.
    write('/check it', ONE);
    write('what does the pager do', ONE);
    if (existsSync(listPath(ONE))) fails.push('write: a message naming no skill left the last list standing');
  } catch (error) {
    fails.push(`cycle: ${error.message}`);
  } finally {
    rmSync(listPath(ONE), { force: true });
    rmSync(listPath(TWO), { force: true });
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
  let prompt = '';
  try {
    prompt = (JSON.parse(raw).prompt ?? '').trim();
  } catch {
    process.exit(0);
  }
  let found = null;
  try {
    found = prompt ? write(prompt, sessionOf(raw)) : null;
  } catch {
    // A list that cannot be written holds nobody, which is the safe way round.
    process.exit(0);
  }
  if (found) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: [
          `This turn's checklist is \`${listPath(sessionOf(raw))}\` — the ${found.steps.length} steps of /${found.name}, in its order.`,
          'Work them in order and strike each one in the same edit as the work it names. A step that does not apply is struck with its reason. The turn cannot end while one is un-struck.',
          'They are steps, not work: anything found while working one is a ticket.',
        ].join('\n'),
      },
    }));
  }
  process.exit(0);
}
