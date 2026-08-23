#!/usr/bin/env node
// The published account of what the page may ask the app for, held to the app's own list. The architecture page carries a row per command and is the only published list of them, so a contributor reads it to learn what exists — and a silently short one teaches them a command does not.
//
//   node scripts/check-doc-commands.mjs   fail on a command with no row, or a row naming none (`just verify`)
//
// The names come off `IpcCommand` in `src/app/events.rs` through `enumCommands`, imported from `scripts/check-web-commands.mjs` rather than copied: one list, one reader. That check is about what a browser host does with a command; this one is about what the page says about it, which is a different failure and owes its own message.
//
// The table is found by its heading — `## IPC bridge`, then the first table under it. Not by the sentence above it, which moves, and not by the shape of its cells: the crates table higher up the same page puts backticked names in a first cell too, and would read as fourteen stale rows.
//
// A row may name more than one command and every name in the cell counts. `goBack` / `goForward` and the three window buttons are one sentence each, and reading the first name only reports the rest as missing.
//
// Both refusals are proved on made-up input before either real file is opened, so a matcher that quietly stops matching fails the build instead of passing everything.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enumCommands } from './check-web-commands.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const PAGE = 'docs/02-development/01-architecture.md';
const HEADING = '## IPC bridge';

// The app has scores of commands and has never had fewer. A count far off that means the enum stopped matching, not that the app shrank.
const FEWEST = 60;

/** Every command named in the first cell of the table under `## IPC bridge`, row by row. A row is kept whole, so a row naming two commands answers for both and a row naming none is reported as itself. */
function tableRows(markdown) {
  const at = markdown.indexOf(`${HEADING}\n`);
  if (at === -1) throw new Error(`${PAGE} no longer carries a ${HEADING} heading`);
  const section = markdown.slice(at + HEADING.length).split(/^## /m)[0];
  const rows = [];
  let started = false;
  for (const line of section.split('\n')) {
    const row = line.trim();
    if (!row.startsWith('|')) {
      if (started) break;
      continue;
    }
    started = true;
    const first = row.slice(1).split('|')[0].trim();
    if (/^[\s:-]+$/.test(first)) continue;
    rows.push({ first, commands: [...first.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1]) });
  }
  if (!rows.length) throw new Error(`${PAGE} has no table under ${HEADING}`);
  return rows.slice(1);
}

/** What is wrong with a given enum and set of rows. Pure, so the refusals can be proved on input nobody has to keep in step. */
function problems(commands, rows) {
  const found = [];
  const named = new Set(rows.flatMap((row) => row.commands));
  for (const command of commands) {
    if (!named.has(command)) {
      found.push(`${command} has no row on the page — the table says it is every command the page can send, so a contributor reading it learns this one does not exist`);
    }
  }
  for (const row of rows) {
    if (!row.commands.length) {
      found.push(`the row beginning "${row.first}" names no command in backticks — the check reads the first cell, so a row written another way is invisible`);
    }
    for (const command of row.commands) {
      if (!commands.includes(command)) {
        found.push(`the page has a row for ${command}, which IpcCommand has no arm for — a stale row is how a list stops being read`);
      }
    }
  }
  return found;
}

// ---- both refusals, on made-up input ----------------------------------------

function selfTest() {
  const broken = [];
  const rust = [
    'pub(crate) enum IpcCommand {',
    '    #[serde(rename = "alpha")]',
    '    Alpha,',
    '    #[serde(rename = "beta")]',
    '    Beta,',
    '    #[serde(rename = "gamma")]',
    '    Gamma,',
    '}',
    '',
  ].join('\n');
  const page = [
    '## Crates',
    '',
    '| Crate | What for |',
    '| --- | --- |',
    '| `delta` | not a command, and above the heading |',
    '',
    HEADING,
    '',
    '| Command | Triggered by |',
    '| ---------- | ---------- |',
    '| `alpha`    | the first one |',
    '| `beta` / `gamma` | two names in one cell, which is a shape the page already uses |',
    '',
    'Results flow back the other way.',
    '',
    '## Key data structures',
    '',
  ].join('\n');

  const commands = enumCommands(rust);
  if (commands.join(',') !== 'alpha,beta,gamma') broken.push(`the enum reader found ${JSON.stringify(commands)} instead of the three variants`);

  const rows = tableRows(page);
  // A row carrying two names answers for both, and nothing above the heading is read.
  if (rows.length !== 2) broken.push(`the table reader found ${rows.length} rows instead of the two under the heading — the crates table above it is not this one`);
  if (rows[1] && rows[1].commands.join(',') !== 'beta,gamma') broken.push(`the table reader lost a second name in one cell: ${JSON.stringify(rows[1])}`);

  const clean = problems(commands, rows);
  if (clean.length) broken.push(`a page that agrees was called wrong: ${clean.join('; ')}`);

  // 1. an arm with no row.
  if (!problems(commands, rows.slice(0, 1)).some((one) => one.startsWith('beta has no row'))) {
    broken.push('a command with no row on the page passed');
  }
  // 2. a row naming no arm.
  if (!problems(commands, [...rows, { first: '`delta`', commands: ['delta'] }]).some((one) => one.includes('stale row'))) {
    broken.push('a row naming no arm passed');
  }
  // A row with no backticked name at all is the other way that list stops being read.
  if (!problems(commands, [...rows, { first: 'the window buttons', commands: [] }]).some((one) => one.includes('names no command'))) {
    broken.push('a row naming nothing at all passed');
  }
  return broken;
}

// ---- the real pair ----------------------------------------------------------

const broken = selfTest();
if (broken.length) {
  console.error('check-doc-commands cannot check anything — its own matchers are wrong:');
  for (const one of broken) console.error(`  ${one}`);
  process.exit(1);
}

const commands = enumCommands(readFileSync(join(root, 'src/app/events.rs'), 'utf8'));
if (commands.length < FEWEST) {
  console.error(`only ${commands.length} commands came off IpcCommand, and the app has never had fewer than ${FEWEST}.`);
  console.error('The enum reader has stopped matching, so this check would pass a table with anything in it.');
  process.exit(1);
}

const rows = tableRows(readFileSync(join(root, PAGE), 'utf8'));
const found = problems(commands, rows);
if (found.length) {
  console.error(`${found.length} thing(s) the published command table cannot account for:`);
  for (const one of found) console.error(`  ${one}`);
  console.error(`The table is under ${HEADING} in ${PAGE}, and it says it is every command the page can send. A command with no row does not ship.`);
  process.exit(1);
}

console.log(`doc commands: ${commands.length} arms, every one named across ${rows.length} rows under ${HEADING} in ${PAGE}`);
