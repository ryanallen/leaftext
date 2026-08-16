#!/usr/bin/env node
// A paragraph is one line — in Markdown, and in a comment in the code. Nothing that reads either of them wants it wrapped — the app's renderer reflows, so does GitHub, so does every editor — and a hard wrap costs on every edit after it: a word added in the middle re-flows the rest by hand, and the diff of a one-word change is a whole paragraph. So the newline inside a paragraph is noise, and this takes it out.
//
//   node scripts/check-wrapping.mjs           fail, naming every file and line
//   node scripts/check-wrapping.mjs --fix     join them
//
// Markdown in this repo and the plan tree next door; comments in this repo's `.rs`, `.js`, `.mjs` and `.css`. A comment joins only where two lines are both flush prose: a body with an indent of its own is a command, a table or a list, where the shape is the content. A `/* */` block is flush against its own base indent, because its continuation lines are aligned under the opener rather than starting at column zero.
//
// What is left alone, because the break is doing something:
//
//   * a line ending in two spaces or a backslash — that is a real line break
//   * anything inside a fenced or indented code block, or YAML frontmatter
//   * a table, a heading, a thematic break, a link definition, raw HTML
//   * the `[!NOTE]` marker that opens an alert, which needs its own line
//   * a file whose head says it is generated, and one nobody here wrote
//   * a file carrying the keep-wrapping marker on a line of its own, for verse and
//     quoted text where the shape of the lines is the point

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planTree } from './agent-workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plans = planTree(root);

const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', '.git', 'vendor', 'conformance']);

// Whole folders nobody here writes the prose of. `learn/` is somebody else's writing kept to read, and the Markdown under `src/assets/` is somebody's license text, reproduced verbatim or not at all — the scripts beside it are ours and are read.
const SKIP_PATHS = [/(^|\/)learn\//, /^src\/assets\/.*\.md$/, /(^|\/)LICENSE/];

/// A file written by a bundler says so in its first lines, and rewriting one only makes `just verify` fail on the drift. It says so in whatever comment its own language writes, so the code files are read here too, not just the Markdown.
function isGenerated(text) {
  return (
    /^(<!--[\s\S]{0,400}?generated|\s*<!--[\s\S]{0,400}?do not edit)/i.test(text) ||
    /^(#!.*\n)?\s*(\/\/|\/\*)[^\n]{0,300}?(generated|do not edit)/i.test(text)
  );
}

/// Only a line that is the marker and nothing else opts a file out. Matched anywhere in the text, a file that merely names the marker in a sentence exempts itself — which is how the rules file that states the rule stayed outside it.
function optedOut(text) {
  return /^[ \t]*<!--[ \t]*keep-wrapping[ \t]*-->[ \t]*$/im.test(text);
}

/// Every file under `dir` whose name ends in one of `suffixes`.
function walk(dir, suffixes) {
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
    if (entry.isDirectory()) out.push(...walk(full, suffixes));
    else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) out.push(full);
  }
  return out;
}

/// A line split into the part that says where it sits and the part that is prose: its blockquote marker, its indent, and the rest.
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

/// Nothing joins onto the end of one of these: the line is the whole thing it is, and a word landing after it would change what it means.
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

/// Whether this line begins something of its own rather than continuing the prose above it. A list item does, which is why it is here and not in `CLOSED` — an item takes its own wrapped continuation, it just never joins onto a paragraph.
function opens(body) {
  return body === '' || FENCE.test(body) || LIST.test(body) || CLOSED.some((test) => test.test(body));
}

/// Whether the line before can take another line onto its end. Two trailing spaces and a trailing backslash are both real line breaks, so both stop here.
function absorbs(line, body) {
  if (body === '' || FENCE.test(body) || CLOSED.some((test) => test.test(body))) return false;
  if (/\s\s$/.test(line) || /\\$/.test(line)) return false;
  return true;
}

/// Unwrap one file's paragraphs. Returns the new text and the 1-based numbers of the lines that were joined onto the one above.
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

    // An indented block after a blank line is code. A wrapped paragraph never starts four spaces in, and a list's own continuation lines are shallower.
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

