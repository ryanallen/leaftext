#!/usr/bin/env node
// A validate workflow exists to fail without costing anything: it runs beside the releases, reports, and must never be able to publish or delete one. That safety was each file's own promise — `validate-web-modules.yml` is read-only because its author wrote `contents: read`, held by nobody — until the Mac check joined them and the rule got a reader. This holds every `validate-*` workflow to it, so the next one inherits the rule instead of relying on whoever writes it.
//
//   node scripts/check-workflow-permissions.mjs   (`just verify`)
//
// Two halves, because either alone leaves a door open: the permissions block grants reads only (a missing block is a refusal too, since the default token can write), and no step runs a release-writing command — `gh release` is how the release workflows publish, upload and delete, and a validate workflow has no business saying it.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, '.github/workflows');

const problems = [];
const files = readdirSync(dir)
  .filter((name) => name.startsWith('validate-'))
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));

for (const file of files) {
  const lines = readFileSync(join(dir, file), 'utf8').split('\n');

  // The top-level permissions block: the unindented `permissions:` line and the indented grants under it.
  const start = lines.findIndex((line) => /^permissions:\s*(#.*)?$/.test(line));
  if (start === -1) {
    problems.push(`${file} declares no permissions, so it runs with the default token — write it read-only: \`permissions:\` then \`contents: read\``);
  } else {
    const grants = [];
    for (const line of lines.slice(start + 1)) {
      const bare = line.replace(/#.*$/, '');
      if (!bare.trim()) continue;
      if (!/^\s/.test(bare)) break;
      grants.push(bare.trim());
    }
    if (!grants.includes('contents: read')) {
      problems.push(`${file} does not grant \`contents: read\` — the one permission a validate workflow needs, to check the tree out`);
    }
    for (const grant of grants) {
      if (/:\s*write\b/.test(grant)) {
        problems.push(`${file} grants a write — \`${grant}\` — and a validate workflow must only ever report`);
      }
    }
  }

  for (const [index, line] of lines.entries()) {
    const bare = line.replace(/#.*$/, '');
    if (/\bgh\s+release\b/.test(bare)) {
      problems.push(`${file}:${index + 1} runs a release command: ${bare.trim()}`);
    }
  }
}

if (problems.length) {
  console.error('a validate workflow could touch a release:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('A validate workflow reports and nothing else: `permissions:` granting only reads, and no `gh release` anywhere in it.');
  process.exit(1);
}
console.log(`workflows: ${files.length} validate workflows read, every one read-only with no release command in it`);
