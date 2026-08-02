#!/usr/bin/env node
// The MCP wrapper is a second copy of two things the app decides: what can be
// asked, and where to ask it. This is what keeps the copy honest.
//
//   node scripts/check-mcp.mjs   (`just verify`)
//
// The wrapper itself cannot be in the suite — it needs a running app — but this
// reads two files and nothing else, so a renamed pipe or an ask with no tool
// fails here rather than the next time somebody tries to use it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

if (problems.length) {
  console.error('the MCP wrapper and the app disagree:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('The wrapper wraps src/pipe.rs; adding an ask there is what adds a tool.');
  process.exit(1);
}
console.log(`mcp: ${asks.length} asks, each with a tool, on the address the app listens on`);
