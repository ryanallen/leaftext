// Mutable state belongs to its only writer, or in state.js when fragments share the writing.
//
// The same file owns where a shared name lives, for the four the whole front end writes text with: they were declared at the foot of the last fragment and called by seven loading ahead of it, which stood only because a function declaration hoists over the joined script.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, names, root } from './shared.mjs';

const ASSIGNMENTS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=']);
function tokenize(source) {
  const tokens = [];
  let index = 0;
  let line = 1;
  const push = (type, value, start, atLine) => tokens.push({ type, value, start, line: atLine });
  const skipQuoted = (quote) => {
    index += 1;
    while (index < source.length) {
      if (source[index] === '\n') line += 1;
      if (source[index] === '\\') index += 2;
      else if (source[index++] === quote) break;
    }
  };
  const regexMayStart = () => {
    const previous = tokens.at(-1);
    return !previous || !((previous.type === 'id') || previous.value === ')' || previous.value === ']' || previous.value === '}' || previous.value === '++' || previous.value === '--');
  };
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      if (char === '\n') line += 1;
      index += 1;
      continue;
    }
    if (source.startsWith('//', index)) {
      index = source.indexOf('\n', index);
      if (index < 0) break;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      const stop = end < 0 ? source.length : end + 2;
      line += (source.slice(index, stop).match(/\n/g) || []).length;
      index = stop;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      skipQuoted(char);
      continue;
    }
    if (char === '/' && regexMayStart() && source[index + 1] !== '=') {
      index += 1;
      let inClass = false;
      while (index < source.length) {
        if (source[index] === '\\') index += 2;
        else if (source[index] === '[') { inClass = true; index += 1; }
        else if (source[index] === ']') { inClass = false; index += 1; }
        else if (source[index] === '/' && !inClass) { index += 1; break; }
        else { if (source[index] === '\n') line += 1; index += 1; }
      }
      while (/[A-Za-z]/.test(source[index] || '')) index += 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index;
      const atLine = line;
      index += 1;
      while (/[\w$]/.test(source[index] || '')) index += 1;
      push('id', source.slice(start, index), start, atLine);
      continue;
    }
    if (/\d/.test(char)) {
      const start = index;
      index += 1;
      while (/[\w.]/.test(source[index] || '')) index += 1;
      push('number', source.slice(start, index), start, line);
      continue;
    }
    const operator = ['>>>=', '**=', '===', '!==', '>>>', '&&=', '||=', '??=', '=>', '++', '--', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=', '==', '!=', '<=', '>=', '&&', '||', '??', '**', '?.'].find((one) => source.startsWith(one, index));
    push('punct', operator || char, index, line);
    index += (operator || char).length;
  }
  return tokens;
}

function pairs(tokens, open, close) {
  const result = new Map();
  const stack = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === open) stack.push(index);
    if (tokens[index].value === close && stack.length) {
      const start = stack.pop();
      result.set(start, index);
      result.set(index, start);
    }
  }
  return result;
}

