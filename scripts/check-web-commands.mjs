#!/usr/bin/env node
// The app and the published site are one front end with two hosts under it, and only one of them is ever checked. This is what makes the other half say something.
//
//   node scripts/check-web-commands.mjs   fail on a command with no browser line (`just verify`)
//
// The names come off `IpcCommand` in `src/app/events.rs` — the app's one typed list of what the page may send, complete by the compiler and by serde, the same way `format.rs` is the one table of readable formats. Never off the front end: a scan of `src/assets/shell/` for a command literal misses every one sent through a variable or a ternary, and picks up the `execCommand` names in the selection toolbar that never reach a host at all.
//
// Three refusals, because they catch three different things:
//
//   an arm with no row     a command was added to the app and nobody said what a browser does
//                          about it. The line is the point of this check — it is the only thing
//                          here that acts on work nobody has written yet.
//   a row with no arm      a stale row, which is how a list stops being read.
//   a sent name with no arm  a command the front end sends that neither host has. The scan runs
//                          in the safe direction only — a literal `send({ command: 'x' })` — where
//                          a name found is provably a name sent.
//
// Each of the three is proved on made-up input before either real file is opened, so a matcher that quietly stops matching fails the build instead of passing everything.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The app has scores of commands and has never had fewer. A count far off that means the enum stopped matching, not that the app shrank — and an empty table would otherwise pass everything.
const FEWEST = 60;

/** From a declaration to the brace that closes it, which is the only one at the start of a line. Cut on a line rather than on a byte sequence: a working tree checked out on Windows has the other line ending, and a slice that missed would quietly take the rest of the file. */
function block(text, opens, closes, what) {
  const at = text.indexOf(opens);
  if (at === -1) throw new Error(`${what} no longer declares ${opens.trim()}`);
  const rest = text.slice(at);
  const end = rest.search(closes);
  if (end === -1) throw new Error(`${what} declares ${opens.trim()} and nothing closes it`);
  return rest.slice(0, end);
}

/** Every variant of `IpcCommand`, by the name it is sent under. A variant's own rename sits at four spaces; a field's sits at eight, and is not a command. */
function enumCommands(rust) {
  const body = block(rust, 'enum IpcCommand {', /^\}/m, 'src/app/events.rs');
  return [...body.matchAll(/^ {4}#\[serde\(rename = "([A-Za-z][A-Za-z0-9]*)"\)\]/gm)].map((m) => m[1]);
}

/** The host's own table: the command, which of the three answers it carries, and the reason or the ticket. */
function hostRows(js) {
  const body = block(js, 'export const COMMANDS = {', /^\};/m, 'web/preview/host.js');
  return [...body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*): \[(ANSWERED|REFUSED|LATER)(?:, '([^']*)')?\]/gm)].map((m) => ({
    command: m[1],
    kind: m[2],
    why: m[3] || '',
  }));
}

