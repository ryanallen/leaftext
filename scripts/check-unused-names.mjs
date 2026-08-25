#!/usr/bin/env node
// A name at the top of a file that the file never reaches for is a dependency that is not there: it says the file reads the disk, or boots the page, or reaches the checkout top, when it does none of those. The Rust half of this tree stops the build over exactly this; the JavaScript half had nothing at all.
//
//   node scripts/check-unused-names.mjs --check   fail on an imported name nothing under it uses (`just verify`)
//
// It reads the import half only. A name declared inside a file and never read is the same fault and is not covered, because finding it needs scope. The one shape it cannot see is a name shadowed by a later declaration of the same spelling: the word goes on appearing, so the import reads as used.
//
// Comments, string bodies, template bodies and regex literals are blanked to spaces before anything is looked for, because this tree writes full English sentences in its comments and names its shared vocabulary in plain English words, so a word search cannot tell a use from a mention. The import list is read out of the blanked text as well, or a script that writes JavaScript is read as importing what it writes.
//
// Third-party bytes and build output are skipped: nobody here writes them, and a folder a fresh checkout does not have cannot be part of a gate.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FOLDERS = ['scripts', 'src/assets/shell', 'site', 'web'];
const EXTENSIONS = ['.mjs', '.js', '.mts'];
const SKIP = ['vendor', 'dist', 'node_modules'];

// A slash after one of these words opens a regex; after a name, a number or a closing bracket it is division.
const REGEX_MAY_FOLLOW = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

function isNameChar(c) {
  return c !== undefined && /[A-Za-z0-9_$]/.test(c);
}

// Where a quoted string ends, or -1 if the quote was not one: a string does not cross a line.
function quoteEnd(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '\n') return -1;
    if (c === '\\') { i += 2; continue; }
    if (c === quote) return i;
    i += 1;
  }
  return -1;
}

// Where a regex literal ends, or -1 if this slash was division. A slash inside a character class is not the end.
function regexEnd(source, start, previous, word) {
  if (isNameChar(previous) && !REGEX_MAY_FOLLOW.has(word)) return -1;
  if (previous === ')' || previous === ']') return -1;
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const c = source[i];
    if (c === '\n') return -1;
    if (c === '\\') { i += 2; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return i;
    i += 1;
  }
  return -1;
}

// Every comment, string body, template body and regex body replaced by spaces, with every newline kept so line numbers still hold. A hole in a template literal stays code: a name used only in one is used.
export function blank(source) {
  const out = source.split('');
  const wipe = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  const n = source.length;
  const stack = [{ kind: 'code', depth: 0, hole: false }];
  let i = 0;
  let previous = '';
  let word = '';
  let textStart = 0;
  if (source.startsWith('#!')) {
    const end = source.indexOf('\n');
    i = end === -1 ? n : end;
    wipe(0, i);
  }
  while (i < n) {
    const top = stack[stack.length - 1];
    const c = source[i];
    if (top.kind === 'template') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { wipe(textStart, i); stack.pop(); previous = '`'; word = ''; i += 1; continue; }
      if (c === '$' && source[i + 1] === '{') { wipe(textStart, i); stack.push({ kind: 'code', depth: 0, hole: true }); previous = '{'; word = ''; i += 2; continue; }
      i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      wipe(i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      wipe(i, stop);
      i = stop;
      continue;
    }
    if (c === '/') {
      const end = regexEnd(source, i, previous, word);
      if (end !== -1) { wipe(i + 1, end); i = end + 1; previous = '/'; word = ''; continue; }
      previous = '/';
      word = '';
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = quoteEnd(source, i);
      if (end !== -1) { wipe(i + 1, end); i = end + 1; previous = c; word = ''; continue; }
      i += 1;
      continue;
    }
    if (c === '`') { stack.push({ kind: 'template' }); textStart = i + 1; i += 1; continue; }
    if (c === '{') { top.depth += 1; previous = '{'; word = ''; i += 1; continue; }
    if (c === '}') {
      if (top.depth === 0 && top.hole) { stack.pop(); textStart = i + 1; i += 1; continue; }
      if (top.depth > 0) top.depth -= 1;
      previous = '}';
      word = '';
      i += 1;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i += 1; continue; }
    if (isNameChar(c)) {
      let j = i;
      while (j < n && isNameChar(source[j])) j += 1;
      word = source.slice(i, j);
      previous = source[j - 1];
      i = j;
      continue;
    }
    previous = c;
    word = '';
    i += 1;
  }
  return out.join('');
}