/// A comment on a line of its own: its indent, its marker, and the prose after it. A comment sitting after code on the same line is not one — that text is about the line it is on.
function commentAt(line) {
  const found = line.match(/^(\s*)(\/\/\/|\/\/!|\/\/)( ?)(.*)$/);
  if (!found) return null;
  return { indent: found[1], marker: found[2], body: found[4] };
}

/// A run of dashes or stars is a rule somebody drew, not a sentence.
const RULE = /^[-=*_+~]{3,}/;

/// A hyphen attached to the word before it is a word split across the wrap, so the join takes no space. Two hyphens are an em dash, and that one keeps its space.
const SPLIT_WORD = /\w-$/;

/// Join a comment's wrapped prose, in `.rs` and `.js` alike.
///
/// Narrower than the Markdown side on purpose: only two flush lines join. A body with any indent of its own is a shell command, a table, a list continuation or an example — the shape is the content there, and joining it would destroy it.
export function unwrapComments(text) {
  const lines = text.split('\n');
  const out = [];
  const joined = [];
  let fence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const here = commentAt(line);
    if (here && FENCE.test(here.body.trim())) {
      fence = !fence;
      out.push(line);
      continue;
    }
    const previousLine = out[out.length - 1];
    const previous = previousLine === undefined ? null : commentAt(previousLine);
    if (
      !fence &&
      here &&
      previous &&
      here.marker === previous.marker &&
      here.indent === previous.indent &&
      here.body !== '' &&
      previous.body !== '' &&
      !/^\s/.test(here.body) &&
      !/^\s/.test(previous.body) &&
      !RULE.test(here.body) &&
      !RULE.test(previous.body) &&
      !opens(here.body) &&
      absorbs(previousLine, previous.body)
    ) {
      out[out.length - 1] = `${previousLine}${SPLIT_WORD.test(previousLine) ? '' : ' '}${here.body}`;
      joined.push(index + 1);
      continue;
    }
    out.push(line);
  }

  return { text: out.join('\n'), joined };
}

/// A `/*` opening a block on a line of its own: its indent and the prose after the marker. A `/*` after a declaration on the same line is not one, and neither is a block that closes on the line it opens.
const BLOCK_OPEN = /^([ \t]*)\/\*(.*)$/;

/// A line inside a block, split at its own indent.
function blockLineAt(line) {
  const indent = line.match(/^[ \t]*/)[0];
  return { indent: indent.length, body: line.slice(indent.length) };
}

/// Join the wrapped prose inside a `/* … */` block, in `.css`.
///
/// The one thing this does that `unwrapComments` does not is measure the indent from the block rather than from the line: a CSS block's continuation lines are aligned under its `/*`, so read as `//` lines every one of them would look like an indented example and nothing would join. The block's base is the smallest indent among its continuation lines — a line at that base is prose, a line deeper than it is an example and keeps its shape. A star-led block needs no rule of its own: its ` * ` continuation reads as a list item, which never joins.
export function unwrapBlockComments(text) {
  const lines = text.split('\n');
  const out = [];
  const joined = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const open = BLOCK_OPEN.exec(line);
    if (!open || open[2].includes('*/')) {
      out.push(line);
      continue;
    }

    let close = -1;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      if (lines[scan].includes('*/')) {
        close = scan;
        break;
      }
    }
    if (close === -1) {
      out.push(line);
      continue;
    }

    // The closer alone on its line says nothing about where the prose sits, and neither does a blank line.
    let base = null;
    for (let scan = index + 1; scan <= close; scan += 1) {
      const { indent, body } = blockLineAt(lines[scan]);
      if (body === '' || body === '*/') continue;
      if (base === null || indent < base) base = indent;
    }

    out.push(line);
    let previousBody = open[2].trim();
    let joinable = base !== null && previousBody !== '' && !RULE.test(previousBody);

    for (let scan = index + 1; scan <= close; scan += 1) {
      const raw = lines[scan];
      const { indent, body } = blockLineAt(raw);
      const prose = body !== '' && body !== '*/' && indent === base && !RULE.test(body) && !opens(body);
      const previousLine = out[out.length - 1];
      if (prose && joinable && absorbs(previousLine, previousBody)) {
        out[out.length - 1] = `${previousLine}${SPLIT_WORD.test(previousLine) ? '' : ' '}${body}`;
        previousBody = `${previousBody} ${body}`;
        joined.push(scan + 1);
        continue;
      }
      out.push(raw);
      previousBody = body;
      joinable = prose;
    }
    index = close;
  }

  return { text: out.join('\n'), joined };
}

