#!/usr/bin/env node
// PostToolUse hook. Sample how the build's ticket stands after every edit and every shell command, so the stop hook can tell a build that filled its boxes as it went from one that swept them at the end.
//
//   node scripts/gate-sample.mjs --after   the tool's PostToolUse payload on stdin
//   node scripts/gate-sample.mjs --check   self-test (`just verify`)
//
// After each one this appends one sample to the record gate-design.mjs wrote — every phase of the ticket with its boxes counted — and gate-voice.mjs reads the run of them at the end of the turn. It has to be sampled here rather than read once at the end, because a phase batch-ticked after the code stopped moving leaves a file identical to one filled in as the work finished. After rather than before, and every edit rather than only the ones inside this checkout, because the tick that finishes a box is itself an edit and the plan tree is where it is written: sampled the other way, a tick is only ever seen by whatever edit comes next and the last tick of a turn is seen by nothing.
//
// A shell command is sampled for the same reason and it is not a corner: a session in this mode is told to prefer a heredoc, a `sed` or a script for writing a file, so sampling the edit tools alone left the ordinary build with an empty list and nothing to read — and left a build that worked in the shell and ticked through an edit tool refused for ticking boxes back to back, with its work in commands nothing sampled.
//
// Nothing here refuses and nothing waits.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRecord, buildingPath, forget } from './gate-design.mjs';
import { RING, keep, sessionOf, sessionTag } from './hook-payload.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/// The tools that write a file. A name outside this list changes nothing, so there is nothing to sample — the settings row narrows it as well, and this is the half that holds if the row is ever widened.
export const EDIT_TOOLS = /^(write|edit|multiedit|notebookedit)$/i;

/// The tools that run a command. A shell line writes files too — a heredoc, a `sed`, a script — and a session in this mode is told to prefer them, so a build sampled on the edit tools alone is the ordinary build going unheld. A read is sampled as well: it changes no box, and a flat sample is exactly what separates one tick from the next.
export const SHELL_TOOLS = /^(bash|powershell)$/i;

/// Every tool name a sample is taken for, spelled the way the host spells it, so the settings rows can be held to the branch below rather than drifting from it.
export const SAMPLED_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'];

/// Whether this tool's use is worth a sample: it wrote a file, or it ran a command that may have.
export const sampled = (name) => EDIT_TOOLS.test(name ?? '') || SHELL_TOOLS.test(name ?? '');

/// Which bucket of the payload ring this one belongs in. The ring keeps twenty per name, so an edit and a shell command sharing a name is a build's edit payloads gone within twenty commands — seconds on any real build, and the diagnostic is only ever read once something has already gone wrong. Three names a side, worked out from the tool the payload already carries rather than from a flag on the settings row, where a row added without it would land silently back in the edits' bucket. `-other` is the one that matters: a tool a widened row lets through and a payload nothing can parse both reach the ring under it, and the unparseable one is the largest and the most worth keeping.
export function bucketOf(hook, raw) {
  let tool = '';
  try {
    tool = String(JSON.parse(raw ?? '').tool_name ?? '');
  } catch {
    return `${hook}-other`; // Named before the parse the entry point needs, so a payload that will not open is filed rather than dropped.
  }
  if (EDIT_TOOLS.test(tool)) return `${hook}-edit`;
  if (SHELL_TOOLS.test(tool)) return `${hook}-shell`;
  return `${hook}-other`;
}

/// The tools this samples that no `PostToolUse` row hands it. A row is the only thing that runs a hook, so a tool named here and matched by none is a branch nothing ever reaches: the rule is off, on disk, passing its own self-test. That is this file's own bug wearing a different hat, and nothing else fails when a row is deleted. The host reads a matcher as an unanchored pattern, so this tests one the same way — which is why `Edit` covers `MultiEdit` and no row spells it.
export function unrowedTools(settingsText, names = SAMPLED_TOOLS) {
  let rows = [];
  try {
    rows = JSON.parse(settingsText).hooks?.PostToolUse ?? [];
  } catch {
    return [...names]; // Settings nobody can read run no hook at all.
  }
  const matchers = [];
  for (const row of rows ?? []) {
    if (!(row.hooks ?? []).some((hook) => /gate-sample\.mjs/.test(String(hook.command ?? '')))) continue;
    try {
      matchers.push(new RegExp(row.matcher ?? ''));
    } catch {
      // A matcher the host cannot read matches nothing, and saying so is check-agent-settings.mjs's job rather than this one's.
    }
  }
  return names.filter((name) => !matchers.some((matcher) => matcher.test(name)));
}

