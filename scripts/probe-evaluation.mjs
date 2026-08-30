#!/usr/bin/env node
// What each part of the front end costs a launch, measured in a copy of the app rather than reasoned about.
//
//   node scripts/probe-evaluation.mjs [--launches 3] [--work <name>] [--ticket <path>]
//
// Behind `just probe-evaluation`. It launches a copy served the timed front end, waits for the page to say it has booted, reads the measures that front end wrote, closes the copy, and does it again from cold — three times by default, because one launch on a machine somebody else is also using says almost nothing.
//
// The order it expects is read off the page rather than written down here. The timed asset opens by declaring the regions it is about to time, in the order the binary joined them, so a fragment moved in `APP_SHELL_SCRIPT_PARTS` moves in both lists at once and this can never be checking yesterday's order.
//
// It needs a copy of the app and it launches one, so it is not in `just verify` — `scripts/check-probe-evaluation.mjs` reads the judging back there instead.

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readProbeReply } from './probe-motion-output.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The lines in the ticket this rewrites, and nothing outside them. A run replaces its own table rather than adding a second one under the first.
export const TABLE_OPENS = '<!-- probe-evaluation -->';
export const TABLE_CLOSES = '<!-- /probe-evaluation -->';

/** Every way a set of measures can fail to be the launch it claims to be, said in the words a reader can act on. An empty list is a run worth writing down. */
export function judgeMeasures(regions, measured) {
  const problems = [];
  const counted = new Map();
  for (const [name] of measured) counted.set(name, (counted.get(name) ?? 0) + 1);

  for (const name of regions) {
    const times = counted.get(name) ?? 0;
    if (times === 0) problems.push(`nothing timed ${name}`);
    else if (times > 1) problems.push(`${name} was timed ${times} times, so one region of the front end ran more than once`);
  }

  const known = new Set(regions);
  for (const [name] of measured) {
    if (!known.has(name)) problems.push(`${name} was timed and is no region of this front end`);
  }

  // Order, over the names both lists carry: the whole point of the number is which part of the launch runs when.
  const got = measured.map(([name]) => name).filter((name) => known.has(name));
  const want = regions.filter((name) => counted.has(name));
  for (let at = 0; at < Math.min(got.length, want.length); at += 1) {
    if (got[at] !== want[at]) {
      problems.push(`the front end timed ${got[at]} where the list expects ${want[at]}, so it no longer evaluates in its written order`);
      break;
    }
  }
  return problems;
}

/** The ticket with its table replaced. Everything outside the two marker lines is left byte for byte, because the rest of the page is somebody's plan. */
export function writeTable(markdown, table) {
  const opens = markdown.indexOf(TABLE_OPENS);
  const closes = markdown.indexOf(TABLE_CLOSES);
  if (opens === -1 || closes === -1 || closes < opens) {
    throw new Error(`the ticket carries no ${TABLE_OPENS} … ${TABLE_CLOSES} pair for the table to go in`);
  }
  return `${markdown.slice(0, opens + TABLE_OPENS.length)}\n${table}\n${markdown.slice(closes)}`;
}

