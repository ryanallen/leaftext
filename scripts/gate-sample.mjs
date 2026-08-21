#!/usr/bin/env node
// PostToolUse hook. Sample how the build's ticket stands after every edit, so the stop hook can tell a build that filled its boxes as it went from one that swept them at the end.
//
//   node scripts/gate-sample.mjs --after   the edit tool's PostToolUse payload on stdin
//   node scripts/gate-sample.mjs --check   self-test (`just verify`)
//
// After each edit this appends one sample to the record gate-design.mjs wrote — every phase of the ticket with its boxes counted — and gate-voice.mjs reads the run of them at the end of the turn. It has to be sampled here rather than read once at the end, because a phase batch-ticked after the code stopped moving leaves a file identical to one filled in as the work finished. After rather than before, and every edit rather than only the ones inside this checkout, because the tick that finishes a box is itself an edit and the plan tree is where it is written: sampled the other way, a tick is only ever seen by whatever edit comes next and the last tick of a turn is seen by nothing.
//
// Nothing here refuses and nothing waits.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRecord, buildingPath, forget } from './gate-design.mjs';
import { keep, sessionOf, sessionTag } from './hook-payload.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/// The tools that write a file. A name outside this list changes nothing, so there is nothing to sample — the settings row narrows it as well, and this is the half that holds if the row is ever widened.
export const EDIT_TOOLS = /^(write|edit|multiedit|notebookedit)$/i;

/// Every `### Phase` section of a ticket, with its boxes counted. Any other heading ends the section, so the owner's box and the per-phase `/check` box — each under a heading of its own — are never counted as a phase's work.
export function phasesOf(ticket) {
  const phases = [];
  let here = null;
  for (const line of String(ticket ?? '').split('\n')) {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      here = /^Phase\b/i.test(heading[1]) ? { phase: heading[1], open: 0, ticked: 0 } : null;
      if (here) phases.push(here);
      continue;
    }
    if (!here) continue;
    const box = /^\s*-\s*\[([ xX])\]/.exec(line);
    if (box) here[box[1] === ' ' ? 'open' : 'ticked'] += 1;
  }
  return phases;
}

/// Append one sample to this session's build record: every phase of the ticket with its boxes counted, read *after* the edit has landed. Every edit is sampled, in this checkout or the plan tree next door, because the tick that finishes a box is itself an edit — sampled before the write, a tick is seen only by whatever edit comes next, and the last tick of a turn by nothing. Every phase rather than the one being built: ticking a phase's last box moves which phase is open, and a single count would read that move as a fall.
export function sample(session, dir = tmpdir(), open = (path) => readFileSync(path, 'utf8')) {
  const held = buildRecord(session, dir);
  if (!held) return null;
  let text = '';
  try {
    text = open(held.ticket);
  } catch {
    return null; // A ticket that will not open says nothing about how its boxes stand.
  }
  const now = phasesOf(text);
  if (!now.length) return null;
  writeFileSync(buildingPath(session, dir), JSON.stringify({ session: sessionTag(session), ticket: held.ticket, samples: [...held.samples, now] }) + '\n');
  return now;
}

