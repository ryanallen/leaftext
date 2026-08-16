#!/usr/bin/env node
// What the repo's own settings file owes an agent that opens this checkout. Today that is one plugin row; anything Claude Code should answer once for everybody rather than once per machine belongs here beside it.
//
//   node scripts/check-agent-settings.mjs   (`just verify`)
//
// The row enables Anthropic's rust-analyzer language server, which is what answers go-to-definition, find-all-references and live compile errors instead of a text search over the tree. Lose it and nothing breaks loudly: the popup comes back, one person says yes into their own settings file, and the next machine asks again. The program itself is a per-machine `rustup component add rust-analyzer`, deliberately not checked — a check for it would fail the suite for anyone who has not run one optional command for a tool the build never uses.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS = '.agents/settings.json';

// The name is the plugin and the catalog it comes from, joined by an `@`. Claude reads the halves apart, so the plugin's bare name here would be a row that never resolves and never complains.
const PLUGINS = [['rust-analyzer-lsp@claude-plugins-official', 'the Rust analyzer, which answers definitions, callers and compile errors']];

function settingsProblems(settingsText) {
  let enabled;
  try {
    enabled = JSON.parse(settingsText).enabledPlugins ?? {};
  } catch {
    return [`${SETTINGS} is not valid JSON, so every hook and approval in it is off`];
  }

  const found = [];
  for (const [name, why] of PLUGINS) {
    if (!(name in enabled)) {
      const bare = name.split('@')[0];
      const near = Object.keys(enabled).find((key) => key.split('@')[0] === bare);
      found.push(
        near
          ? `${SETTINGS} names the plugin "${near}", and Claude reads it as "${name}"`
          : `${SETTINGS} does not enable "${name}" — ${why}`
      );
    } else if (enabled[name] !== true) {
      found.push(`${SETTINGS} sets "${name}" to ${JSON.stringify(enabled[name])}, which turns it off`);
    }
  }
  return found;
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

// One case per way the row can be wrong, because the live file is right and a check that only ever sees a right answer proves nothing. Each of these has to produce at least one problem, and the last has to produce none.
const NAME = PLUGINS[0][0];
const CASES = [
  ['a settings file with no plugins at all', {}, true],
  ['the row gone and another plugin left', { 'some-other@claude-plugins-official': true }, true],
  ['the plugin named without its catalog', { 'rust-analyzer-lsp': true }, true],
  ['the plugin named with the wrong catalog', { 'rust-analyzer-lsp@somebody-elses': true }, true],
  ['the row turned off', { [NAME]: false }, true],
  ['the row set to something that is not a yes', { [NAME]: 'true' }, true],
  ['the shape that is right', { [NAME]: true }, false],
];

const problems = [];
for (const [name, enabled, shouldFail] of CASES) {
  const found = settingsProblems(JSON.stringify({ enabledPlugins: enabled }));
  if (shouldFail && !found.length) problems.push(`this check misses ${name}`);
  if (!shouldFail && found.length) problems.push(`this check fails ${name}: ${found[0]}`);
}
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
  console.error(`A plugin answered per machine is a popup that comes back; ${SETTINGS} is where the answer is kept for everybody.`);
  process.exit(1);
}
console.log(`agent settings: ${PLUGINS.length} plugin enabled for everybody who opens this checkout, and every hook row runs a script that is here`);
