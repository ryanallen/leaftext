#!/usr/bin/env node
// design/ is the source of a token. This compiles it into what the binary uses:
//
//   design/colors.md  -> the LEAF_SEMANTIC_TOKEN_CONTRACT block in src/theme.rs
//   design/tokens.md  -> src/assets/tokens.css, served ahead of reading.css
//
// It also holds the three files to the code: a theme row whose key is not in
// colors.md, and a component row naming a class family reading.css does not style,
// both fail here. theme.rs emits a property for any row it finds, so a key nobody
// lists is dead CSS in every theme rather than an error.
//
//   node scripts/bundle-tokens.mjs           write the generated files
//   node scripts/bundle-tokens.mjs --check   fail on drift (`just verify`)
//
// Nobody edits the generated files, the same way nobody edits src/assets/themes.md.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const CONTRACT_START = '// GENERATED from design/colors.md by `just bundle-tokens` — do not edit by hand.';
const CONTRACT_END = '// END GENERATED';
const TOKEN_PREFIX = '--lt-';

const problems = [];
const written = [];

// Every `| a | b | …` row under a `## Heading`, as trimmed cells.
function tableRows(markdown) {
  const rows = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    // The header and its dashed underline are not data.
    const isHeader = cells[0] === 'Token' || cells[0] === 'Component';
    if (!cells.length || isHeader || cells.some((cell) => /^-{3,}$/.test(cell))) {
      continue;
    }
    rows.push(cells);
  }
  return rows;
}

function compare(relative, generated) {
  const path = join(root, relative);
  let current = '';
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    current = '';
  }
  if (current === generated) return;
  if (check) {
    problems.push(`${relative} has drifted from design/ — run \`just bundle-tokens\``);
    return;
  }
  writeFileSync(path, generated);
  written.push(relative);
}

// --- colors.md -> the contract in theme.rs ---------------------------------

const colors = readFileSync(join(root, 'design/colors.md'), 'utf8');
const colorNames = tableRows(colors).map(([name]) => name);
if (colorNames.length < 50) throw new Error(`design/colors.md gave only ${colorNames.length} colors`);
for (const name of colorNames) {
  if (!/^[a-z0-9-]+$/.test(name)) problems.push(`design/colors.md: "${name}" is not a token name`);
}
const duplicates = colorNames.filter((name, index) => colorNames.indexOf(name) !== index);
if (duplicates.length) problems.push(`design/colors.md lists twice: ${duplicates.join(', ')}`);

const themePath = join(root, 'src/theme.rs');
const theme = readFileSync(themePath, 'utf8');
const before = theme.indexOf(CONTRACT_START);
const after = theme.indexOf(CONTRACT_END, before);
if (before < 0 || after < 0) {
  throw new Error('src/theme.rs is missing the generated contract markers');
}
const contractBlock = [
  CONTRACT_START,
  'pub(crate) const LEAF_SEMANTIC_TOKEN_CONTRACT: &[&str] = &[',
  ...colorNames.map((name) => `    "${TOKEN_PREFIX}${name}",`),
  '];',
  CONTRACT_END,
].join('\n');
compare(
  'src/theme.rs',
  theme.slice(0, before) + contractBlock + theme.slice(after + CONTRACT_END.length)
);

// --- tokens.md -> tokens.css ----------------------------------------------

const tokens = readFileSync(join(root, 'design/tokens.md'), 'utf8');
const declarations = [];
let group = '';
for (const line of tokens.split('\n')) {
  if (line.startsWith('## ')) group = line.slice(3).trim();
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
  if (cells.length < 3 || cells[0] === 'Token' || /^-+$/.test(cells[1])) continue;
  const [name, value, purpose] = cells;
  if (!/^[a-z0-9-]+$/.test(name)) {
    problems.push(`design/tokens.md: "${name}" is not a token name`);
    continue;
  }
  // A value wrapped in backticks is one that needed them to survive the table.
  declarations.push({ group, name, value: value.replace(/^`|`$/g, ''), purpose });
}
if (declarations.length < 20) throw new Error(`design/tokens.md gave only ${declarations.length} tokens`);

const css = ['/* Generated from design/tokens.md by `just bundle-tokens`. Do not edit. */', ':root {'];
let lastGroup = '';
for (const { group: section, name, value } of declarations) {
  if (section !== lastGroup) {
    css.push(`  /* ${section} */`);
    lastGroup = section;
  }
  css.push(`  --${name}: ${value};`);
}
css.push('}', '');
compare('src/assets/tokens.css', css.join('\n'));

// --- the three files against the code -------------------------------------

const listed = new Set(colorNames);
for (const file of readdirSync(join(root, 'themes'))) {
  if (!file.endsWith('.md') || file === 'README.md') continue;
  const rows = readFileSync(join(root, 'themes', file), 'utf8')
    .split('\n')
    .map((line) => line.match(/^\|\s*([a-z][a-z0-9-]*)\s*\|/))
    .filter(Boolean)
    .map((match) => match[1])
    // The Fonts table's rows are roles, not colors.
    .filter((key) => !['role', 'heading', 'body', 'code', 'google', 'token'].includes(key));
  const stale = [...new Set(rows.filter((key) => !listed.has(key)))];
  if (stale.length) {
    problems.push(`themes/${file} sets colors design/colors.md does not list: ${stale.join(', ')}`);
  }
}

const readingCss = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
// Only the component table: the two tables after it account for what a rendered
// document brings and what a state is called, neither being a class family of its own.
const componentsMd = readFileSync(join(root, 'design/components.md'), 'utf8');
const components = tableRows(componentsMd.slice(0, componentsMd.indexOf('## What a document brings')));
for (const [component, family] of components) {
  if (!new RegExp('\\.' + family + '[\\s,:.{[-]').test(readingCss)) {
    problems.push(`design/components.md: nothing styles .${family} (${component})`);
  }
}

if (problems.length) {
  console.error('design/ and the code disagree:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
if (check) {
  console.log(`design/: ${colorNames.length} colors, ${declarations.length} tokens, ${components.length} components — all match`);
} else {
  console.log(
    written.length
      ? `bundled design/ into ${written.join(' and ')}`
      : 'design/: nothing to write, the generated files already match'
  );
}
