// The one headless browser every script here drives: where a browser lives, how one is started with its debugging port open, and the client that talks to it.
//
// Edge or Chrome over its own debugging port, no package added. Every script that photographs or drives a page reads this, because the list of where a browser lives and the focus emulation that keeps a headless page awake are each one forgotten line away from a picture of a page that never drew.
//
// The site's deploy runs `site-thumbnails.mjs` on a Linux runner, so this crosses to the public side with it and imports nothing private.

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where a browser lives on each platform, most likely first: Windows, then a Mac, then the Linux runner the site is published from. */
export const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/** The browser to drive, or nothing where the machine has none. */
export function findBrowser() {
  return BROWSERS.find((path) => {
    try {
      return existsSync(path);
    } catch {
      return false;
    }
  });
}

/**
 * A headless browser opened on `url` with its debugging port attached: `send` speaks the protocol, `evaluate` runs an expression in the page and answers what it came to, `close` ends the browser.
 *
 * Focus emulation is turned on before anything is handed back. A headless page hides itself five to nine seconds in, and a hidden page runs no animation frame — which is where the front end does every bit of its placing, so a click lands, the address is written, and the reader never moves while every step says it worked. It is the one call measured to hold it awake past twenty seconds; `Page.bringToFront` and the two occlusion flags were all tried and none of them does.
 */
export async function openHeadless(url, { width = 1600, height = 1000, browser = findBrowser() } = {}) {
  if (!browser) throw new Error('no Edge or Chrome on this machine');
  const port = 9333 + Math.floor(process.pid % 400);
  const profile = mkdtempSync(join(tmpdir(), 'leaf-drive-'));
  const child = execFile(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    // Ubuntu refuses the sandbox the unprivileged user namespaces it needs, and the only pages this ever opens are the site's own.
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    url,
  ]);

  let address = null;
  for (let attempt = 0; attempt < 60 && !address; attempt += 1) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      address = pages.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)?.webSocketDebuggerUrl ?? null;
    } catch {
      // not up yet
    }
    if (!address) await new Promise((done) => setTimeout(done, 250));
  }
  const close = () => {
    child.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // The browser may still hold a file in it for a moment; the system's own temporary folder clears it later.
    }
  };
  if (!address) {
    close();
    throw new Error('the browser never opened its debugging port');
  }

  const socket = new WebSocket(address);
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

  const send = (method, params = {}) => {
    const id = (nextId += 1);
    return new Promise((done, fail) => {
      waiting.set(id, { done, fail });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };

  const evaluate = async (expression) => {
    const answer = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.text);
    return answer.result.value;
  };

  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  return {
    send,
    evaluate,
    close: () => {
      socket.close();
      close();
    },
  };
}