function analyze(file, source) {
  const tokens = tokenize(source);
  const braces = pairs(tokens, '{', '}');
  const brackets = pairs(tokens, '[', ']');
  const parens = pairs(tokens, '(', ')');
  const scopeAt = [];
  const scopes = [{ start: 0, end: tokens.length, parent: null, declarations: new Set() }];
  const stack = [scopes[0]];
  for (let index = 0; index < tokens.length; index += 1) {
    scopeAt[index] = stack.at(-1);
    if (tokens[index].value === '{') {
      const scope = { start: index, end: braces.get(index) ?? tokens.length, parent: stack.at(-1), declarations: new Set() };
      scopes.push(scope);
      stack.push(scope);
    } else if (tokens[index].value === '}' && stack.length > 1) stack.pop();
  }
  const declaredTokens = new Set();
  const globals = [];
  const declare = (tokenIndex, scope) => {
    if (tokenIndex < 0 || tokens[tokenIndex]?.type !== 'id') return;
    declaredTokens.add(tokenIndex);
    scope.declarations.add(tokens[tokenIndex].value);
  };
  for (let index = 0; index < tokens.length; index += 1) {
    if (!['let', 'const', 'var'].includes(tokens[index].value)) continue;
    const scope = scopeAt[index];
    let cursor = index + 1;
    let nesting = 0;
    let expectsBinding = true;
    while (cursor < tokens.length) {
      const value = tokens[cursor].value;
      if (!nesting && value === ';') break;
      if (!nesting && value === ',') { expectsBinding = true; cursor += 1; continue; }
      if (value === '{' || value === '[' || value === '(') nesting += 1;
      if (value === '}' || value === ']' || value === ')') nesting -= 1;
      if (expectsBinding && tokens[cursor].type === 'id') {
        declare(cursor, scope);
        if (scope === scopes[0] && tokens[index].value !== 'const') globals.push({ name: value, file, line: tokens[cursor].line });
        expectsBinding = false;
      }
      if (!nesting && value === '=') expectsBinding = false;
      cursor += 1;
    }
  }
  for (const [open, close] of parens) {
    if (open > close) continue;
    const before = tokens[open - 1]?.value;
    const after = tokens[close + 1]?.value;
    const isFunction = before === 'function' || tokens[open - 2]?.value === 'function' || after === '=>';
    if (!isFunction || tokens[close + (after === '=>' ? 2 : 1)]?.value !== '{') continue;
    const body = scopeAt[close + (after === '=>' ? 2 : 1) + 1];
    for (let cursor = open + 1; cursor < close; cursor += 1) {
      if (tokens[cursor].type !== 'id') continue;
      if (tokens[cursor + 1]?.value === ':' || tokens[cursor - 1]?.value === '.') continue;
      declare(cursor, body);
    }
  }
  const assignments = [];
  const assigned = (tokenIndex) => {
    const token = tokens[tokenIndex];
    if (!token || token.type !== 'id' || declaredTokens.has(tokenIndex) || tokens[tokenIndex - 1]?.value === '.' || tokens[tokenIndex - 1]?.value === '?.') return;
    assignments.push({ name: token.value, file, line: token.line, scope: scopeAt[tokenIndex] });
  };
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type === 'id' && (ASSIGNMENTS.has(tokens[index + 1]?.value) || tokens[index - 1]?.value === '++' || tokens[index - 1]?.value === '--' || tokens[index + 1]?.value === '++' || tokens[index + 1]?.value === '--')) assigned(index);
    if (tokens[index].value !== '=') continue;
    const close = index - 1;
    const open = brackets.get(close) ?? braces.get(close);
    if (open === undefined || open > close) continue;
    for (let cursor = open + 1; cursor < close; cursor += 1) {
      if (tokens[cursor].type !== 'id' || tokens[cursor + 1]?.value === ':' || tokens[cursor - 1]?.value === '.') continue;
      assigned(cursor);
    }
  }
  return { assignments, globals, scopes };
}

function resolvesToLocal(assignment) {
  for (let scope = assignment.scope; scope?.parent; scope = scope.parent) {
    if (scope.declarations.has(assignment.name)) return true;
  }
  return false;
}

export function foreignAssignments(fragments) {
  const scans = fragments.map(({ file, source }) => analyze(file, source));
  const globals = new Map();
  for (const analysis of scans) for (const binding of analysis.globals) globals.set(binding.name, binding);
  const found = new Map();
  for (const analysis of scans) {
    for (const assignment of analysis.assignments) {
      const binding = globals.get(assignment.name);
      if (!binding || binding.file === assignment.file || resolvesToLocal(assignment) || binding.file === 'shell/state.js') continue;
      const key = `${binding.file}:${binding.name}`;
      if (!found.has(key)) found.set(key, { ...binding, sites: [] });
      found.get(key).sites.push(`${assignment.file}:${assignment.line}`);
    }
  }
  return found;
}

function ownershipProblems(found, baseline) {
  const problems = [];
  for (const [key, binding] of found) if (!baseline.has(key)) problems.push(`${binding.file}:${binding.line} ${binding.name} is assigned from ${binding.sites.join(', ')}`);
  for (const key of baseline) if (!found.has(key)) problems.push(`${key} is in the ownership baseline and is no longer a fault`);
  return problems;
}

function proveScanner() {
  const fragments = [
    { file: 'shell/one.js', source: "let owned = 0;\nowned = 1;\nlet direct = 0, compound = 0, rising = 0, falling = 0, unpacked = 0, shadowed = 0, ignored = 0;\n" },
    { file: 'shell/two.js', source: "direct = 1; compound += 1; rising++; --falling; [unpacked] = values;\n// ignored = 1\nconst words = 'ignored = 1';\nconst template = `ignored = 1`;\nthing.ignored = 1;\nfunction local(shadowed) { shadowed = 1; }\n" },
  ];
  const found = foreignAssignments(fragments);
  const expected = ['direct', 'compound', 'rising', 'falling', 'unpacked'];
  if (found.size !== expected.length || expected.some((name) => !found.has(`shell/one.js:${name}`))) throw new Error(`the planted assignment forms were not resolved: ${[...found.keys()].join(', ')}`);
  if (found.has('shell/one.js:owned') || found.has('shell/one.js:shadowed') || found.has('shell/one.js:ignored')) throw new Error('an owned, shadowed, or masked assignment was called foreign');
  const unknown = ownershipProblems(found, new Set());
  if (!unknown.some((one) => one.includes('shell/one.js') && one.includes('direct'))) throw new Error('an unknown ownership fault passed without its file and binding');
  const stale = ownershipProblems(new Map(), new Set(['shell/one.js:stale']));
  if (!stale.some((one) => one.includes('shell/one.js:stale'))) throw new Error('a stale ownership baseline entry passed without its file and binding');
}

