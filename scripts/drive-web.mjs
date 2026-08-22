#!/usr/bin/env node
// Drive the exported site in a real browser: click things, read the page back, photograph it.
//
//   node scripts/drive-web.mjs <url> [steps…]
//
//   size:<w>,<h>       lay the page out at that window size
//   eval:<js>          run it in the page and print what it returns
//   click:<selector>   click the first match
//   wait:<ms>          let the page catch up
//   shot:<file.png>    photograph the window
//
// The window opens at 1600x1000 and a `size:` step relays the page out at another width, as many times in one run as it is given — which is the only way anything here can read a column that is written to grow with the window.
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

// A headless page hides itself five to nine seconds in, and a hidden page runs no animation frame — which is where the front end does every bit of its placing, so a click lands, the address is written, and the reader never moves while every step says it worked. Focus emulation is the one call measured to hold it awake past twenty seconds; `Page.bringToFront` and the two occlusion flags were all tried and none of them does.
await send('Emulation.setFocusEmulationEnabled', { enabled: true });

// The page is already loading; give the front end and the module a moment before the first step.
await new Promise((done) => setTimeout(done, 3000));

let failed = false;
let asleep = false;
for (const step of steps) {
  const cut = step.indexOf(':');
  const verb = step.slice(0, cut);
  const rest = step.slice(cut + 1);
  try {
    if (verb === 'size') {
      const [width, height] = rest.split(',').map(Number);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('a size is <width>,<height> in pixels');
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      // The layout is new the moment the override lands, and nothing has drawn against it: the front end does all of its placing on an animation frame, so a step reading the page straight after would read the old one.
      await new Promise((done) => setTimeout(done, 250));
      console.log(`size ${width}x${height}`);
    } else if (verb === 'wait') {
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
  // Read after every step rather than once at the end: a step that ran on a frozen page reported a success it could not have earned, and the run has to name that step rather than the last one. It is not on the step's own line — `eval:` prints what the page returned and nothing else, because whatever reads this parses that line as JSON.
  const visibility = await evaluate('document.visibilityState').catch(() => 'unreadable');
  if (visibility !== 'visible') {
    console.error(`${step}: the page was ${visibility}, so no frame ran and nothing this step reported can be trusted`);
    asleep = true;
    failed = true;
    break;
  }
}

if (steps.length && !asleep) console.log('the page stayed awake for every step');

socket.close();
child.kill();
process.exit(failed ? 1 : 0);
