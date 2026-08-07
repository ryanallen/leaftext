#!/usr/bin/env node
// The release workflows have to find the app's binary in a tree that is now a workspace. `cargo metadata --no-deps` returns no resolve graph, so there is no root package to ask for, and the browser package sorts ahead of the app — picking the first workspace member found it, and v0.1.484's Mac job failed with "Release requires at least one Cargo binary target" having built both chips first.
//
//   node scripts/check-release-package.mjs   (`just verify`)
//
// Two halves, because either alone goes quiet: the tree really does have one package named `leaftext` carrying a `leaftext` binary, and the workflow really does pick it by name rather than by position.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const metadata = JSON.parse(
  execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
);
const packages = metadata.packages || [];
const app = packages.find((one) => one.name === 'leaftext');
if (!app) {
  problems.push('no package named leaftext — the workflows look it up by that name');
} else if (!app.targets.some((target) => target.kind.includes('bin') && target.name === 'leaftext')) {
  problems.push('the leaftext package has no binary target named leaftext');
}

// A workflow that takes the first member is the bug this file exists for, and it only bites when there is more than one package to be first.
const macos = readFileSync(join(root, '.github/workflows/release-distributions.yml'), 'utf8');
if (!macos.includes('item.get("name") == "leaftext"')) {
  problems.push('release-distributions.yml no longer picks the app package by name');
}
for (const guess of ['packages[0]', 'workspace_members']) {
  if (macos.includes(guess)) problems.push(`release-distributions.yml picks a package by position (${guess})`);
}

if (problems.length) {
  console.error('the release workflows cannot be trusted to find the app:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`release: ${packages.length} packages in the tree, and the workflows name the one that carries the app`);
