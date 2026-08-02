#!/usr/bin/env node
// An MCP server wrapping the running app's ask pipe, so an AI can ask a live
// Leaftext questions instead of reading what it wrote earlier.
//
//   node scripts/mcp-leaftext.mjs          speak MCP on stdin/stdout
//   node scripts/mcp-leaftext.mjs --ask '{"ask":"state"}'   one question, for a person
//
// It is a wrapper and nothing else: every answer comes from `src/pipe.rs`, and
// adding an ask there is what adds a tool here. **Never a shipped artifact** —
// one MSI and one DMG is the rule, and every extra file in a release is one
// somebody has to ask about. Build it on demand; it is not in either release
// workflow, and `just verify` cannot run it because it needs the app running.
//
// No dependency, not even the MCP SDK: the stdio transport is newline-delimited
// JSON-RPC, which is the hundred lines below.

import net from 'node:net';
import process from 'node:process';
import readline from 'node:readline';

// The address the app listens on. Written in src/pipe.rs — `address()` — and the
// folder it sits in comes from `project_data_local_dir()` in src/lib.rs.
// scripts/check-mcp.mjs fails if the pipe's name here and there drift apart.
const PIPE_NAME = 'leaftext-journal-';

function address() {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\${PIPE_NAME}${process.env.USERNAME ?? ''}`;
  }
  const home = process.env.HOME ?? '';
  return `${home}/Library/Application Support/com.ryanallen.leaftext/journal.sock`;
}

/** One ask down the pipe, one reply back. */
function askApp(request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(address());
    let reply = '';
    socket.setTimeout(10_000);
    socket.on('connect', () => {
      const text = JSON.stringify(request);
      // A Windows named pipe has no half-close: ending the socket closes the
      // whole handle, and the reply lands on a pipe with nobody at this end.
      // The server there reads one message and does not wait for EOF. A Unix
      // socket does wait for it, so there the write has to be the last thing.
      if (process.platform === 'win32') socket.write(text);
      else socket.end(text);
    });
    socket.on('data', (chunk) => {
      reply += chunk;
    });
    socket.on('close', () => resolve(reply));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('the app did not answer in ten seconds'));
    });
    socket.on('error', (error) => {
      reject(
        error.code === 'ENOENT' || error.code === 'ECONNREFUSED'
          ? new Error('Leaftext is not running, so there is nothing to ask')
          : error
      );
    });
  });
}

// One entry per ask in `Ask` (src/pipe.rs). A new variant there is a new row here
// and nothing else.
const TOOLS = [
  {
    name: 'leaftext_log',
    description:
      "The running app's log file: everything it printed this session, plus any crash. Omit `lines` for the whole file.",
    inputSchema: {
      type: 'object',
      properties: { lines: { type: 'number', description: 'Only the last N lines' } },
    },
    ask: (args) => ({ ask: 'log', lines: args.lines ?? null }),
  },
  {
    name: 'leaftext_state',
    description:
      'What the app has open right now: its tabs, which is active, which have unsaved edits, and the active vault.',
    inputSchema: { type: 'object', properties: {} },
    ask: () => ({ ask: 'state' }),
  },
  {
    name: 'leaftext_eval',
    description:
      'Run a line of JavaScript inside the app page and return what it evaluated to. This is arbitrary code execution inside the running app.',
    inputSchema: {
      type: 'object',
      properties: { script: { type: 'string', description: 'JavaScript to evaluate' } },
      required: ['script'],
    },
    ask: (args) => ({ ask: 'eval', script: String(args.script ?? '') }),
  },
  {
    name: 'leaftext_version',
    description: 'The version of the build that is running.',
    inputSchema: { type: 'object', properties: {} },
    ask: () => ({ ask: 'version' }),
  },
];

async function callTool(name, args) {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (!tool) return { isError: true, text: `there is no tool called ${name}` };
  try {
    const reply = JSON.parse(await askApp(tool.ask(args ?? {})));
    return reply.ok
      ? { isError: false, text: typeof reply.answer === 'string' ? reply.answer : JSON.stringify(reply.answer, null, 2) }
      : { isError: true, text: reply.error };
  } catch (error) {
    return { isError: true, text: error.message };
  }
}

// ---- one question from a terminal -------------------------------------------

const askFlag = process.argv.indexOf('--ask');
if (askFlag >= 0) {
  const request = process.argv[askFlag + 1];
  askApp(JSON.parse(request)).then(
    (reply) => console.log(reply),
    (error) => {
      console.error(error.message);
      process.exit(1);
    }
  );
} else {
  serveMcp();
}

// ---- MCP over stdio ---------------------------------------------------------

function serveMcp() {
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });

  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    // A notification has no id and takes no reply.
    if (message.id === undefined) return;

    switch (message.method) {
      case 'initialize':
        reply(message.id, {
          protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'leaftext', version: '0.1.0' },
        });
        break;
      case 'tools/list':
        reply(message.id, {
          tools: TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
        break;
      case 'tools/call': {
        const { isError, text } = await callTool(message.params?.name, message.params?.arguments);
        reply(message.id, { content: [{ type: 'text', text }], isError });
        break;
      }
      default:
        send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `no method ${message.method}` },
        });
    }
  });
}
