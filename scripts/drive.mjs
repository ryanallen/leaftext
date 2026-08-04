#!/usr/bin/env node
// Behind `just drive`: point the gesture driver at the copy of the app that is already open.
//
//   node scripts/drive.mjs <out.png> <step> [<step> …]
//
// Here rather than as one line in the Justfile because the steps cannot survive that trip. `just` runs a recipe through cmd.exe, cmd hands the quotes around an argument straight through to PowerShell instead of stripping them, and PowerShell then splits the quoted list at its spaces — so `scroll:600,500,-10 click:900,700` arrived as a step called `"click:900,700` and a document called `scroll:900,700,-10"`. Spawning PowerShell from here passes each argument as one argument.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// cmd.exe hands the quotes around an argument through rather than stripping them, so a path quoted in the Justfile arrives wrapped in them — and every path with a quote in it is one Windows refuses.
const unquote = (text) => text.replace(/^"(.*)"$/, '$1');
const [out, ...steps] = process.argv.slice(2).map(unquote);

if (!out) {
  console.error('usage: node scripts/drive.mjs <out.png> <step> …   (steps: click:X,Y  scroll:X,Y,NOTCHES  drag:X1,Y1,X2,Y2  key:{ESC}  …)');
  process.exit(1);
}

const args = [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  join(root, 'scripts/capture-screenshot.ps1'),
  '-Attach',
  '-Out',
  out,
];
// One argument holding the whole list, split by the script: a `-Do` array would be re-split at the commas inside a step.
if (steps.length) args.push('-Steps', steps.join(' '));

const run = spawnSync('powershell', args, { stdio: 'inherit' });
if (run.error) {
  console.error(`could not run PowerShell: ${run.error.message}`);
  process.exit(1);
}
process.exit(run.status ?? 1);
