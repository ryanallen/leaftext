#!/usr/bin/env node
// UserPromptSubmit hook. Two jobs, both cheap enough to pay for on every turn:
//
//   1. Print Rule 1 out of AGENTS.md, so the tone rule is read again rather than
//      remembered. The file is the copy; this script holds none of its own.
//   2. Record whether this message says `/git-release`, in `.tmp/git-license`.
//      A PreToolUse hook never sees the prompt, so scripts/gate-git.mjs reads
//      what this wrote.
//
//   node scripts/gate-rules.mjs           the hook payload on stdin
//   node scripts/gate-rules.mjs --check   self-test (`just verify`)
//
// Never blocks: any failure exits 0, because a broken hook must not stop a turn.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LICENSE = join(root, '.tmp', 'git-license');

// Messages that are host commands rather than work. They get no context, but they
// still revoke the git license — otherwise a `/clear` after a release keeps it.
const META = ['/clear', '/help', '/config', '/cost', '/compact', '/init', '/skills',
  '/agents', '/permissions', '/status', '/release-notes', '/upgrade', '/mcp',
  '/login', '/logout', '/exit', '/quit'];

// One line each, for whatever the message touches. Three at most, so the output
// stays about ten lines.
const TRIGGERS = [
  [/reading\.css|theme\.rs|themes\//i,
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

// `/git-release` typed as this message's command, and nothing else, authorizes a
// git write. Anchored to the start because that is where a slash command is: a
// match anywhere let a message that merely *quoted* the string grant one, and
// pasting a transcript back is exactly how that happened.
export function hasReleaseLicense(prompt) {
  return /^\/git-release\b/i.test(prompt.trim());
}

// The `# Rule 1` section of AGENTS.md, up to the rule after it.
export function rule1(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^#+\s+Rule 1\b/.test(line));
  if (start < 0) return '';
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line) || /^---\s*$/.test(line)) break;
    body.push(line);
  }
  return body.join('\n').trim();
}

export function reminders(prompt) {
  return TRIGGERS.filter(([test]) => test.test(prompt)).slice(0, 3).map(([, line]) => line);
}

export function context(prompt, rule) {
  const out = [];
  if (rule) out.push(rule);
  const hints = reminders(prompt);
  if (hints.length) out.push('', ...hints.map((h) => `- ${h}`));
  out.push('', hasReleaseLicense(prompt)
    ? '- `/git-release` is in this message: one git write is authorized, for this turn only.'
    : '- No `/git-release` in this message. Git writes are refused by scripts/gate-git.mjs. Do not offer or hint at one; a dirty tree is the correct end state.');
  out.push('- Before handing work back: `just verify`. Say what changed in plain words. Never mention that the Mac build or the installer cannot be built here — it is true every time, it is already known, and saying it is the padding Rule 1 refuses.');
  return out.join('\n');
}

function writeLicense(granted, prompt) {
  try {
    mkdirSync(dirname(LICENSE), { recursive: true });
    writeFileSync(LICENSE, JSON.stringify({
      state: granted ? 'granted' : 'denied',
      at: new Date().toISOString(),
      prompt: prompt.slice(0, 120),
    }) + '\n');
  } catch {
    // A license that cannot be written reads as denied, which is the safe way round.
  }
}

function selfTest() {
  const cases = [
    ['plain message', false],
    ['/git-release', true],
    ['/git-release 0.1.441', true],
    ['  /git-release  ', true],
    // v0.1.442: the release ran off a message that only quoted the transcript.
    // A mention is not an instruction, wherever in the message it sits.
    ['ship it with /git-release please', false],
    ['i ran /git-release and you refused, why', false],
    ['> /git-release\n\n● Running the pre-steps', false],
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
  if (!reminders('editing src/assets/reading.css').length) fails.push('reminders: reading.css matched nothing');
  if (reminders('hello').length) fails.push('reminders: fired on a message that touches nothing');
  if (!context('hello', rule).includes('refused')) fails.push('context: missing the git refusal');
  if (!context('/git-release', rule).includes('authorized')) fails.push('context: missing the license note');

  if (fails.length) {
    console.error('gate-rules: failed');
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`gate-rules: ok (Rule 1 is ${rule.split('\n').filter(Boolean).length} lines)`);
}

if (process.argv.includes('--check')) {
  selfTest();
} else {
  const raw = readStdin();
  // What the host actually sends, kept for the last few turns. A slash command
  // may reach here expanded, or not at all, and the license turns on which —
  // guessing at that is what cost v0.1.442 a refused release. Untracked.
  try {
    const log = join(root, '.tmp', 'prompt-payloads.jsonl');
    mkdirSync(dirname(log), { recursive: true });
    const kept = (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []).slice(-19);
    writeFileSync(log, [...kept, JSON.stringify({ at: new Date().toISOString(), raw: raw.slice(0, 4000) })].join('\n') + '\n');
  } catch {
    // A diagnostic that cannot be written is not worth failing a turn over.
  }
  const prompt = promptOf(raw);
  writeLicense(hasReleaseLicense(prompt), prompt);
  if (prompt && !isMeta(prompt)) {
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
