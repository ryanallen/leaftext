#!/usr/bin/env node
// PreToolUse hook on the shell tools. Refuses a git write unless the message being answered said `/git-release` (Claude) or `$git-release` (Codex). This is the one rule reading cannot hold, so a script holds it: scripts/gate-rules.mjs writes a license on every turn, because a PreToolUse hook never sees the prompt.
//
// One license file per session, because two agents can work this checkout at once and a license keyed on the machine is a license the other agent can spend.
//
// Refused: commit, push, tag (writing one), reset, rebase, revert, cherry-pick, merge, am, clean, filter-branch, checkout, switch, restore, stash, worktree, pull, apply, rm, mv, a deleted or moved branch, anything with --force, and the commands that run a release. Reading is always fine — a release is recognized by what a command runs, so a search or a reader that merely names one is not a write.
//
//   node scripts/gate-git.mjs           the hook payload on stdin
//   node scripts/gate-git.mjs --check   self-test (`just verify`)

import { readFileSync } from 'node:fs';
import { keep, licensePath, sessionOf } from './hook-payload.mjs';

const LICENSE_MAX_AGE_MS = 4 * 60 * 60 * 1000;

// The middle five discard the working tree rather than history, and are refused in every form: `git checkout -- <path>` is the ordinary undo, and reading a file out of a commit is `git show <ref>:<path>`, which stays allowed. The last four are quieter writes with no reading form at all — `pull` carries a merge, `apply` rewrites the tree, `rm` deletes and `mv` renames.
const WRITE_SUBCOMMANDS = new Set(['commit', 'push', 'reset', 'rebase', 'revert',
  'cherry-pick', 'merge', 'am', 'clean', 'filter-branch',
  'checkout', 'switch', 'restore', 'stash', 'worktree',
  'pull', 'apply', 'rm', 'mv']);
// `git tag` reads when it is listing, writes otherwise.
const TAG_READ_FLAGS = ['-l', '--list', '-n', '--contains', '--no-contains',
  '--points-at', '--merged', '--no-merged'];
const BRANCH_WRITE_FLAGS = ['-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy'];
// git's own options come before the subcommand and these five carry their value as the next word, so the first word without a dash is the path in `git -C . commit`, not the command.
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
// The recipes that commit, tag and push on their own. `land` is the release's first half — it commits and pushes main with no gate, so it is a git write with git nowhere in the command.
const RELEASE_RECIPES = new Set(['release', 'land']);
// Shells that run another command string and can be unwrapped, so a release inside one is refused exactly as a bare one is.
const NESTED_RUNNERS = /^(?:cmd|powershell|pwsh|invoke-expression|iex)$/;
// Runners this parser does not model. Each can run anything, so a release name inside one is refused rather than guessed at: a new interpreter must never become the way past the gate.
const OPAQUE_RUNNERS = /^(?:bash|sh|zsh|dash|fish|wsl|env|xargs|start|eval|npm|npx|pnpm|yarn|tsx|ts-node|deno|bun)$/;
// Node running a string instead of a file is opaque for the same reason.
const NODE_EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print']);
// Only for a runner that cannot be read: a command naming a release without running one is a read.
const RELEASE_NAMES = /\bjust\s+(?:release|land)\b|prepare-release/i;
// Shell punctuation standing in front of a program rather than being one.
const PUNCTUATION = /^[&(){}]+$/;

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// Everything the shell would run as its own command. A lone `&` is one of them: cmd runs what follows it whatever the first command did.
function segments(command) {
  return command.split(/&&|&|\|\||;|\||\n|\r/).map((s) => s.trim()).filter(Boolean);
}

function tokens(rest) {
  return rest.split(/\s+/).filter(Boolean);
}

