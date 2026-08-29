#!/usr/bin/env node
// The three provers are what prove a change happened rather than was assumed — the gesture driver against a real window, `drive-web.mjs` against a published site in a headless browser, and `probe-motion.mjs` sampling where an element actually was on each frame. This checks the half of each that needs no app and no site.
//
//   node scripts/check-driver.mjs   (`just verify`)
//
// `-DryRun` returns before the gesture driver loads an assembly, launches anything or reaches user32, so this is the one thing about it that a machine with no app built and no window open can check: that every verb parses, that an unknown one is refused, and that an attached run refuses the flags that would rewrite the owner's profile rather than ignoring them.
//
// It also reads that script itself for the half a dry run never reaches: that the throwaway profile is built from nothing on every run. That one is not a matter of taste — a profile carrying the last shot's vaults photographs them. The profile is then entered for real against a throwaway work folder and its home folder read back, because a folder written under the wrong parent passes every read of the text and still leaves a save window opening on nothing.
//
// The motion probe needs a running copy, so what is read back here is its dry run: that it echoes the element, the trigger and the property it would watch, and that it refuses a run missing one of them rather than sampling something nobody named.
//
// The browser driver is checked by driving it, because what this is afraid of is the browser changing under it and a source read can never see that. A headless page hides itself a few seconds in, which stops every animation frame and so every bit of the front end's placing, while each step still says it worked; one focus call holds it awake. `about:blank` hides just the same, so the probe needs no site, no export and no server.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readProbeReply } from './probe-motion-output.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts/capture-screenshot.ps1');
// The throwaway profile both launchers run against, and the launcher that leaves its copy up. One file answers for both callers, which is what stops a probe writing into the owner's recent files while a shot stays clean.
const profile = join(root, 'scripts/probe-profile.ps1');
const launcher = join(root, 'scripts/probe-launch.ps1');
const launcherText = readFileSync(launcher, 'utf8');
// The one command behind both recipes, and the only thing that sees a launch and its pointer in the same process.
const wrapper = join(root, 'scripts/probe.mjs');
const webDriver = join(root, 'scripts/drive-web.mjs');
const motionProbe = join(root, 'scripts/probe-motion.mjs');
const out = join(tmpdir(), 'leaftext-driver-check.bmp');

