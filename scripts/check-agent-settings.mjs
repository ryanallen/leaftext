#!/usr/bin/env node
// What the repo's own settings file owes an agent that opens this checkout. Today that is one plugin row; anything Claude Code should answer once for everybody rather than once per machine belongs here beside it.
//
//   node scripts/check-agent-settings.mjs   (`just verify`)
//
// The row enables Anthropic's rust-analyzer language server, which is what answers go-to-definition, find-all-references and live compile errors instead of a text search over the tree. Lose it and nothing breaks loudly: the popup comes back, one person says yes into their own settings file, and the next machine asks again. The program itself is a per-machine `rustup component add rust-analyzer`, deliberately not checked — a check for it would fail the suite for anyone who has not run one optional command for a tool the build never uses.

import { readFileSync } from 'node:fs';
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

problems.push(...settingsProblems(readFileSync(join(root, SETTINGS), 'utf8')));

if (problems.length) {
  console.error('the repo settings file is missing something an agent needs:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`A plugin answered per machine is a popup that comes back; ${SETTINGS} is where the answer is kept for everybody.`);
  process.exit(1);
}
console.log(`agent settings: ${PLUGINS.length} plugin enabled for everybody who opens this checkout`);
