#!/usr/bin/env node
// Whether the dot grain survives the render behind the Export button, measured on the pixels rather than read off the stylesheet.
//
//   node scripts/check-grain-in-a-picture.mjs          render the reading stylesheet and say what the code block came out as
//   node scripts/check-grain-in-a-picture.mjs --check  exit 1 unless the grain is absent without the fix and present with it (`just verify`)
//
// Every other reading of the grain in this tree reads the stylesheet, and the stylesheet was right the whole time an exported picture was arriving flat: a `background-attachment: fixed` layer paints nothing at all in the capture unless the box holding it composites, and no rule anybody could read says so. So this one lays the compiled stylesheet out over a fixture document with the paper class on, captures it the way `src/app/fileops.rs` does — `Page.captureScreenshot`, beyond the viewport, clipped to the whole document — and samples the code block for the two shades a dithered surface has.
//
// `--check` renders four times: at a display scale of 1 and again at 1.5, the stylesheet as it stands and the same stylesheet with that scale's fix taken back out. A check that only proves the grain is there today would pass on one somebody had quietly flattened, so the stripped render has to come out flat and the real one dithered; a pair that agrees is the reading itself failing rather than the app. The two scales lose the grain to different faults and so are read against different controls: at 1.5 an uncomposited box drops the fixed layer out of the capture, and at 1 the shipped 0.6px dot in a 2px tile misses all four device pixels of its tile unless the resolution branch hands that display a bigger one.
//
// Edge headless over its own developer protocol, which is the engine the app's web view runs on and the one call — `Page.captureScreenshot` with `captureBeyondViewport` — that the fault lives inside. No crate, no package: the PNG reader is `check-shot-edges.mjs`'s and the browser is `wireframe.mjs`'s. A machine with neither Edge nor Chrome says so and passes, the way a wireframe does — a browser is not a build dependency here.

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decode } from './check-shot-edges.mjs';
import { findBrowser } from './wireframe.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The declaration phase 1 of the exported-picture ticket added, and the one thing the two renders differ by. */
const COMPOSITED = 'will-change: transform;';

/** The rule it lives in. Named rather than matched loosely: a stylesheet with the declaration somewhere else would let the flat render pass for the wrong reason. */
const PAPER_SURFACE = 'body.leaf-paper .app-surface {';

/** The branch that hands a display at 100% a lattice big enough for a device pixel to hold. */
const RESOLUTION_BRANCH = '@media (resolution <= 1dppx)';

/** The same stylesheet with that branch and everything it sets taken out: the lattice a display at 100% is left with. */
function withoutTheResolutionBranch(css) {
  const at = css.indexOf(RESOLUTION_BRANCH);
  if (at < 0) return css;
  let depth = 0;
  for (let scan = css.indexOf('{', at); scan < css.length; scan++) {
    if (css[scan] === '{') depth++;
    else if (css[scan] === '}' && --depth === 0) return css.slice(0, at) + css.slice(scan + 1);
  }
  return css;
}

/** The same stylesheet with the one declaration taken back out of the one rule it is in. */
function withoutTheCompositedPaper(css) {
  const at = css.indexOf(PAPER_SURFACE);
  return css.slice(0, at) + css.slice(at).replace(COMPOSITED, '');
}

/** What the grain rests on at each display scale, and the edit that takes it away. 1.5 is Windows' own default on a laptop panel and the scale the export fault was watched on; 1 is the ordinary desktop monitor, and nothing else in the tree reads a pixel there, so an edit that drops the branch fails here or nowhere. */
const RESTS_ON = [
  {
    scale: 1,
    strip: withoutTheResolutionBranch,
    named: RESOLUTION_BRANCH,
    fix: `A display at 100% needs a lattice it can draw — ${RESOLUTION_BRANCH} setting --lt-grain-radius, --lt-grain-edge and --lt-grain-tile in src/assets/reading/base.css.`,
  },
  {
    scale: 1.5,
    strip: withoutTheCompositedPaper,
    named: COMPOSITED,
    fix: `The paper class has to composite the app box — ${COMPOSITED} on ${PAPER_SURFACE} in src/assets/reading/print.css.`,
  },
];

/** A share of the sampled block below which a shade is text, an edge or an artifact rather than the surface. */
const REAL_SHARE = 0.1;

