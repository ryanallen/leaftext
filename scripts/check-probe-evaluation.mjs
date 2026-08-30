#!/usr/bin/env node
// A measurement that cannot refuse a bad run is a number nobody should act on. This is the half of `scripts/probe-evaluation.mjs` a machine with no copy of the app open can read back.
//
//   node scripts/check-probe-evaluation.mjs   prove the probe refuses a run that is not the launch it claims (`just verify`)
//
// The three refusals are the three ways a launch lies about itself. A missing measure means a region never ran, so its cost is silently nothing. A duplicated one means a region ran twice, so every number beside it is a different launch's. An unordered one means the fragments no longer evaluate in the order the list joins them, which is the one thing the whole measurement is about.
//
// The table write is proved too, because it writes into somebody's plan: everything outside the two marker lines has to come back byte for byte.

import { judgeMeasures, writeTable, middle, TABLE_OPENS, TABLE_CLOSES } from './probe-evaluation.mjs';

const problems = [];

function expect(what, held) {
  if (!held) problems.push(what);
}

const regions = ['one.js', 'two.js', 'boot tail 1: window.__leafBooted = true;'];
const clean = [
  ['one.js', 4.5],
  ['two.js', 9.25],
  ['boot tail 1: window.__leafBooted = true;', 0.5],
];

expect('a run that timed every region in order is refused', judgeMeasures(regions, clean).length === 0);

const missing = judgeMeasures(regions, clean.filter(([name]) => name !== 'two.js'));
expect('a region nothing timed is accepted', missing.some((said) => said.includes('nothing timed two.js')));

const duplicated = judgeMeasures(regions, [...clean, ['two.js', 9.25]]);
expect('a region timed twice is accepted', duplicated.some((said) => said.includes('two.js was timed 2 times')));

const unordered = judgeMeasures(regions, [clean[1], clean[0], clean[2]]);
expect('measures that came back out of the front end order are accepted', unordered.some((said) => said.includes('no longer evaluates in its written order')));

const stranger = judgeMeasures(regions, [...clean, ['three.js', 1]]);
expect('a measure naming no region of the front end is accepted', stranger.some((said) => said.includes('is no region of this front end')));

const page = `# A plan\n\nWords above.\n\n${TABLE_OPENS}\nthe old table\n${TABLE_CLOSES}\n\nWords below.\n`;
const written = writeTable(page, '| region |\n| --- |');
expect('the table write loses the words above it', written.startsWith('# A plan\n\nWords above.\n\n'));
expect('the table write loses the words below it', written.endsWith(`${TABLE_CLOSES}\n\nWords below.\n`));
expect('the table write keeps the old table', !written.includes('the old table'));
expect('the table write leaves no markers to write into next time', written.includes(TABLE_OPENS) && written.includes(TABLE_CLOSES));

let refused = false;
try {
  writeTable('# A plan with no markers\n', '| region |');
} catch {
  refused = true;
}
expect('a ticket with no markers is written into anyway', refused);

expect('the middle of three readings is not the middle one', middle([9, 1, 5]) === 5);

if (problems.length) {
  for (const problem of problems) console.error(`check-probe-evaluation: ${problem}`);
  process.exit(1);
}
console.log(`check-probe-evaluation: the probe refuses a missing, duplicated, stray or unordered measure, and writes its table between its own markers`);