/// The hook names one session put in the ring, in the order they were written. The ring is one file for the whole checkout and every hook of every live session rewrites it whole, so its last lines belong to whoever wrote last: a proof reading them reads another session's hook name, or a line caught part-way through a rewrite, and fails on a tree that is fine. Every line already records the session it came from, so the reading simply drops the ones it did not write — which takes the torn line with it, since a line nothing can parse carries no session either.
export function ownRingNames(lines, session) {
  const mine = String(session ?? '');
  if (!mine) return []; // No session is no way to tell one line from another, and claiming every line would be worse than claiming none.
  const names = [];
  for (const line of lines ?? []) {
    try {
      const entry = JSON.parse(line);
      if (String(entry.session ?? '') === mine) names.push(String(entry.hook ?? ''));
    } catch {
      // A line stopping mid-payload says nothing about who wrote it, so it is not this session's.
    }
  }
  return names;
}

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
      '### The build ends the same way', '', '- [ ] `/check` once', '',
      '### The owner\'s box', '', '- [ ] press it', '',
    ].join('\n');
    const phases = phasesOf(TICKET);
    if (phases.length !== 2) fails.push(`${phases.length} phases read rather than 2 — a heading of its own is not a phase`);
    if (phases[0]?.ticked !== 1 || phases[0]?.open !== 1) fails.push("the first phase's boxes were not counted");
    if (phases.some((p) => p.phase.includes('owner') || p.phase.includes('The build ends'))) fails.push("the owner's box or the one final check box was read as a phase");
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
    const firedAs = (session, tool, input, ...flags) => execFileSync(process.execPath, [fileURLToPath(import.meta.url), ...flags], {
      input: JSON.stringify({ session_id: session, tool_name: tool, tool_input: input }),
      encoding: 'utf8',
    });
    const fired = (tool, input, ...flags) => firedAs(FIVE, tool, input, ...flags);
    const edited = (file, ...flags) => fired('Edit', { file_path: file }, ...flags);
    try {
      writeFileSync(buildingPath(FIVE), JSON.stringify({ session: sessionTag(FIVE), ticket: onDisk, samples: [] }) + '\n');
      edited(join(root, 'src', 'lib.rs'));
      if (buildRecord(FIVE)?.samples.length) fails.push('an edit was sampled on the way in, so a tick would only ever be seen by whatever edit came next');
      edited(join(root, 'src', 'lib.rs'), '--after');
      if (buildRecord(FIVE)?.samples.length !== 1) fails.push('an edit was not sampled on the way out');
      edited(join(root, '..', 'docs', 'README.md'), '--after');
      if (buildRecord(FIVE)?.samples.length !== 2) fails.push('an edit to the plan tree was not sampled, so a tick would be seen by nothing');

      // The shell, carrying a command rather than a file: the tool a session in this mode is told to prefer for writing one, and the payload's own input is never opened, so what the line touched decides nothing.
      fired('Bash', { command: `sed -i 's/a/b/' ${join(root, 'src', 'lib.rs')}` }, '--after');
      if (buildRecord(FIVE)?.samples.length !== 3) fails.push('a shell command was not sampled, so a build that writes with one reads as never having started');
      fired('PowerShell', { command: 'Set-Content src/lib.rs "x"' }, '--after');
      if (buildRecord(FIVE)?.samples.length !== 4) fails.push('the other shell was not sampled, so half a build would be held and half of it not');

      // A tool that neither writes a file nor runs a command still samples nothing: the branch is narrowed here as well as by the settings rows, and this is the half that holds if a row is ever widened.
      fired('Read', { file_path: onDisk }, '--after');
      if (buildRecord(FIVE)?.samples.length !== 4) fails.push('a tool that neither writes nor runs anything was sampled');
    } finally {
      forget(FIVE);
    }

    // A shell command belonging to no build writes nothing at all. Every session runs commands and only some of them are building, so a hook now fired on every one of them has to leave the rest of the folder as it found it.
    const SIX = `gate-sample-selftest-loose-${process.pid}`;
    try {
      firedAs(SIX, 'Bash', { command: 'ls' }, '--after');
      if (buildRecord(SIX)) fails.push('a shell command in a session with no build record open wrote one');
    } finally {
      forget(SIX);
    }

    // Through the real entry point and into the real ring: an edit and a shell command have to come out under a name each, which is the whole ticket. Two lines rather than twenty — filling a bucket past its limit is `ringLines`' own claim and scripts/gate-rules.mjs makes it in memory, where a proof cannot flush the live diagnostic it is proving.
    //
    // Only this run's own lines are read, which `ownRingNames` says why. What that filter cannot answer is the ring dropping this run's line outright — and a line missing says nothing about how the buckets are named, so there is nothing to fail on yet and the pair is fired again under a fresh name, three tries in all. Two lines named wrong still fail on the spot: the second write is only ever for lines the ring did not keep, never for lines it kept and spelled differently.
    const SEVEN = `gate-sample-selftest-ring-${process.pid}`;
    const RING_TRIES = 3;
    const ringLinesOnDisk = () => {
      try {
        return readFileSync(RING, 'utf8').split('\n').filter(Boolean);
      } catch {
        return []; // No ring to read is a write the ring did not keep, which the tries below make again before anything fails.
      }
    };
    const firedPair = (name, between = () => {}) => {
      for (let attempt = 1; attempt <= RING_TRIES; attempt += 1) {
        const session = `${name}-${attempt}`;
        try {
          firedAs(session, 'Edit', { file_path: onDisk }, '--after');
          between();
          firedAs(session, 'Bash', { command: 'ls' }, '--after');
          const own = ownRingNames(ringLinesOnDisk(), session);
          if (own.length >= 2) return own.slice(-2).join(' then ');
        } finally {
          forget(session);
        }
      }
      return null; // Three tries and the ring kept fewer than two of them, which the caller says is unproven rather than wrong.
    };
    const landed = firedPair(SEVEN);
    if (landed === null) {
      fails.push(`the ring kept fewer than two of this run's own payloads on ${RING_TRIES} tries, so nothing here says whether an edit and a shell command reach it under a bucket each`);
    } else if (landed !== 'PostToolUse-edit then PostToolUse-shell') {
      fails.push(`an edit and a shell command reached the ring as ${landed} rather than under a bucket each, so twenty commands would push the edit payload out`);
    }

    // The collision made on purpose rather than waited for: another session's payload through the real entry point, between this run's two. Read the file's last two lines and the shell command answering is somebody else's, which is the red gate on a green tree this whole case exists to stop.
    const CROWD = `gate-sample-selftest-ring-other-${process.pid}`;
    const crowded = firedPair(`gate-sample-selftest-ring-crowded-${process.pid}`, () => {
      try {
        firedAs(CROWD, 'Bash', { command: 'ls' }, '--after');
      } finally {
        forget(CROWD);
      }
    });
    if (crowded === null) {
      fails.push(`the ring kept fewer than two of this run's own payloads on ${RING_TRIES} tries with a second session writing between them`);
    } else if (crowded !== 'PostToolUse-edit then PostToolUse-shell') {
      fails.push(`another session's payload landing between the two fires read back as ${crowded}, so the gate still goes red on a tree that is fine`);
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

  // The six bucket names, worked out from the tool alone. `-other` on each side is what a tool a widened row lets through and a payload nothing can parse both have to reach: folded into either of the others, this is the fault the split was made for.
  for (const [tool, want] of [['Write', 'edit'], ['Edit', 'edit'], ['MultiEdit', 'edit'], ['NotebookEdit', 'edit'], ['Bash', 'shell'], ['PowerShell', 'shell'], ['Read', 'other']]) {
    for (const hook of ['PostToolUse', 'PreToolUse']) {
      const got = bucketOf(hook, JSON.stringify({ tool_name: tool }));
      if (got !== `${hook}-${want}`) fails.push(`${tool} on ${hook} was filed under ${got} rather than ${hook}-${want}`);
    }
  }
  if (bucketOf('PostToolUse', '{ not a payload') !== 'PostToolUse-other') fails.push('a payload nothing can parse was not filed under -other, where the largest and most worth keeping of them belong');
  if (bucketOf('PreToolUse', JSON.stringify({})) !== 'PreToolUse-other') fails.push('a payload naming no tool was not filed under -other');

  // The ring read, over made-up lines. What it drops is the whole fix: another session's hook name, and a line caught part-way through somebody's rewrite. One of its own lines coming back has to read as one — a write the ring lost, which the case above fires again — rather than as a bucket named wrong, which it fails on.
  const ringLine = (session, hook) => JSON.stringify({ at: '', hook, session, env: '', raw: '' });
  const MINE = 'gate-sample-selftest-mine';
  const THEIRS = 'gate-sample-selftest-theirs';
  const mixed = [
    ringLine(THEIRS, 'Stop'),
    ringLine(MINE, 'PostToolUse-edit'),
    ringLine(THEIRS, 'PostToolUse-shell'),
    `{"hook":"PostToolUse-edit","session":"${MINE}"`,
    ringLine(MINE, 'PostToolUse-shell'),
  ];
  if (ownRingNames(mixed, MINE).join(' then ') !== 'PostToolUse-edit then PostToolUse-shell') {
    fails.push("the ring read did not step over another session's lines and a line stopping mid-payload to answer this run's own two in the order they were written");
  }
  if (ownRingNames(mixed, THEIRS).join(' then ') !== 'Stop then PostToolUse-shell') fails.push('the ring read did not answer a second session the lines that session wrote');
  if (ownRingNames([ringLine(MINE, 'PostToolUse-edit')], MINE).length !== 1) fails.push("one of this run's own lines coming back did not read as one, so a write the ring lost would fail as a bucket named wrong");
  if (ownRingNames(mixed, '').length) fails.push('the ring read with no session to match claimed lines it cannot have written');
  if (ownRingNames([], MINE).length) fails.push('an empty ring answered a line');

  // The row direction on settings files invented here, before the real one is opened. `rowed` is a pretend settings file: one `PostToolUse` row per matcher, each running this hook.
  const rowed = (...matchers) => JSON.stringify({
    hooks: { PostToolUse: matchers.map((matcher) => ({ matcher, hooks: [{ type: 'command', command: 'node scripts/gate-sample.mjs --after' }] })) },
  });
  if (unrowedTools(rowed('Write|Edit|NotebookEdit', 'Bash|PowerShell')).length) fails.push('this check fails a settings file whose rows already cover every tool it samples');
  if (unrowedTools(rowed('Write|Edit|NotebookEdit')).join(', ') !== 'Bash, PowerShell') fails.push('this check misses the shell rows going missing, which is the state this hook was widened out of');
  if (unrowedTools(rowed()).length !== SAMPLED_TOOLS.length) fails.push('this check passes a settings file with no PostToolUse row at all');
  if (unrowedTools(rowed('*(')).length !== SAMPLED_TOOLS.length) fails.push('this check read a matcher the host cannot parse as one that matches everything');
  if (unrowedTools(JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'node scripts/gate-git.mjs' }] }] } })).length !== SAMPLED_TOOLS.length) {
    fails.push('this check read a row running some other hook as one that samples');
  }
  if (unrowedTools('{').length !== SAMPLED_TOOLS.length) fails.push('this check read an unreadable settings file as one that runs every hook');

  // The rows themselves, against the real settings file. A tool this samples with nothing to run it is a rule that is quietly off, and the next build nobody held is what notices.
  try {
    for (const name of unrowedTools(readFileSync(join(root, '.agents', 'settings.json'), 'utf8'))) {
      fails.push(`${name} is sampled here and no PostToolUse row in .agents/settings.json matches it, so a build that reaches for it is held by nothing`);
    }
  } catch {
    fails.push('.agents/settings.json will not open, so nothing says which tools run this hook');
  }

  if (fails.length) {
    console.error('gate-sample: failed');
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('gate-sample: ok (every edit and every shell command of a build samples every phase of its ticket after the write, the plan tree included; a turn with no build in it samples nothing; every tool sampled has a settings row that runs this; and an edit and a shell command reach the payload ring under a bucket each, with anything unreadable under -other)');
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
  keep(bucketOf(after ? 'PostToolUse' : 'PreToolUse', raw), raw);
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // An unreadable payload samples nothing.
  }
  if (after && sampled(payload.tool_name)) {
    try {
      // How the ticket stands once the write has happened, so it is taken on the way out.
      sample(sessionOf(raw));
    } catch {
      // Never block: a hook that can wedge a session is worse than no hook.
    }
  }
  process.exit(0);
}
