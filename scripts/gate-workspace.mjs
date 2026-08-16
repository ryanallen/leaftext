#!/usr/bin/env node
// UserPromptSubmit hook. Puts this session in a copy of its own before the message is read, and says where it is.
//
// **Nobody types a command.** The owner calls the skills they already call — `/ticket`, `/dev`, `/design`, `/pm` and the rest — and the pair of worktrees those skills need is already there when the agent starts reading. A session that has one is answered with it; a session that has none is given one.
//
//   node scripts/gate-workspace.mjs           the hook payload on stdin
//   node scripts/gate-workspace.mjs --check   self-test (`just verify`)
//
// Only a message that names a skill that changes something gets a copy. A question, a `/clear`, a message naming nothing: no copy, because cutting a worktree for somebody asking what a button does is a folder nobody will ever look in.
//
// **Never blocks.** A pair that cannot be made is said in one line and the turn goes on in the copy the owner is reading, which is where every turn ran before this existed. A hook that can wedge a session is worse than no hook.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensure, primaryRoots, workspaceParent } from './agent-workspace.mjs';
import { keyedFiles } from './gate-keycode.mjs';
import { keep, sessionOf } from './hook-payload.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/// The skills that only read. Naming one of these is not a reason to cut a copy, and `check` is the loudest of them: it is run from inside whatever copy the work is already in.
export const READ_ONLY = new Set(['check', 'add-dependency', 'code-comments', 'workspace']);

/// Whether this message is work that belongs in a copy of its own. Read off the one table of keyed skills, so a skill is named in one place and a new one joins this by existing.
export function wantsWorkspace(prompt) {
  for (const file of keyedFiles()) {
    const name = file.match(/skills\/(.*?)\//)?.[1];
    if (!name || READ_ONLY.has(name)) continue;
    if (new RegExp(`(^|\\s)[$/]${name}\\b`, 'i').test(prompt)) return name;
  }
  return '';
}

/// What the agent is told. It names both halves, because the plan tree and the app are two repositories and a session that edits one in its copy and the other in the owner's has handed nobody anything.
export function directions(record, skill) {
  return [
    `This session works in its own copy, not in the one the owner is reading. \`/${skill}\` and everything under it happens here:`,
    `- the app: ${record.app}`,
    `- the plan tree: ${join(record.studio, 'leaftext', 'docs')}`,
    'Open every file there by its full path, and run every command with that app folder as the working directory. The copy the owner reads is changed only by a submit, which is what `/git-release` does at the end.',
    ...(record.warnings || []).map((line) => `- ${line}`),
  ].join('\n');
}

function selfTest() {
  const fails = [];

  if (wantsWorkspace('/dev the ticket') !== 'dev') fails.push('a build message was not given a copy');
  if (wantsWorkspace('$ticket this') !== 'ticket') fails.push('the dollar sign did not name a skill');
  if (wantsWorkspace('/pm') !== 'pm') fails.push('a ranking message was not given a copy');
  if (wantsWorkspace('what does the pager do')) fails.push('a question was given a copy');
  if (wantsWorkspace('/clear')) fails.push('a host command was given a copy');
  if (wantsWorkspace('run the checker')) fails.push('prose named a skill');
  // The gate skill runs inside whatever copy the work is already in, so naming it must not cut a second one.
  if (wantsWorkspace('/check it')) fails.push('the gate skill was given a copy of its own');
  if (wantsWorkspace('/workspace list')) fails.push('the copy skill was given a copy of its own');

  const said = directions({ app: 'C:/p/one/leaftext/app', studio: 'C:/p/one', warnings: ['work is sitting in the primary app copy'] }, 'dev');
  if (!said.includes('C:/p/one/leaftext/app')) fails.push('the directions do not say where the app is');
  if (!said.includes('leaftext') || !said.includes('docs')) fails.push('the directions do not say where the plan tree is');
  if (!said.includes('work is sitting in the primary app copy')) fails.push('a warning from making the copy was not passed on');

  // Imported rather than run, this file must do nothing: the hook body reading stdin on import would swallow another hook's payload.
  try {
    const loaded = execFileSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(import.meta.url)}; console.log('loaded');`], {
      input: JSON.stringify({ prompt: '/dev it' }),
      encoding: 'utf8',
    });
    if (loaded.trim() !== 'loaded') fails.push('imported: the hook body ran on import');
  } catch (error) {
    fails.push(`imported: ${error.message}`);
  }

  if (fails.length) {
    console.error('gate-workspace: failed');
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`gate-workspace: ok (${keyedFiles().length - 1 - READ_ONLY.size} skills get a copy, ${READ_ONLY.size} read-only skills do not)`);
}

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
  const skill = prompt ? wantsWorkspace(prompt) : '';
  if (skill) {
    let context = '';
    try {
      const { studioRoot, appRoot } = primaryRoots();
      context = directions(ensure({ session: sessionOf(raw), studioRoot, appRoot, parent: workspaceParent() }), skill);
    } catch (error) {
      // The turn carries on in the copy the owner is reading, which is where every turn ran before this existed.
      context = `This session has no copy of its own: ${error.message}. Work in the checkout you are in and say so when you hand back.`;
    }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
    }));
  }
  process.exit(0);
}
