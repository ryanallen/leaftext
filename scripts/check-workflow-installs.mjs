#!/usr/bin/env node
// A workflow that caches `~/.cargo/bin` is handed the binary back on its next run, and `cargo install` refuses to overwrite one — "binary already exists in destination", exit 101, three steps in. That pairing took leaftext.com off the air and stopped the only build that compiles the browser crate for wasm32, so it is read here rather than found again on a release.
//
//   node scripts/check-workflow-installs.mjs   (`just verify`)
//
// It is the pairing that is the fault, never the install on its own: `release-windows.yml` and `validate-installer.yml` install `cargo-wix` exactly as bare and cache no binary directory, and they have never broken. Either half arriving later fails here — a path added to a cache, or an install added to a workflow that already caches one. A guard is anything that stops the refusal: a lookup before the install, a step condition, or `--force`, so the check does not pick the fix for whoever writes the next one.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, '.github/workflows');

// Where a compiled tool survives to the next run. A cache holding one of these makes every `cargo install` under it a refusal waiting to happen.
const BIN_DIRS = [/~\/\.cargo\/bin\b/, /\$HOME\/\.cargo\/bin\b/, /\/usr\/local\/bin\b/];

const problems = [];
let installs = 0;
const files = readdirSync(dir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));

for (const file of files) {
  const lines = readFileSync(join(dir, file), 'utf8').split('\n');
  const cached = lines.some((line) => {
    const bare = line.replace(/#.*$/, '');
    return BIN_DIRS.some((pattern) => pattern.test(bare));
  });

  for (const [index, line] of lines.entries()) {
    const bare = line.replace(/#.*$/, '');
    if (!/\bcargo\s+install\b/.test(bare)) continue;
    installs += 1;
    if (!cached) continue;
    // The install is safe when something stops it running twice: a lookup on the left of `||`, a condition on the step, or `--force`.
    const guarded =
      /--force\b/.test(bare) ||
      /\b(command\s+-v|which|hash|type)\s+\S+.*\|\|/.test(bare) ||
      /^\s*if\s/.test(bare) ||
      lines.slice(Math.max(0, index - 6), index).some((above) => /^\s*if:\s/.test(above.replace(/#.*$/, '')));
    if (guarded) continue;
    problems.push(
      `${file}:${index + 1} installs into a cached binary directory with nothing to stop it: ${bare.trim()}`
    );
  }
}

if (problems.length) {
  console.error('a workflow will be refused by its own cache:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('Guard the install — `command -v <name> || cargo install <name> --locked` — or stop caching the directory it writes to.');
  process.exit(1);
}
console.log(`workflows: ${files.length} read, ${installs} cargo installs, and none of them fights the cache above it`);