/// What the joining has to get right, each case as the text going in and the text coming out. This runs before the sweep, because a wrong transform rewrites 150 files and the only thing that would notice is somebody reading one.
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

/// The same, for the comment side.
const COMMENT_CASES = [
  ['a wrapped comment', '// one two\n// three four\n', '// one two three four\n'],
  ['a doc comment too', '/// one two\n/// three four\n', '/// one two three four\n'],
  ['a module comment too', '//! one\n//! two\n', '//! one two\n'],
  ['markers never mix', '/// one\n// two\n', '/// one\n// two\n'],
  ['a bare marker breaks the paragraph', '// one\n//\n// two\n', '// one\n//\n// two\n'],
  ['an indented body is an example', '//   node scripts/x.mjs   what it does\n//   node scripts/x.mjs --fix\n', '//   node scripts/x.mjs   what it does\n//   node scripts/x.mjs --fix\n'],
  ['prose never eats an example', '// Two ways to run it:\n//   node scripts/x.mjs\n', '// Two ways to run it:\n//   node scripts/x.mjs\n'],
  ['a rule line stays a rule', '// ---- headings ----\n// one\n', '// ---- headings ----\n// one\n'],
  ['a list inside a comment keeps its items', '// * one\n// * two\n', '// * one\n// * two\n'],
  ['a fence inside a doc comment is code', '/// ```\n/// one\n/// two\n/// ```\n', '/// ```\n/// one\n/// two\n/// ```\n'],
  ['a comment after code is left alone', 'let x = 1; // one\nlet y = 2; // two\n', 'let x = 1; // one\nlet y = 2; // two\n'],
  ['code between comments breaks the run', '// one\nfn a() {}\n// two\n', '// one\nfn a() {}\n// two\n'],
  ['indentation has to match', '// one\n    // two\n', '// one\n    // two\n'],
  ['a split word joins tight', '// a reading-\n// view affordance\n', '// a reading-view affordance\n'],
  ['an em dash keeps its space', '// taken back --\n// and the history\n', '// taken back -- and the history\n'],
];

/// The same, for a `/* */` block. The indent in these is the block's own, which is the whole of what the reader has to get right.
const BLOCK_CASES = [
  ['a wrapped block carries its closer along', '  /* one two\n     three four */\n', '  /* one two three four */\n'],
  ['a body deeper than the base is an example', '/* one\n   two\n     node scripts/x.mjs\n   three */\n', '/* one two\n     node scripts/x.mjs\n   three */\n'],
  ['a blank line breaks the paragraph', '/* one\n   two\n\n   three\n   four */\n', '/* one two\n\n   three four */\n'],
  ['a banner rule takes nothing', '/* ---- Title ----\n   one\n   two */\n', '/* ---- Title ----\n   one two */\n'],
  ['a banner rule joins onto nothing', '/* one\n   ----\n   two */\n', '/* one\n   ----\n   two */\n'],
  ['a comment opened after a declaration is untouched', 'a { color: red; /* one\n   two */ }\n', 'a { color: red; /* one\n   two */ }\n'],
  ['a one-liner is untouched', '/* one two */\n', '/* one two */\n'],
  ['a star-led block is left alone', '/* one\n * two\n */\n', '/* one\n * two\n */\n'],
  ['a closer on its own line stays there', '/* one\n   two\n*/\n', '/* one two\n*/\n'],
  ['a split word joins tight', '/* a reading-\n   view affordance */\n', '/* a reading-view affordance */\n'],
  ['an em dash keeps its space', '/* taken back --\n   and the history */\n', '/* taken back -- and the history */\n'],
  ['an unterminated block is left alone', '/* one\n   two\n', '/* one\n   two\n'],
];

