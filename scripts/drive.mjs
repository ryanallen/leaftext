#!/usr/bin/env node
// Behind `just drive` and `just dismiss-box`: point the gesture driver at the copy of the app that is already open.
//
//   node scripts/drive.mjs <out.png> <step> [<step> …]
//   node scripts/drive.mjs --dismiss <title words…>
//
// Here rather than as one line in the Justfile because neither the steps nor a multiword title can survive that trip. `just` runs a recipe through cmd.exe, cmd hands the quotes around an argument straight through to PowerShell instead of stripping them, and PowerShell then splits the quoted list at its spaces — so `scroll:600,500,-10 click:900,700` arrived as a step called `"click:900,700` and a document called `scroll:900,700,-10"`. Spawning PowerShell from here passes each argument as one argument.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeCopy } from './probe-copy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// cmd.exe hands the quotes around an argument through rather than stripping them, so a path quoted in the Justfile arrives wrapped in them — and every path with a quote in it is one Windows refuses.
const unquote = (text) => text.replace(/^"(.*)"$/, '$1');
const [first, ...rest] = process.argv.slice(2).map(unquote);

const script = join(root, 'scripts/capture-screenshot.ps1');
const shell = (args) => {
  const run = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
    stdio: 'inherit',
  });
  if (run.error) {
    console.error(`could not run PowerShell: ${run.error.message}`);
    process.exit(1);
  }
  process.exit(run.status ?? 1);
};

// Which copy this build launched, asked here because this is the only attached caller in the tree. Picking the photograph by process path while every gesture goes down the copy's own pipe plays the steps into one window and photographs the other, whenever a copy built from this checkout is up beside a probe. Reading the pointer here rather than in the PowerShell keeps its single reader, which is the whole reason it can be trusted, and leaves a hand-run `-Attach` answering exactly as it does today.
const copy = probeCopy();
const probe = copy ? ['-ProbePid', String(copy.pid)] : [];

// The way past a box standing over the driven window, named in the driver's own refusal. A title arrives as separate words — the Justfile interpolates it without quotes and cmd hands each word on — so it is joined back into the one exact title the box wears, and an empty one goes down to the driver to be refused there rather than being refused twice in two wordings.
if (first === '--dismiss') {
  shell(['-DismissBox', rest.join(' '), ...probe]);
}

const [out, steps] = [first, rest];

if (!out) {
  console.error('usage: node scripts/drive.mjs <out.png> <step> …   (steps: click:X,Y  scroll:X,Y,NOTCHES  drag:X1,Y1,X2,Y2  drag:X1,Y1,X2,Y2,MOVES,GAP for a gesture at the speed you name  key:{ESC}  …)');
  console.error('       node scripts/drive.mjs --dismiss <title>   (cancel one box standing over the driven window)');
  process.exit(1);
}

const args = ['-Attach', '-Out', out, ...probe];
// One argument holding the whole list, split by the script: a `-Do` array would be re-split at the commas inside a step.
if (steps.length) args.push('-Steps', steps.join(' '));
shell(args);
