#!/usr/bin/env node
// PreToolUse hook on the shell tools. Refuses a git write unless the message being answered said `$git-release`. This is the one rule reading cannot hold, so a script holds it: scripts/gate-rules.mjs writes a license on every turn, because a PreToolUse hook never sees the prompt.
//
// One license file per session, because two agents can work this checkout at once and a license keyed on the machine is a license the other agent can spend.
//
// Refused: commit, push, tag (writing one), reset, rebase, revert, cherry-pick, merge, am, clean, filter-branch, a deleted or moved branch, anything with --force, and the release scripts that do those. Reading is always fine.
//
//   node scripts/gate-git.mjs           the hook payload on stdin
//   node scripts/gate-git.mjs --check   self-test (`just verify`)

import { readFileSync } from 'node:fs';
import { keep, licensePath, sessionOf } from './hook-payload.mjs';

const LICENSE_MAX_AGE_MS = 4 * 60 * 60 * 1000;

const WRITE_SUBCOMMANDS = new Set(['commit', 'push', 'reset', 'rebase', 'revert',
  'cherry-pick', 'merge', 'am', 'clean', 'filter-branch']);
// `git tag` reads when it is listing, writes otherwise.
const TAG_READ_FLAGS = ['-l', '--list', '-n', '--contains', '--no-contains',
  '--points-at', '--merged', '--no-merged'];
const BRANCH_WRITE_FLAGS = ['-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy'];
// These commit, tag and push on their own.
const RELEASE_COMMANDS = [/\bjust\s+release\b/i, /prepare-release/i];

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// Everything the shell would run as its own command.
function segments(command) {
  return command.split(/&&|\|\||;|\||\n|\r/).map((s) => s.trim()).filter(Boolean);
}

function tokens(rest) {
  return rest.split(/\s+/).filter(Boolean);
}

// The git write this command performs, named, or '' if it performs none.
export function gitWrite(command) {
  if (!command) return '';
  for (const pattern of RELEASE_COMMANDS) {
    if (pattern.test(command)) return command.match(pattern)[0];
  }
  for (const segment of segments(command)) {
    const match = segment.match(/(?:^|[\s&|;(])["']?(?:[^\s"']*[\\/])?git(?:\.exe)?["']?\s+(.+)$/i);
    if (!match) continue;
    const args = tokens(match[1]);
    const flags = args.filter((a) => a.startsWith('-'));
    const sub = args.find((a) => !a.startsWith('-'))?.toLowerCase() ?? '';
    if (flags.some((f) => f === '--force' || f.startsWith('--force-with-lease') || f === '--force-if-includes')) {
      return `git ${sub} --force`.trim();
    }
    if (WRITE_SUBCOMMANDS.has(sub)) return `git ${sub}`;
    if (sub === 'tag' && !flags.some((f) => TAG_READ_FLAGS.includes(f))) return 'git tag';
    if (sub === 'branch' && flags.some((f) => BRANCH_WRITE_FLAGS.includes(f))) return 'git branch';
  }
  return '';
}

// True only when the message being answered right now, in this session, said `$git-release`. Two agents can share this checkout, and a license keyed on the machine authorizes whichever of them asks first, for four hours — which is the rule the whole repo's git safety rests on. No session id at all refuses everything: an environment that changed shape must not turn the gate off.
export function licensed(raw, session, now = Date.now()) {
  if (!session || !raw) return false;
  try {
    const { state, at, session: granted } = JSON.parse(raw);
    if (state !== 'granted') return false;
    if (granted !== session) return false;
    const age = now - Date.parse(at);
    return Number.isFinite(age) && age >= 0 && age < LICENSE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function readLicense(session) {
  const path = licensePath(session);
  if (!path) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function deny(write, session) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: [
        session
          ? `Refused: ${write} is a git write and this message does not say \`$git-release\`.`
          : `Refused: ${write} is a git write and nothing here can tell which session asked, so no license can be found.`,
        'AGENTS.md: only a `$git-release` in the message being answered right now authorizes one, and only in the session it was said in.',
        'A dirty tree is the correct end state — say what changed and stop. Do not offer to push.',
      ].join(' '),
    },
  }));
  process.exit(0);
}

function selfTest() {
  const denied = [
    'git commit -m "x"',
    'git push origin HEAD --follow-tags',
    'git tag v0.1.441',
    'git reset --hard origin/main',
    'git rebase main',
    'git push --force',
    'git push --force-with-lease origin main',
    'git branch -D old',
    'cd /c/repo && git commit -am "x"',
    'git status; git push',
    'just release 0.1.441',
    'node --experimental-strip-types scripts/prepare-release.mts 0.1.441',
    '"C:\\Program Files\\Git\\bin\\git.exe" push',
  ];
  const allowed = [
    'git status',
    'git log --oneline -5',
    'git diff HEAD',
    'git tag --list',
    'git tag -l "v0.1.4*"',
    'git branch --show-current',
    'git show HEAD:src/lib.rs',
    'just verify',
    'cargo test',
    'ls scripts/',
  ];
  const fails = [];
  for (const command of denied) if (!gitWrite(command)) fails.push(`should refuse: ${command}`);
  for (const command of allowed) if (gitWrite(command)) fails.push(`should allow: ${command} (read as ${gitWrite(command)})`);

  const now = Date.parse('2026-08-01T12:00:00.000Z');
  const MINE = 'aaaaaaaa-1111-1111-1111-111111111111';
  const THEIRS = 'bbbbbbbb-2222-2222-2222-222222222222';
  const stamp = (state, iso, session = MINE) => JSON.stringify({ state, at: iso, session });
  const fresh = '2026-08-01T11:59:00.000Z';
  if (!licensed(stamp('granted', fresh), MINE, now)) fails.push('license: a fresh grant was not honored');
  if (licensed(stamp('denied', fresh), MINE, now)) fails.push('license: a denial was honored');
  if (licensed(stamp('granted', '2026-08-01T06:00:00.000Z'), MINE, now)) fails.push('license: a stale grant was honored');
  if (licensed('', MINE, now) || licensed('granted', MINE, now)) fails.push('license: garbage was honored');
  // The whole of the second agent's half: a release granted in one session, read in the other.
  if (licensed(stamp('granted', fresh, THEIRS), MINE, now)) fails.push("license: one session's grant authorized another session");
  if (licensed(stamp('granted', fresh), '', now)) fails.push('license: a write with no session id was allowed');
  if (licensePath('') !== '') fails.push('license: no session id still named a file to write');
  if (licensePath(MINE) === licensePath(THEIRS)) fails.push('license: two sessions share one file');

  if (fails.length) {
    console.error('gate-git: failed');
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`gate-git: ok (${denied.length} refused, ${allowed.length} allowed)`);
}

if (process.argv.includes('--check')) {
  selfTest();
} else {
  const raw = readStdin();
  keep('PreToolUse', raw);
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // Unreadable payload: let the normal permission flow decide.
  }
  if (/^(bash|powershell|shell)$/i.test(payload.tool_name ?? '')) {
    const session = sessionOf(raw);
    const write = gitWrite(payload.tool_input?.command ?? '');
    if (write && !licensed(readLicense(session), session)) deny(write, session);
  }
  process.exit(0);
}
