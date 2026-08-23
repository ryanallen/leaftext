#!/usr/bin/env node
// Behind `just probe-copy` and `just probe-close`: launch a copy of the app beside the owner's and leave it up, then close it when the build is done with it.
//
//   node scripts/probe.mjs open [<document>] [--work <name>]
//   node scripts/probe.mjs close [--work <name>]
//
// Here rather than as one line in the Justfile for the reason scripts/drive.mjs is, written out there: spawning PowerShell from node passes each argument as one argument.
//
// Windows only, and it says so rather than launching something that cannot separate. The separation is `%USERNAME%`, which is what names the instance slot and the ask pipe there; the macOS socket is keyed on the home folder and that half is not designed yet.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forget, remember } from './probe-copy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// cmd.exe hands the quotes around an argument through rather than stripping them, so a path quoted in the Justfile arrives wrapped in them — and every path with a quote in it is one Windows refuses.
const unquote = (text) => text.replace(/^"(.*)"$/, '$1');
const argv = process.argv.slice(2).map(unquote);

const verb = argv.shift();
if (verb !== 'open' && verb !== 'close') {
  console.error('usage: node scripts/probe.mjs open [<document>] [--work <name>]   |   node scripts/probe.mjs close [--work <name>]');
  process.exit(1);
}

let work = 'default';
let doc = '';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--work') {
    work = argv[++i] ?? '';
    if (!work) {
      console.error('--work wants a name');
      process.exit(1);
    }
  } else if (!doc) {
    doc = argv[i];
  } else {
    console.error(`nothing here takes a second document: ${argv[i]}`);
    process.exit(1);
  }
}

if (process.platform !== 'win32') {
  console.error('a probe copy is Windows only so far: the ask socket on macOS is named after the home folder rather than the account, so a copy launched under a name of its own cannot be addressed there');
  process.exit(1);
}

const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/probe-launch.ps1'), '-Work', work];
if (verb === 'close') args.push('-Close');
else if (doc) args.push('-Doc', doc);

const run = spawnSync('powershell', args, { encoding: 'utf8' });
if (run.error) {
  console.error(`could not run PowerShell: ${run.error.message}`);
  process.exit(1);
}
if (run.stderr) process.stderr.write(run.stderr);
const said = run.stdout ?? '';
process.stdout.write(said);
if (run.status !== 0) process.exit(run.status ?? 1);

// The pointer is written as the copy comes up and removed as it goes, here because this is the one process that sees both halves. The launcher prints them; scripts/probe-copy.mjs owns the file.
if (verb === 'close') {
  forget();
} else {
  const read = (key) => (said.match(new RegExp(`^${key}=(.+)$`, 'm')) ?? [])[1]?.trim();
  const name = read('name');
  const pid = Number(read('pid'));
  if (!name || !Number.isInteger(pid)) {
    console.error('the launcher came back without a name and a process id, so nothing can be pointed at the copy it started');
    process.exit(1);
  }
  remember({ name, pid });
  console.log(`every ask now lands on this copy, until 'just probe-close'`);
}
