#!/usr/bin/env node
// The gesture driver is what proves a change in the window — a real click, a real drag, a real wheel notch. Nothing in the suite can run one, so this runs the half that needs no app: reading the `-Do` list back.
//
//   node scripts/check-driver.mjs   (`just verify`)
//
// `-DryRun` returns before the script loads an assembly, launches anything or reaches user32, so this is the one thing about the driver that a machine with no app built and no window open can check: that every verb parses, that an unknown one is refused, and that an attached run refuses the flags that would rewrite the owner's profile rather than ignoring them.
//
// It also reads the script itself for the half a dry run never reaches: that the throwaway profile is built from nothing on every run. That one is not a matter of taste — a profile carrying the last shot's vaults photographs them.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts/capture-screenshot.ps1');
const out = join(tmpdir(), 'leaftext-driver-check.bmp');

// One entry per verb the driver takes, with what a dry run says it would do. A verb with no row here is a verb nobody has read back.
const VERBS = [
  ['move:10,20', 'move to 10,20'],
  ['click:1,2', 'click at 1,2'],
  ['rclick:3,4', 'right-click at 3,4'],
  ['drag:1,2,3,4', 'drag from 1,2 to 3,4'],
  ['hold:1,2,3,4', 'and hold the button down'],
  ['scroll:5,6,-8', 'scroll -8 notches at 5,6'],
  ['type:hello', 'type hello'],
  ['key:{ESC}', 'press {ESC}'],
  ['wait:250', 'wait 250 ms'],
];

function shell() {
  for (const exe of ['pwsh', 'powershell']) {
    const found = spawnSync(exe, ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' });
    if (!found.error && found.status === 0) return exe;
  }
  return null;
}

const exe = shell();
if (!exe) {
  // A skip, said out loud. A silent pass here would read as "the driver is fine" on a machine that cannot run a line of it.
  console.log('driver: skipped — no PowerShell on this machine, so the -Do list was not read back');
  process.exit(0);
}

/** One dry run. Returns what it printed and whether it was refused. */
function dryRun(steps, extra = '') {
  const list = steps.map((step) => `'${step}'`).join(',');
  const command = `& '${script}' -DryRun -Out '${out}' ${extra} -Do @(${list})`;
  const run = spawnSync(exe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    encoding: 'utf8',
  });
  return { text: `${run.stdout ?? ''}${run.stderr ?? ''}`, ok: run.status === 0 };
}

/** A dry run down the route `just drive` really takes: one string, split by the script. */
function viaSteps(steps) {
  const run = spawnSync(
    exe,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-DryRun', '-Out', out, '-Steps', steps.join(' ')],
    { encoding: 'utf8' }
  );
  return { text: `${run.stdout ?? ''}${run.stderr ?? ''}`, ok: run.status === 0 };
}

const problems = [];

rmSync(out, { force: true });
const all = dryRun(VERBS.map(([step]) => step));
if (!all.ok) problems.push(`a dry run of every verb was refused:\n${all.text}`);
for (const [step, said] of VERBS) {
  if (!all.text.includes(said)) problems.push(`${step} did not read back as "${said}"`);
}
if (!all.text.includes(`${VERBS.length} steps`)) {
  problems.push(`a dry run of ${VERBS.length} steps did not say how many it had`);
}
// A coordinate is a pixel in the picture, and the picture is what the app draws — not the rectangle around it that includes the invisible resize border. Sizing the bitmap to the wrong one put a black strip on six published pictures and would move every step in every list already written.
if (!all.text.includes('not the invisible resize border')) {
  problems.push('a dry run does not say which rectangle it would photograph and offset steps by');
}
// The point of the mode: it stops before it does anything.
if (existsSync(out)) problems.push('a dry run wrote a file, so it did more than read the list');

// `just drive` hands the whole list over as one argument, because a step's own commas are what PowerShell would otherwise split it at. Two steps have to survive that.
const joined = viaSteps(['click:900,700', 'scroll:900,700,-10']);
if (!joined.ok) problems.push(`a -Steps list was refused:\n${joined.text}`);
if (!joined.text.includes('2 steps')) problems.push(`a two-step -Steps list came back as: ${joined.text.trim()}`);
if (!joined.text.includes('scroll -10 notches at 900,700')) {
  problems.push(`a step with commas in it did not survive -Steps: ${joined.text.trim()}`);
}

const unknown = dryRun(['wiggle:1,2']);
if (unknown.ok) problems.push('an unknown verb was accepted');
else if (!unknown.text.includes('unknown -Do step')) {
  problems.push(`an unknown verb was refused for some other reason:\n${unknown.text}`);
}

const short = dryRun(['scroll:1,2']);
if (short.ok) problems.push('scroll with two numbers instead of three was accepted');

// -Attach is the owner's own session, so a flag that would rewrite their settings is refused with the reason.
for (const flag of ['-ThemeFamily fern', '-Doc x.md', '-Unlocked', '-Width 800', '-Recents x.md']) {
  const refused = dryRun(['click:1,2'], `-Attach ${flag}`);
  if (refused.ok) problems.push(`-Attach accepted ${flag}, which shapes a throwaway profile it must not write`);
  else if (!refused.text.includes('cannot set')) {
    problems.push(`-Attach ${flag} was refused for some other reason:\n${refused.text}`);
  }
}
const attached = dryRun(['click:1,2'], '-Attach');
if (!attached.ok) problems.push(`a bare -Attach dry run was refused:\n${attached.text}`);
else if (!attached.text.includes('the running copy')) {
  problems.push('an attached dry run does not say it is driving the copy that is already open');
}

// Every file the shot profile is made of, written or removed on every unattached run. The recent list was already like this — the app appends to it as it opens files — and the vault registry has the same fault for the same reason: the app registers a cloud folder as a vault at every launch, so a database reused across a batch photographs whatever the earlier shots found.
const text = readFileSync(script, 'utf8');
const PROFILE = [
  ["settings.json", /Out-File -FilePath \(Join-Path \$config 'settings\.json'\)/],
  ['recent-files.json', /Out-File -FilePath \(Join-Path \$config 'recent-files\.json'\)/],
  ['manifest.db', /Remove-Item \$stale -Force/],
  ['a home folder with no cloud client under it', /\$env:USERPROFILE = \$shotHome/],
  ['the three OneDrive variables', /\$env:OneDriveCommercial = ''/],
];
for (const [what, pattern] of PROFILE) {
  if (!pattern.test(text)) problems.push(`the shot profile no longer starts every run with ${what}`);
}

if (problems.length) {
  console.error('the gesture driver does not read its own -Do list:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('scripts/capture-screenshot.ps1 is the only driver; -DryRun is the half that runs with no app.');
  process.exit(1);
}
console.log(
  `driver: ${VERBS.length} verbs read back, an unknown one refused, -Attach refuses every profile flag, and the shot profile starts empty in ${PROFILE.length} ways`
);
