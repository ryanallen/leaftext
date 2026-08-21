#!/usr/bin/env node
// UserPromptSubmit hook. Refuses a build on a ticket nobody has designed. Reading a plan against the code is what turns a wish into work somebody can build, and a build that skipped it writes code off a plan whose own words have never been opened — which is how a phase gets built the way the plan guessed rather than the way the code is.
//
//   node scripts/gate-design.mjs           the hook payload on stdin
//   node scripts/gate-design.mjs --check   self-test (`just verify`)
//
// Blocks rather than warns: this is the one order in the workflow that cannot be recovered afterwards, because the code is already written by the time anybody notices. The message names the ticket and says to run /design over it, which is the whole way past.
//
// Only a message naming the build skill with its host's sign and carrying a path into the plan tree is read. A path that cannot be opened is somebody else's refusal — a hook that guesses at a missing file wedges a session over a typo.
//
// It also writes down which ticket the turn is building, because it is the one hook that sees the message that names one. The edit hook samples that ticket's boxes and the stop hook reads the samples, and neither can find the ticket for itself, because the step list records a skill rather than its argument. A message naming no build clears the last one, so a later turn is never judged against a ticket it is not working.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { keep, sessionOf, sessionTag, sweep } from './hook-payload.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TREE = join(root, '..', 'docs');

/** The dated `Designed` line /design writes. The same test check-plan-stage.mjs makes of a row's stage. */
export function isDesigned(ticket) {
  return /\*\*Designed\s+\d/.test(ticket);
}

