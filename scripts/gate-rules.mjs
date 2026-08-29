#!/usr/bin/env node
// UserPromptSubmit hook. Two jobs, both cheap enough to pay for on every turn:
//
//   1. Print Rule 1 out of AGENTS.md, so the tone rule is read again rather than
//      remembered. The file is the copy; this script holds none of its own.
//   2. Record whether this message says `/git-release` or `$git-release`, in `.tmp/git-license`.
//      A PreToolUse hook never sees the prompt, so scripts/gate-git.mjs reads
//      what this wrote.
//
//   node scripts/gate-rules.mjs           the hook payload on stdin
//   node scripts/gate-rules.mjs --check   self-test (`just verify`)
//
// Never blocks: any failure exits 0, because a broken hook must not stop a turn.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ALWAYS, close, extend, read, recordPath, requiredFor } from './gate-keycode.mjs';
import { KEEP, LICENSE_DIR, RING, keep, licensePath, ringLines, sessionOf, sweep } from './hook-payload.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Messages that are host commands rather than work. They get no context, but they still revoke the git license — otherwise a `/clear` after a release keeps it.
const META = ['/clear', '/help', '/config', '/cost', '/compact', '/init', '/skills',
  '/agents', '/permissions', '/status', '/release-notes', '/upgrade', '/mcp',
  '/login', '/logout', '/exit', '/quit'];

// One line each, for whatever the message touches. Three at most, so the output stays about ten lines.
const TRIGGERS = [
  [/assets\/reading\/|theme\.rs|themes\//i,
    'A value belongs in `design/`: colors.md names a color, tokens.md holds every other value, icons.md the icons, components.md every class — then `just bundle-tokens`, `bundle-icons` or `bundle-gallery`. What a theme sets a color to is `themes/`, then `just bundle-themes`. Never edit a generated file, never a per-theme diagram palette.'],
  [/shell\/|fragment|app_shell|APP_SHELL/i,
    '`src/assets/shell/` is one shared scope in `APP_SHELL_SCRIPT_PARTS` order. `state.js` holds only what two fragments touch. `just check-shell`.'],
  [/Cargo\.toml|\bcrate\b|dependenc/i,
    'A new crate: report the transitive `cargo tree` cost and the alternative, default features off, gate one platform — then ask.'],
  [/format\.rs|new format|file extension/i,
    '`format.rs` is the only table of formats: one arm, then fix every exhaustive match that stops compiling. Never a second list.'],
  [/\bdocs\b|README|sync-docs/i,
    'Docs: `/sync-docs` edits `docs/` and never touches git.'],
];

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function promptOf(payload) {
  try {
    const obj = JSON.parse(payload);
    return typeof obj.prompt === 'string' ? obj.prompt.trim() : '';
  } catch {
    return '';
  }
}

export function isMeta(prompt) {
  const first = prompt.split(/\s+/, 1)[0].toLowerCase();
  return META.some((m) => first === m || first.startsWith(m + ':'));
}

// `git-release` typed as this message's command — Claude's slash or Codex's dollar — and nothing else, authorizes a git write. Anchored to the start because a mention anywhere would let a quoted transcript grant one.
export function hasReleaseLicense(prompt) {
  return /^[$\/]git-release\b/i.test(prompt.trim());
}

// One section's body, up to the next heading at its own level or above.
function sectionBody(markdown, heading, depth) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return '';
  const stop = new RegExp(`^#{1,${depth}}\\s`);
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (stop.test(line) || /^---\s*$/.test(line)) break;
    body.push(line);
  }
  return body.join('\n').trim();
}

