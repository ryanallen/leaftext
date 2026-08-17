#!/usr/bin/env node
// PreToolUse hook on the shell tools. Refuses a git write unless the message being answered said `/git-release` (Claude) or `$git-release` (Codex). This is the one rule reading cannot hold, so a script holds it: scripts/gate-rules.mjs writes a license on every turn, because a PreToolUse hook never sees the prompt.
//
// One license file per session, because two agents can work this checkout at once and a license keyed on the machine is a license the other agent can spend.
//
// Refused: commit, push, tag (writing one), reset, rebase, revert, cherry-pick, merge, am, clean, filter-branch, checkout, switch, restore, stash, worktree, pull, apply, rm, mv, a deleted or moved branch, anything with --force, and the commands that run a release. Reading is always fine — a git write and a release are both recognized by the program a command runs, so a search, a message or a filename that merely quotes one is text.
//
// A segment never ends inside a quote. Never simplify `segments` back to one `split`: cutting at `&&` before anything reads a quote leaves `bash -c "cd . && git push"` as a head holding an open quote and a tail reading `git push"`, and neither of those names a write, so the write goes through.
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
// Runners this parser does not model. Each can run anything, so a git write or a release name inside one is refused rather than guessed at: a new interpreter must never become the way past the gate. The last six stand in front of another program instead of being one, and each takes options this parser does not read, so refusing on the name is the side to be wrong on.
const OPAQUE_RUNNERS = /^(?:bash|sh|zsh|dash|fish|wsl|env|xargs|start|eval|npm|npx|pnpm|yarn|tsx|ts-node|deno|bun|sudo|doas|time|nohup|command|exec)$/;
// Node running a string instead of a file is opaque for the same reason.
const NODE_EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print']);
// Only for a runner that cannot be read: a command naming a release without running one is a read.
const RELEASE_NAMES = /\bjust\s+(?:release|land)\b|prepare-release/i;
// Every git in a segment, each read with whatever follows it as its arguments. Only for a runner that cannot be read, beside `RELEASE_NAMES`: a command naming a git write without running one is a read. Every one of them, because such a segment holds a whole command string — `sh -c "git status && git commit -m x"` names a read first and a write second.
const GIT_NAME = /(?:^|[\s&|;(])["']?(?:[^\s"']*[\\/])?git(?:\.exe)?["']?(?=\s)/gi;
// Shell punctuation standing in front of a program rather than being one.
const PUNCTUATION = /^[&(){}]+$/;
// A leading `NAME=value` is the shell setting a variable, not the program it then runs.
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// Everything the shell would run as its own command. A lone `&` is one of them: cmd runs what follows it whatever the first command did. It is a walk rather than a `split` because a separator inside a quoted string is text the shell hands on, never a cut.
function segments(command) {
  const out = [];
  let current = '';
  let quote = '';
  for (let at = 0; at < command.length; at += 1) {
    const ch = command[at];
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (command.startsWith('&&', at) || command.startsWith('||', at)) {
      out.push(current);
      current = '';
      at += 1;
      continue;
    }
    if (ch === '&' || ch === ';' || ch === '|' || ch === '\n' || ch === '\r') {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current); // An unterminated quote never closes, so the rest of the line arrives here as one segment.
  return out.map((s) => s.trim()).filter(Boolean);
}

// A quote the line never closes. Such a line is one no parser can model — a shell would go on reading — so it is refused on the name it carries, the way a runner nothing here can read is.
function unterminated(text) {
  let quote = '';
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    }
  }
  return quote !== '';
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

// Where the subcommand sits, having walked past git's own options and whatever they carry. It stops at the first plain word, so a `-c` after that is `git branch`'s copy flag rather than git's config option.
function subcommandAt(args) {
  let at = 0;
  while (at < args.length && args[at].startsWith('-')) {
    at += GIT_VALUE_OPTIONS.has(args[at]) ? 2 : 1;
  }
  return at;
}

// The git write these arguments perform, named, or '' if they perform none. Only ever git's own words — the caller has already established that git is what runs.
function gitArguments(args) {
  const at = subcommandAt(args);
  const sub = args[at]?.toLowerCase() ?? '';
  const flags = args.slice(at).filter((a) => a.startsWith('-'));
  if (flags.some((f) => f === '--force' || f.startsWith('--force-with-lease') || f === '--force-if-includes')) {
    return `git ${sub} --force`.trim();
  }
  if (WRITE_SUBCOMMANDS.has(sub)) return `git ${sub}`;
  if (sub === 'tag' && !flags.some((f) => TAG_READ_FLAGS.includes(f))) return 'git tag';
  if (sub === 'branch' && flags.some((f) => BRANCH_WRITE_FLAGS.includes(f))) return 'git branch';
  return '';
}

// Only for a runner this parser cannot read: what the segment names, refused on the name rather than on a parse nobody can make. A whole-segment match is safe here and nowhere else, since a program that can run anything is the one case where the words are all there is.
function namedWrite(segment, head) {
  for (const match of segment.matchAll(GIT_NAME)) {
    // The quotes come out because the command string is still wrapped in them here: without this the subcommand of `bash -c "cd . && git push"` is `push"`, which is in no list.
    const tail = segment.slice(match.index + match[0].length).replace(/["']/g, ' ');
    const named = gitArguments(words(tail));
    if (named) return `${head} running ${named}`;
  }
  return RELEASE_NAMES.test(segment) ? `${head} running a release` : '';
}

// The write this one command performs, named, or '' if it performs none. The program decides it, so text naming a write is not one: a search for it, a message quoting it, a filename carrying it, a read of this rule and the release fixture's own `--check` all reach here and all come back empty.
function segmentWrite(segment, depth = 0) {
  const args = words(segment);
  let start = 0; // PowerShell's call operator and its braces stand in front of the program, and a `NAME=value` is the shell setting a variable rather than running anything, so step over both to reach it.
  while (start < args.length && (PUNCTUATION.test(args[start]) || ASSIGNMENT.test(args[start]))) start += 1;
  const head = runner(args[start] ?? '');
  if (!head) return '';
  const write = programWrite(head, args.slice(start + 1), segment, depth);
  if (write) return write;
  return unterminated(segment) ? namedWrite(segment, head) : '';
}

// The write the named program performs, or '' if it performs none.
function programWrite(head, rest, segment, depth) {
  // A shell inside a shell adds nothing: read what it really runs. The name is only the answer where the command string cannot be reached at all.
  if (NESTED_RUNNERS.test(head)) {
    let at = 0; // Past the shell's own options — `/c`, `-NoProfile`, `-Command` — to the command string itself.
    while (at < rest.length && (PUNCTUATION.test(rest[at]) || /^[-/][\w-]*$/.test(rest[at]))) at += 1;
    const inner = rest.slice(at).join(' ');
    // Split again: the command string it carries is a whole line, and `cmd /c "git status && git push"` runs two commands.
    if (inner && depth < 3) return commandWrite(inner, depth + 1);
    return namedWrite(segment, head);
  }
  if (OPAQUE_RUNNERS.test(head) || (head === 'node' && rest.some((a) => NODE_EVAL_FLAGS.has(a)))) {
    return namedWrite(segment, head);
  }
  if (head === 'git') return gitArguments(rest);
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

// The first write any command on this line performs, named, or '' if none of them does.
function commandWrite(command, depth = 0) {
  for (const segment of segments(command)) {
    const write = segmentWrite(segment, depth);
    if (write) return write;
  }
  return '';
}

// The git write or release this command performs, named, or '' if it performs none.
export function gitWrite(command) {
  return command ? commandWrite(command) : '';
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
    // A git write inside a shell this parser can read, reached through the same unwrap the release half uses.
    'cmd /c git commit -m x',
    'cmd.exe /c "git push"',
    'powershell -Command "git push origin main"',
    'iex "git reset --hard origin/main"',
    // A git write behind a runner this parser cannot read: refused on the name the segment carries.
    'bash -c "git commit -m x"',
    'sudo git push',
    'doas git push',
    'time git commit -m x',
    'nohup git push',
    'command git push',
    'exec git push',
    'xargs git rm',
    // A leading shell assignment is not a program, so the program is what follows it.
    'GIT_DIR=. git commit -m x',
    'FOO=bar just land',
    // A write inside a quoted command string. Every one goes through where the line is cut at its separators before anything reads a quote, and `cd` somewhere and then do the thing is how most shell lines are written.
    'bash -c "cd . && git push"',
    "bash -c 'cd . && git push'",
    'cmd /c "git status && git push"',
    'cmd.exe /c "cd . & git push"',
    'powershell -Command "cd repo; git push"',
    'powershell -Command "cd .; git commit -m x"',
    'sh -c "git status && git commit -m x"',
    'git commit -m "a && b"',
    // The release half, missed the same way.
    'sh -c "just verify && just land"',
    'cmd /c "cd . && just land"',
    // A quote the line never closes: nothing can model what the shell does next, so it is refused on the name it carries.
    'bash -c "cd . && git push',
    'echo "unterminated && git push',
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
    // Reading the git path. A pattern of three words or more was refused before the program decided the segment; a two-word one passed only because the quote happened to land on the subcommand, and it now passes because its program is `rg`.
    'rg "git commit -m" scripts/',
    'rg "git commit" scripts/',
    'grep -rn "git reset --hard" .',
    'rg -n "git worktree add" AGENTS.md',
    'rg "git tag" scripts/',
    'echo "git commit -m done"',
    'cat "notes/git commit basics.md"',
    'code scripts/gate-git.mjs',
    // A separator inside a search pattern is text, so keeping a segment whole must not buy strictness with a refused search or a refused read.
    'rg "a && b" scripts/',
    'rg -n "a; b" scripts/',
    'cmd /c "cd . && git status"',
    'sh -c "git log && ls"',
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
