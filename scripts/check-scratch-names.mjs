#!/usr/bin/env node
// Two agents can work this checkout at once, and the OS temp folder is the one place they can write over each other. A scratch path built from a fixed name is one file with two writers: the conformance run wrote its child's output to one path per suite, and a second run beside it truncated the file the first was about to read — which failed the gate on a clean tree and sent the reader to a renamed test.
//
//   node scripts/check-scratch-names.mjs   fail on a scratch path with a fixed name (`just verify`)
//
// A name belongs to one run when something is interpolated into it — `std::process::id()` is what most of the suite already uses — or when the OS hands it out (`mkdtemp`). A variable path segment is not enough: `join("leaf-journal").join(name)` gave every journal test a folder of its own and every run the same three.
//
// A clock reading is not one either, and it is the substitution a test reaches for: a clock ticking in hundred-nanosecond steps hands two tests that start together the same folder, which is what took the gate red on a change that broke nothing. So a name whose every substituted value resolves to a clock is refused, and a value is followed through the `let` that bound it and the function that returned it, because a bare inline clock is the shape it is spelled in least often.
//
// The other half is which test, and it is read across files rather than down one. A scratch helper takes a word per test and builds a folder from it, so two calls to one helper carrying one word are one folder with two writers. Two helpers may share a word freely — their prefixes differ, so the folders do — which is why the rule is per helper and why two helpers building one prefix are refused instead.
//
// Four temp paths are fixed on purpose and one more is never written, so the rule cannot simply refuse all of them. Each carries a row below with the reason, and a row that matches nothing fails too — a list of exceptions nobody prunes is how a rule stops being read.
//
// The last half is where the name came from. A function that builds a scratch path out of its one argument carries the interpolation itself, so the rule above reads the builder and never the caller: two gate self-tests handed theirs `aaaaaaaa-1111-1111-1111-111111111111` and wrote over each other's record on a clean tree. So a fixed name handed to such a builder is refused, followed one hop through the local `const` that bound it. An empty name, or none at all, is the builder's own answer and is left alone, and a builder handed its folder as well is somebody else's parent to keep unique.
//
// The rules are proved on made-up files before the real tree is opened, so a matcher that quietly stops matching fails the build instead of passing everything.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/// Nothing of ours is in these.
const SKIP = new Set(['target', 'node_modules', '.git', 'dist', '.tmp', 'vendor']);

/// This file is not read: it carries made-up scratch paths as its own test cases, and every one of them would be a finding.
const SELF = 'scripts/check-scratch-names.mjs';

/// A fixed name that has to stay fixed: the file it is in, enough of the name to find it, and why. The reason is the point — without it the row is just a way of turning the rule off.
export const ON_PURPOSE = [
  ['src/app/tests/links.rs', 'leaf-link-fixtures',
    'only builds a name for a link test to resolve against; nothing is ever written there'],
  ['src/tests/mod.rs', 'leaf-render-fixtures',
    'only builds a name for an image test to resolve against; nothing is ever written there'],
  ['src/tests/conformance/mod.rs', 'leaftext-conformance',
    'the stand-in every Markdown case is rendered against, and never written — a path that varied per case would move the rendered answer under the normalizer'],
  ['installer/src/apply.rs', 'leaftext-uninstall.exe',
    'shipping code: where the uninstaller copies itself so it can delete the folder it was running from'],
  ['scripts/check-driver.mjs', 'leaftext-driver-check.bmp',
    'the driver is only ever run dry here, and the check asserts nothing appeared at that path'],
];

/// Where a scratch path starts.
const OPENER = /(?:std::env::temp_dir|env::temp_dir|temp_dir|tmpdir)\s*\(\s*\)/g;

