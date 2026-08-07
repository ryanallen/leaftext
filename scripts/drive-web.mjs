#!/usr/bin/env node
// Drive the exported site in a real browser: click things, read the page back, photograph it.
//
//   node scripts/drive-web.mjs <url> [steps…]
//
//   eval:<js>          run it in the page and print what it returns
//   click:<selector>   click the first match
//   wait:<ms>          let the page catch up
//   shot:<file.png>    photograph the window
//
// The desktop has `just drive` for exactly this reason: a check that passes is not a thing that works, and the only way to know a button does what it says is to press it. This is that, for the browser half — Edge headless over its own debugging port, no package added.

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const [url, ...steps] = process.argv.slice(2);
if (!url) {
  console.error('node scripts/drive-web.mjs <url> [click:… eval:… wait:… shot:…]');
  process.exit(1);
}

const browser = BROWSERS.find((path) => {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
});
if (!browser) {
  console.error('no Edge or Chrome on this machine');
  process.exit(1);
}

const port = 9333 + Math.floor(process.pid % 400);
const profile = mkdtempSync(join(tmpdir(), 'leaf-drive-'));
const child = execFile(browser, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--window-size=1600,1000',
  url,
]);

/** Wait for the browser to publish its debugging address. */
async function target() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = pages.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error('the browser never opened its debugging port');
}

const socket = new WebSocket(await target());
await new Promise((done, fail) => {
  socket.onopen = done;
  socket.onerror = () => fail(new Error('could not attach to the page'));
});

let nextId = 0;
const waiting = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const held = waiting.get(message.id);
  if (!held) return;
  waiting.delete(message.id);
  message.error ? held.fail(new Error(message.error.message)) : held.done(message.result);
};

function send(method, params = {}) {
  const id = (nextId += 1);
  return new Promise((done, fail) => {
    waiting.set(id, { done, fail });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

/** Run an expression in the page and hand back what it evaluated to. */
async function evaluate(expression) {
  const answer = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.text);
  return answer.result.value;
}

// The page is already loading; give the front end and the module a moment before the first step.
await new Promise((done) => setTimeout(done, 3000));

let failed = false;
for (const step of steps) {
  const cut = step.indexOf(':');
  const verb = step.slice(0, cut);
  const rest = step.slice(cut + 1);
  try {
    if (verb === 'wait') {
      await new Promise((done) => setTimeout(done, Number(rest)));
    } else if (verb === 'eval') {
      console.log(JSON.stringify(await evaluate(rest)));
    } else if (verb === 'click') {
      const clicked = await evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(rest)}); if (!el) return 'nothing matches'; el.click(); return 'clicked'; })()`
      );
      console.log(`${rest}: ${clicked}`);
      if (clicked !== 'clicked') failed = true;
    } else if (verb === 'shot') {
      const file = resolve(rest);
      mkdirSync(dirname(file), { recursive: true });
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log(`shot ${file}`);
    } else {
      console.error(`not a step this knows: ${step}`);
      failed = true;
    }
  } catch (error) {
    console.error(`${step}: ${error.message}`);
    failed = true;
  }
}

socket.close();
child.kill();
process.exit(failed ? 1 : 0);