/// Which files the sweep never opens, and which only look like they say so. A file that names the marker inside a sentence is read like any other, because a rule nobody can see written down is a rule that exempts whoever writes it out.
const EXEMPT_CASES = [
  ['the marker on a line of its own opts out', optedOut, '# Title\n\n<!-- keep-wrapping -->\n', true],
  ['an indented one still opts out', optedOut, '  <!-- keep-wrapping -->\n', true],
  ['the marker inside a sentence does not', optedOut, 'the file carries `<!-- keep-wrapping -->` when the shape is the point\n', false],
  ['the marker inside a comment does not', optedOut, '// a file carrying <!-- keep-wrapping -->, for verse\n', false],
  ['a generated Markdown head is skipped', isGenerated, '<!-- Generated by a bundler. -->\n\n# Title\n', true],
  ['a generated script head is skipped', isGenerated, '// Generated from design/icons.md. Do not edit.\n', true],
  ['a script that only writes one is read', isGenerated, "// The bundler writes this file's neighbors, not this one.\n", false],
];

function selfTest() {
  const fails = [];
  for (const [name, input, want] of CASES) {
    const got = unwrap(input).text;
    if (got !== want) fails.push(`markdown, ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  for (const [name, input, want] of COMMENT_CASES) {
    const got = unwrapComments(input).text;
    if (got !== want) fails.push(`comments, ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  for (const [name, input, want] of BLOCK_CASES) {
    const got = unwrapBlockComments(input).text;
    if (got !== want) fails.push(`block comments, ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  for (const [name, test, input, want] of EXEMPT_CASES) {
    const got = test(input);
    if (got !== want) fails.push(`exemption, ${name}: got ${got}, want ${want}`);
  }
  // Joining is idempotent, or `--fix` would keep finding work in a file it just wrote.
  if (unwrap(unwrap('one\ntwo\nthree\n').text).joined.length) {
    fails.push('a joined paragraph still reports wrapped lines');
  }
  if (unwrapComments(unwrapComments('// one\n// two\n// three\n').text).joined.length) {
    fails.push('a joined comment still reports wrapped lines');
  }
  if (unwrapBlockComments(unwrapBlockComments('/* one\n   two\n   three */\n').text).joined.length) {
    fails.push('a joined block comment still reports wrapped lines');
  }
  return fails;
}

// `unwrap` is exported so it can be run over one string; the walk of both trees and the exit code only happen when this file is the command.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fails = selfTest();
  if (fails.length) {
    console.error('wrapping: the transform is wrong, so nothing was read:\n');
    for (const line of fails) console.error(`  ${line}`);
    process.exit(1);
  }

  const fix = process.argv.includes('--fix');
  const listed = (dir, suffixes, join_) =>
    walk(dir, suffixes)
      .map((full) => ({ full, shown: relative(root, full).split(sep).join('/'), join: join_ }))
      .filter(({ shown }) => !SKIP_PATHS.some((test) => test.test(shown)));

  // Markdown in both trees, and the comments in the code of this one.
  const files = [
    ...listed(root, ['.md'], unwrap),
    ...listed(plans, ['.md'], unwrap),
    ...listed(root, ['.rs', '.js', '.mjs'], unwrapComments),
    ...listed(root, ['.css'], unwrapBlockComments),
  ];

  let wrapped = 0;
  let touched = 0;
  const offenders = [];

  for (const { full, shown, join: joiner } of files) {
    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (isGenerated(text) || optedOut(text)) continue;
    const result = joiner(text);
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
    console.error('carries the keep-wrapping marker on a line of its own, where the shape');
    console.error('of the lines is the point.');
    process.exit(1);
  }

  console.log(`wrapping: ${files.length} files, every paragraph and comment on one line`);
}
