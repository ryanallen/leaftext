#!/usr/bin/env node
// An MCP server wrapping the running app's ask pipe, so an AI can ask a live Leaftext questions instead of reading what it wrote earlier.
//
//   node scripts/mcp-leaftext.mjs          speak MCP on stdin/stdout
//   node scripts/mcp-leaftext.mjs --ask '{"ask":"state"}'   one question, for a person
//
// It is a wrapper and nothing else: every answer comes from `src/pipe.rs`, and adding an ask there is what adds a tool here. **Never a shipped artifact** — one MSI and one DMG is the rule, and every extra file in a release is one somebody has to ask about. Build it on demand; it is not in either release workflow, and `just verify` cannot run it because it needs the app running.
//
// No dependency, not even the MCP SDK: the stdio transport is newline-delimited JSON-RPC, which is the hundred lines below.

import net from 'node:net';
import process from 'node:process';
import readline from 'node:readline';
import { probeName } from './probe-copy.mjs';

// The address the app listens on. Written in src/pipe.rs — `address()` — and the folder it sits in comes from `project_data_local_dir()` in src/lib.rs. scripts/check-mcp.mjs fails if the pipe's name here and there drift apart.
const PIPE_NAME = 'leaftext-journal-';

// Said on the error stream, because the reply on the output stream is what MCP reads, and said only when it changes. A person running one ask in a terminal is otherwise guessing which window answered.
const UNSAID = Symbol('nothing said yet');
let saidCopy = UNSAID;
function announce(name) {
  if (saidCopy === name) return;
  const first = saidCopy === UNSAID;
  saidCopy = name;
  const account = process.env.USERNAME ?? 'this account';
  if (name) console.error(`answered by the probe copy launched under ${name}, not by the one running as ${account} — 'just probe-close' hands it back`);
  else if (!first) console.error(`answered by the copy running as ${account} again`);
}

function address() {
  if (process.platform === 'win32') {
    // A copy this session launched with `just probe-copy` is the one it asks, so a build can watch a change in a real window without taking the one the owner is reading. The fallback is the ambient account: no pointer, a pointer naming a process that is gone, or a caller that has already set the account name to the copy it means. Read fresh every ask rather than once at startup, because this process is long-lived when it speaks MCP and a probe is usually launched after it.
    const probe = probeName();
    announce(probe);
    return `\\\\.\\pipe\\${PIPE_NAME}${probe ?? process.env.USERNAME ?? ''}`;
  }
  return `${process.env.HOME ?? ''}/Library/Application Support/com.ryanallen.leaftext/journal.sock`;
}

