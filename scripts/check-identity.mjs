#!/usr/bin/env node
// The commits are the owner's. No assistant or third-party identity in the repo or
// its history — AGENTS.md, Conventions. Reading that rule was the only thing
// holding it; this fails the build instead.
//
// Three things are checked: every commit's author and committer, every commit
// message, and every tracked text file. What fails is an *attribution* — a
// `Co-authored-by:` trailer, a "Generated with" credit, an assistant as the author
// — not a mention. Naming the rule is allowed, which is why AGENTS.md and the
// skills can state it and this file can list the patterns.
//
//   node scripts/check-identity.mjs   report every hit and exit non-zero (`just verify`)

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// An assistant or vendor standing in for the author.
const NOT_THE_AUTHOR = /\b(claude|anthropic|codex|copilot|chatgpt|openai|gemini|cursor|devin|dependabot|github-actions)\b/i;

// An attribution, wherever it is written.
const ATTRIBUTIONS = [
  [/^\s*co-authored-by:/im, 'a `Co-authored-by:` trailer'],
  [/^\s*signed-off-by:.*(claude|anthropic|codex|copilot|chatgpt|gemini)/im, 'an assistant sign-off'],
  [/generated with\s*\[?\s*(claude|codex|copilot|chatgpt|gemini|cursor)/i, 'a "Generated with" credit'],
  [/🤖\s*generated/i, 'a robot credit'],
];

const TEXT = /\.(rs|js|mjs|mts|ts|css|html|md|txt|toml|json|yml|yaml|wxs|rc|ps1|sh)$/;
const SKIP = ['src/assets/vendor/', 'site/vendor/', 'src/assets/themes.md', 'Cargo.lock'];

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? (result.stdout ?? '') : null;
}

const hits = [];

// Every commit: who it says wrote it, and what the message credits.
const log = git(['log', '--format=%H%x00%an <%ae>%x00%cn <%ce>%x00%B%x01']);
if (log === null) {
  console.log('identity: no git history here, files only');
} else {
  for (const entry of log.split('\x01')) {
    const record = entry.replace(/^\s+/, '');
    if (!record) continue;
    const [hash, author, committer, message = ''] = record.split('\x00');
    const short = hash.slice(0, 8);
    if (NOT_THE_AUTHOR.test(author)) hits.push(`${short}  author is ${author}`);
    if (NOT_THE_AUTHOR.test(committer)) hits.push(`${short}  committer is ${committer}`);
    for (const [pattern, what] of ATTRIBUTIONS) {
      if (pattern.test(message)) hits.push(`${short}  commit message carries ${what}`);
    }
  }
}

// Every tracked text file.
const tracked = (git(['ls-files']) ?? '').split('\n').map((f) => f.trim()).filter(Boolean);
for (const file of tracked) {
  if (!TEXT.test(file) || SKIP.some((skip) => file.startsWith(skip))) continue;
  let text = '';
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch {
    continue; // Deleted from the working tree, or a symlink to something unreadable.
  }
  for (const [pattern, what] of ATTRIBUTIONS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const line = text.slice(0, match.index).split('\n').length;
    hits.push(`${file}:${line}  ${what}`);
  }
}

if (hits.length) {
  console.error(`Assistant or third-party identity in ${hits.length} place(s) — the commits are the owner's:`);
  for (const hit of hits) console.error(`  ${hit}`);
  console.error('AGENTS.md, Conventions: no co-author trailer, no generated-by credit, no assistant as author.');
  process.exit(1);
}
console.log(`identity: clean (${tracked.length} tracked files, every commit the owner's)`);