/// Every scratch path a file builds, from the start of the line it begins on to the end of the statement — or to the closing brace, because a path returned as a function's last expression has no semicolon.
///
/// A path is one only where the temp folder is joined onto, which is how every one in this tree is built. The folder handed to something whole — a sweep, a walk — names no file and is left alone.
export function scratchPaths(text) {
  const found = [];
  for (const match of text.matchAll(OPENER)) {
    const after = text.slice(match.index + match[0].length);
    const joined = /^\s*\.join\s*\(/.test(after) || /\bjoin\s*\(\s*$/.test(text.slice(0, match.index));
    if (!joined) continue;
    const from = text.lastIndexOf('\n', match.index) + 1;
    const rest = text.slice(from);
    const end = rest.search(/;|\n\s*\}/);
    found.push({
      line: text.slice(0, from).split('\n').length,
      source: end === -1 ? rest.slice(0, 400) : rest.slice(0, end),
    });
  }
  return found;
}

/// Whether the name belongs to one run. `{{` and `}}` are an escaped brace in a Rust format string, not a value.
export function unique(source) {
  if (/mkdtemp/i.test(source)) return true;
  if (/\$\{/.test(source)) return true;
  if (/format!/.test(source)) return /\{[^{}]*\}/.test(source.replace(/\{\{|\}\}/g, ''));
  return false;
}

/// Reading a clock, in any of the spellings this tree uses for one.
const CLOCK = /SystemTime::now|Instant::now|duration_since|as_nanos|as_millis|as_micros|elapsed\(\)|Date\.now\(\)|hrtime/;

/// Every value substituted into a scratch name: the ones named inside the braces, and the arguments that fill the empty ones.
export function substituted(source) {
  const named = [];
  const string = source.replace(/\{\{|\}\}/g, '');
  for (const brace of string.matchAll(/\{([^{}]*)\}/g)) {
    const inner = brace[1].split(':')[0].trim();
    if (inner) named.push(inner);
  }
  // What follows the format string, split on the commas between arguments rather than inside them.
  const after = source.slice(source.indexOf('format!'));
  const quote = after.indexOf('"');
  const close = quote === -1 ? -1 : after.indexOf('"', quote + 1);
  const args = close === -1 ? '' : after.slice(close + 1);
  let depth = 0;
  let piece = '';
  const positional = [];
  for (const ch of args) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
    if (ch === ',' && depth === 0) { positional.push(piece); piece = ''; continue; }
    piece += ch;
  }
  positional.push(piece);
  return [...named, ...positional].map((v) => v.trim()).filter(Boolean);
}

/// What a substituted value turns out to be, followed through the `let` that bound it and the function that returned it. One hop each way: the tree spells a clock inline, in a `let unique = …` above the path, or in a `fn unique_suffix()` beside it, and nothing deeper than that.
export function resolved(value, text) {
  if (CLOCK.test(value)) return value;
  const call = /^(\w+)\s*\(\s*\)$/.exec(value);
  if (call) {
    const body = functionBody(text, call[1]);
    return body === null ? value : body;
  }
  if (/^\w+$/.test(value)) {
    const bound = new RegExp(`let\\s+(?:mut\\s+)?${value}\\s*=([\\s\\S]*?);`).exec(text);
    if (bound) return bound[1];
  }
  return value;
}

/// The body of a named Rust function, braces matched, or null where the file has none.
export function functionBody(text, name) {
  const at = new RegExp(`\\bfn\\s+${name}\\s*\\(`).exec(text);
  return at ? bracedBody(text, at.index) : null;
}

/// The braced block opening at or after a point, braces matched, or null where none closes.
export function bracedBody(text, from) {
  const open = text.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/// What a builder puts in a name to own its own run, whatever it was handed.
const OWN_RUN = /process\.pid|mkdtemp/;

/// Every JavaScript function whose one argument is the whole of a scratch name: the builder carries the interpolation, so the fixed-name rule reads it and the caller's fixed string goes unseen. A function handed its folder as well builds nothing here — that parent is the caller's to keep unique, which is how a name under a folder the OS made stays outside this. Nor does a builder putting this run's own id in the name itself: what it takes is a word telling one test from another, which is the helper rule's to hold.
export function pathBuilders(files) {
  const found = new Map();
  for (const { path, text } of files) {
    if (!/\.m[jt]s$/.test(path)) continue;
    for (const at of text.matchAll(/\bfunction\s+(\w+)\s*\(\s*\w+\s*\)\s*\{/g)) {
      const body = bracedBody(text, at.index);
      if (body === null) continue;
      const paths = scratchPaths(body);
      if (!paths.length || paths.some(({ source }) => OWN_RUN.test(source))) continue;
      found.set(at[1], path);
    }
  }
  return found;
}

/// What one call hands over, or null where it hands over anything but a single thing.
export function callArgument(text, from) {
  let depth = 0;
  let piece = '';
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if ('([{'.includes(ch)) {
      depth += 1;
      if (depth === 1) continue;
    } else if (')]}'.includes(ch)) {
      depth -= 1;
      if (depth === 0) return piece;
    } else if (ch === ',' && depth === 1) return null;
    piece += ch;
  }
  return null;
}

/// Every call to one of those builders, with the one thing it was handed. The definition itself is not a call, and a name is looked for across every file, because a builder is exported and called from the file beside it.
export function builderCalls(files, builders) {
  const out = [];
  for (const { path, text } of files) {
    for (const name of builders.keys()) {
      for (const at of text.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
        if (/\bfunction\s+$/.test(text.slice(0, at.index))) continue;
        const argument = callArgument(text, at.index + at[0].length - 1);
        if (argument === null) continue;
        out.push({ path, text, name, argument: argument.trim(), line: text.slice(0, at.index).split('\n').length });
      }
    }
  }
  return out;
}

/// The fixed name a call hands a builder, or null where it hands one this run owns, an empty one, or nothing at all. One hop through the `const` that bound it, the way a clock is followed through its `let`.
export function fixedName(written, text) {
  const value = written.trim();
  if (!value || unique(value)) return null;
  const literal = /^(['"`])([\s\S]*)\1$/.exec(value);
  if (literal) return literal[2] ? value : null;
  if (/^\w+$/.test(value)) {
    const bound = new RegExp(`const\\s+${value}\\s*=([^;\\n]*)`).exec(text);
    if (bound) return fixedName(bound[1], '');
  }
  return null;
}

/// Whether a name says nothing about the run but what time it was: every value it carries is a clock. A name carrying no value at all is the fixed-name rule's, not this one's.
export function clockAlone(source, text) {
  const values = substituted(source);
  if (!values.length) return false;
  return values.every((value) => CLOCK.test(resolved(value, text)));
}

/// The head of a helper in either language: a Rust function taking one string, and a JavaScript one taking one argument.
const HELPER_HEAD = {
  rust: /\bfn\s+(\w+)\s*\(\s*(\w+)\s*:\s*&str\s*\)/g,
  javascript: /\bfunction\s+(\w+)\s*\(\s*(\w+)\s*\)\s*\{/g,
};

/// Every function that hands out a scratch folder under a word: it takes one string and its body builds a scratch path, or passes the word on to one that does. Found in two passes, because a per-subject helper is one line over the shared one and the shared one has to be known first.
///
/// Both languages go in one set, because the folder two of them collide in does not know which made it: the Rust `scratch_dir` builds `leaf-{label}-{pid}-{n}`, whose head is empty, so a JavaScript helper spelling `` `leaf-${word}-${process.pid}` `` builds the same folder for the same word and a list per language could not see it.
///
/// A wrapper that passes its own word through unchanged is not a namespace of its own — its calls belong to the helper it wraps, or `filtered_vault("empty")` and `corpus_dir("empty")` would read as two words and name one folder.
export function helpers(files) {
  const found = new Map();
  const wraps = new Map();
  let grew = true;
  while (grew) {
    grew = false;
    for (const { path, text } of files) {
      const javascript = /\.m[jt]s$/.test(path);
      for (const at of text.matchAll(javascript ? HELPER_HEAD.javascript : HELPER_HEAD.rust)) {
        const [, name, param] = at;
        if (found.has(name)) continue;
        const body = bracedBody(text, at.index);
        if (body === null) continue;
        // A JavaScript helper claims exactly the bodies `pathBuilders` steps around — this run's own id in the folder itself — so a one-argument function is read by one rule or the other and never both.
        const direct = scratchPaths(body).some(({ source }) => (javascript ? OWN_RUN.test(source) : unique(source)));
        const passes = [...found.keys()].find((known) => new RegExp(`\\b${known}\\s*\\(`).test(body));
        if (!direct && !passes) continue;
        // A word handed straight on lands in the wrapped helper's namespace; a word built into a new prefix starts one.
        const through = passes && new RegExp(`\\b${passes}\\s*\\(\\s*${param}\\s*\\)`).test(body) ? passes : null;
        found.set(name, { path, prefix: prefixOf(body) });
        if (through) wraps.set(name, through);
        grew = true;
      }
    }
  }
  for (const [name, wrapped] of wraps) {
    let root = wrapped;
    while (wraps.has(root)) root = wraps.get(root);
    found.get(name).under = root;
  }
  return found;
}

/// The two spellings of a folder's head: Rust's `"leaf-corpus-{tag}"` and JavaScript's `` `leaf-site-boot-${process.pid}` ``.
const HEAD = [
  /"(leaf-)?([a-z0-9]+(?:-[a-z0-9]+)*?)?-?\{/,
  /`(leaf-)?([a-z0-9]+(?:-[a-z0-9]+)*?)?-?\$\{/,
];

/// The fixed head of the folder a helper builds — `corpus` out of `leaf-corpus-{tag}`. Null where the body names no literal at all, which is a helper this check cannot hold and says so.
export function prefixOf(body) {
  // Whichever spelling comes first, so a body carrying both is read as it is written rather than by which pattern was tried first.
  const literal = HEAD.map((head) => head.exec(body)).filter(Boolean).sort((a, b) => a.index - b.index)[0];
  if (!literal) return null;
  if (literal[2]) return literal[2];
  // `leaf-{label}` is a head of nothing on purpose: the word is the whole name. No head at all is a helper whose words cannot be told apart.
  return literal[1] ? '' : null;
}

/// Every word handed to a scratch helper, as `helper` and `word` with where it was written.
export function words(files, found) {
  const out = [];
  for (const { path, text } of files) {
    for (const [name, helper] of found) {
      // A wrapper's word is spelled by the helper it hands it to, or the two ways of asking for one folder would read as two.
      const owner = helper.under ?? name;
      const prefix = found.get(owner)?.prefix;
      // The three ways a word is written down: Rust's double quote, and JavaScript's single quote or backtick. A backtick carrying a value is not a word at all, so it is left to the caller's own name to be unique.
      const written = new RegExp(`\\b${name}\\s*\\(\\s*(?:"([^"]*)"|'([^']*)'|\`([^\`$]*)\`)`, 'g');
      for (const at of text.matchAll(written)) {
        const word = at[1] ?? at[2] ?? at[3];
        out.push({
          helper: owner,
          word: prefix ? `${prefix}-${word}` : word,
          path,
          line: text.slice(0, at.index).split('\n').length,
        });
      }
    }
  }
  return out;
}

/// What is wrong with a set of files and a set of rows. Pure, so every refusal can be proved on input nobody has to keep in step.
export function problems(files, rows) {
  const found = [];
  const matched = new Set();
  for (const { path, text } of files) {
    for (const { line, source } of scratchPaths(text)) {
      if (clockAlone(source, text)) {
        found.push(`${path}:${line} names its run with a clock reading and nothing else — the clock ticks slowly enough here to hand two tests that start together one folder, which is what went red. Put this run's own in it (\`std::process::id()\`)`);
        continue;
      }
      if (unique(source)) continue;
      const row = rows.find(([file, name]) => file === path && source.includes(name));
      if (row) {
        matched.add(row);
        continue;
      }
      found.push(`${path}:${line} builds a scratch path with a fixed name — two runs of the suite at once share it. Put this run's own in it (\`std::process::id()\`), or add a row to ${SELF} saying why it has to be fixed`);
    }
  }
  for (const row of rows) {
    if (!matched.has(row)) {
      found.push(`${SELF} excuses ${row[1]} in ${row[0]}, and nothing there builds that path any more — a stale row is how a list of exceptions stops being read`);
    }
  }

  const scratchHelpers = helpers(files);
  const prefixes = new Map();
  for (const [name, helper] of scratchHelpers) {
    if (helper.under) continue;
    if (helper.prefix === null) {
      found.push(`${helper.path} builds scratch folders in ${name} under a name this check cannot read, so two tests sharing a word there would pass. Give the folder a fixed head — \`format!("thing-{word}")\``);
      continue;
    }
    const taken = prefixes.get(helper.prefix);
    if (taken) {
      found.push(`${name} and ${taken} both build scratch folders called \`${helper.prefix}-…\`, so one word handed to each is one folder with two writers. Give one of them its own head`);
      continue;
    }
    prefixes.set(helper.prefix, name);
  }

  const builders = pathBuilders(files);
  for (const call of builderCalls(files, builders)) {
    const fixed = fixedName(call.argument, call.text);
    if (!fixed) continue;
    found.push(`${call.path}:${call.line} hands ${call.name} the fixed name ${fixed}, and ${call.name} builds a scratch path out of it — two runs at once are one file with two writers. Put this run's own in it (\`process.pid\`)`);
  }

  const seen = new Map();
  for (const call of words(files, scratchHelpers)) {
    const key = `${call.helper} ${call.word}`;
    const first = seen.get(key);
    if (first) {
      found.push(`${call.path}:${call.line} asks ${call.helper} for a scratch folder called \`${call.word}\`, and so does ${first.path}:${first.line} — one folder, two tests, and whichever finishes second reads what the other wrote. A word is its own test's name`);
      continue;
    }
    seen.set(key, call);
  }
  return found;
}

/// A made-up suite in the shape the real one now has: one builder, per-subject helpers over it, and a wrapper that hands its word straight on.
const HELPERS = [
  'fn shared(label: &str) -> PathBuf {',
  '    std::env::temp_dir().join(format!("leaf-{label}-{}", std::process::id()))',
  '}',
  'fn corpus(tag: &str) -> PathBuf { shared(&format!("corpus-{tag}")) }',
  'fn clouds(tag: &str) -> PathBuf { shared(&format!("clouds-{tag}")) }',
  'fn filtered(tag: &str) -> PathBuf { corpus(tag) }',
].join('\n');

/// Made-up scratch helpers written in JavaScript, in the shape the site-boot check has: one word per test, and this run's own id in the folder itself, which is what leaves the word the only thing telling two folders apart.
const JS_HELPERS = [
  'function boot(word) {',
  '  return join(tmpdir(), `leaf-boot-${process.pid}-${word}`);',
  '}',
  'function docs(word) {',
  '  return join(tmpdir(), `leaf-docs-${process.pid}-${word}`);',
  '}',
].join('\n');

/// A made-up path builder in the shape the gates have: one argument, and the interpolation that hides a caller's fixed name.
const BUILDER = [
  'function record(session) {',
  '  return join(tmpdir(), session ? `leaf-record-${session}.json` : \'leaf-record.json\');',
  '}',
].join('\n');

const CASES = [
  ['a fixed name is refused',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join("leaf-fixture");' }], [], 1],
  ['this run\'s own process id passes',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join(format!("leaf-fixture-{}", std::process::id()));' }], [], 0],
  ['a variable segment is not unique, because every run passes the same one',
    [{ path: 'a.rs', text: 'std::env::temp_dir().join("leaf-journal").join(name)\n}' }], [], 1],
  ['a name the OS hands out passes',
    [{ path: 'a.mjs', text: "const p = mkdtempSync(join(tmpdir(), 'leaf-drive-'));" }], [], 0],
  ['a template literal passes',
    [{ path: 'a.mjs', text: 'const p = join(tmpdir(), `leaf-${process.pid}.json`);' }], [], 0],
  ['a fixed name in a JavaScript file is refused too',
    [{ path: 'a.mjs', text: "const p = join(tmpdir(), 'leaf-fixed.json');" }], [], 1],
  ['a fixed name with a row is allowed',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join("leaf-fixture");' }],
    [['a.rs', 'leaf-fixture', 'never written']], 0],
  ['a row for another file does not excuse it',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join("leaf-fixture");' }],
    [['b.rs', 'leaf-fixture', 'never written']], 2],
  ['a row that matches nothing is refused',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join(format!("leaf-{}", std::process::id()));' }],
    [['a.rs', 'leaf-gone', 'never written']], 1],
  ['the temp folder handed over whole names no file',
    [{ path: 'a.mjs', text: "sweep(tmpdir(), 'leaftext-keycode-');" }], [], 0],
  ['an escaped brace is not a value',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join(format!("leaf-{{fixed}}"));' }], [], 1],

  // A clock says what time it is, not which run asked, and it is the substitution that took the gate red.
  ['a clock read into the name is refused',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join(format!("leaf-x-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));' }], [], 1],
  ['a clock bound on the line above is refused too',
    [{ path: 'a.rs', text: 'let unique = SystemTime::now().as_nanos();\nlet d = std::env::temp_dir().join(format!("leaf-x-{unique}"));' }], [], 1],
  ['a clock behind a function of its own is refused too',
    [{ path: 'a.rs', text: 'fn suffix() -> u128 { SystemTime::now().as_nanos() }\nlet d = std::env::temp_dir().join(format!("leaf-x-{}", suffix()));' }], [], 1],
  ['this run\'s own id passes with a clock beside it',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join(format!("leaf-x-{}-{}", std::process::id(), SystemTime::now().as_nanos()));' }], [], 0],
  ['a word passes',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join(format!("leaf-{label}-{}", std::process::id()));' }], [], 0],

  // Which test, read across files rather than down one.
  ['two calls to one helper carrying one word are refused',
    [{ path: 'a.rs', text: HELPERS + '\nfn one() { corpus("empty"); }\nfn two() { corpus("empty"); }' }], [], 1],
  ['the same word under two helpers passes, because their folders differ',
    [{ path: 'a.rs', text: HELPERS + '\nfn one() { corpus("empty"); }\nfn two() { clouds("empty"); }' }], [], 0],
  ['a word handed straight through a wrapper lands in the wrapped helper\'s namespace',
    [{ path: 'a.rs', text: HELPERS + '\nfn one() { corpus("empty"); }\nfn two() { filtered("empty"); }' }], [], 1],
  ['two calls in two files are the same folder',
    [{ path: 'a.rs', text: HELPERS + '\nfn one() { corpus("empty"); }' },
     { path: 'b.rs', text: 'fn two() { corpus("empty"); }' }], [], 1],
  ['a helper whose folder has no readable head is refused, because a word under it cannot be counted',
    [{ path: 'a.rs', text: 'fn odd(tag: &str) -> PathBuf { std::env::temp_dir().join(format!("{tag}{}", std::process::id())) }' }], [], 1],
  ['a builder of fixed names is not a scratch helper, so its words are nobody\'s',
    [{ path: 'a.rs', text: 'fn fixture(name: &str) -> PathBuf { std::env::temp_dir().join("leaf-fixtures").join(name) }\nfn one() { fixture("a.md"); }\nfn two() { fixture("a.md"); }' }],
    [['a.rs', 'leaf-fixtures', 'never written']], 0],

  // Where the name came from, because the builder holds the interpolation and the caller's fixed string is what two gates shared.
  ['a fixed name handed to a scratch path builder is refused',
    [{ path: 'a.mjs', text: `${BUILDER}\nconst p = record('aaaa-1111');` }], [], 1],
  ['a fixed name bound above the call is refused too',
    [{ path: 'a.mjs', text: `${BUILDER}\nconst ONE = 'aaaa-1111';\nconst p = record(ONE);` }], [], 1],
  ['a name carrying this run\'s own id passes',
    [{ path: 'a.mjs', text: `${BUILDER}\nconst ONE = \`selftest-\${process.pid}-one\`;\nconst p = record(ONE);` }], [], 0],
  ['an empty name is the builder\'s own answer, not a fixed one',
    [{ path: 'a.mjs', text: `${BUILDER}\nconst p = record('');` }], [], 0],
  ['no argument at all is that same answer',
    [{ path: 'a.mjs', text: `${BUILDER}\nconst p = record();` }], [], 0],
  ['a builder handed the folder as well is outside this rule, because the OS made that parent',
    [{ path: 'a.mjs', text: "function under(tag, dir = mkdtempSync(join(tmpdir(), 'leaf-'))) { return join(dir, `leaf-${tag}.json`); }\nconst p = under('aaaa-1111');" }], [], 0],
  ['a caller in another file is read too',
    [{ path: 'a.mjs', text: BUILDER }, { path: 'b.mjs', text: "const p = record('aaaa-1111');" }], [], 1],
  ['a builder naming this run itself is outside this rule, because its argument is a word rather than the name',
    [{ path: 'a.mjs', text: "function per(word) {\n  return join(tmpdir(), `leaf-per-${process.pid}-${word}`);\n}\nconst p = per('missing-one');" }], [], 0],

  // Which test, in the other language: the word rule reads a JavaScript helper the way it reads a Rust one, and both sit in one set.
  ['two calls to one JavaScript helper carrying one word are refused',
    [{ path: 'a.mjs', text: `${JS_HELPERS}\nconst one = boot('empty');\nconst two = boot(\`empty\`);` }], [], 1],
  ['the same word under two JavaScript helpers passes, because their folders differ',
    [{ path: 'a.mjs', text: `${JS_HELPERS}\nconst one = boot('empty');\nconst two = docs('empty');` }], [], 0],
  ['two calls to one JavaScript helper in two files are the same folder',
    [{ path: 'a.mjs', text: `${JS_HELPERS}\nconst one = boot('empty');` },
     { path: 'b.mjs', text: "const two = boot('empty');" }], [], 1],
  ['a Rust helper and a JavaScript one building one head are refused, because the folder does not know which made it',
    [{ path: 'a.rs', text: 'fn boot_dir(word: &str) -> PathBuf { std::env::temp_dir().join(format!("leaf-boot-{word}-{}", std::process::id())) }' },
     { path: 'b.mjs', text: JS_HELPERS }], [], 1],
];

const testFails = [];
for (const [name, files, rows, want] of CASES) {
  const got = problems(files, rows).length;
  if (got !== want) testFails.push(`${name}: ${got} findings, wanted ${want}`);
}
if (testFails.length) {
  console.error('scratch names: the rules are wrong, so nothing was read:');
  for (const line of testFails) console.error(`  ${line}`);
  process.exit(1);
}

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.(rs|mjs|mts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = sources(root)
  .map((full) => relative(root, full).split(sep).join('/'))
  .filter((path) => path !== SELF)
  .map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));

const found = problems(files, ON_PURPOSE);
if (found.length) {
  console.error('a scratch path two runs would share:');
  for (const line of found) console.error(`  ${line}`);
  process.exit(1);
}

const paths = files.reduce((n, { text }) => n + scratchPaths(text).length, 0);
console.log(`scratch names: ok (${paths} scratch paths, ${ON_PURPOSE.length} fixed on purpose)`);