/** One ask down the pipe, one reply back. */
function askApp(request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(address());
    let reply = '';
    socket.setTimeout(10_000);
    socket.on('connect', () => {
      const text = JSON.stringify(request);
      // A Windows named pipe has no half-close: ending the socket closes the whole handle, and the reply lands on a pipe with nobody at this end. The server there reads one message and does not wait for EOF. A Unix socket does wait for it, so there the write has to be the last thing.
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

// The whole document workflow in one line, carried in the description of every tool that is part of it, since a tool set is read one description at a time.
const WORKFLOW =
  'The workflow for working on ordinary text is leaftext_doc to read it and take its fingerprint, leaftext_edit for each change, leaftext_idle to wait for the window to redraw, leaftext_save to write it, then leaftext_state to see it is no longer unsaved. A task checkbox is not that: it is leaftext_doc then leaftext_toggle_task, which writes the file itself.';

// The shorter one, for the checkbox path: two calls rather than five, and no byte offset at either end.
const TASK_WORKFLOW =
  'A task checkbox is leaftext_doc to read the document and its task list, then leaftext_toggle_task on the task you want — it writes the file itself, so there is no leaftext_edit and no leaftext_save.';

// One entry per ask in `Ask` (src/pipe.rs). A new variant there is a new row here and nothing else.
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
      'What the app has open right now: its tabs, which is active, which have unsaved edits, and the active vault. With `reader` set it also carries what the page can see — the scroll position and the block it is anchored to, which panels are open, the selected text, and whether a render is still in flight. Leave `reader` off when the app may be stuck: the tab list answers without the page, and the reader half does not.',
    inputSchema: {
      type: 'object',
      properties: {
        reader: { type: 'boolean', description: 'Also ask the page what the reader can see' },
      },
    },
    ask: (args) => ({ ask: 'state', reader: !!args.reader }),
  },
  {
    name: 'leaftext_eval',
    description:
      'Run a line of JavaScript inside the app page and return what it evaluated to. A line that failed comes back as a failure rather than as an answer: one that threw carries the message and stack the engine gave it, and one the page never read at all — a syntax error, or a `const` an earlier call already declared — says so. So `null` now means the line really did evaluate to nothing. This is arbitrary code execution inside the running app.',
    inputSchema: {
      type: 'object',
      properties: { script: { type: 'string', description: 'JavaScript to evaluate' } },
      required: ['script'],
    },
    ask: (args) => ({ ask: 'eval', script: String(args.script ?? '') }),
  },
  {
    name: 'leaftext_doc',
    description:
      `A document's source, as the app holds it. Opens the file, or brings it to the front if it is already open, so the window shows what you are working on. Answers the text, how the file is spelled (its encoding and whether it has a byte order mark), whether it has edits nobody has saved, a fingerprint, and its \`tasks\` — every Markdown checkbox in document order, each with its checked state and its own words. **That list is what a checkbox is addressed by**: hand its position to leaftext_toggle_task rather than working out a marker offset from the source beside it. Read a file this way rather than through the shell, and write it back the same way: the app keeps the spelling the file arrived with, which is what rewriting a file through terminal text output loses. ${WORKFLOW}`,
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'The file to read' } },
      required: ['path'],
    },
    ask: (args) => ({ ask: 'doc', path: String(args.path ?? '') }),
  },
  {
    name: 'leaftext_edit',
    description:
      `Replace the bytes from \`start\` to \`end\` of the document at the front with \`text\`, as one undo step the reader can take back. The offsets count bytes of the UTF-8 text leaftext_doc answered — a whole-document rewrite is 0 to its length. \`expect\` is the fingerprint that answer carried: if the document has changed since, nothing is written and the refusal says what the fingerprint is now, so read it again and redo the edit against what is there. Nothing reaches the file until leaftext_save. ${WORKFLOW}`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The document being edited' },
        start: { type: 'number', description: 'First byte to replace' },
        end: { type: 'number', description: 'One past the last byte to replace' },
        text: { type: 'string', description: 'What goes in its place' },
        expect: { type: 'string', description: 'The fingerprint leaftext_doc answered' },
      },
      required: ['path', 'start', 'end', 'text', 'expect'],
    },
    ask: (args) => ({
      ask: 'edit',
      path: String(args.path ?? ''),
      start: Number(args.start ?? 0),
      end: Number(args.end ?? 0),
      text: String(args.text ?? ''),
      expect: String(args.expect ?? ''),
    }),
  },
  {
    name: 'leaftext_toggle_task',
    description:
      `Check or clear one task of the document at the front, and write the file at once — the same action a person clicking that checkbox makes, so there is no separate save. \`index\` is the task's place in the \`tasks\` list leaftext_doc answered, counting from zero: name a task by that position rather than working out a byte offset. \`expect\` is the fingerprint that answer carried; if the document has changed since, nothing is written and the refusal says what the fingerprint is now, so read it again. It also refuses a document that is not at the front, a document that is not Markdown, and an index naming no task — in every case before a byte is written. Answers the path, the task's new checked state, and the fresh fingerprint. ${TASK_WORKFLOW}`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The document holding the task' },
        index: { type: 'number', description: "The task's place in the list leaftext_doc answered, from zero" },
        expect: { type: 'string', description: 'The fingerprint leaftext_doc answered' },
      },
      required: ['path', 'index', 'expect'],
    },
    ask: (args) => ({
      ask: 'task',
      path: String(args.path ?? ''),
      index: Number(args.index ?? 0),
      expect: String(args.expect ?? ''),
    }),
  },
  {
    name: 'leaftext_save',
    description:
      `Write the document at the front to its file, the way the app's own Save does — so the file keeps the encoding and byte order mark it was read with, which is what rewriting a file through the shell cannot promise. \`expect\` is the fingerprint of the text you mean to save, as the last read or edit answered it. A document that has never been saved is refused: only the person at the window can say where a new file goes. ${WORKFLOW}`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The document to write' },
        expect: { type: 'string', description: 'The fingerprint of the text being saved' },
      },
      required: ['path', 'expect'],
    },
    ask: (args) => ({
      ask: 'save',
      path: String(args.path ?? ''),
      expect: String(args.expect ?? ''),
    }),
  },
  {
    name: 'leaftext_export',
    description:
      "Write the page at the front out as a PDF at a path you name, with no save dialog in the way — the same render the app's Export button runs. `width` and `height` are the page's own measurement of the sheet the document needs: read them with leaftext_eval of `pageExportSize()` rather than working them out, or what comes back is a reading of your arithmetic instead of the app's. Answers where it wrote and the size it was given.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Where the PDF goes' },
        width: { type: 'number', description: "The sheet's width in CSS pixels, from pageExportSize()" },
        height: { type: 'number', description: "The sheet's height in CSS pixels, from pageExportSize()" },
      },
      required: ['path', 'width', 'height'],
    },
    ask: (args) => ({
      ask: 'export',
      path: String(args.path ?? ''),
      width: Number(args.width ?? 0),
      height: Number(args.height ?? 0),
    }),
  },
  {
    name: 'leaftext_shot',
    description:
      "Write the page at the front out as a picture at a path you name, with no save window in the way — the same picture the app's Export button writes. The ending on the path is the format, the way it is in that window. The whole document, not the visible view. `width` and `height` are the page's own measurement of the sheet: read them with leaftext_eval of `pageExportSize()` rather than working them out, or what comes back is a reading of your arithmetic instead of the app's. Answers where it wrote, the pixels the picture came out at, and how many bytes it weighs.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Where the picture goes; its ending is the format' },
        width: { type: 'number', description: "The document's width in CSS pixels, from pageExportSize()" },
        height: { type: 'number', description: "The document's height in CSS pixels, from pageExportSize()" },
      },
      required: ['path', 'width', 'height'],
    },
    ask: (args) => ({
      ask: 'shot',
      path: String(args.path ?? ''),
      width: Number(args.width ?? 0),
      height: Number(args.height ?? 0),
    }),
  },
  {
    name: 'leaftext_idle',
    description:
      'Wait until the page has finished rendering, then answer what the reader can see. Use it after a gesture instead of sleeping: it says whether the page settled, or that it was still rendering when the wait ran out.',
    inputSchema: { type: 'object', properties: {} },
    ask: () => ({ ask: 'idle' }),
  },
  {
    name: 'leaftext_version',
    description: 'The version of the build that is running.',
    inputSchema: { type: 'object', properties: {} },
    ask: () => ({ ask: 'version' }),
  },
  {
    name: 'leaftext_quit',
    description:
      "Close the running app the way its close button does, saving the window's size and place first. Answers that it is closing before it goes. Use this instead of killing the process — a kill is the one way out that skips the save, and the process name is shared with any other copy on the machine.",
    inputSchema: { type: 'object', properties: {} },
    ask: () => ({ ask: 'quit' }),
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