/** Command names the front end sends as a literal — the one direction a scan of it can be trusted in. */
function sentCommands(sources) {
  const found = new Set();
  for (const text of sources) {
    for (const m of text.matchAll(/send\(\{ command: '([A-Za-z][A-Za-z0-9]*)'/g)) found.add(m[1]);
    for (const m of text.matchAll(/postMessage\(JSON\.stringify\(\{ command: '([A-Za-z][A-Za-z0-9]*)'/g)) found.add(m[1]);
  }
  return [...found];
}

/** What is wrong with a given enum, table and set of sent names. Pure, so the three refusals can be proved on input nobody has to keep in step. */
function problems(commands, rows, sent) {
  const found = [];
  const listed = new Map(rows.map((row) => [row.command, row]));

  for (const command of commands) {
    if (!listed.has(command)) {
      found.push(`${command} has no line in web/preview/host.js — say whether the browser answers it, will not (and why), or not yet (and which ticket owns it)`);
    }
  }
  for (const row of rows) {
    if (!commands.includes(row.command)) {
      found.push(`web/preview/host.js has a line for ${row.command}, which IpcCommand has no arm for — a stale row is how a list stops being read`);
    }
    if (row.kind !== 'ANSWERED' && !row.why) {
      found.push(`${row.command} is ${row.kind} with nothing after it — a refusal owes its reason, and a not-yet owes its ticket`);
    }
    if (row.kind === 'ANSWERED' && row.why) {
      found.push(`${row.command} is ANSWERED and carries a reason; an arm answers for itself`);
    }
  }
  for (const command of sent) {
    if (!commands.includes(command)) {
      found.push(`the front end sends ${command}, which IpcCommand has no arm for — nothing answers it on either host`);
    }
  }
  return found;
}

// ---- the three refusals, on made-up input -----------------------------------

function selfTest() {
  const broken = [];
  const rust = [
    'pub(crate) enum IpcCommand {',
    '    #[serde(rename = "alpha")]',
    '    Alpha,',
    '    #[serde(rename = "beta")]',
    '    Beta {',
    '        #[serde(rename = "notACommand")]',
    '        not_a_command: bool,',
    '    },',
    '}',
    '',
  ].join('\n');
  const table = [
    'export const COMMANDS = {',
    "  alpha: [ANSWERED],",
    "  beta: [REFUSED, 'no disk here'],",
    '};',
  ].join('\n');

  const commands = enumCommands(rust);
  if (commands.join(',') !== 'alpha,beta') broken.push(`the enum reader found ${JSON.stringify(commands)} instead of the two variants — a field rename is not a command`);
  const rows = hostRows(table);
  if (rows.length !== 2 || rows[1].why !== 'no disk here') broken.push(`the table reader lost a row or its reason: ${JSON.stringify(rows)}`);
  if (sentCommands(["send({ command: 'alpha', x: 1 });", "postMessage(JSON.stringify({ command: 'beta' }))"]).sort().join(',') !== 'alpha,beta') {
    broken.push('the front-end scan stopped finding a literal command');
  }

  const clean = problems(commands, rows, ['alpha']);
  if (clean.length) broken.push(`a pair that agrees was called wrong: ${clean.join('; ')}`);

  // 1. an arm with no row.
  if (!problems(commands, rows.slice(0, 1), []).some((one) => one.startsWith('beta has no line'))) {
    broken.push('a command with no line in the host passed');
  }
  // 2. a row naming no arm.
  if (!problems(commands, [...rows, { command: 'gamma', kind: 'ANSWERED', why: '' }], []).some((one) => one.includes('stale row'))) {
    broken.push('a stale row naming no arm passed');
  }
  // 3. a sent command the enum has no arm for.
  if (!problems(commands, rows, ['gamma']).some((one) => one.includes('sends gamma'))) {
    broken.push('a sent command nothing answers passed');
  }
  // A refusal with nothing after it is a line that says nothing.
  if (!problems(commands, [rows[0], { command: 'beta', kind: 'REFUSED', why: '' }], []).some((one) => one.includes('owes its reason'))) {
    broken.push('a refusal with no reason passed');
  }
  return broken;
}

const broken = selfTest();
if (broken.length) {
  console.error('check-web-commands cannot check anything — its own matchers are wrong:');
  for (const one of broken) console.error(`  ${one}`);
  process.exit(1);
}

// ---- the real pair ----------------------------------------------------------

const commands = enumCommands(readFileSync(join(root, 'src/app/events.rs'), 'utf8'));
if (commands.length < FEWEST) {
  console.error(`only ${commands.length} commands came off IpcCommand, and the app has never had fewer than ${FEWEST}.`);
  console.error('The enum reader has stopped matching, so this check would pass an empty table.');
  process.exit(1);
}

const rows = hostRows(readFileSync(join(root, 'web/preview/host.js'), 'utf8'));
const fragments = readdirSync(join(root, 'src/assets/shell'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => readFileSync(join(root, 'src/assets/shell', name), 'utf8'));
// The theme bootstrap is the other place a command comes from: it runs in its own scope above the fragments, and it is inlined into the page a static site is served with.
fragments.push(readFileSync(join(root, 'src/assets/theme-bootstrap.js'), 'utf8'));
const sent = sentCommands(fragments);

const found = problems(commands, rows, sent);
if (found.length) {
  console.error(`${found.length} command(s) the browser half cannot account for:`);
  for (const one of found) console.error(`  ${one}`);
  console.error('The table is in web/preview/host.js, beside the arms. One front end, two hosts: a command with no browser line does not ship.');
  process.exit(1);
}

const answered = rows.filter((row) => row.kind === 'ANSWERED').length;
const later = rows.filter((row) => row.kind === 'LATER').length;
console.log(
  `web commands: ${commands.length} arms, every one with a line — ${answered} answered, ` +
    `${rows.length - answered - later} refused on purpose, ${later} not yet; ${sent.length} sent by name, all of them arms`
);
