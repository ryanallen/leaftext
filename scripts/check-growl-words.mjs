#!/usr/bin/env node
// A growl that names a file it wrote is a press that opens the file, and the page draws that press only when the path arrives as its own value. The diagram export composed the path into its sentence instead, so the same path was words in one box and a press in the next, and the reader learned the box could not be trusted. Nothing found it; two call sites happened to sit near each other.
//
//   node scripts/check-growl-words.mjs --check   fail on a success growl that composes a value (`just verify`)
//
// Two clauses, because the helper is not the only door.
//
// The page's success growl is named in one file. `window.leafShowNotice` may be written in `src/scripts.rs` and in no other Rust source, or a module composes the page call itself and never touches the helper — which is exactly what three other modules already do for their own page calls.
//
// Every call to `notice_toast_script` passes a plain string literal: no `format!`, no bound variable, no concatenation. A path cannot reach a string except by being substituted into it, so a growl with nothing substituted cannot carry one. A rule that hunted for a path spelling instead would be a list of spellings, and it would lose to a message built on the line above and handed over by name.
//
// The failure side is untouched. `error_toast_script` keeps composing, because the file it names is the file that was *not* written and there is nothing there to press.
//
// What this refuses that is legitimate is a success growl carrying a count or a name. That value travels as its own parameter, the way `file_written_notice_script` takes the path, so the page writes the words and the host hands over the value.
//
// The rules are proved on made-up files before the real tree is opened, so a matcher that quietly stops matching fails the build instead of passing everything.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/// Nothing of ours is in these.
const SKIP = new Set(['target', 'node_modules', '.git', 'dist', '.tmp', 'vendor']);

/// The page call the host may write, and the one file it may be written in.
const PAGE_CALL = 'leafShowNotice';
const HOME = 'src/scripts.rs';

/// The helper whose argument may not be composed.
const HELPER = 'notice_toast_script';

/// The parenthesized argument of every call to `name`, with the line it starts on. The declaration is not a call, and neither is a mention inside a string or a comment.
export function calls(text, name) {
  const found = [];
  const at = new RegExp(`\\b${name}\\s*\\(`, 'g');
  for (const match of text.matchAll(at)) {
    const before = text.slice(0, match.index);
    if (/\bfn\s+$/.test(before)) continue;
    const open = match.index + match[0].length - 1;
    const argument = balanced(text, open);
    if (argument === null) continue;
    found.push({ line: before.split('\n').length, argument });
  }
  return found;
}

/// What sits between a `(` and the `)` that closes it, with string literals stepped over so a bracket inside one does not count. Null where nothing closes it.
export function balanced(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/// Whether an argument is a plain string literal and nothing else. A borrow of one still is; anything with a value substituted into it, bound to it or added onto it is not.
export function plainLiteral(argument) {
  const source = argument.trim().replace(/^&\s*/, '').trim();
  return /^"(?:[^"\\]|\\[\s\S])*"$/.test(source);
}

/// What is wrong with a set of files. Pure, so every refusal can be proved on input nobody has to keep in step.
export function problems(files) {
  const found = [];
  for (const { path, text } of files) {
    if (path !== HOME) {
      for (const match of text.matchAll(new RegExp(PAGE_CALL, 'g'))) {
        const line = text.slice(0, match.index).split('\n').length;
        found.push(`${path}:${line} writes the page's success growl itself, and only ${HOME} may — a call composed here never passes the helper, so nothing reads what it puts in the sentence. Send it through \`${HELPER}\`, or through \`file_written_notice_script\` where it names a file it wrote`);
      }
    }
    for (const { line, argument } of calls(text, HELPER)) {
      if (plainLiteral(argument)) continue;
      found.push(`${path}:${line} builds a success growl out of \`${argument.trim()}\` — a value composed into the sentence reaches the page as words, so a path there is read and never pressed. Hand the value over in its own parameter, the way \`file_written_notice_script\` takes the path and the page writes the word beside it`);
    }
  }
  return found;
}

const CASES = [
  ['the helper where it is declared and the page call in its own file',
    [{ path: HOME, text: `pub fn ${HELPER}(message: &str) -> String {\n    format!("window.${PAGE_CALL}({message});")\n}` }], 0],
  ['a plain literal',
    [{ path: 'a.rs', text: `${HELPER}("Copied");` }], 0],
  ['a plain literal borrowed',
    [{ path: 'a.rs', text: `${HELPER}(&"Copied");` }], 0],
  ['a literal carrying an escaped quote',
    [{ path: 'a.rs', text: `${HELPER}("Copied \\"it\\"");` }], 0],
  ['the failure growl composing a path, which is right — the file was not written',
    [{ path: 'a.rs', text: 'error_toast_script(&format!("Could not write {}", path.display()));' }], 0],
  ['the file written growl handing its path over whole',
    [{ path: 'a.rs', text: 'file_written_notice_script(&path.to_string_lossy());' }], 0],

  ['a path composed into the sentence',
    [{ path: 'a.rs', text: `${HELPER}(&format!("Saved {}", path.display()));` }], 1],
  ['a message bound on the line above',
    [{ path: 'a.rs', text: `let message = format!("Saved {}", path.display());\n${HELPER}(&message);` }], 1],
  ['a bare composition',
    [{ path: 'a.rs', text: `${HELPER}(&("Saved ".to_string() + &path));` }], 1],
  ['a value handed over with no words around it at all',
    [{ path: 'a.rs', text: `${HELPER}(&path.to_string_lossy());` }], 1],
  ['the page call written inline in another module',
    [{ path: 'a.rs', text: `let script = format!("window.${PAGE_CALL}(\\"Saved {}\\");", path.display());` }], 1],
  ['both faults in one file are both named',
    [{ path: 'a.rs', text: `window.${PAGE_CALL}("x");\n${HELPER}(&message);` }], 2],
];

const testFails = [];
for (const [name, files, want] of CASES) {
  const got = problems(files).length;
  if (got !== want) testFails.push(`${name}: ${got} findings, wanted ${want}`);
}
if (testFails.length) {
  console.error('growl words: the rules are wrong, so nothing was read:');
  for (const line of testFails) console.error(`  ${line}`);
  process.exit(1);
}

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (entry.name.endsWith('.rs')) out.push(full);
  }
  return out;
}

const files = sources(root)
  .map((full) => relative(root, full).split(sep).join('/'))
  .map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));

const found = problems(files);
if (found.length) {
  console.error('a success growl that composes a value of its own:');
  for (const line of found) console.error(`  ${line}`);
  process.exit(1);
}

const helperCalls = files.reduce((n, { text }) => n + calls(text, HELPER).length, 0);
console.log(`growl words: ok (${files.length} Rust files, ${helperCalls} success growls, all plain words)`);