// One entry per verb the driver takes, with what a dry run says it would do. A verb with no row here is a verb nobody has read back.
const VERBS = [
  ['move:10,20', 'move to 10,20'],
  ['click:1,2', 'click at 1,2'],
  ['rclick:3,4', 'right-click at 3,4'],
  ['drag:1,2,3,4', 'drag from 1,2 to 3,4'],
  // A hold is the verb for catching a gesture in flight, and which picture it gets is half of that: written the old way it settles first, which is a gesture that stopped moving nearly a second ago.
  ['hold:1,2,3,4', 'and hold the button down, photographed after the settle'],
  // The six-number form is what makes a gesture at the speed a hand makes it: a drag written without one walks twelve moves twenty-five milliseconds apart, which is about thirty a second.
  ['drag:1,2,3,4,250,8', 'drag from 1,2 to 3,4 in 250 moves 8 ms apart'],
  ['hold:1,2,3,4,250,8', 'drag from 1,2 to 3,4 in 250 moves 8 ms apart and hold the button down, photographed where the walk stops'],
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
//
// The same run lays the page out at two widths and reads each back: a `size:` step quietly ignored makes every reading taken through this driver a reading of the window it happened to open at. `about:blank` measures it as well as any page does — the question is whether the browser relaid out, not what it drew.
const probe = spawnSync(
  process.execPath,
  [webDriver, 'about:blank', 'size:1280,900', 'eval:innerWidth', 'size:2530,1400', 'eval:innerWidth', 'wait:8000', 'eval:document.visibilityState'],
  { encoding: 'utf8', timeout: 120000 }
);
const probeText = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
let webSaid = 'the browser driver laid one page out at two widths, refused a size that is not two numbers, and kept an empty page awake for eight seconds';
if (probeText.includes('no Edge or Chrome on this machine')) {
  // A skip, said out loud, for the same reason as the PowerShell one below.
  webSaid = 'the browser driver was not driven — no Edge or Chrome on this machine';
  console.log(`driver: skipped — ${webSaid}`);
} else if (probe.status !== 0 || !probeText.includes('the page stayed awake for every step')) {
  console.error('the browser driver no longer keeps its page awake, so every step it reports is a step that may not have happened:');
  console.error(`  ${probeText.trim() || probe.error?.message || 'it printed nothing'}`);
  process.exit(1);
}

if (!probeText.includes('no Edge or Chrome on this machine')) {
  if (!/^1280$/m.test(probeText) || !/^2530$/m.test(probeText)) {
    console.error('the browser driver no longer lays its page out at the size a `size:` step asks for, so a reading taken at a named width is really a reading of whatever width the window opened at:');
    console.error(`  ${probeText.trim() || 'it printed nothing'}`);
    process.exit(1);
  }
  // And it refuses a size it cannot read rather than carrying on at the last one, which would report a width nobody asked for as though it had been set.
  const refused = spawnSync(process.execPath, [webDriver, 'about:blank', 'size:wide'], { encoding: 'utf8', timeout: 120000 });
  if (refused.status === 0) {
    console.error('the browser driver accepted a size that is not two numbers, so a mistyped width would pass as a reading');
    process.exit(1);
  }
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

// The half of the motion probe that lives past its dry run: reading one wrapper result. The reply is on the output stream and the note saying which copy answered is on the error stream, and joining them makes unreadable text of every answer a copy `just probe-copy` launched, because a valid reply with an English sentence after it is not JSON. The reader the command really uses is imported rather than driven through the command, because the command needs a copy of the app up and this is the seam that does not.
const NOTE = "answered by the probe copy launched under leaftext-probe-default, not by the one running as someone — 'just probe-close' hands it back";
const READER = [
  [
    'hand back the app answer when a copy note sits beside a valid reply',
    () => {
      const said = readProbeReply('{"ok":true,"answer":{"threw":null}}', NOTE);
      return said.answer && said.answer.threw === null ? null : `it came back as ${JSON.stringify(said)}`;
    },
  ],
  [
    'keep that note to hand rather than swallowing it, so a run still says which window it is watching',
    () => {
      const said = readProbeReply('{"ok":true,"answer":42}', NOTE);
      return said.note === NOTE ? null : `the note came back as ${JSON.stringify(said.note)}`;
    },
  ],
  [
    'refuse output with nothing in it, and name the note in the refusal',
    () => {
      const said = readProbeReply('', NOTE);
      if (!said.unreadable) return `it took nothing as an answer: ${JSON.stringify(said)}`;
      return said.unreadable.includes(NOTE) ? null : `the refusal does not name the note: ${said.unreadable}`;
    },
  ],
  [
    'refuse output that is not a reply at all, and name the note in the refusal',
    () => {
      const said = readProbeReply('the pipe closed', NOTE);
      if (!said.unreadable) return `it read a sentence as a reply: ${JSON.stringify(said)}`;
      return said.unreadable.includes(NOTE) ? null : `the refusal does not name the note: ${said.unreadable}`;
    },
  ],
  [
    "leave an app refusal a refusal in the app's own words",
    () => {
      const said = readProbeReply('{"ok":false,"error":"nothing is listening on that pipe"}', NOTE);
      if (said.refusal !== 'nothing is listening on that pipe') return `the refusal came back as ${JSON.stringify(said)}`;
      return said.note === NOTE ? null : `the note came back as ${JSON.stringify(said.note)}`;
    },
  ],
];
for (const [what, read] of READER) {
  const wrong = read();
  if (wrong) problems.push(`the motion probe cannot ${what}: ${wrong}`);
}

const exe = shell();
if (!exe) {
  // A skip, said out loud. A silent pass here would read as "the driver is fine" on a machine that cannot run a line of it. The probe's own read-back still counts: it is node, so it ran.
  if (problems.length) stop();
  console.log('driver: skipped — no PowerShell on this machine, so the -Do list was not read back');
  process.exit(0);
}

// A cargo that always fails, ahead of the real one on PATH: the launcher's refusal to fall through to the last build is the whole point of building, and nothing else can prove it without breaking the tree.
//
// It prints the home it ran under before it fails: Rust keeps its toolchain and its crate cache under %USERPROFILE%, which the profile starves, so the read below is the only thing holding the build outside it.
const failedBuildName = `driver-check-${process.pid}`;
const failedBuildWork = join(tmpdir(), `leaftext-probe-${failedBuildName}`);
const fakeCargoHome = join(tmpdir(), `leaftext-fake-cargo-${process.pid}`);
rmSync(failedBuildWork, { recursive: true, force: true });
rmSync(fakeCargoHome, { recursive: true, force: true });
mkdirSync(fakeCargoHome, { recursive: true });
writeFileSync(join(fakeCargoHome, 'cargo.cmd'), '@echo leaf-build-home=%USERPROFILE%\r\n@echo fake cargo failed 1>&2\r\n@exit /b 23\r\n');
const failedBuild = spawnSync(
  exe,
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-Work', failedBuildName],
  { encoding: 'utf8', env: { ...process.env, PATH: `${fakeCargoHome};${process.env.PATH ?? ''}` } }
);
const failedBuildText = `${failedBuild.stdout ?? ''}${failedBuild.stderr ?? ''}`;
if (failedBuild.status === 0 || !failedBuildText.includes('cargo build failed with exit code 23')) {
  problems.push(`the probe launcher did not stop on a failed build:\n${failedBuildText}`);
}
if (existsSync(join(failedBuildWork, 'leaftext.exe'))) {
  problems.push('the probe launcher copied or launched an executable after Cargo failed');
}
// Where the build ran, read off what the build saw rather than off the order some lines of text sit in. There is no third answer: either the home is the machine's own, or it is the throwaway one under the work folder and the profile was entered first.
const buildHome = /^leaf-build-home=(.*)$/m.exec(failedBuildText)?.[1]?.trim();
if (!buildHome) {
  problems.push(`the probe launcher's build no longer says which home folder it ran under, so nothing holds it outside the starved profile:\n${failedBuildText}`);
} else if (buildHome.toLowerCase().startsWith(failedBuildWork.toLowerCase())) {
  problems.push(
    `the probe launcher builds inside the throwaway profile, whose home folder at ${buildHome} has never held Rust - the build asks it which toolchain to use and the launch never happens. Build before Enter-LeafProfile.`
  );
}
rmSync(failedBuildWork, { recursive: true, force: true });
rmSync(fakeCargoHome, { recursive: true, force: true });

const launcherRun = launcherText.slice(launcherText.indexOf('$builtExe = $null'));
function inOrder(lines) {
  let at = -1;
  return lines.every((line) => (at = launcherRun.indexOf(line, at + 1)) >= 0);
}
// The build is not named here: the read above already proves where it ran, and a text order that passes on a launcher that read refuses is the weaker check deciding when the tree turns red. These three print nothing a run could be read off.
if (!inOrder(['if (-not $Close -and (Test-LeafPipe $name))', 'Copy-Item -LiteralPath $builtExe', 'Start-LeafOffScreen $Exe'])) {
  problems.push('the probe open path is no longer same-name refusal, copy, launch');
}
if (!inOrder(['Send-LeafQuit', 'Wait-LeafPipe $name $false', 'Remove-Item -LiteralPath $privateExe'])) {
  problems.push('the probe close path is no longer quit, wait, remove');
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

// Which of the two routes each verb takes against a window standing on no monitor, read back from the same dry run: a pointer step is played into the page through the gesture ask, a key step is refused with eval named, and a wait runs where it is.
const OFF_ROUTE = {
  move: 'the gesture ask', click: 'the gesture ask', rclick: 'the gesture ask',
  drag: 'the gesture ask', hold: 'the gesture ask', scroll: 'the gesture ask',
  type: 'refused; eval does keys', key: 'refused; eval does keys', wait: null,
};
for (const [step, said] of VERBS) {
  const kind = step.split(':')[0];
  const line = all.text.split(/\r?\n/).find((printed) => printed.includes(said)) ?? '';
  const route = OFF_ROUTE[kind];
  if (route && !line.includes(`off screen: ${route === 'the gesture ask' ? 'played into the page through the gesture ask' : route}`)) {
    problems.push(`${step} does not say its route against a window on no monitor: ${line || 'no line printed'}`);
  }
  if (!route && line.includes('off screen')) {
    problems.push(`${step} claims an off-screen route and runs where it is: ${line}`);
  }
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

// A drag and a hold take four numbers or six and nothing between or beyond, and the refusal says both counts — a driver that quietly dropped a seventh number would walk at a speed nobody asked for and report the gesture as made.
for (const step of ['drag:1,2,3,4,250', 'drag:1,2,3,4,250,8,1', 'hold:1,2,3,4,250', 'hold:1,2,3,4,250,8,1']) {
  const refused = dryRun([step]);
  if (refused.ok) problems.push(`${step} was accepted, so a pointer verb takes a count nobody wrote it for`);
  else if (!refused.text.includes('takes 4 or 6 numbers')) {
    problems.push(`${step} was refused without naming both counts it takes:
${refused.text}`);
  }
}
// Not a faster hand: no gap is the walk at 125,000 moves a second, past anything a mouse reports, and no moves is the press and teleport the walk exists to avoid.
for (const step of ['drag:1,2,3,4,250,0', 'hold:1,2,3,4,250,0', 'drag:1,2,3,4,0,8']) {
  if (dryRun([step]).ok) problems.push(`${step} was accepted, so the walk would run faster than a gesture means anything`);
}
// A drag written the old way still walks the pacing every step list already in the tree was written against.
const plain = dryRun(['drag:1,2,3,4']);
if (!plain.ok) problems.push(`a four-number drag was refused:
${plain.text}`);
else if (plain.text.includes('moves') || plain.text.includes('ms apart')) {
  problems.push(`a drag written the old way read back as paced: ${plain.text.trim()}`);
}

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

/** A dry dismissal, down the road `just dismiss-box` really takes: one title, no -Out, no picture. */
function dryDismiss(title) {
  const run = spawnSync(
    exe,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-DryRun', '-DismissBox', title],
    { encoding: 'utf8' }
  );
  return { text: `${run.stdout ?? ''}${run.stderr ?? ''}`, ok: run.status === 0 };
}

// A title with spaces in it is the ordinary case — "Location is not available" is the box that was watched — and a title that arrives split is a dismissal that cancels nothing while reading as the box having moved. No -Out either: a dismissal takes no picture, so demanding somewhere to write one would be a file nobody wants.
const dismissal = dryDismiss('Location is not available');
if (!dismissal.ok) problems.push(`a dry dismissal was refused:\n${dismissal.text}`);
else {
  if (!dismissal.text.includes('cancel the box titled "Location is not available"')) {
    problems.push(`a dry dismissal did not read its title back whole:\n${dismissal.text}`);
  }
  if (!dismissal.text.includes('Escape rather than a default button')) {
    problems.push('a dry dismissal does not say it presses Escape rather than a default button');
  }
}
const unnamed = dryDismiss('');
if (unnamed.ok) problems.push('a dismissal naming no box was not refused, so it fell through to something else');
const both = spawnSync(
  exe,
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-DryRun', '-DismissBox', 'A box', '-Steps', 'click:1,2'],
  { encoding: 'utf8' }
);
if (both.status === 0) problems.push('a dismissal took a step list as well, so a run could cancel a box and then drive past what raised it');

// Every file the shot profile is made of, written or removed on every unattached run. The recent list was already like this — the app appends to it as it opens files — and the vault registry has the same fault for the same reason: the app registers a cloud folder as a vault at every launch, so a database reused across a batch photographs whatever the earlier shots found.
const text = readFileSync(script, 'utf8');
const profileText = readFileSync(profile, 'utf8');
const wrapperText = readFileSync(wrapper, 'utf8');
const driveText = readFileSync(join(root, 'scripts/drive.mjs'), 'utf8');
const PROFILE = [
  ["settings.json", /Out-File -FilePath \(Join-Path \$config 'settings\.json'\)/],
  ['recent-files.json', /Out-File -FilePath \(Join-Path \$config 'recent-files\.json'\)/],
  ['manifest.db', /Remove-Item \$stale -Force/],
];
for (const [what, pattern] of PROFILE) {
  if (!pattern.test(text)) problems.push(`the shot profile no longer starts every run with ${what}`);
}

// The separation itself, in the one file both launchers dot-source. Two copies of this block drift, and the drift shows up as a probe writing into the owner's recent files while a shot stays clean.
const SHARED = [
  ['a config root under the work folder', /\$env:APPDATA = \$appdata/],
  ['a data root under the work folder', /\$env:LOCALAPPDATA = \$local/],
  ['a home folder with no cloud client under it', /\$env:USERPROFILE = \$emptyHome/],
  ['the three OneDrive variables', /\$env:OneDriveCommercial = ''/],
  ['an account name of its own', /\$env:USERNAME = \$Name/],
  ['every one of them saved before it is written over', /GetEnvironmentVariable\(\$varName\)/],
  ['every one of them put back when the caller is done', /SetEnvironmentVariable\(\$varName, \$before\[\$varName\]\)/],
];
for (const [what, pattern] of SHARED) {
  if (!pattern.test(profileText)) problems.push(`the shared throwaway profile no longer gives a copy ${what}`);
}
// Both callers reading it rather than carrying their own copy, which is the whole of what moving the block bought.
for (const [who, caller] of [['the documentation shot', text], ['the probe launcher', launcherText]]) {
  if (!/\. \(Join-Path \$PSScriptRoot 'probe-profile\.ps1'\)/.test(caller)) {
    problems.push(`${who} no longer runs against the shared throwaway profile, so the two can drift apart`);
  }
}

// The one thing reading the script's text can never answer: a `New-Item` written under the wrong parent is still a `New-Item`, and the save window still opens on nothing. So the profile is dot-sourced in a shell of its own, entered against a throwaway work folder, and the folders under the home folder it reports are read back. Windows starts a save window on %USERPROFILE%\Desktop and puts a "Location is not available" error over it when that folder is missing, so a copy cannot save an export through its own button. It stays empty on purpose: src/known_folders.rs makes a vault of every cloud folder it finds under the home folder, and the starving is what a probe copy is launched for.
const profileWork = join(tmpdir(), `leaftext-profile-check-${process.pid}`);
const profileName = basename(profileWork);
rmSync(profileWork, { recursive: true, force: true });
const entered = spawnSync(
  exe,
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    [
      `. '${profile}'`,
      `$p = Enter-LeafProfile -Work '${profileWork}' -Name '${profileName}'`,
      "Write-Output ('home=' + $p.Home)",
      "Write-Output ('userprofile=' + $env:USERPROFILE)",
      "Write-Output ('under=' + ((Get-ChildItem $p.Home -Force | Select-Object -ExpandProperty Name) -join ','))",
      "$desktop = Join-Path $p.Home 'Desktop'",
      "Write-Output ('desktop=' + (Test-Path $desktop))",
      // Guarded, or a missing Desktop throws out of the shell and the run reads as a profile that could not be entered rather than one with nothing to open on.
      "Write-Output ('empty=' + $(if (Test-Path $desktop) { @(Get-ChildItem $desktop -Force).Count -eq 0 } else { 'no folder' }))",
      'Exit-LeafProfile $p.Before',
    ].join('; '),
  ],
  { encoding: 'utf8' }
);
const enteredText = `${entered.stdout ?? ''}${entered.stderr ?? ''}`;
rmSync(profileWork, { recursive: true, force: true });
if (entered.status !== 0) {
  problems.push(`the shared throwaway profile could not be entered at all:\n${enteredText}`);
} else {
  const said = new Map(
    enteredText
      .split(/\r?\n/)
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()])
  );
  const home = join(profileWork, 'home');
  const under = (said.get('under') ?? '').split(',').filter(Boolean);
  if (said.get('home') !== home) problems.push(`the throwaway profile's home folder is ${said.get('home')} rather than ${home}`);
  if (said.get('userprofile') !== home) problems.push(`a copy launched against the throwaway profile has %USERPROFILE% at ${said.get('userprofile')} rather than its own home folder, so its save window opens somewhere nobody chose`);
  if (said.get('desktop') !== 'True' || !under.includes('Desktop')) {
    problems.push(`a fresh throwaway profile has no Desktop under its home folder, so every save window a copy opens comes up on a folder that is not there — it holds ${under.join(', ') || 'nothing'}`);
  } else if (said.get('empty') !== 'True') {
    problems.push('the throwaway profile seeds files into its Desktop, and anything a copy finds under its home folder it can register as a vault');
  }
}

// A documentation shot has to leave the copy the owner is reading alone, which is what the account name above buys: the app names its instance slot and its ask pipe after %USERNAME%, so a copy launched under a name nobody else uses opens its own window and hears its own quit. The sweep staying away matters as much as the quit going out, so the refusal below is read for as well as the four shutdown steps.
const SAFE_SHUTDOWN = [
  ['closes its own copy by asking rather than stopping it', /--ask '\{\\"ask\\":\\"quit\\"\}'/],
  ['waits for that copy to go before it says anything', /\$proc\.WaitForExit\(/],
  ['closes the warm copy the vault registry needs the same way', /Stop-ShotCopy \$warm/],
  ['puts the account name and the profile roots back when the run ends', /Exit-LeafProfile \$shotEnvBefore/],
];
for (const [what, pattern] of SAFE_SHUTDOWN) {
  if (!pattern.test(text)) problems.push(`the documentation shot no longer ${what}`);
}
// Any of them, at any depth: `Get-Process leaftext | Stop-Process` takes the owner's window down with the shot copy, and `Stop-Process -Id` on a copy of the app throws its window place away instead of saving it. -Attach has no copy of its own to stop.
for (const [who, caller] of [['the documentation shot', text], ['the probe launcher', launcherText], ['the shared profile', profileText]]) {
  if (/Stop-Process/.test(caller)) {
    problems.push(`${who} can stop a process again, and it cannot tell the owner's copy from its own`);
  }
}

// The launcher's own half: a copy still up when the command that started it has returned, addressable by a second command, and closed by asking.
const LAUNCHER = [
  ['leave its copy running when it returns', /CloseHandle\(\$pi\.hProcess\)/],
  // The whole of why a build launches a copy of its own is that the owner keeps working, and a window landing in front of them is the one thing that undoes it. Start-Process cannot carry a place, and the app's own window builder throws away a position matching no monitor — so the place rides on the process.
  ['start that copy off every monitor rather than over what the owner is reading', /STARTF_USEPOSITION/],
  ['compute the place against the virtual screen rather than write one down, so a monitor added to the left cannot bring the copy back into view', /SystemInformation\]::VirtualScreen/],
  ['hand the app nothing but the document, so the place travels with the process instead of an argument an ordinary copy could carry', /\$line = if \(\$doc\)/],
  ['name that copy off its work folder, so a close run later can address it', /Get-LeafProfileName \$workDir/],
  ['close it by asking down its own pipe', /--ask '\{\\"ask\\":\\"quit\\"\}'/],
  ['wait for that pipe to go away rather than for a process', /Wait-LeafPipe \$name \$false/],
  ['keep the work folder rather than empty it, so a saved window size comes back', /A work folder is kept rather than emptied/],
];
// What the one command behind `just probe-copy` and `just probe-close` owes on either path. The pointer is written only after the launch has come back clean and removed only when the close has: a pointer written past a failure sends every later ask at a copy that is not there, which is the false answer the whole thing exists to remove.
const WRAPPER = [
  ['refuse a platform where a copy cannot be addressed at all', /process\.platform !== 'win32'/],
  ['write the pointer only after a launch that came back clean', /remember\(\{ name, pid \}\)/],
  ['remove it when the copy goes', /forget\(\)/],
  ['stop before either of those on a launcher that failed', /if \(run\.status !== 0\) process\.exit/],
];
for (const [what, pattern] of WRAPPER) {
  if (!pattern.test(wrapperText)) problems.push(`the probe command no longer knows how to ${what}`);
}

for (const [what, pattern] of LAUNCHER) {
  if (!pattern.test(launcherText)) problems.push(`the probe launcher no longer knows how to ${what}`);
}

// The photograph's own half of the same promise. A copy off every monitor is drawn with PrintWindow, which needs neither focus nor a place on screen — so pulling it forward first would hand the keyboard back to a window the owner cannot see, at the one moment a build most wants a picture. A window on a monitor is pulled forward and driven through the mouse exactly as it was; one nobody can see takes its pointer steps through the app's own gesture ask instead, because a point off every screen is clamped onto the desktop and the gesture would land on whatever the owner has there.
const OFF_SCREEN_SHOT = [
  ['ask whether the window it is about to drive stands on any monitor', /function Test-OffEveryMonitor/],
  ['skip pulling such a window forward rather than taking the keyboard off what the owner is reading', /if \(Test-OffEveryMonitor \$hwnd\) \{[\s\S]*?Write-Output[\s\S]*?return/],
  ['still pull a window on a monitor forward, so a documentation shot is unchanged', /return\s+\}\s+\[void\]\[LeafShot\]::SetForegroundWindow\(\$hwnd\)/],
  ['play a pointer step against such a window into the page through the gesture ask rather than clamping it onto the desktop', /\$offScreen -and \$step\.Kind -ne 'wait'\) \{ Step-PointerAsk/],
  ['drive a window on a monitor through the mouse exactly as before', /else \{ Step-Pointer \$step \(\$vis\.Left \+ \$app\.X\) \(\$vis\.Top \+ \$app\.Y\) \}/],
  ['read the gesture reply back, so a refused one fails the run rather than reporting a step nobody made', /if \(-not \$said\.ok\) \{ throw "the gesture ask was refused/],
  ['refuse a key step against such a window with the way through named, so it is not a dead end', /needs the keyboard[\s\S]*?just ask eval/],
  ['release a button the ask route left down, so a failed run cannot leave the page mid-drag', /if \(\$heldAsk\) \{ try \{ Send-GestureAsk/],
];
for (const [what, pattern] of OFF_SCREEN_SHOT) {
  if (!pattern.test(text)) problems.push(`the photograph no longer knows how to ${what}`);
}

// A step list that finishes a save window closes the window it was driving, which is the one run a live probe here cannot make: it needs a real window and a real dialog. So the two halves are read instead, the way the browser driver's hidden-page branch is. Capture-Window returns the picture, so a word on its own pipeline joins the return and the caller binds an array where a bitmap was expected — which is how a run that had already written a 4,259,190-byte PDF ended by naming a type it could not convert.
const capture = text.slice(text.indexOf('function Capture-Window'));
const captureBody = capture.slice(0, capture.indexOf('\nfunction ', 1));
// The comment beside the fix names the call it exists to keep out, so the reading is of the code alone.
const captureCode = captureBody.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
if (/Write-Output/.test(captureCode)) {
  problems.push('the photograph writes a word onto its own return value, so the caller binds an array where the picture should be');
}
// The one state the foreground reading cannot see. A dialog's owner takes the foreground while the dialog keeps the keyboard, so GetForegroundWindow, GetLastActivePopup and GetGUIThreadInfo all answer the owner — every reading the driver can take says the driven window is in front, every key goes into the box, and the run reports the steps as made. Read rather than driven, because it needs a real window with a real modal box over it.
const BOX_OVER = [
  ['ask whether a box stands over the window it is about to drive', /function Find-BoxOver/],
  ['walk the windows for a visible one this process owns from the driven window', /public static IntPtr BoxWindowOver\(IntPtr owner, int processId\)/],
  ['refuse a key, type or scroll step while such a box is up', /if \(\$needsFocus\.Count -and \$box\) \{/],
  ['name the box in the refusal, so the reader knows what to deal with', /A box titled `"\$box`" stands over the window being driven/],
  ['ask before the foreground reading, which passes on this state', /\$box = Find-BoxOver \$hwnd \$running\.Id[\s\S]*?GetForegroundWindow\(\) -ne \$hwnd/],
];
for (const [what, pattern] of BOX_OVER) {
  if (!pattern.test(text)) problems.push(`an attached run no longer ${what}`);
}

// The way out of that refusal, which without one is a wall: the box has the keyboard, every key step is refused, and the reader is left writing a throwaway script to find and cancel it. Read rather than driven for the same reason the refusal is — it needs a real window with a real modal box over it — and every reading here is about sending Escape at exactly the box that was named rather than at whatever else happens to be up.
const DISMISS = [
  ['name the command that cancels it in the refusal, rather than saying only that it is there', /just dismiss-box `"\$box`"/],
  ['take the handle of the box beside its title, so there is something to bring forward and something to watch go away', /function Find-BoxWindow/],
  ['refuse when no box is there at all, rather than sending a key into the app', /nothing to cancel/],
  ['refuse a box wearing a title that is not the one that was named', /if \(\$box\.Title -ne \$DismissBox\)/],
  ['refuse rather than press when Windows will not bring that box forward', /would not bring the box titled `"\$DismissBox`" forward/],
  ['send Escape and nothing else, so it can never accept the warning it meant to back out of', /SendKeys\]::SendWait\('\{ESC\}'\)/],
  ['say it worked only once that same box has gone', /Escape went to the box titled `"\$DismissBox`" and it is still there/],
  ['refuse a dismissal that names no box, so it cannot fall through into a photograph', /a dismissal needs the exact title of the box to cancel/],
];
for (const [what, pattern] of DISMISS) {
  if (!pattern.test(text)) problems.push(`the driver no longer knows how to ${what}`);
}
// Every word of the title has to arrive as one title. `just` interpolates without quotes and cmd hands each word on separately, so a title joined back the wrong way cancels nothing and reads as the box having moved.
if (!/rest\.join\(' '\)/.test(driveText)) {
  problems.push('the drive command no longer carries every word of a multiword box title through as one title');
}

const CLOSED_WINDOW = [
  ['ask whether the window it drove is still there before photographing it', /IsWindow\(\$hwnd\)/],
  ['say a window that has gone in its own words rather than photographing a handle nobody holds', /closed while the steps ran/],
  ['have that reading at all', /public static extern bool IsWindow/],
];
for (const [what, pattern] of CLOSED_WINDOW) {
  if (!pattern.test(text)) problems.push(`a driven save no longer ${what}`);
}

// Only a copy the launcher started is off screen. The documentation shot's copy is photographed as a window on a monitor, and a copy the owner opens carries no startup place at all — which is what keeps the app's no-keyboard rule from ever firing on one of theirs.
if (/STARTF_USEPOSITION/.test(text)) {
  problems.push('the documentation shot starts its copy off screen, and a published picture is a picture of a window on a monitor');
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
  `driver: ${VERBS.length} verbs read back, an unknown one refused, -Attach refuses every profile flag and picks the copy built from this checkout, the shot profile starts empty in ${PROFILE.length} ways, one shared throwaway profile separates a copy in ${SHARED.length} ways for both launchers and was entered for real to read back a home folder with an empty Desktop under it, a documentation shot runs under a name of its own and closes only that copy by asking, the probe launcher leaves its copy up and addressable in ${LAUNCHER.length} ways, closes it by asking too, and was run against a cargo that fails to read back that it built outside the starved profile, under ${buildHome}, the photograph leaves a window nobody can see where it stands and drives it through the page's own gesture ask in ${OFF_SCREEN_SHOT.length} ways with every verb's route read back, puts no word onto its own return and says a driven window that closed in ${CLOSED_WINDOW.length} ways, refuses a key step under a box standing over that window in ${BOX_OVER.length} ways and cancels exactly that box by its whole title in ${DISMISS.length} ways, the one command behind both recipes keeps its pointer honest in ${WRAPPER.length} ways, the motion probe reads its element, trigger and property back and refuses a run missing one, keeps the app's reply and the note naming which copy answered apart in ${READER.length} ways, and ${webSaid}`
);
