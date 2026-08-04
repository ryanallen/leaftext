#!/usr/bin/env node
// Every Markdown file here and in the plan folder next door has a role — something `/sync-docs` knows how to keep true. A file matching none is one nobody looks at again, which is how a whole folder of plans went unswept.
//
//   node scripts/check-docs.mjs            fail on a file with no role
//   node scripts/check-docs.mjs --list     every file and its role
//
// Roles are folder patterns, so a new page needs no edit here and a new *top* folder does: a new kind of document is a decision about who keeps it true. A subject folder inside one (`features/editing/`) inherits its parent's role by prefix.

import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plans = join(root, '..', 'docs');

// Each row: where the files are, and what keeps them true. Order matters — the first match wins, so a specific folder goes above the folder holding it.
const ROLES = [
  ['docs/01-features', 'published: what a reader sees'],
  ['docs/02-development', 'published: how it is built'],
  ['docs', 'published: the entry pages and the glossary'],
  ['design', 'source of a token, an icon or a component — generated from, never by hand'],
  ['themes', "source of a color's value"],
  ['.agents/skills', 'a repeatable job'],
  ['src/assets', 'a third-party license notice shipped in the app'],
  ['wix', 'installer text'],
  ['.', 'the repo root: the guide, the readme, and their symlinks'],
];

const PLAN_ROLES = [
  ['features', 'plan: the app cannot do it yet'],
  ['refactor', 'plan: it does it, this changes how'],
  ['fixes', 'plan: something is wrong and this is the fix'],
  ['done', 'shipped, kept for the reasoning (with the retired running-order rows)'],
  ['canceled', 'decided against, kept for the reasoning'],
  ['tests', 'a document to open in the app, not a plan'],
  ['learn', "writing from elsewhere, kept to read — not about this app, so nothing here can go stale"],
  ['.', 'the ticket index, and the glossary of the words it is written in'],
];

// Generated or vendored: hundreds of files nobody here writes.
const SKIP = new Set(['node_modules', 'target', 'dist', '.git', 'vendor', 'conformance']);

function markdown(dir, base) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdown(full, base));
    else if (entry.name.endsWith('.md')) out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

function roleFor(file, roles) {
  const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.';
  for (const [prefix, role] of roles) {
    if (prefix === '.' ? folder === '.' : folder === prefix || folder.startsWith(`${prefix}/`)) {
      return role;
    }
  }
  return null;
}

const rows = [];
const orphans = [];
for (const [base, roles, label] of [
  [root, ROLES, ''],
  [plans, PLAN_ROLES, '../docs/'],
]) {
  let files;
  try {
    statSync(base);
    files = markdown(base, base).sort();
  } catch {
    continue;
  }
  for (const file of files) {
    const role = roleFor(file, roles);
    if (role) rows.push([`${label}${file}`, role]);
    else orphans.push(`${label}${file}`);
  }
}

if (process.argv.includes('--list')) {
  const width = Math.max(...rows.map((r) => r[0].length));
  for (const [file, role] of rows) console.log(`${file.padEnd(width)}  ${role}`);
}

if (orphans.length) {
  console.error('these Markdown files have no role, so nothing keeps them true:');
  for (const file of orphans) console.error(`  ${file}`);
  console.error('add the folder to ROLES in scripts/check-docs.mjs, and say in');
  console.error('.agents/skills/sync-docs/SKILL.md how that kind of document is kept current.');
  process.exit(1);
}

const folders = new Set(rows.map(([file]) => file.slice(0, file.lastIndexOf('/')) || '.'));
console.log(`docs: ${rows.length} Markdown files across ${folders.size} folders, every one with a role`);
