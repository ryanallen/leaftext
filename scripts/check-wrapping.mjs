#!/usr/bin/env node
// Markdown holds one paragraph on one line. Nothing that reads these files wants
// them wrapped — the app's renderer reflows, so does GitHub, so does every editor
// — and a hard wrap costs on every edit after it: a word added in the middle
// re-flows the rest by hand, and the diff of a one-word change is a whole
// paragraph. So the newline inside a paragraph is noise, and this takes it out.
//
//   node scripts/check-wrapping.mjs           fail, naming every file and line
//   node scripts/check-wrapping.mjs --fix     join them
//
// What is left alone, because the break is doing something:
//
//   * a line ending in two spaces or a backslash — that is a real line break
//   * anything inside a fenced or indented code block, or YAML frontmatter
//   * a table, a heading, a thematic break, a link definition, raw HTML
//   * the `[!NOTE]` marker that opens an alert, which needs its own line
//   * a file whose head says it is generated, and one nobody here wrote
//   * a file carrying `<!-- keep-wrapping -->`, for verse and quoted text where
//     the shape of the lines is the point

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plans = join(root, '..', 'docs');

const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', '.git', 'vendor', 'conformance']);

// Whole folders nobody here writes the prose of. `learn/` is somebody else's
// writing kept to read, and the notices under `src/assets/` are somebody's license
// text, reproduced verbatim or not at all.
const SKIP_PATHS = [/(^|\/)learn\//, /^src\/assets\//, /(^|\/)LICENSE/];

/// A file written by a bundler says so in its first lines, and rewriting one only
/// makes `just verify` fail on the drift.
function isGenerated(text) {
  return /^(<!--[\s\S]{0,400}?generated|\s*<!--[\s\S]{0,400}?do not edit)/i.test(text);
}

function optedOut(text) {
  return /<!--\s*keep-wrapping\s*-->/i.test(text);
}

function markdown(dir, base) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.git')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdown(full, base));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/// A line split into the part that says where it sits and the part that is prose:
/// its blockquote marker, its indent, and the rest.
function split(line) {
  const quote = line.match(/^(\s*(?:>\s*)+)/)?.[1] ?? '';
  const rest = line.slice(quote.length);
  const indent = rest.match(/^\s*/)[0];
  return { quote, indent, body: rest.slice(indent.length) };
}

/// How deep in blockquotes a line is, so a quote and the prose under it never join.
function depth(quote) {
  return (quote.match(/>/g) ?? []).length;
}

const FENCE = /^(```+|~~~+)/;

/// Nothing joins onto the end of one of these: the line is the whole thing it is,
/// and a word landing after it would change what it means.
const CLOSED = [
  /^#{1,6}\s/, // heading
  /^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/, // thematic break
  /^\|/, // table row
  /^\[[^\]]+\]:\s/, // link or footnote definition
  /^</, // raw HTML
  /^\[!\w+\]/, // the marker that opens an alert
  /^={2,}$|^-{2,}$/, // setext underline
];

const LIST = /^([-*+]|\d+[.)])(\s|$)/;

/// Whether this line begins something of its own rather than continuing the prose
/// above it. A list item does, which is why it is here and not in `CLOSED` — an
/// item takes its own wrapped continuation, it just never joins onto a paragraph.
function opens(body) {
  return body === '' || FENCE.test(body) || LIST.test(body) || CLOSED.some((test) => test.test(body));
}

/// Whether the line before can take another line onto its end. Two trailing spaces
/// and a trailing backslash are both real line breaks, so both stop here.
function absorbs(line, body) {
  if (body === '' || FENCE.test(body) || CLOSED.some((test) => test.test(body))) return false;
  if (/\s\s$/.test(line) || /\\$/.test(line)) return false;
  return true;
}

/// Unwrap one file's paragraphs. Returns the new text and the 1-based numbers of
/// the lines that were joined onto the one above.
export function unwrap(text) {
  const lines = text.split('\n');
  const out = [];
  const joined = [];
  let fence = null;
  let code = false; // an indented code block
  let frontmatter = lines[0]?.trim() === '---';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const { quote, indent, body } = split(line);

    if (frontmatter) {
      out.push(line);
      if (index > 0 && line.trim() === '---') frontmatter = false;
      continue;
    }

    if (fence) {
      out.push(line);
      if (FENCE.test(body) && body.startsWith(fence)) fence = null;
      continue;
    }
    if (FENCE.test(body)) {
      fence = body.match(FENCE)[1];
      out.push(line);
      continue;
    }

    // An indented block after a blank line is code. A wrapped paragraph never
    // starts four spaces in, and a list's own continuation lines are shallower.
    const blankBefore = out.length === 0 || out[out.length - 1].trim() === '';
    if (code) {
      if (body === '' || indent.length >= 4) {
        out.push(line);
        continue;
      }
      code = false;
    } else if (blankBefore && indent.length >= 4 && body !== '') {
      code = true;
      out.push(line);
      continue;
    }

    const previous = out[out.length - 1];
    if (
      previous !== undefined &&
      body !== '' &&
      !opens(body) &&
      absorbs(previous, split(previous).body) &&
      depth(split(previous).quote) === depth(quote)
    ) {
      out[out.length - 1] = `${previous} ${body}`;
      joined.push(index + 1);
      continue;
    }
    out.push(line);
  }

  return { text: out.join('\n'), joined };
}

/// What the joining has to get right, each case as the text going in and the text
/// coming out. This runs before the sweep, because a wrong transform rewrites 150
/// files and the only thing that would notice is somebody reading one.
const CASES = [
  ['a paragraph', 'one two\nthree four\n', 'one two three four\n'],
  ['a blank line ends it', 'one\ntwo\n\nthree\nfour\n', 'one two\n\nthree four\n'],
  ['two trailing spaces are a real break', 'one  \ntwo\n', 'one  \ntwo\n'],
  ['a backslash is a real break', 'one\\\ntwo\n', 'one\\\ntwo\n'],
  ['a heading takes nothing', '# Title\nprose\n', '# Title\nprose\n'],
  ['a list item takes its own continuation', '- one\n  two\n- three\n', '- one two\n- three\n'],
  ['prose never joins onto a list', 'lead\n- one\n', 'lead\n- one\n'],
  ['a table stays a table', '| a | b |\n| - | - |\n', '| a | b |\n| - | - |\n'],
  ['a fence is left alone', '```\none\ntwo\n```\n', '```\none\ntwo\n```\n'],
  ['a fence inside a list too', '- one\n\n  ```\n  a\n  b\n  ```\n', '- one\n\n  ```\n  a\n  b\n  ```\n'],
  ['an alert marker keeps its line', '> [!NOTE]\n> one\n> two\n', '> [!NOTE]\n> one two\n'],
  ['a quote and the prose under it stay apart', '> quoted\nplain\n', '> quoted\nplain\n'],
  ['frontmatter is untouched', '---\nname: x\ndesc: y\n---\n\none\ntwo\n', '---\nname: x\ndesc: y\n---\n\none two\n'],
  ['an indented code block is code', 'lead\n\n    one\n    two\n', 'lead\n\n    one\n    two\n'],
  ['a thematic break separates', 'one\n\n---\n\ntwo\nthree\n', 'one\n\n---\n\ntwo three\n'],
];

function selfTest() {
  const fails = [];
  for (const [name, input, want] of CASES) {
    const got = unwrap(input).text;
    if (got !== want) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  // Joining is idempotent, or `--fix` would keep finding work in a file it just wrote.
  const twice = unwrap(unwrap('one\ntwo\nthree\n').text);
  if (twice.joined.length) fails.push('a joined file still reports wrapped lines');
  return fails;
}

// `unwrap` is exported so it can be run over one string; the walk of both trees and
// the exit code only happen when this file is the command.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fails = selfTest();
  if (fails.length) {
    console.error('wrapping: the transform is wrong, so nothing was read:\n');
    for (const line of fails) console.error(`  ${line}`);
    process.exit(1);
  }

  const fix = process.argv.includes('--fix');
  const files = [...markdown(root, root), ...markdown(plans, plans)]
    .map((full) => ({ full, shown: relative(root, full).split(sep).join('/') }))
    .filter(({ shown }) => !SKIP_PATHS.some((test) => test.test(shown)));

  let wrapped = 0;
  let touched = 0;
  const offenders = [];

  for (const { full, shown } of files) {
    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (isGenerated(text) || optedOut(text)) continue;
    const result = unwrap(text);
    if (!result.joined.length) continue;
    wrapped += result.joined.length;
    touched += 1;
    offenders.push(`${shown}: ${result.joined.length} wrapped line${result.joined.length === 1 ? '' : 's'} (first at ${result.joined[0]})`);
    if (fix) writeFileSync(full, result.text);
  }

  if (fix) {
    console.log(
      touched
        ? `wrapping: joined ${wrapped} lines across ${touched} files`
        : `wrapping: nothing to join across ${files.length} files`
    );
    process.exit(0);
  }

  if (touched) {
    console.error('A paragraph is one line. These carry a newline inside one:\n');
    for (const line of offenders) console.error(`  ${line}`);
    console.error('\nJoin them: node scripts/check-wrapping.mjs --fix');
    console.error('A break that is doing something keeps two trailing spaces, or the file');
    console.error('carries <!-- keep-wrapping --> when the shape of the lines is the point.');
    process.exit(1);
  }

  console.log(`wrapping: ${files.length} Markdown files, every paragraph on one line`);
}
