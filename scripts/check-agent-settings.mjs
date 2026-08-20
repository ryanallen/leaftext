#!/usr/bin/env node
// What the repo's own settings file owes an agent that opens this checkout.
//
//   node scripts/check-agent-settings.mjs   (`just verify`)
//
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS = '.agents/settings.json';

function settingsProblems(settingsText) {
  try {
    JSON.parse(settingsText);
  } catch {
    return [`${SETTINGS} is not valid JSON, so every hook and approval in it is off`];
  }
  return [];
}

// A hook row is a command the host runs before it will read a message, and a row naming a script that is not here fails silently: the host reports the miss to nobody, the rule that script held is simply off, and the next person to notice is whoever meets what it was stopping. So a deleted script has to take its row with it, and this is what says so.
const SCRIPT_NAMED = /scripts[\\/]([A-Za-z0-9._-]+)/g;

function hookProblems(settingsText, hasScript) {
  let hooks;
  try {
    hooks = JSON.parse(settingsText).hooks ?? {};
  } catch {
    return [];
  }

  const found = [];
  for (const [event, rows] of Object.entries(hooks)) {
    for (const row of rows ?? []) {
      for (const hook of row.hooks ?? []) {
        for (const [, name] of String(hook.command ?? '').matchAll(SCRIPT_NAMED)) {
          if (!hasScript(name)) found.push(`${SETTINGS} runs "scripts/${name}" on ${event}, and this repo has no such file`);
        }
      }
    }
  }
  return found;
}

const problems = [];
if (settingsProblems('{').length !== 1) {
  problems.push('this check does not report unreadable JSON as one problem');
}

// The same shape, once per way a hook row can name a script that is not here. `here` is the pretend repo: everything else is gone.
const here = (name) => name === 'gate-rules.mjs';
const row = (command) => JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command }] }] } });
const HOOK_CASES = [
  ['a row running a script the repo does not have', row('node "${CLAUDE_PROJECT_DIR}/scripts/gate-gone.mjs"'), true],
  ['the same row written with backslashes', row('node "${CLAUDE_PROJECT_DIR}\\scripts\\gate-gone.mjs"'), true],
  ['a second script on one command line', row('node scripts/gate-rules.mjs && node scripts/gate-gone.mjs'), true],
  ['every script it names being here', row('node "${CLAUDE_PROJECT_DIR}/scripts/gate-rules.mjs"'), false],
  ['a settings file with no hooks at all', '{}', false],
];
for (const [name, text, shouldFail] of HOOK_CASES) {
  const found = hookProblems(text, here);
  if (shouldFail && !found.length) problems.push(`this check misses ${name}`);
  if (!shouldFail && found.length) problems.push(`this check fails ${name}: ${found[0]}`);
}

const settingsText = readFileSync(join(root, SETTINGS), 'utf8');
problems.push(...settingsProblems(settingsText));
problems.push(...hookProblems(settingsText, (name) => existsSync(join(root, 'scripts', name))));

if (problems.length) {
  console.error('the repo settings file is missing something an agent needs:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('agent settings: every hook row runs a script that is here');