/** The middle reading of however many launches there were, which is what a machine somebody is also working on can honestly report. */
export function middle(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The whole measurement as one Markdown table: a row per region, a column per launch, and the middle reading beside them. */
export function tableFor(regions, launches, stamp) {
  const columns = launches.map((_, at) => `launch ${at + 1}`).join(' | ');
  const lines = [
    `**Measured ${stamp} over ${launches.length} cold ${launches.length === 1 ? 'launch' : 'launches'}, each a copy launched off screen and served the timed front end.** Milliseconds of the main thread, in the order the front end evaluates them.`,
    '',
    `| region | ${columns} | middle |`,
    `| --- | ${launches.map(() => '---').join(' | ')} | --- |`,
  ];
  for (const name of regions) {
    const readings = launches.map((launch) => launch.get(name) ?? 0);
    const cells = readings.map((reading) => reading.toFixed(1)).join(' | ');
    lines.push(`| \`${name}\` | ${cells} | ${middle(readings).toFixed(1)} |`);
  }
  const totals = launches.map((launch) => [...launch.values()].reduce((sum, one) => sum + one, 0));
  lines.push(`| **the whole front end** | ${totals.map((total) => total.toFixed(1)).join(' | ')} | ${middle(totals).toFixed(1)} |`);
  return lines.join('\n');
}

/** The clock as every date in this tree is written, read at the moment the table is. */
export function stampNow(now = new Date()) {
  const day = now.getDate();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const hour = now.getHours() % 12 || 12;
  const minute = String(now.getMinutes()).padStart(2, '0');
  const half = now.getHours() < 12 ? 'am' : 'pm';
  return `${day} ${month} ${now.getFullYear()}, ${hour}:${minute}${half}`;
}

// ---- the run ----------------------------------------------------------------

function fail(reason) {
  console.error(`probe: ${reason}`);
  process.exit(1);
}

/** One ask down the app's pipe, through the same wrapper `just ask` uses so the address is written once. */
function ask(request) {
  const run = spawnSync(process.execPath, [join(root, 'scripts/mcp-leaftext.mjs'), '--ask', JSON.stringify(request)], {
    encoding: 'utf8',
  });
  // The reply is on the output stream and the note saying which copy answered is on the error stream, so joining them makes every answer from a probe copy unreadable.
  const said = readProbeReply(run.stdout, run.stderr);
  if (said.unreadable) return { unreadable: said.unreadable };
  if (said.refusal) return { refusal: said.refusal };
  return { answer: said.answer };
}

function probe(...args) {
  const run = spawnSync(process.execPath, [join(root, 'scripts/probe.mjs'), ...args], { encoding: 'utf8' });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) fail(`the probe copy would not ${args[0]}`);
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** The measures of one cold launch, once the page says it is a page somebody could use. */
async function oneLaunch(work, patience) {
  probe('open', '--work', work, '--evaluation');
  try {
    const deadline = Date.now() + patience;
    while (Date.now() < deadline) {
      const booted = ask({ ask: 'eval', script: 'window.__leafBooted === true' });
      if (booted.answer === true) break;
      await wait(200);
    }
    const read = ask({
      ask: 'eval',
      script:
        '(() => ({ regions: window.__leafEvaluationRegions || null, measures: performance.getEntriesByType("measure").filter((entry) => entry.name.startsWith("leaf-evaluation:")).map((entry) => [entry.name.slice("leaf-evaluation:".length), entry.duration]) }))()',
    });
    if (read.unreadable) fail(read.unreadable);
    if (read.refusal) fail(read.refusal);
    const said = read.answer;
    if (!said || !Array.isArray(said.regions)) {
      fail('the copy came up without the timed front end, so nothing declared what it was about to time — it was launched without the evaluation mode, or it never booted');
    }
    return said;
  } finally {
    probe('close', '--work', work);
  }
}

async function main(argv) {
  let launches = 3;
  let work = 'evaluation';
  let patience = 60000;
  let ticket = join(root, '../docs/refactor/reading/every-launch-evaluates-the-whole-front-end-before-the-window-can-be-used.md');
  const unquote = (text) => text.replace(/^"(.*)"$/, '$1');
  const loose = argv.map(unquote);
  for (let at = 0; at < loose.length; at += 1) {
    if (loose[at] === '--launches') launches = Number(loose[(at += 1)]);
    else if (loose[at] === '--work') work = loose[(at += 1)];
    else if (loose[at] === '--ticket') ticket = loose[(at += 1)];
    else if (loose[at] === '--patience') patience = Number(loose[(at += 1)]);
    else fail(`nothing here takes ${loose[at]}`);
  }
  if (!Number.isInteger(launches) || launches < 1) fail('--launches wants a whole number of launches');

  if (process.platform !== 'win32') {
    fail('a probe copy is Windows only so far, so there is nowhere to launch a measured copy');
  }

  let regions = null;
  const readings = [];
  for (let at = 0; at < launches; at += 1) {
    console.log(`probe: launch ${at + 1} of ${launches}`);
    const said = await oneLaunch(work, patience);
    if (regions && said.regions.join(' ') !== regions.join(' ')) {
      fail('two launches of the same binary declared different regions, so one of them was not the front end this is measuring');
    }
    regions = said.regions;
    const problems = judgeMeasures(regions, said.measures);
    if (problems.length) {
      for (const problem of problems) console.error(`probe: ${problem}`);
      fail(`launch ${at + 1} did not time its own front end, so there is no table to write`);
    }
    readings.push(new Map(said.measures));
  }

  const table = tableFor(regions, readings, stampNow());
  const source = readFileSync(ticket, 'utf8');
  writeFileSync(ticket, writeTable(source, table), 'utf8');
  console.log(`probe: ${regions.length} regions timed over ${launches} launches, written into ${ticket}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main(process.argv.slice(2));
}
