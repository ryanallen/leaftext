#!/usr/bin/env node
// Turn a wireframe written as HTML into a PNG for a ticket.
//
//   node scripts/wireframe.mjs <sketch.html> <../docs/imgs/<ticket>-wireframe.png> [width] [height]
//   node scripts/wireframe.mjs --check
//
// A ticket that changes the window has to draw it, and a drawing has to be a picture — ASCII boxes come out ragged in every renderer that matters and are unreadable the moment a label runs long. So the sketch is written as HTML, which is the one drawing language everything here already speaks, and photographed by the browser that is already on the machine.
//
// Edge headless, not a crate and not a node package: it is the same engine the app's own web view runs on, it ships with Windows, and nothing is added to a tree where every dependency is a security boundary. On a Mac it takes Chrome or Edge, whichever is installed.
//
// The picture lands in `../docs/imgs/`, named after its ticket, because that is where every picture in the plan tree lives and a drawing in a chat is gone by the time somebody builds from it.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/// Where a browser lives on each platform, most likely first. The app's own web view is Edge on Windows and WebKit on macOS, so a shot taken here matches what a reader will see closely enough for a wireframe.
export const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** The browser to drive, or nothing where the machine has none. Exported because `check-grain-in-a-picture.mjs` lays the reading stylesheet out in the same engine, and two lists of where a browser lives would part company the first time one moved. */
export function findBrowser() {
  return BROWSERS.find((path) => existsSync(path));
}

// Everything below runs only when this file is the command being run, so importing `findBrowser` photographs nothing.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv[2] === '--check') {
    const browser = findBrowser();
    console.log(
      browser
        ? `wireframe: ${BROWSERS.length} browsers looked for, using ${browser}`
        : `wireframe: no browser found — a wireframe needs Edge or Chrome, which is not a build dependency`,
    );
    process.exit(0);
  }

  const [sketch, out, width = '760', height = '520'] = process.argv.slice(2);
  if (!sketch || !out) {
    console.error('usage: wireframe.mjs <sketch.html> <out.png> [width] [height]');
    process.exit(2);
  }
  if (!existsSync(sketch)) {
    console.error(`no sketch at ${sketch}`);
    process.exit(1);
  }
  const browser = findBrowser();
  if (!browser) {
    console.error('no Edge or Chrome on this machine, and a wireframe is not worth a dependency');
    process.exit(1);
  }

  const target = resolve(out);
  mkdirSync(dirname(target), { recursive: true });
  execFileSync(browser, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    `--screenshot=${target.replace(/\\/g, '/')}`,
    `--window-size=${width},${height}`,
    `file:///${resolve(sketch).replace(/\\/g, '/')}`,
  ]);
  console.log(`wireframe: ${target}`);
}