/** The plan paths a message naming the build skill hands over, or [] when it names no build. */
export function ticketsIn(prompt) {
  if (!/(^|\s)[$/]dev\b/i.test(prompt)) return [];
  return [...prompt.matchAll(/(?:^|[\s"'`(])((?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?[^\s"'`()]*docs[\\/][^\s"'`()]*\.md)/g)].map((m) => m[1]);
}

/** The reason a build is refused, or '' when it may go ahead. `read` opens a path the message named. */
export function refusal(prompt, read) {
  for (const path of ticketsIn(prompt)) {
    let ticket = null;
    try {
      ticket = read(path);
    } catch {
      continue; // A path that will not open is a typo or another tree's file, and holding the turn over one is a hook nobody can get past.
    }
    if (!isDesigned(ticket)) return `${path} has no dated Designed line, so it has never been read against the code. Run /design over it first, and leave its running-order row at \`Ready\` until that pass writes one.`;
  }
  return '';
}

/// What every record of this kind is named with, and what the sweep looks for. One file per session: two agents build different tickets in this checkout at once, and a single file naming a session is overwritten by the other one's next message.
export const BUILDING = 'leaftext-building-';

export function buildingPath(session, dir = tmpdir()) {
  const tag = sessionTag(session ?? sessionOf(''));
  return tag ? join(dir, `${BUILDING}${tag}.json`) : '';
}

/// A path a message wrote, resolved against the plan tree next door.
export function resolveTicket(path) {
  return isAbsolute(path) ? path : join(TREE, path.replace(/^\.\.[\\/]docs[\\/]/, ''));
}

/// The first designed ticket a build message named that also opens, or ''. A message naming two is naming one build and one citation, so only the first counts.
export function designedIn(prompt, read) {
  for (const path of ticketsIn(prompt)) {
    let ticket = null;
    try {
      ticket = read(path);
    } catch {
      continue;
    }
    if (isDesigned(ticket)) return path;
  }
  return '';
}

/// Remember which ticket this turn is building, and forget the last one where the message names none. The edit hook reads it to find the phase whose boxes have to fill in as the code lands.
export function remember(session, ticket, dir = tmpdir()) {
  const path = buildingPath(session, dir);
  if (!path) return '';
  if (!ticket) {
    rmSync(path, { force: true });
    return '';
  }
  writeFileSync(path, JSON.stringify({ session: sessionTag(session), ticket, samples: [] }) + '\n');
  return ticket;
}

/// What this session is building, and how its phase's boxes stood at each source edit. Null when no build turn is running.
export function buildRecord(session, dir = tmpdir()) {
  const path = buildingPath(session, dir);
  if (!path) return null;
  try {
    const held = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof held?.ticket !== 'string' || !held.ticket) return null;
    return { ticket: held.ticket, samples: Array.isArray(held.samples) ? held.samples : [] };
  } catch {
    return null; // No record, or one nothing can read, is no build to hold.
  }
}

/// Drop the record. The turn it belongs to is over.
export function forget(session, dir = tmpdir()) {
  const path = buildingPath(session, dir);
  if (path) rmSync(path, { force: true });
}

const DESIGNED = '# A plan\n\n> **Designed 19 August 2026, 7:07pm.** Citations opened.\n';
const PLAIN = '# A plan\n\n> **Not built.** A plan.\n';
const READ = (path) => {
  if (path.includes('designed')) return DESIGNED;
  if (path.includes('plain')) return PLAIN;
  throw new Error('no such file');
};

const CASES = [
  ['a build on a designed ticket', '/dev ../docs/refactor/a/designed.md', false],
  ['a build on a ticket nobody designed', '/dev ../docs/refactor/a/plain.md', true],
  ['a build named with the other host sign', '$dev ../docs/refactor/a/plain.md', true],
  ['a build on a Windows path', '/dev C:\\work\\leaftext\\docs\\refactor\\a\\plain.md', true],
  ['a build naming a path that will not open', '/dev ../docs/refactor/a/gone.md', false],
  ['a build with no path at all', '/dev the top of the running order', false],
  ['another skill over an undesigned ticket', '/ticket ../docs/refactor/a/plain.md', false],
  ['prose that merely says the word', 'the dev tree holds ../docs/refactor/a/plain.md', false],
];

function selfTest() {
  const fails = [];
  for (const [name, prompt, shouldRefuse] of CASES) {
    const found = refusal(prompt, READ);
    if (shouldRefuse && !found) fails.push(`${name} is let through`);
    if (!shouldRefuse && found) fails.push(`${name} is refused — ${found}`);
  }

  // Which ticket the turn is building, kept so the edit hook and the stop hook read the same one.
  const ONE = 'aaaaaaaa-1111-1111-1111-111111111111';
  const dir = mkdtempSync(join(tmpdir(), 'leaftext-buildtest-'));
  try {
    if (designedIn('/dev ../docs/refactor/a/designed.md', READ) !== '../docs/refactor/a/designed.md') fails.push('a designed ticket was not read out of a build message');
    if (designedIn('/dev ../docs/refactor/a/plain.md', READ)) fails.push('a ticket nobody designed was written down as the build');
    if (designedIn('/dev ../docs/refactor/a/gone.md', READ)) fails.push('a path that will not open was written down as the build');
    if (designedIn('/ticket ../docs/refactor/a/designed.md', READ)) fails.push('a message naming no build was read as one');
    if (designedIn('/dev ../docs/refactor/a/gone.md ../docs/refactor/a/designed.md', READ) !== '../docs/refactor/a/designed.md') fails.push('a build naming a bad path first did not fall through to the good one');

    if (buildRecord(ONE, dir)) fails.push('a session with no build turn answered a record');
    if (remember(ONE, '/plans/a.md', dir) !== '/plans/a.md') fails.push('a build turn did not write its record');
    if (buildRecord(ONE, dir)?.ticket !== '/plans/a.md') fails.push('the ticket did not come back');
    if (buildRecord(ONE, dir)?.samples.length) fails.push('a fresh record started with samples in it');
    if (remember(ONE, '', dir) !== '') fails.push('a message naming no build still wrote a record');
    if (buildRecord(ONE, dir)) fails.push('a message naming no build left the last one standing');
    if (remember('', '/plans/a.md', dir) !== '') fails.push('no session id still named a file to write');

    remember(ONE, '/plans/a.md', dir);
    forget(ONE, dir);
    if (buildRecord(ONE, dir)) fails.push('the record survived the turn it belonged to');

    writeFileSync(buildingPath(ONE, dir), 'not json at all');
    if (buildRecord(ONE, dir)) fails.push('an unreadable record was read as a build');
    writeFileSync(buildingPath(ONE, dir), JSON.stringify({ session: 'aaaaaaaa' }) + '\n');
    if (buildRecord(ONE, dir)) fails.push('a record naming no ticket was read as a build');
  } catch (error) {
    fails.push(`record: ${error.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (fails.length) {
    console.error('gate-design: failed');
    for (const fail of fails) console.error(`  ${fail}`);
    process.exit(1);
  }
  console.log(`gate-design: ok (${CASES.length} messages read, a build on an undesigned plan refused, and the ticket a build named written down for the turn)`);
  process.exit(0);
}

// Only act when run directly: the edit and stop hooks import this for the build record, and a hook body that read stdin on import would swallow whatever payload the importing hook was handed.
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
    process.exit(0); // No payload is no message to read, and a hook that cannot read one must never hold a turn.
  }
  keep('gate-design', raw);

  let prompt = '';
  try {
    prompt = JSON.parse(raw).prompt ?? '';
  } catch {
    process.exit(0);
  }

  const open = (path) => readFileSync(resolveTicket(path), 'utf8');
  let reason = '';
  let building = '';
  try {
    reason = refusal(prompt, open);
    if (!reason) building = designedIn(prompt, open);
  } catch {
    process.exit(0); // A broken gate must never wedge a session.
  }

  // Written down whether or not this message names one: a turn naming no build clears the last one, so a later turn is never judged against a ticket it is not working.
  try {
    remember(sessionOf(raw), building ? resolveTicket(building) : '');
    sweep(tmpdir(), BUILDING);
  } catch {
    // A record that cannot be written holds nothing, which is how the gate behaved before it existed.
  }

  if (reason) {
    console.error(`a build was asked for on a plan nobody has designed:\n  ${reason}`);
    process.exit(2);
  }
  process.exit(0);
}
