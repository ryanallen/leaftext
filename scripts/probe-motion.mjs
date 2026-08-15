#!/usr/bin/env node
// Prove a motion drew, by where the pixels were on each frame.
//
//   node scripts/probe-motion.mjs <selector> <trigger…> [--property transform] [--for 1000] [--dry-run]
//
// Reading the classes off a running copy proves nothing about motion: the leg runner carries a timer for the case where no `transitionend` arrives, so every class lands on schedule whether or not anything moved. The bottom sheet shipped its entrance as a snap through a proof of exactly that shape. This samples the element's own computed value once per animation frame and fails when the first frame is already at the resting value — which is what a snap looks like from the outside.
//
// One ask installs the sampler and runs the trigger together, so no frame falls in the gap between two asks; a second ask, once the legs are over, reads the frames back. The page keeps its globals between asks even though the pipe keeps nothing, which is what makes the pair work.
//
// It needs a copy of the app running, so it is not in `just verify` — `scripts/check-driver.mjs` reads its dry run back there instead.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// cmd.exe hands the quotes around an argument through rather than stripping them, so anything quoted in the Justfile arrives still wearing them.
const unquote = (text) => text.replace(/^"(.*)"$/, '$1');

const USAGE =
  'node scripts/probe-motion.mjs <selector> <trigger…> [--property transform] [--for 1000] [--dry-run]';

let property = 'transform';
let sampleMs = 1000;
let dryRun = false;
const loose = [];
const argv = process.argv.slice(2).map(unquote);
for (let at = 0; at < argv.length; at += 1) {
  if (argv[at] === '--property') property = unquote(argv[(at += 1)] ?? '');
  else if (argv[at] === '--for') sampleMs = Number(unquote(argv[(at += 1)] ?? ''));
  else if (argv[at] === '--dry-run') dryRun = true;
  else loose.push(argv[at]);
}
// The selector is one word; the trigger is a line of JavaScript, and `just` hands it over already split at its spaces. So everything after the selector is the trigger, joined back up.
const selector = loose[0] ?? '';
const trigger = loose.slice(1).join(' ');

if (!selector) fail(`no element to watch. ${USAGE}`);
if (!trigger) fail(`no trigger to start the motion. ${USAGE}`);
if (!property) fail(`no property to watch. ${USAGE}`);
if (!Number.isFinite(sampleMs) || sampleMs <= 0) fail(`--for wants a number of milliseconds. ${USAGE}`);

console.log(`probe: watching ${property} on ${selector}`);
console.log(`probe: trigger ${trigger}`);
console.log(`probe: sampling every frame for ${sampleMs} ms, then reading the frames back`);

// The dry run stops here, before the pipe: it is the half of this that a machine with no app open can read back.
if (dryRun) process.exit(0);

/** One ask down the app's pipe, through the same wrapper `just ask` uses so the address is written once. */
function ask(request) {
  const run = spawnSync(process.execPath, [join(root, 'scripts/mcp-leaftext.mjs'), '--ask', JSON.stringify(request)], {
    encoding: 'utf8',
  });
  const text = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
  let reply;
  try {
    reply = JSON.parse(text);
  } catch {
    fail(text || 'the app said nothing');
  }
  if (!reply.ok) fail(reply.error);
  return reply.answer;
}

function fail(reason) {
  console.error(`probe: ${reason}`);
  process.exit(1);
}

// The sampler and the trigger in one script: a rAF registered before the trigger runs fires after it, on the first frame of whatever it started. The trigger is caught rather than thrown, because a throw here never reaches the callback the pipe is waiting on and the ask times out saying the app is stuck.
const install = `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { missing: true };
  const frames = [];
  window.__leafMotionFrames = frames;
  const start = performance.now();
  const step = () => {
    frames.push([Math.round(performance.now() - start), getComputedStyle(el).getPropertyValue(${JSON.stringify(property)})]);
    if (performance.now() - start < ${sampleMs}) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  let threw = null;
  try { ${trigger} } catch (error) { threw = String((error && error.message) || error); }
  return { threw };
})()`;

const read = `(() => { const frames = window.__leafMotionFrames; delete window.__leafMotionFrames; return frames || null; })()`;

const started = ask({ ask: 'eval', script: install });
if (started && started.missing) fail(`nothing on the page matches ${selector}`);
if (started && started.threw) fail(`the trigger threw: ${started.threw}`);

// The legs, plus a moment for the last frame to land.
await new Promise((done) => setTimeout(done, sampleMs + 250));

const frames = ask({ ask: 'eval', script: read });
if (!Array.isArray(frames) || !frames.length) fail('the page recorded no frames, so nothing drew and nothing can be judged');
for (const [at, value] of frames) console.log(`  ${String(at).padStart(5)}ms  ${value}`);

const resting = frames[frames.length - 1][1];
if (frames[0][1] === resting) {
  fail(
    `the first frame was already at ${resting}, so ${property} on ${selector} snapped — the classes may still have run on time, which is what makes this worth checking`
  );
}
console.log(`probe: ${frames.length} frames, ${property} moved from ${frames[0][1]} to ${resting}`);