// ---- where a shared name lives ----------------------------------------------

// The four the whole front end writes text with. Their home is pinned rather than left to hoisting: seven fragments call them and every one loads ahead of the file declaring them, so a move back into a subject file breaks nothing a boot would notice.
const TEXT_HELPERS = ['escapeText', 'escapeAttr', 'formatCount', 'formatCountLabel'];
const TEXT_HELPER_HOME = 'shell/text.js';

function textHelperProblems(fragments) {
  const declaredIn = new Map(TEXT_HELPERS.map((name) => [name, []]));
  for (const { file, source } of fragments) {
    for (const name of TEXT_HELPERS) {
      const declarations = source.match(new RegExp(String.raw`^[ \t]*function\s+` + name + String.raw`\s*\(`, 'gm')) || [];
      for (const _ of declarations) declaredIn.get(name).push(file);
    }
  }
  const problems = [];
  for (const [name, files] of declaredIn) {
    if (!files.length) problems.push(`${name} is declared in no fragment; it belongs in ${TEXT_HELPER_HOME}`);
    else if (files.length > 1) problems.push(`${name} is declared in ${files.join(' and ')}; it belongs in ${TEXT_HELPER_HOME} alone`);
    else if (files[0] !== TEXT_HELPER_HOME) problems.push(`${name} is declared in ${files[0]}; it belongs in ${TEXT_HELPER_HOME}`);
  }
  return problems;
}

// Proved on made-up fragments before a real one is opened, so a green run is evidence the pin can still fail rather than an empty walk.
function proveTextHelperPin() {
  const declarations = (names) => `${names.map((name) => `function ${name}(value) { return value; }`).join('\n')}\n`;
  const home = { file: TEXT_HELPER_HOME, source: declarations(TEXT_HELPERS) };
  const caller = { file: 'shell/library.js', source: 'const label = formatCountLabel(1, "match", "matches");\n' };
  const settled = textHelperProblems([home, caller]);
  if (settled.length) throw new Error(`the four in their own fragment were called a fault: ${settled.join('; ')}`);
  const moved = textHelperProblems([
    { file: TEXT_HELPER_HOME, source: declarations(['escapeAttr', 'formatCount', 'formatCountLabel']) },
    { file: 'shell/minimap.js', source: declarations(['escapeText']) },
  ]);
  if (!moved.some((one) => one.includes('escapeText') && one.includes('shell/minimap.js'))) throw new Error(`a helper declared outside its home passed without its name and the fragment holding it: ${moved.join('; ')}`);
  const copied = textHelperProblems([home, { file: 'shell/library.js', source: '  function formatCount(value) { return value; }\n' }]);
  if (!copied.some((one) => one.includes('formatCount') && one.includes('shell/library.js') && one.includes(TEXT_HELPER_HOME))) throw new Error(`a second copy passed without both fragments holding it: ${copied.join('; ')}`);
  const dropped = textHelperProblems([caller]);
  if (dropped.length !== TEXT_HELPERS.length) throw new Error(`a fragment list with no home for the four passed: ${dropped.join('; ')}`);
}

function shellFragments() {
  return names.filter((name) => name.startsWith('shell/')).map((file) => ({ file, source: readFileSync(join(root, 'src/assets', file), 'utf8') }));
}

export function run() {
  check('mutable front-end state is assigned only by its owning fragment', () => {
    proveScanner();
    if (names[0] !== 'shell/journal.js' || names[1] !== 'shell/state.js') throw new Error(`the shell must load journal.js then state.js, found ${names.slice(0, 2).join(', ')}`);
    const found = foreignAssignments(shellFragments());
    const problems = ownershipProblems(found, new Set());
    if (problems.length) throw new Error(problems.join('; '));
  });
  check(`the four helpers the front end writes text with are declared in ${TEXT_HELPER_HOME} alone`, () => {
    proveTextHelperPin();
    const problems = textHelperProblems(shellFragments());
    if (problems.length) throw new Error(problems.join('; '));
  });
}
