#!/usr/bin/env node
// The three provers are what prove a change happened rather than was assumed — the gesture driver against a real window, `drive-web.mjs` against a published site in a headless browser, and `probe-motion.mjs` sampling where an element actually was on each frame. This checks the half of each that needs no app and no site.
//
//   node scripts/check-driver.mjs   (`just verify`)
//
// `-DryRun` returns before the gesture driver loads an assembly, launches anything or reaches user32, so this is the one thing about it that a machine with no app built and no window open can check: that every verb parses, that an unknown one is refused, and that an attached run refuses the flags that would rewrite the owner's profile rather than ignoring them.
//
// It also reads that script itself for the half a dry run never reaches: that the throwaway profile is built from nothing on every run. That one is not a matter of taste — a profile carrying the last shot's vaults photographs them.
//
// The motion probe needs a running copy, so what is read back here is its dry run: that it echoes the element, the trigger and the property it would watch, and that it refuses a run missing one of them rather than sampling something nobody named.
//
// The browser driver is checked by driving it, because what this is afraid of is the browser changing under it and a source read can never see that. A headless page hides itself a few seconds in, which stops every animation frame and so every bit of the front end's placing, while each step still says it worked; one focus call holds it awake. `about:blank` hides just the same, so the probe needs no site, no export and no server.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts/capture-screenshot.ps1');
const webDriver = join(root, 'scripts/drive-web.mjs');
const motionProbe = join(root, 'scripts/probe-motion.mjs');
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

// A real driven run of the browser driver: eight seconds on an empty page, which is past where one without the focus call goes hidden. A grep for that call would prove only that the string is in the file, which is the one thing nobody doubts.
const probe = spawnSync(
  process.execPath,
  [webDriver, 'about:blank', 'wait:8000', 'eval:document.visibilityState'],
  { encoding: 'utf8', timeout: 120000 }
);
const probeText = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
let webSaid = 'the browser driver kept an empty page awake for eight seconds';
if (probeText.includes('no Edge or Chrome on this machine')) {
  // A skip, said out loud, for the same reason as the PowerShell one below.
  webSaid = 'the browser driver was not driven — no Edge or Chrome on this machine';
  console.log(`driver: skipped — ${webSaid}`);
} else if (probe.status !== 0 || !probeText.includes('the page stayed awake for every step')) {
  console.error('the browser driver no longer keeps its page awake, so every step it reports is a step that may not have happened:');
  console.error(`  ${probeText.trim() || probe.error?.message || 'it printed nothing'}`);
  process.exit(1);
}

// The branch that fails a run on a hidden page cannot be reached by a live probe without a back door in the shipped driver, so it is read instead.
const webText = readFileSync(webDriver, 'utf8');
if (!/document\.visibilityState/.test(webText) || !/no frame ran/.test(webText)) {
  console.error('the browser driver no longer fails a run whose page went hidden, so a frozen one would pass in silence');
  process.exit(1);
}

const problems = [];

/** Say what was wrong and stop. Reached from two places: a machine with no PowerShell still runs the probe's half. */
function stop() {
  console.error('a prover does not read its own arguments back:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('scripts/capture-screenshot.ps1 drives the window and scripts/probe-motion.mjs samples where it moved; a dry run of either is the half that needs no app.');
  process.exit(1);
}

/** One dry run of the motion probe: it reads its arguments back and stops before the pipe. */
function dryProbe(args) {
  const run = spawnSync(process.execPath, [motionProbe, '--dry-run', ...args], { encoding: 'utf8' });
  return { text: `${run.stdout ?? ''}${run.stderr ?? ''}`, ok: run.status === 0 };
}

// A trigger is a line of JavaScript with spaces in it, and `just` hands it over already split at them — so what the probe watches has to survive being handed a selector and four separate words.
const probed = dryProbe(['.lt-bottom-sheet', 'window.leafOpenSheet(', '1', ')', '--property', 'opacity']);
if (!probed.ok) problems.push(`a dry run of the motion probe was refused:\n${probed.text}`);
for (const said of ['watching opacity on .lt-bottom-sheet', 'trigger window.leafOpenSheet( 1 )']) {
  if (!probed.text.includes(said)) problems.push(`the motion probe did not read back "${said}":\n${probed.text}`);
}
// Sampling a property nobody named would watch `transform` on whatever the selector caught and call the answer a proof.
for (const [what, args] of [
  ['no element to watch', []],
  ['no trigger', ['.lt-bottom-sheet']],
  ['a property given as nothing', ['.lt-bottom-sheet', 'go()', '--property', '']],
  ['a sampling window that is not a number', ['.lt-bottom-sheet', 'go()', '--for', 'soon']],
]) {
  if (dryProbe(args).ok) problems.push(`the motion probe accepted a run with ${what}`);
}

const exe = shell();
if (!exe) {
  // A skip, said out loud. A silent pass here would read as "the driver is fine" on a machine that cannot run a line of it. The probe's own read-back still counts: it is node, so it ran.
  if (problems.length) stop();
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
for (const flag of ['-ThemeFamily fern', '-Doc x.md', '-Unlocked', '-Width 800', '-Recents x.md', '-Favorites x.md']) {
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

// Two development copies can be open at once, each built under its own checkout, so -Attach has to pick the one belonging to the checkout it was run from rather than refuse because it found two windows. With no copy from this checkout running it still takes whatever is up, which is the installed copy the owner reads.
const ATTACH = [
  ['prefer the copy built from this checkout', /\$ours = @\(\$copies \| Where-Object \{ \$_\.Path -and \$_\.Path\.StartsWith\(\$root/],
  ['refuse two copies from this checkout rather than guess', /built from this checkout are running with a window/],
  ['still refuse two it cannot tell apart', /none was built from this checkout/],
];
for (const [what, pattern] of ATTACH) {
  if (!pattern.test(text)) problems.push(`-Attach no longer knows how to ${what}`);
}

if (problems.length) stop();
console.log(
  `driver: ${VERBS.length} verbs read back, an unknown one refused, -Attach refuses every profile flag and picks the copy built from this checkout, the shot profile starts empty in ${PROFILE.length} ways, the motion probe reads its element, trigger and property back and refuses a run missing one, and ${webSaid}`
);