// The `# Rule 1` section of AGENTS.md, up to the rule after it.
export function rule1(markdown) {
  return sectionBody(markdown, /^#+\s+Rule 1\b/, 2);
}

// The layout section is two things: a pointer to the architecture page, which is the file map, and the cross-cutting rules the guide carries itself. Under one heading the rules read as a second file map, so each half owes a heading saying which it is.
export function layoutFaults(markdown) {
  const layout = sectionBody(markdown, /^##\s+Layout\b/, 2);
  if (!layout) return ['AGENTS.md: no `## Layout` section'];
  const faults = [];
  if (!/^###\s+The file map\s*$/m.test(layout)) faults.push('AGENTS.md: the layout section has no `### The file map` heading');
  if (!/docs\/02-development\/01-architecture\.md/.test(layout)) faults.push('AGENTS.md: the layout section no longer points at the architecture page, which is the file map');
  if (!/^###\s+Rules the file map does not carry\s*$/m.test(layout)) faults.push('AGENTS.md: the cross-cutting rules have no heading of their own, so they read as a second file map');
  return faults;
}

export function reminders(prompt) {
  return TRIGGERS.filter(([test]) => test.test(prompt)).slice(0, 3).map(([, line]) => line);
}

export function context(prompt, rule) {
  const out = [];
  if (rule) out.push(rule);
  const hints = reminders(prompt);
  if (hints.length) out.push('', ...hints.map((h) => `- ${h}`));
  out.push('', `- Read these before you finish, and report each one's keycode with \`node scripts/gate-keycode.mjs <file> <code>\`: ${requiredFor(prompt).join(', ')}. The keycode is an HTML comment at the end of the file. The turn cannot end until every one is in.`);
  out.push('', hasReleaseLicense(prompt)
    ? '- A git-release command starts this message: one git write is authorized, for this turn only.'
    : '- No git-release command starts this message (`/git-release` in Claude, `$git-release` in Codex). Git writes are refused by scripts/gate-git.mjs. Do not offer or hint at one; a dirty tree is the correct end state.');
  out.push('- A build runs `/check` once, after its last phase. A pass that wrote no code runs none: shipping, retirement, ticket writing, design and ranking each prove what they write and never the code again. Then the whole reply is this message repeated word for word: nothing about what changed, nothing to try, no command after it. Never mention that the Mac build or the installer cannot be built here — it is true every time, it is already known, and saying it is the padding Rule 1 refuses.');
  return out.join('\n');
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

function selfTest() {
  const cases = [
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
  const fails = [];
  for (const [prompt, want] of cases) {
    if (hasReleaseLicense(prompt) !== want) fails.push(`license: ${JSON.stringify(prompt)} -> ${!want}`);
  }
  if (!isMeta('/clear')) fails.push('meta: /clear not recognized');
  if (isMeta('clear the cache')) fails.push('meta: prose treated as a command');

  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  const rule = rule1(agents);
  if (!rule) fails.push('AGENTS.md: no `# Rule 1` section to print');
  if (/^#/m.test(rule)) fails.push('AGENTS.md: Rule 1 section ran into the next heading');
  if ((agents.match(/^#+\s+Rule 1\b/gm) || []).length !== 1) {
    fails.push('AGENTS.md: Rule 1 is written more than once');
  }
  // The hand-back test is prose only the printed rule enforces, so an edit that moves its paragraph out of the section must fail here rather than silently drop it from every turn.
  if (!rule.includes('A fact the owner cannot act on')) {
    fails.push('AGENTS.md: the printed Rule 1 no longer carries the hand-back test');
  }
  // The three cases mutate the real guide rather than a fixture, so renaming a heading fails here instead of passing against a copy.
  for (const fault of layoutFaults(agents)) fails.push(fault);
  if (!layoutFaults(agents.replace(/^### The file map$/m, '### Where things live')).length) {
    fails.push('layout: a guide whose file map lost its heading passed');
  }
  if (!layoutFaults(agents.replace(/docs\/02-development\/01-architecture\.md/g, 'docs/02-development/')).length) {
    fails.push('layout: a guide that stopped naming the architecture page passed');
  }
  if (!layoutFaults(agents.replace(/^### Rules the file map does not carry$/m, '### More')).length) {
    fails.push('layout: a guide whose cross-cutting rules lost their heading passed');
  }

  if (!reminders('editing src/assets/reading/library.css').length) fails.push('reminders: a stylesheet part matched nothing');
  if (reminders('hello').length) fails.push('reminders: fired on a message that touches nothing');
  if (!context('hello', rule).includes('refused')) fails.push('context: missing the git refusal');
  if (!context('$git-release', rule).includes('authorized')) fails.push('context: missing the license note');
  // A ticket pays for the complete suite once, at the end of its build. The line printed before every message used to command one before every hand-back, which is a plan-only pass paying for a suite that proves nothing about a file it never wrote — and a build paying again for what it just proved.
  const printed = context('hello', rule);
  if (!/build runs `\/check` once, after its last phase/.test(printed)) fails.push('context: the printed rule no longer says the build owns the one check');
  if (!/wrote no code runs none/.test(printed)) fails.push('context: the printed rule no longer excuses a pass that wrote no code');
  if (/Before handing work back: `just verify`/.test(printed)) fails.push('context: the printed rule still commands the complete suite before every hand-back');

  // The ring, which all three hooks write to now. Per hook, because the tool gate fires on every command and would otherwise push the one prompt of the turn out before anyone read it back.
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
  const before = existsSync(RING) ? readFileSync(RING, 'utf8') : null;
  keep('SelfTest', '   ');
  const after = existsSync(RING) ? readFileSync(RING, 'utf8') : null;
  if (after !== before) fails.push('ring: an empty payload still wrote a line');

  // The record, through the hook rather than through its own functions. A record still standing is a turn still running, and this is the one place that decision is wired: swapping this call back to `open` passes every test that reaches the record directly, so the fold is proved here by firing the hook twice.
  const MID = `gate-rules-selftest-${process.pid}`;
  const DEV = '.agents/skills/dev/SKILL.md';
  const fire = (prompt) => execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
    input: JSON.stringify({ session_id: MID, prompt }),
    encoding: 'utf8',
  });
  try {
    fire('/dev the ticket');
    const opened = read(MID);
    if (!opened?.required?.includes(DEV)) fails.push('hook: a skill-named message did not owe that skill');
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
    rmSync(licensePath(MID), { force: true });
  }
  if (fails.length) {
    console.error('gate-rules: failed');
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`gate-rules: ok (Rule 1 is ${rule.split('\n').filter(Boolean).length} lines)`);
}

// Only act when run directly: anything importing this for a function would otherwise read a stream nobody is writing, and the importer hangs with no message.
const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
const args = invoked === import.meta.url ? process.argv.slice(2) : null;
if (!args) {
  // Imported, not run.
} else if (args.includes('--check')) {
  selfTest();
} else {
  const raw = readStdin();
  // What the host actually sends, kept for the last few turns. A slash command may reach here expanded, or not at all, and the license turns on which — guessing at that is what cost v0.1.442 a refused release. All three hooks keep theirs now, because the license turns on the session id too.
  keep('UserPromptSubmit', raw);
  const prompt = promptOf(raw);
  const session = sessionOf(raw);
  writeLicense(hasReleaseLicense(prompt), prompt, session);
  if (prompt && !isMeta(prompt)) {
    // What this message owes, folded into this session's record. A record still standing is a turn still running, because the reply gate deletes it when one ends — so a sentence typed into a running pass adds to what is owed and leaves the codes it has given and the moment it began where they are. This session's record only, or the other agent is held for codes it already gave.
    try {
      extend(requiredFor(prompt), session);
    } catch {
      // A record that cannot be written owes nothing, which is the safe way round: a broken hook must never stop a turn.
    }
    let rule = '';
    try {
      rule = rule1(readFileSync(join(root, 'AGENTS.md'), 'utf8'));
    } catch {
      // No AGENTS.md means no Rule 1 to print; the git note below still goes out.
    }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context(prompt, rule),
      },
    }));
  }
  process.exit(0);
}