// An import statement, read off the blanked text. A side-effect import and a re-export both bind nothing, so neither matches: the first has no `from`, and the second opens with `export`.
const IMPORT = /(?:^|\n)[ \t]*import(?=[\s{*])([\w$,{}* \t\r\n]*?)from[ \t\r\n]*(['"]) *\2/g;

// What one import clause really binds: a default, a namespace under its `as` spelling, and each named binding under its own.
function bindingsIn(clause, base) {
  const tokens = [];
  const pattern = /[A-Za-z_$][\w$]*|[,{}*]/g;
  let match;
  while ((match = pattern.exec(clause)) !== null) tokens.push({ text: match[0], at: base + match.index });
  const bindings = [];
  let entry = [];
  const flush = () => {
    let parts = entry.filter((token) => token.text !== '*');
    if (parts.length > 1 && parts[0].text === 'type') parts = parts.slice(1);
    const as = parts.findIndex((token) => token.text === 'as');
    if (as !== -1) {
      if (parts[as + 1]) bindings.push(parts[as + 1]);
    } else if (parts.length === 1) bindings.push(parts[0]);
    entry = [];
  };
  for (const token of tokens) {
    if (token.text === ',' || token.text === '{' || token.text === '}') { flush(); continue; }
    entry.push(token);
  }
  flush();
  return bindings;
}

// The name standing on its own somewhere that is not an import statement. A property of the same spelling counts as a use on purpose: a gate two sessions run cannot afford to be wrong in the other direction.
function appearsOutside(text, name, spans) {
  let from = 0;
  for (;;) {
    const at = text.indexOf(name, from);
    if (at === -1) return false;
    from = at + name.length;
    if (isNameChar(text[at - 1]) || isNameChar(text[at + name.length])) continue;
    if (spans.some(([start, end]) => at >= start && at < end)) continue;
    return true;
  }
}

function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

export function unusedNames(source) {
  const text = blank(source);
  const statements = [];
  IMPORT.lastIndex = 0;
  let match;
  while ((match = IMPORT.exec(text)) !== null) {
    const clauseAt = match.index + match[0].indexOf('import') + 'import'.length;
    statements.push({ span: [match.index, match.index + match[0].length], bindings: bindingsIn(match[1], clauseAt) });
  }
  const spans = statements.map((statement) => statement.span);
  const dead = [];
  for (const statement of statements) {
    for (const bound of statement.bindings) {
      if (!appearsOutside(text, bound.text, spans)) dead.push({ name: bound.text, line: lineAt(text, bound.at) });
    }
  }
  return dead;
}

const CASES = [
  ['a name nothing under it uses', "import { readFileSync } from 'node:fs';\nconsole.log(1);\n", ['readFileSync']],
  ['a file using every name it imports', "import { readFileSync } from 'node:fs';\nreadFileSync('x');\n", []],
  ['a default and a namespace, both used', "import vm from 'node:vm';\nimport * as fs from 'node:fs';\nvm.run(fs);\n", []],
  ['a name used only inside a hole in a template literal', "import { root } from './x.mjs';\nconst where = `under ${root}`;\nconsole.log(where);\n", []],
  ['a name renamed with as and used under the new spelling', "import { check as assert } from './x.mjs';\nassert(1);\n", []],
  ['a name renamed with as and used under the old one', "import { check as assert } from './x.mjs';\ncheck(1);\n", ['assert']],
  ['a name whose only other appearance is inside a comment', "import { names } from './x.mjs';\n// the saved growl opens the file it names\n", ['names']],
  ['a name whose only other appearance is inside a check title', "import { source } from './x.mjs';\ncheck('the page keeps its source', () => {});\n", ['source']],
  ['a regex literal holding a backtick, which must not desync the rest', "import { existsSync } from 'node:fs';\nconst blanked = (s) => s.replace(/```[\\s\\S]*?```/g, ' ');\nexistsSync(blanked('x'));\n", []],
  ['an import line sitting inside a template literal', "const entry = `\nimport * as monaco from 'monaco';\nmonaco.start();\n`;\nconsole.log(entry);\n", []],
  ['an export from line, which binds no local name', "export { check, names } from './collector.mjs';\n", []],
  ['a side-effect import, which binds no local name', "import './boot.js';\nconsole.log(1);\n", []],
  ['an import clause spread over several lines', "import {\n  alpha,\n  beta,\n} from './x.mjs';\nalpha();\n", ['beta']],
  ['a shebang, whose path holds a slash that opens no regex', "#!/usr/bin/env node\nimport { join } from 'node:path';\njoin('a', 'b');\n", []],
];

function filesUnder(dir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.includes(entry.name)) found.push(...filesUnder(full));
      continue;
    }
    if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(full);
  }
  return found;
}

const problems = [];
for (const [name, source, expected] of CASES) {
  const found = unusedNames(source).map((dead) => dead.name).sort().join(', ');
  const want = [...expected].sort().join(', ');
  if (found !== want) problems.push(`this check reads ${name} as [${found}] rather than [${want}]`);
}

const files = FOLDERS.flatMap((folder) => filesUnder(join(root, folder))).sort();
for (const file of files) {
  const where = relative(root, file).split(sep).join('/');
  for (const dead of unusedNames(readFileSync(file, 'utf8'))) problems.push(`${where}:${dead.line} imports ${dead.name} and never uses it`);
}

if (problems.length) {
  console.error('a file names something it never reaches for:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`${files.length} JavaScript files: every imported name is used`);