// The words a shell would see, keeping a quoted path with spaces in it whole.
function words(text) {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

// The name of the program a word runs, with its folders, quotes and `.exe` off.
function runner(word) {
  const bare = word.replace(/["']/g, '').split(/[\\/]/).pop() ?? '';
  return bare.replace(/\.exe$/i, '').toLowerCase();
}

function isReleaseScript(word) {
  return /(?:^|[\\/])prepare-release\.mts$/i.test(word.replace(/["']/g, ''));
}

// The release this one command runs, named, or '' if it runs none. Text naming a release is not one: a search for it, a read of this rule and the release fixture's own `--check` all reach here and all come back empty.
function releaseWrite(segment, depth = 0) {
  const args = words(segment);
  let start = 0; // PowerShell's call operator and its braces stand in front of the program, so step over them to reach it.
  while (start < args.length && PUNCTUATION.test(args[start])) start += 1;
  const head = runner(args[start] ?? '');
  const rest = args.slice(start + 1);
  if (!head) return '';

  // A shell inside a shell adds nothing: read what it really runs. The name is only the answer where the command string cannot be reached at all.
  if (NESTED_RUNNERS.test(head)) {
    let at = 0; // Past the shell's own options — `/c`, `-NoProfile`, `-Command` — to the command string itself.
    while (at < rest.length && (PUNCTUATION.test(rest[at]) || /^[-/][\w-]*$/.test(rest[at]))) at += 1;
    const inner = rest.slice(at).join(' ');
    if (inner && depth < 3) return releaseWrite(inner, depth + 1);
    return RELEASE_NAMES.test(segment) ? `${head} running a release` : '';
  }
  if (OPAQUE_RUNNERS.test(head) || (head === 'node' && rest.some((a) => NODE_EVAL_FLAGS.has(a)))) {
    return RELEASE_NAMES.test(segment) ? `${head} running a release` : '';
  }
  if (head === 'just') {
    const recipe = (rest.find((a) => !a.startsWith('-')) ?? '').toLowerCase();
    return RELEASE_RECIPES.has(recipe) ? `just ${recipe}` : '';
  }
  // The fixture self-test records its release calls on a fixture host and starts none, which is the one form of this script that reads. `--check` wins over a version in the script itself, so it wins here too.
  if (isReleaseScript(head) || (head === 'node' && rest.some(isReleaseScript))) {
    return rest.includes('--check') ? '' : 'prepare-release.mts';
  }
  return '';
}

// Where the subcommand sits, having walked past git's own options and whatever they carry. It stops at the first plain word, so a `-c` after that is `git branch`'s copy flag rather than git's config option.
function subcommandAt(args) {
  let at = 0;
  while (at < args.length && args[at].startsWith('-')) {
    at += GIT_VALUE_OPTIONS.has(args[at]) ? 2 : 1;
  }
  return at;
}

// The git write this command performs, named, or '' if it performs none.
export function gitWrite(command) {
  if (!command) return '';
  for (const segment of segments(command)) {
    const release = releaseWrite(segment);
    if (release) return release;
    const match = segment.match(/(?:^|[\s&|;(])["']?(?:[^\s"']*[\\/])?git(?:\.exe)?["']?\s+(.+)$/i);
    if (!match) continue;
    const args = tokens(match[1]);
    const at = subcommandAt(args);
    const sub = args[at]?.toLowerCase() ?? '';
    const flags = args.slice(at).filter((a) => a.startsWith('-'));
    if (flags.some((f) => f === '--force' || f.startsWith('--force-with-lease') || f === '--force-if-includes')) {
      return `git ${sub} --force`.trim();
    }
    if (WRITE_SUBCOMMANDS.has(sub)) return `git ${sub}`;
    if (sub === 'tag' && !flags.some((f) => TAG_READ_FLAGS.includes(f))) return 'git tag';
    if (sub === 'branch' && flags.some((f) => BRANCH_WRITE_FLAGS.includes(f))) return 'git branch';
  }
  return '';
}

// True only when the message being answered right now, in this session, said `/git-release` or `$git-release`. Two agents can share this checkout, and a license keyed on the machine authorizes whichever of them asks first, for four hours — which is the rule the whole repo's git safety rests on. No session id at all refuses everything: an environment that changed shape must not turn the gate off.
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
          ? `Refused: ${write} is a git write and this message does not say \`/git-release\` (Claude) or \`$git-release\` (Codex).`
          : `Refused: ${write} is a git write and nothing here can tell which session asked, so no license can be found.`,
        'AGENTS.md: only a `/git-release` or `$git-release` in the message being answered right now authorizes one, and only in the session it was said in.',
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
    'git branch -c old new',
    'git -C . commit -m x',
    'git -c user.email=e commit -m x',
    'git --git-dir .git --work-tree . commit -m x',
    'cd /c/repo && git commit -am "x"',
    'git status; git push',
    'git checkout -- src/lib.rs',
    'git checkout -b feature',
    'git switch main',
    'git restore src/lib.rs',
    'git stash',
    'git stash list',
    'git worktree add ../wt main',
    'git pull',
    'git apply fix.patch',
    'git rm -f src/lib.rs',
    'git mv src/lib.rs src/root.rs',
    'just release 0.1.441',
    'just land',
    'node --experimental-strip-types scripts/prepare-release.mts 0.1.441',
    'node --experimental-strip-types scripts/prepare-release.mts --land',
    './scripts/prepare-release.mts 0.1.441',
    '"C:\\Program Files\\Git\\bin\\git.exe" push',
    // A release runner reached through a quoted path, a separator, or a shell inside a shell.
    '"C:\\Users\\me\\.cargo\\bin\\just.exe" release 0.1.441',
    'just verify && just release 0.1.441',
    'node --experimental-strip-types scripts/prepare-release.mts --check && just release 0.1.441',
    'cmd /c just release 0.1.441',
    'cmd.exe /c "just land"',
    'powershell -NoProfile -Command "just release 0.1.441"',
    'pwsh -Command "node --experimental-strip-types scripts/prepare-release.mts 0.1.441"',
    'Invoke-Expression "just land"',
    'iex "just release 0.1.441"',
    'powershell -Command "& { just release 0.1.441 }"',
    '& just release 0.1.441',
    'echo hi & just land',
    // A runner the parser cannot read carrying a release name: refused rather than guessed at.
    'bash -c "just release 0.1.441"',
    'sh -c "node --experimental-strip-types scripts/prepare-release.mts 0.1.441"',
    'npx tsx scripts/prepare-release.mts 0.1.441',
    'node -e "execSync(\'just release 0.1.441\')"',
  ];
  const allowed = [
    'git status',
    'git log --oneline -5',
    'git diff HEAD',
    'git tag --list',
    'git tag -l "v0.1.4*"',
    'git branch --show-current',
    'git -C . status',
    'git -C . branch --show-current',
    'git show HEAD:src/lib.rs',
    'just verify',
    'cargo test',
    'ls scripts/',
    // Reading the release path. Every one of these was refused while the gate matched a release by name.
    'rg "just release" .agents/skills',
    'rg -n prepare-release scripts/',
    'grep -rn "just land" AGENTS.md',
    'node scripts/check-justfile-quotes.mjs',
    'code scripts/prepare-release.mts',
    // The fixture self-test: it records its release calls on a fixture host and starts none.
    'node --experimental-strip-types scripts/prepare-release.mts --check',
    'just check-release',
    'cmd /c node --experimental-strip-types scripts/prepare-release.mts --check',
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
