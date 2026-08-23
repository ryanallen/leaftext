#!/usr/bin/env node
// The MCP wrapper is a second copy of two things the app decides: what can be asked, and where to ask it. Its registration is a third copy of where the wrapper is. This is what keeps all three honest.
//
//   node scripts/check-mcp.mjs   (`just verify`)
//
// The wrapper itself cannot be in the suite — it needs a running app — but this reads four files and nothing else, so a renamed pipe, an ask with no tool, or a registration pointing at a file that moved fails here rather than the next time somebody tries to use it.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeName } from './probe-copy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pipe = readFileSync(join(root, 'src/pipe.rs'), 'utf8');
const wrapper = readFileSync(join(root, 'scripts/mcp-leaftext.mjs'), 'utf8');
const problems = [];

// ---- every ask has a tool ---------------------------------------------------

const enumBody = pipe.match(/pub\(crate\) enum Ask \{([\s\S]*?)\n\}/);
if (!enumBody) throw new Error('could not find `enum Ask` in src/pipe.rs');
const asks = [...enumBody[1].matchAll(/#\[serde\(rename = "(.*?)"\)\]/g)].map((m) => m[1]);
if (!asks.length) throw new Error('the Ask enum names no asks');

const wrapped = new Set([...wrapper.matchAll(/ask: '(.*?)'/g)].map((m) => m[1]));
for (const ask of asks) {
  if (!wrapped.has(ask)) problems.push(`src/pipe.rs answers "${ask}" and no tool offers it`);
}
for (const ask of wrapped) {
  if (!asks.includes(ask)) problems.push(`a tool offers "${ask}", which src/pipe.rs does not answer`);
}

// ---- the refusal names every ask ---------------------------------------------

// What a stranger who mistypes an ask is shown is a hand-written list, and nothing but this holds it to the enum beside it. A list one short is an ask the app answers and nobody is told about.
function listedProblems(named, refusalText) {
  const listed = [...refusalText.matchAll(/ask\\":\\"([a-z]+)/g)].map((m) => m[1]);
  if (!listed.length) return ['the refusal in src/pipe.rs names no ask at all, so this check is out of date too'];
  const found = [];
  for (const ask of named) {
    if (!listed.includes(ask)) found.push(`src/pipe.rs answers "${ask}" and the refusal does not offer it`);
  }
  for (const ask of listed) {
    if (!named.includes(ask)) found.push(`the refusal offers "${ask}", which src/pipe.rs does not answer`);
  }
  return found;
}

// A stand-in enum and refusal per way the two can disagree, because the live pair is right and a check that only ever sees a right answer proves nothing.
const LISTED_CASES = [
  ['a refusal one ask short', ['log', 'quit'], '{{\\"ask\\":\\"log\\"}}', true],
  ['a refusal offering an ask nobody answers', ['log'], '{{\\"ask\\":\\"log\\"}}, {{\\"ask\\":\\"sudo\\"}}', true],
  ['a refusal naming nothing', ['log'], 'it answers nothing at all', true],
  ['the pair that agrees', ['log', 'quit'], '{{\\"ask\\":\\"log\\"}}, {{\\"ask\\":\\"quit\\"}}', false],
];
for (const [name, named, refusalText, shouldFail] of LISTED_CASES) {
  const found = listedProblems(named, refusalText);
  if (shouldFail && !found.length) problems.push(`this check misses ${name}`);
  if (!shouldFail && found.length) problems.push(`this check fails ${name}: ${found[0]}`);
}

const refusal = pipe.match(/not an ask this app knows[\s\S]*?"\s*\)\)/);
if (!refusal) throw new Error('could not find the refusal for an unknown ask in src/pipe.rs');
problems.push(...listedProblems(asks, refusal[0]));

// ---- both ends agree where the pipe is --------------------------------------

const PIPE_NAME = 'leaftext-journal-';
if (!pipe.includes(PIPE_NAME)) {
  problems.push(`src/pipe.rs no longer listens on ${PIPE_NAME}…, so this check is out of date too`);
} else if (!wrapper.includes(`'${PIPE_NAME}'`)) {
  problems.push(`the app listens on ${PIPE_NAME}… and the wrapper connects somewhere else`);
}

// The socket half is a path, not a name, and it is built from the data folder.
if (!wrapper.includes('journal.sock') || !pipe.includes('journal.sock')) {
  problems.push('the socket file is named differently at the two ends');
}

// ---- which copy an ask lands on ---------------------------------------------

// The wrapper asks scripts/probe-copy.mjs before it reads the account name, so a copy `just probe-copy` launched is the one a build talks to. Read back on made-up pointers rather than on a live one, the way the registration above is: this stays offline and needs no app.
const POINTER_CASES = [
  ['a pointer naming a copy that is up', { pointer: { name: 'leaftext-probe-default', pid: 7 }, running: () => true }, 'leaftext-probe-default'],
  ['a pointer naming a process that is gone', { pointer: { name: 'leaftext-probe-default', pid: 7 }, running: () => false }, null],
  ['no pointer at all', { pointer: null, running: () => true }, null],
  ['a live pointer off Windows, where the socket is named after the home folder', { pointer: { name: 'leaftext-probe-default', pid: 7 }, running: () => true, platform: 'darwin' }, null],
  ['a caller that has already named the copy it means', { pointer: { name: 'leaftext-probe-default', pid: 7 }, running: () => true, accountOnly: true }, null],
];
for (const [name, given, wanted] of POINTER_CASES) {
  const got = probeName({ platform: 'win32', accountOnly: false, ...given });
  if (got !== wanted) {
    problems.push(`with ${name} an ask should go to ${wanted ?? 'the account it is running under'}, and it goes to ${got ?? 'the account it is running under'}`);
  }
}
if (!wrapper.includes('probeName()')) {
  problems.push('the wrapper no longer asks which copy a build launched before it reads the account name, so a probe copy is invisible to every question again');
}

// ---- the registration reaches the wrapper -----------------------------------

// Two files, each doing a half. `.mcp.json` at the repo root is where Claude Code reads server definitions from; the settings schema has no key for them, only `enabledMcpjsonServers` and its two neighbors, which approve what that file declares. A registration in the wrong one of the two would sit there doing nothing, and an agent would have no tools and a green check.
const SERVER = 'leaftext';
const WRAPPER = 'scripts/mcp-leaftext.mjs';

function registrationProblems(registrationText, settingsText, hasFile) {
  let servers;
  let approved;
  try {
    servers = JSON.parse(registrationText).mcpServers ?? {};
  } catch {
    return ['.mcp.json is not valid JSON, so no agent is given the tools'];
  }
  try {
    approved = JSON.parse(settingsText).enabledMcpjsonServers ?? [];
  } catch {
    return ['.agents/settings.json is not valid JSON'];
  }

  const found = [];
  const server = servers[SERVER];
  if (!server) {
    found.push(`.mcp.json declares no server called "${SERVER}"`);
  } else {
    const script = (server.args ?? []).find((arg) => arg.endsWith('.mjs'));
    if (!/(^|[\\/])node(\.exe)?$/.test(server.command ?? '')) {
      found.push(`the "${SERVER}" server runs "${server.command}", and the wrapper is a node script`);
    }
    if (!script) found.push(`the "${SERVER}" server names no script to run`);
    else if (script.split(/[\\/]/).join('/') !== WRAPPER) {
      found.push(`the "${SERVER}" server runs ${script}; the wrapper this file checks is ${WRAPPER}`);
    } else if (!hasFile(script)) {
      found.push(`the "${SERVER}" server runs ${script}, and there is no file there`);
    }
  }
  for (const name of Object.keys(servers)) {
    if (!approved.includes(name)) {
      found.push(`.mcp.json declares "${name}" and .agents/settings.json does not approve it, so it asks once a session`);
    }
  }
  for (const name of approved) {
    if (!(name in servers)) {
      found.push(`.agents/settings.json approves "${name}", which .mcp.json does not declare`);
    }
  }
  return found;
}

// One case per way the registration can be wrong, because the live files are right and a check that only ever sees a right answer proves nothing. Each of these has to produce at least one problem, and the last has to produce none.
const CASES = [
  ['a renamed wrapper', { leaftext: { command: 'node', args: ['scripts/mcp-leaf.mjs'] } }, [SERVER], () => true, true],
  ['a wrapper that is not there', { leaftext: { command: 'node', args: [WRAPPER] } }, [SERVER], () => false, true],
  ['something other than node', { leaftext: { command: 'python', args: [WRAPPER] } }, [SERVER], () => true, true],
  ['no script at all', { leaftext: { command: 'node', args: [] } }, [SERVER], () => true, true],
  ['no server of that name', { other: { command: 'node', args: [WRAPPER] } }, ['other'], () => true, true],
  ['a server the settings file does not approve', { leaftext: { command: 'node', args: [WRAPPER] } }, [], () => true, true],
  ['an approval for a server nobody declares', { leaftext: { command: 'node', args: [WRAPPER] } }, [SERVER, 'ghost'], () => true, true],
  ['the shape that is right', { leaftext: { command: 'node', args: [WRAPPER] } }, [SERVER], () => true, false],
];

for (const [name, servers, approved, hasFile, shouldFail] of CASES) {
  const found = registrationProblems(
    JSON.stringify({ mcpServers: servers }),
    JSON.stringify({ enabledMcpjsonServers: approved }),
    hasFile
  );
  if (shouldFail && !found.length) problems.push(`this check misses ${name}`);
  if (!shouldFail && found.length) problems.push(`this check fails ${name}: ${found[0]}`);
}
if (registrationProblems('{', '{}', () => true).length !== 1) {
  problems.push('this check does not report unreadable JSON as one problem');
}

problems.push(
  ...registrationProblems(
    readFileSync(join(root, '.mcp.json'), 'utf8'),
    readFileSync(join(root, '.agents/settings.json'), 'utf8'),
    (script) => existsSync(join(root, script))
  )
);

if (problems.length) {
  console.error('the MCP wrapper and the app disagree:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('The wrapper wraps src/pipe.rs; adding an ask there is what adds a tool.');
  process.exit(1);
}
console.log(`mcp: ${asks.length} asks, each with a tool, on the address the app listens on, an ask landing on the copy a build launched in ${POINTER_CASES.length} readings, and "${SERVER}" registered at the wrapper`);