function selfTest() {
  const fails = [];

  // A folder of its own, so nothing here reads or writes a live session's record. The name is the OS's, which is what keeps two runs of the gate off each other.
  const dir = mkdtempSync(join(tmpdir(), 'leaftext-sampletest-'));
  try {
    // How a ticket's boxes stand, which is the one fact the stop hook cannot get anywhere else.
    const TICKET = [
      '# A plan', '', '## Phases', '',
      '### Phase 1 — the first one', '', '- [x] built', '- [ ] not built yet', '',
      '### Phase 2 — the second one', '', '- [ ] nothing here yet', '',
      '### Every phase ends the same way', '', '- [ ] `/check`', '',
      '### The owner\'s box', '', '- [ ] press it', '',
    ].join('\n');
    const phases = phasesOf(TICKET);
    if (phases.length !== 2) fails.push(`${phases.length} phases read rather than 2 — a heading of its own is not a phase`);
    if (phases[0]?.ticked !== 1 || phases[0]?.open !== 1) fails.push("the first phase's boxes were not counted");
    if (phases.some((p) => p.phase.includes('owner') || p.phase.includes('Every'))) fails.push("the owner's box or the `/check` box was read as a phase");
    if (phasesOf('# A plan\n\n### Phase 1 — struck\n\n- [x] ~~dropped~~ — N/A\n')[0]?.ticked !== 1) fails.push('a struck box was not counted as ticked');
    if (phasesOf('')?.length) fails.push('an empty ticket named a phase');

    // One sample per edit, carrying every phase rather than the one being built: ticking a phase's last box moves which phase is open, and a single count would read that move as a fall.
    const FOUR = 'dddddddd-4444-4444-4444-444444444444';
    const readTicket = () => TICKET;
    if (sample(FOUR, dir, readTicket)) fails.push('a session with no build turn was sampled');
    writeFileSync(buildingPath(FOUR, dir), JSON.stringify({ session: sessionTag(FOUR), ticket: '/plans/a.md', samples: [] }) + '\n');
    const first = sample(FOUR, dir, readTicket);
    if (first?.length !== 2) fails.push(`a sample carried ${first?.length ?? 'no'} phases rather than every one of them`);
    if (first?.[0]?.ticked !== 1 || first?.[1]?.ticked !== 0) fails.push("a sample did not carry each phase's own tick count");
    if (first?.[0]?.phase !== 'Phase 1 — the first one') fails.push('a sample did not name the phase each count belongs to');
    sample(FOUR, dir, readTicket);
    if (buildRecord(FOUR, dir)?.samples.length !== 2) fails.push('the build record did not keep one sample per edit');
    if (sample(FOUR, dir, () => { throw new Error('gone'); })) fails.push('a ticket that will not open was still sampled');
    if (sample(FOUR, dir, () => '# A plan with no phases at all\n\n- [ ] a box under nothing\n')) fails.push('a ticket carrying no phase was sampled');

    // The wiring, through the real entry point. Two claims no call to `sample` can make on its own: a sample is taken on the way out and never on the way in, and the file the edit named decides nothing — the tick that finishes a box is written in the plan tree next door, so that edit has to be sampled or the tick is seen by nothing.
    const FIVE = `gate-sample-selftest-${process.pid}`;
    const onDisk = join(dir, 'ticket.md');
    writeFileSync(onDisk, TICKET);
    const edited = (file, ...flags) => execFileSync(process.execPath, [fileURLToPath(import.meta.url), ...flags], {
      input: JSON.stringify({ session_id: FIVE, tool_name: 'Edit', tool_input: { file_path: file } }),
      encoding: 'utf8',
    });
    try {
      writeFileSync(buildingPath(FIVE), JSON.stringify({ session: sessionTag(FIVE), ticket: onDisk, samples: [] }) + '\n');
      edited(join(root, 'src', 'lib.rs'));
      if (buildRecord(FIVE)?.samples.length) fails.push('an edit was sampled on the way in, so a tick would only ever be seen by whatever edit came next');
      edited(join(root, 'src', 'lib.rs'), '--after');
      if (buildRecord(FIVE)?.samples.length !== 1) fails.push('an edit was not sampled on the way out');
      edited(join(root, '..', 'docs', 'README.md'), '--after');
      if (buildRecord(FIVE)?.samples.length !== 2) fails.push('an edit to the plan tree was not sampled, so a tick would be seen by nothing');
    } finally {
      forget(FIVE);
    }
  } catch (error) {
    fails.push(`cycle: ${error.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  for (const name of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'edit']) {
    if (!EDIT_TOOLS.test(name)) fails.push(`${name} writes a file and its build would not be sampled`);
  }
  for (const name of ['Read', 'TodoWrite', 'Grep', 'Bash']) {
    if (EDIT_TOOLS.test(name)) fails.push(`${name} was read as a file-writing tool`);
  }

  if (fails.length) {
    console.error('gate-sample: failed');
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('gate-sample: ok (every edit of a build samples every phase of its ticket after the write, the plan tree included, and a turn with no build in it samples nothing)');
}

// Only act when run directly: a hook body that read stdin on import would swallow whatever payload the importing hook was handed.
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
  const after = args.includes('--after');
  keep(after ? 'PostToolUse' : 'PreToolUse', raw);
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // An unreadable payload samples nothing.
  }
  if (after && EDIT_TOOLS.test(payload.tool_name ?? '')) {
    try {
      // How the ticket stands once the write has happened, so it is taken on the way out.
      sample(sessionOf(raw));
    } catch {
      // Never block: a hook that can wedge a session is worse than no hook.
    }
  }
  process.exit(0);
}