/** The compiled stylesheet, from the app itself — the theme compiler is Rust, so a second one written here would be a reading of this script instead of of the app. `bundle-gallery.mjs` asks the same way. */
function readingStylesheet() {
  const css = execFileSync('cargo', ['run', '--quiet', '--', '--dump-css'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!css.includes('--lt-background')) throw new Error('--dump-css gave no stylesheet');
  return css;
}

/** A document with the two surfaces the grain is load-bearing for, inside the boxes the app puts them in, on a dark theme where the dots are strongest. The paper class is on from the start: it is what the app puts on to render, and it is the state this whole reading is about. */
function fixturePage(css) {
  const rows = Array.from({ length: 8 }, (_, at) => `<tr><td>row ${at}</td><td>value ${at}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en" data-theme="dark" data-leaf-theme="pippin" data-leaf-appearance="dark">
<head><meta charset="utf-8"><style>${css}</style></head>
<body class="leaf-paper">
<div class="app-surface"><div class="library-shell"><div class="reader-shell"><div class="document-body">
<h1>Grain</h1>
<pre><code>fn main() {
    let dots = "a code block is one of the grained surfaces";
    println!("{dots}");
}
</code></pre>
<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>
</div></div></div></div>
<div class="context-menu" style="left: 520px; top: 300px; width: 160px; height: 50px; display: block;">Shadow sample</div>
</body></html>`;
}

/** One request out and its answer back, over the page's own developer-protocol socket. */
function ask(socket, pending, method, params = {}) {
  const id = pending.next++;
  return new Promise((resolve, reject) => {
    pending.waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

/** Wait for the browser to answer on its debugging port and hand back the page target's socket address. */
async function pageSocket(port) {
  for (let tries = 0; tries < 100; tries++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // The browser is still coming up; the loop below is the wait.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the browser never answered on its debugging port');
}

/** Lay one page out and photograph the whole of it the way the app does, then say what the code block came out as. */
async function renderAndSample(browser, html, scale) {
  const work = mkdtempSync(join(tmpdir(), 'leaf-grain-'));
  const page = join(work, 'page.html');
  writeFileSync(page, html, 'utf8');
  // Port 0 asks the browser for a free one, and it writes back the port it took.
  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${work}`,
      '--window-size=1080,900',
      pathToFileURL(page).href,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  const port = await new Promise((resolve, reject) => {
    let text = '';
    child.stderr.on('data', (chunk) => {
      text += chunk;
      const found = text.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (found) resolve(Number(found[1]));
    });
    child.on('error', reject);
    child.on('exit', () => reject(new Error(`the browser exited before it listened:\n${text}`)));
  });

  const pending = { next: 1, waiting: new Map() };
  let socket;
  try {
    const address = await pageSocket(port);
    socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    socket.addEventListener('message', (event) => {
      const answer = JSON.parse(event.data);
      const held = pending.waiting.get(answer.id);
      if (!held) return;
      pending.waiting.delete(answer.id);
      if (answer.error) held.reject(new Error(`${answer.error.message}`));
      else held.resolve(answer.result);
    });

    await ask(socket, pending, 'Page.enable');
    await ask(socket, pending, 'Runtime.enable');
    // The one setting the whole reading rests on: it is what the page's own `resolution` query answers, and what the lattice is rasterized in. The app's own capture asks for the picture at one over the window's scale, which rasterizes at the display's resolution and hands back CSS-sized pixels, so this is the display the reading is about rather than a size of file.
    await ask(socket, pending, 'Emulation.setDeviceMetricsOverride', {
      width: 1080,
      height: 900,
      deviceScaleFactor: scale,
      mobile: false,
    });
    // Loading a `file:` URL on the command line races the socket, so the page is navigated again here and waited on: a capture taken against a page that has not laid out yet reads as a fault in the stylesheet.
    await ask(socket, pending, 'Page.navigate', { url: pathToFileURL(page).href });
    await new Promise((resolve) => setTimeout(resolve, 600));

    const measured = await ask(socket, pending, 'Runtime.evaluate', {
      expression: `(() => {
        const pre = document.querySelector('.document-body pre');
        const box = pre.getBoundingClientRect();
        const menu = document.querySelector('.context-menu').getBoundingClientRect();
        // The band's depth is the one the stylesheet declares, never a number written here: a spread the sheet had moved would leave this reading a strip that is part band and part page.
        const spread = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lt-shadow-spread'));
        return JSON.stringify({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
          block: { x: box.x + window.scrollX, y: box.y + window.scrollY, w: box.width, h: box.height },
          shadow: { x: menu.x + window.scrollX - spread, y: menu.y + window.scrollY - spread, w: menu.width + spread * 2, h: spread },
        });
      })()`,
      returnByValue: true,
    });
    const { width, height, block, shadow } = JSON.parse(measured.result.value);

    const shot = await ask(socket, pending, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      // At the display's own resolution rather than shrunk back to CSS pixels the way the app's capture asks for it. Chromium reads a clip scale by rasterizing at that scale rather than by resampling a device-resolution render, so asking for one over the display scale rasterizes the page at 1 — where a 0.6px dot in a 2px tile is below what anything paints, and both stylesheets come back flat. What is being read here is whether the dot layer was painted at all, and the size of the file it was painted into is not part of that.
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    const picture = decode(Buffer.from(shot.data, 'base64'));

    // The same band again, rasterized fine enough for one dot to be several pixels across. The shade count above says the band drew; it cannot say the dots narrow, and a band of same-sized dots whose ink falls carries exactly as many shades as a halftone. The display is still the one being emulated -- what the clip scale changes is how many pixels one CSS pixel is drawn into, not which lattice the page picked.
    const close = await ask(socket, pending, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: shadow.x + 20, y: shadow.y - 2, width: 120, height: shadow.h + 4, scale: FINE },
    });
    return { block: shades(picture, block), halftone: dotRows(decode(Buffer.from(close.data, 'base64'))) };
  } finally {
    if (socket) socket.close();
    child.kill();
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      // The browser holds its profile open a moment longer than it holds the port; a folder left in the temp directory is not worth failing a reading over.
    }
  }
}

/** How many pixels one CSS pixel of the band is rasterized into for the reading below. A 2px tile lands on 16, so a dot that is a fifth of its tile is still three pixels wide and a row that has narrowed by a quarter is not lost to rounding. */
const FINE = 8;

/** A pixel this much below the ground is ink at all rather than the paper it sits on. */
const INK = 8;

/** The band above the sampled surface, read as the rows of dots it is made of: for each one, how wide its widest dot is and how dark its darkest pixel is. Rows come back outermost first, the way the band is captured.
 *
 * A row is found by where the band is darkest rather than by where it carries any ink at all, because the two things this reading is about both blur the boundary between one row and the next. The dot's rim is soft on purpose -- a curve steep enough to be a hard threshold decides each device pixel in or out and rasterizes a four-pixel dot square -- and the ink falls across the band, so a threshold set anywhere near the paper swallows the outer rows and one set near the innermost row's ink clips them. So each dot row is a dip in the band's darkness, and its width is measured at half of that row's own ink. */
function dotRows({ width, height, rgba }) {
  const ground = rgba[(2 * width + Math.floor(width / 2)) * 4];
  const darkest = [];
  for (let y = 0; y < height; y++) {
    let dark = 255;
    for (let x = 0; x < width; x++) dark = Math.min(dark, rgba[(y * width + x) * 4]);
    darkest.push(dark);
  }
  const rows = [];
  for (let y = 1; y < height - 1; y++) {
    const ink = darkest[y];
    if (ground - ink < INK) continue;
    // The dip's own row: no lighter than the one before it and lighter than the one after, which lands on the first row of a plateau rather than on every row of one.
    if (!(ink <= darkest[y - 1] && ink < darkest[y + 1])) continue;
    const half = ground - (ground - ink) / 2;
    let widest = 0;
    let run = 0;
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4] <= half) widest = Math.max(widest, ++run);
      else run = 0;
    }
    rows.push({ width: widest, ink });
  }
  return { ground, rows };
}

/** How many shades really cover the code block. A dithered surface has two; a flat one has the fill and nothing else. */
function shades({ width, height, rgba }, block) {
  const counts = new Map();
  let seen = 0;
  for (let y = Math.max(0, Math.round(block.y)); y < Math.min(Math.round(block.y + block.h), height); y++) {
    for (let x = Math.max(0, Math.round(block.x)); x < Math.min(Math.round(block.x + block.w), width); x++) {
      const at = (y * width + x) * 4;
      const key = `${rgba[at]},${rgba[at + 1]},${rgba[at + 2]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      seen++;
    }
  }
  const real = [...counts]
    .filter(([, n]) => n / seen >= REAL_SHARE)
    .sort((a, b) => b[1] - a[1])
    .map(([shade, n]) => `${shade} (${Math.round((n / seen) * 100)}%)`);
  return { real, seen };
}

/** The dot rows in a sentence, so a run that fails says what it saw. */
function describe({ rows }) {
  if (!rows.length) return 'nothing at all — the band painted no ink';
  return rows.map(({ width, ink }) => `${width}px wide at ${ink}`).join(', ');
}

/** What the band has to do, read off the picture: be a lattice rather than a slab, and dissolve into the page rather than stop on a row. How many rows it holds is not fixed -- the lattice is anchored to the window rather than to the surface, so where the surface landed decides whether a two-pixel tile catches four rows or six.
 *
 * The dot narrowing is not read here any more, and the reason is worth keeping. A dot's size is only meaningful against its own ink, and the ink now falls across the band as well, so a width taken at a fixed threshold measures the two together and a width taken at each row's own ink normalizes the size away -- at 100% every row then comes back the same 10 whatever the ramps did. What proves the dot narrows is where the four background ramps sit: in front of the curve rather than behind it, which is what `the_halftone_is_four_ramps_over_one_spread_with_a_rounded_punch` pins, layer for layer. */
function judgeTheHalftone(band, display) {
  const { ground, rows } = band;
  const seen = describe(band);
  if (rows.length < 2) {
    console.error(`the shadow band at ${display} is not a halftone: it came back as ${seen}, where the band is rows of dots. One row as wide as the band is the slab \`filter: contrast()/brightness()\` leaves behind — neither of those touches alpha, so nothing is ever cut away and the whole band floods.`);
    return 1;
  }
  // Rim first, so each row has to be darker than the one outside it. Rows at one weight read as that many rings rather than as one dissolve, and two overlapping bands then meet at full strength on both.
  for (let at = 1; at < rows.length; at++) {
    if (rows[at].ink >= rows[at - 1].ink) {
      console.error(`the shadow band at ${display} holds its ink out to the rim: its dot rows are ${seen}. The four edge ramps run in the mask as well, so the band starts against the surface and fades to nothing.`);
      return 1;
    }
  }
  // And no row is wider than the one inside it, or the band is a halftone drawn backwards.
  for (let at = 1; at < rows.length; at++) {
    if (rows[at].width < rows[at - 1].width) {
      console.error(`the shadow band at ${display} widens toward its rim: its dot rows are ${seen}. The four background ramps lift coverage off the blob at the rim, so the dot the curve cuts there is the smaller one.`);
      return 1;
    }
  }
  // And it reaches the page rather than stopping short of it. The bar is the floor of what this reading can see at all: the outermost row it finds has to be as faint as a row can be and still be found, which says the band went on fading past it into the paper. A band that stops on a step leaves its last row standing well above that -- the fade this ticket replaced ended at 119 on a page of 244.
  const left = ground - rows[0].ink;
  if (left > INK + 2) {
    console.error(`the shadow band at ${display} still has ink at its outer rim — ${seen} against a page of ${ground}. It has to fade to the page, or the lattice ends on a straight line however small its dots have become.`);
    return 1;
  }
  return 0;
}

async function run() {
  const browser = findBrowser();
  if (!browser) {
    console.log('grain in a picture: no Edge or Chrome on this machine, so nothing was rendered — a browser is not a build dependency here');
    return 0;
  }
  const css = readingStylesheet();
  if (!css.includes(PAPER_SURFACE)) throw new Error(`the stylesheet has no ${PAPER_SURFACE} rule`);

  const checking = process.argv.includes('--check');
  let failed = 0;
  for (const { scale, strip, named, fix } of RESTS_ON) {
    const display = `${Math.round(scale * 100)}%`;
    const withFix = await renderAndSample(browser, fixturePage(css), scale);
    console.log(`grain in a picture at ${display}: the code block carries ${withFix.block.real.length} shade(s) — ${withFix.block.real.join(', ')}`);
    console.log(`  the shadow band's dot rows, rim first, are ${describe(withFix.halftone)}`);
    failed = judgeTheHalftone(withFix.halftone, display) || failed;
    if (!checking) continue;

    const stripped = strip(css);
    if (stripped.length === css.length) throw new Error(`the stylesheet does not carry ${named}`);
    const withoutFix = await renderAndSample(browser, fixturePage(stripped), scale);
    console.log(`  without ${named} it carries ${withoutFix.block.real.length} shade(s) — ${withoutFix.block.real.join(', ')}`);

    if (withoutFix.block.real.length > 1) {
      console.error(`the reading itself is broken at ${display}: the code block is dithered with ${named} taken out, so this check would pass on a stylesheet that had lost it.`);
      failed = 1;
      continue;
    }
    if (withFix.block.real.length < 2) {
      console.error(`the dot grain is missing at ${display}: the code block came out one flat shade. ${fix}`);
      failed = 1;
    }
  }
  return failed;
}

process.exit(await run());
