#!/usr/bin/env node
// Nothing looked at the shape of the running order next door, so three of its tiers emptied and it went on calling itself a ranking for days, and its own counts were out twice in one afternoon.
//
//   node scripts/check-plan.mjs   fail on a running order that has stopped ranking every live ticket
//
// Eight rules, every one arithmetic. Whether a row is ranked well is the ranker's judgment and no script's.
//
// Size is not a test: a band holding most of the rows is what a tree of mostly-features looks like, and no count makes a definition wrong. What makes one wrong is asking for two unrelated things at once, or asking for something no row can satisfy — read the words of a definition, never the count under it.
//
// So the only thing size buys here is a landmark: a long band is cut on cost, counted in a ticket's `### Phase` headings or in the run its cell names, and every row sits under the heading its own count names — or its blocker's, where that is dearer.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plans = join(root, '..', 'docs');

// Every file in these is a ticket — none of them holds an index.
const LIVE_PLANS = ['features', 'refactor', 'fixes'];

const LINK = /\[[^\]]*\]\(\s*([^)\s]+)\)/g;

function links(cell) {
  return [...cell.matchAll(LINK)].map((m) => m[1].split('#')[0]);
}

// An empty tier is deleted heading and all, so this reads the headings it finds rather than expecting five.
function planRows(text) {
  const rows = [];
  let tier = null;
  // A `###` line is a sub-band: it groups rows inside the band it sits in and carries no position of its own.
  let sub = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const heading = /^##(?!#)\s+Tier\s+(\d+)\b/.exec(line);
    if (heading) {
      tier = Number(heading[1]);
      sub = null;
      continue;
    }
    if (/^##(?!#)\s/.test(line)) {
      tier = null;
      sub = null;
      continue;
    }
    const subHeading = /^###\s+(.+)$/.exec(line);
    if (subHeading) {
      sub = subHeading[1].trim();
      continue;
    }
    if (tier === null || !line.startsWith('|')) continue;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length < 5) continue;
    if (cells[0] === '#') continue;
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    rows.push({
      line: i + 1,
      tier,
      sub,
      position: /^\d+$/.test(cells[0]) ? Number(cells[0]) : null,
      // The first link only: a `Ticket` cell can carry words after it, and a `Why here` cell links neighbors.
      ticket: links(cells[1])[0] ?? null,
      shown: cells[1].replace(/\s+/g, ' '),
      blockers: links(cells[3]),
    });
  }
  return rows;
}

// A band is ordered cheapest first, so its sub-bands are cost. The boundaries are the counts themselves — nothing here is measured in time.
const SUB_BANDS = [
  { name: 'One or two phases', upto: 2 },
  { name: 'Three or four phases', upto: 4 },
  { name: 'Five phases or more', upto: Infinity },
];

// `[table-editing](...) **phases 1–4**` ranks a run rather than the whole file, so the run is what the row costs.
const RUN = /\*\*phases?\s+(\d+)(?:\s*[–—-]\s*(\d+))?\*\*/;

function phaseCount(row, tree) {
  const run = RUN.exec(row.shown);
  if (run) return Number(run[2] ?? run[1]) - Number(run[1]) + 1;
  return tree.phases.get(row.ticket) ?? null;
}

function count(text, label) {
  const found = new RegExp(`${label}:\\s*(\\d+)`).exec(text);
  return found ? Number(found[1]) : null;
}

// `tree` is `{ live, retired, turnedDown, phases }` — the live ticket paths, the two retired counts, and what each ticket costs.
function shapeProblems(text, tree) {
  const problems = [];
  // `subject` is what the refusal is about — the self-test reads it, so a rule firing on the wrong row is caught rather than counted as a pass.
  const say = (rule, subject, message) => problems.push({ rule, subject, message });
  const rows = planRows(text);

  // Positions run 1 to N once each, so a row cut or inserted mid-pass cannot leave a gap or a repeat.
  for (const row of rows.filter((r) => r.position === null)) {
    say('position', row.ticket, `line ${row.line}: the row for ${row.shown} has no position`);
  }
  const seen = new Map();
  for (const row of rows) {
    if (row.position !== null) seen.set(row.position, (seen.get(row.position) ?? 0) + 1);
  }
  for (const [position, times] of seen) {
    if (times > 1) say('position', position, `position ${position} is used by ${times} rows`);
  }
  for (let n = 1; n <= rows.length; n++) {
    if (!seen.has(n)) say('position', n, `no row sits at position ${n}, and there are ${rows.length} rows`);
  }
  for (const position of seen.keys()) {
    if (position > rows.length) say('position', position, `position ${position} is above the ${rows.length} rows in the file`);
  }

  // One row per live ticket, both directions.
  const byTicket = new Map();
  for (const row of rows) {
    if (row.ticket === null) {
      say('ticket', row.position, `line ${row.line}: the row for ${row.shown} links no ticket`);
      continue;
    }
    if (byTicket.has(row.ticket)) {
      say('ticket', row.ticket, `${row.ticket} has a row at ${byTicket.get(row.ticket).position} and another at ${row.position}`);
      continue;
    }
    byTicket.set(row.ticket, row);
    if (!tree.live.has(row.ticket)) {
      say('ticket', row.ticket, `position ${row.position} names ${row.ticket}, which is not a live ticket`);
    }
  }
  for (const ticket of tree.live) {
    if (!byTicket.has(ticket)) say('ticket', ticket, `${ticket} has no row, so nobody picks it up`);
  }

  for (const [label, want] of [['Live', tree.live.size], ['Retired', tree.retired], ['Turned down', tree.turnedDown]]) {
    const said = count(text, label);
    if (said === null) say('count', label, `the foot of the file gives no ${label} count`);
    else if (said !== want) say('count', label, `the foot says ${label}: ${said}, and the tree holds ${want}`);
  }

  // A shipped blocker reads as a wait that is over, so that cell holds live tickets only.
  for (const row of rows) {
    for (const blocker of row.blockers) {
      if (!tree.live.has(blocker)) {
        say('depends', blocker, `position ${row.position} waits on ${blocker}, which is not a live ticket`);
        continue;
      }
      const above = byTicket.get(blocker);
      if (above && above.position > row.position) {
        say('depends', blocker, `position ${row.position} waits on ${blocker}, which is below it at ${above.position}`);
      }
    }
  }

  // Which sub-band each row belongs in. Blockers sit above, so one pass down the positions is enough to carry a lift.
  const want = new Map();
  const ordered = rows.filter((r) => r.ticket !== null && tree.live.has(r.ticket)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  for (const row of ordered) {
    const count = phaseCount(row, tree);
    if (count === null) {
      say('phases', row.ticket, `${row.ticket} has no \`### Phase\` heading, so there is nothing to size its row by`);
      continue;
    }
    let band = SUB_BANDS.findIndex((b) => count <= b.upto);
    for (const blocker of row.blockers) {
      const behind = want.get(blocker);
      if (behind !== undefined && behind > band) band = behind;
    }
    want.set(row.ticket, band);
  }

  for (const row of ordered) {
    const band = want.get(row.ticket);
    if (band === undefined || row.sub === null) continue;
    if (row.sub !== SUB_BANDS[band].name) {
      say('sub-band', row.ticket, `position ${row.position} sits under "${row.sub}", and what its phases name is "${SUB_BANDS[band].name}"`);
    }
  }

  // A band over half the file, in more than one size, is a run nobody can find a place in. A band of one size has nothing to cut.
  const bands = new Map();
  for (const row of rows) {
    if (!bands.has(row.tier)) bands.set(row.tier, []);
    bands.get(row.tier).push(row);
  }
  for (const [tier, band] of bands) {
    if (band.length * 2 <= rows.length) continue;
    const sizes = new Set(band.map((r) => want.get(r.ticket)).filter((b) => b !== undefined));
    if (sizes.size < 2) continue;
    const loose = band.filter((r) => r.sub === null);
    if (loose.length === band.length) {
      say('sub-band', tier, `tier ${tier} holds ${band.length} of the ${rows.length} rows in ${sizes.size} sizes and carries no sub-band heading, so it is one run with no landmark in it`);
    } else if (loose.length) {
      say('sub-band', tier, `tier ${tier} holds ${band.length} of the ${rows.length} rows and ${loose.length} of them sit above its first sub-band heading`);
    }
  }

  // The folder is the one claim about a ticket a script can read. Tier 0 is allowed because it sits above tier 1.
  for (const row of rows) {
    if (row.ticket === null) continue;
    if (row.ticket.startsWith('fixes/') && row.tier > 1) {
      say('fixes tier', row.ticket, `position ${row.position} sits in tier ${row.tier}, and ${row.ticket} is filed under fixes/ — a claim to be wrong today, which is what tier 1 holds`);
    }
    if (row.ticket.startsWith('features/') && row.tier === 1) {
      say('features tier', row.ticket, `position ${row.position} sits in tier 1, and ${row.ticket} is filed under features/ — absent is not wrong, so it never reaches that tier`);
    }
  }

  return problems;
}

// Every refusal is proved on made-up files before the real one is opened. Each case is a fault that has happened.
const TABLE = '| # | Ticket | Status | Depends on | Why here |\n|---|---|---|---|---|\n';

// `phases` is what the real run reads off each ticket. Left out, every ticket is three phases, which is the middle sub-band and the tree's own commonest row.
function tree(live, retired = 0, turnedDown = 0, phases = null) {
  const counts = new Map();
  for (const path of live) {
    const n = phases ? phases[path] : 3;
    if (n) counts.set(path, n);
  }
  return { live: new Set(live), retired, turnedDown, phases: counts };
}

// `plan(t, [3, row, row], ...)` — one entry per tier heading, each with its rows. An entry starting `###` is a sub-band heading, and the rows after it get their own table. The foot is written from the tree, so only a case testing the counts has to disagree with it.
function plan(t, ...tiers) {
  const bands = tiers.map(([n, ...items]) => {
    let out = `## Tier ${n} — a band\n\n`;
    let open = false;
    for (const item of items) {
      if (item.startsWith('###')) {
        out += `${item}\n\n`;
        open = false;
        continue;
      }
      if (!open) {
        out += TABLE;
        open = true;
      }
      out += `${item}\n`;
    }
    if (!open) out += TABLE;
    return out;
  });
  return `${bands.join('\n')}\n## Off the list\n\n**Last ranked 9 August 2026.** Live: ${t.live.size}. Retired: ${t.retired}. Turned down: ${t.turnedDown}.\n`;
}

const PAIR = tree(['refactor/a/one.md', 'refactor/b/two.md']);
const ONE = '| 1 | [one](refactor/a/one.md) | Ready | — | first |';
const TWO = '| 2 | [two](refactor/b/two.md) | Ready | — | second |';
const FIX = tree(['fixes/a/f.md']);
const FIX_ROW = '| 1 | [f](fixes/a/f.md) | Ready | — | wrong today |';
const FEATURE = tree(['features/b/g.md']);
const FEATURE_ROW = '| 1 | [g](features/b/g.md) | Ready | — | not built yet |';

const MIXED = tree(['fixes/a/f.md', 'refactor/b/two.md']);

const SMALL_HEAD = `### ${SUB_BANDS[0].name}`;
const MID_HEAD = `### ${SUB_BANDS[1].name}`;
const BIG_HEAD = `### ${SUB_BANDS[2].name}`;

const THREE = '| 3 | [three](refactor/c/three.md) | Ready | — | third |';
// One row of each size, so the band spans all three sub-bands.
const SIZES = tree(['refactor/a/one.md', 'refactor/b/two.md', 'refactor/c/three.md'], 0, 0, {
  'refactor/a/one.md': 1,
  'refactor/b/two.md': 3,
  'refactor/c/three.md': 7,
});
const NO_PHASES = tree(['refactor/a/one.md'], 0, 0, {});
const QUAD = tree(['refactor/a/one.md', 'refactor/b/two.md', 'refactor/c/three.md', 'refactor/d/four.md'], 0, 0, {
  'refactor/a/one.md': 1,
  'refactor/b/two.md': 3,
  'refactor/c/three.md': 7,
  'refactor/d/four.md': 3,
});
const FOUR = '| 4 | [four](refactor/d/four.md) | Ready | — | fourth |';

// A one-phase row behind a seven-phase one: it belongs under its blocker's heading, not its own.
const BEHIND = tree(['refactor/a/big.md', 'refactor/b/small.md'], 0, 0, {
  'refactor/a/big.md': 7,
  'refactor/b/small.md': 1,
});
const BIG_ROW = '| 1 | [big](refactor/a/big.md) | Ready | — | first |';
const SMALL_BEHIND = '| 2 | [small](refactor/b/small.md) | Ready | [big](refactor/a/big.md) | second |';

const RUN_ONLY = tree(['refactor/a/big.md'], 0, 0, { 'refactor/a/big.md': 7 });
const RUN_ROW = '| 1 | [big](refactor/a/big.md) **phases 1–4** | Ready | — | first |';

// Each case wants the rules that fire and what each one names, so a rule firing on the wrong row is a failure.
const CASES = [
  ['a running order that agrees with the tree passes', plan(PAIR, [1, ONE], [3, TWO]), PAIR, []],
  ['a live ticket with no row is refused', plan(PAIR, [1, ONE]), PAIR, ['ticket refactor/b/two.md']],
  ['a row naming no live ticket is refused',
    plan(PAIR, [1, ONE], [3, TWO, '| 3 | [gone](refactor/b/gone.md) | Ready | — | third |']),
    PAIR, ['ticket refactor/b/gone.md']],
  ['a repeated position is refused',
    plan(PAIR, [1, ONE], [3, '| 1 | [two](refactor/b/two.md) | Ready | — | second |']),
    PAIR, ['position 1', 'position 2']],
  ['a row cut mid-pass leaves a gap and a top number above the row count, and both are named',
    plan(PAIR, [1, ONE], [3, '| 3 | [two](refactor/b/two.md) | Ready | — | second |']),
    PAIR, ['position 2', 'position 3']],
  ['a count that disagrees with the tree is refused',
    plan(PAIR, [1, ONE], [3, TWO]).replace('Live: 2', 'Live: 3'), PAIR, ['count Live']],
  ['a row above what it waits on is refused, sub-band heading and all',
    plan(PAIR, [3, MID_HEAD, '| 1 | [one](refactor/a/one.md) | Ready | [two](refactor/b/two.md) | first |', TWO]),
    PAIR, ['depends refactor/b/two.md']],
  ['the same pair the other way round, under a sub-band heading, passes — so a row under a `###` line is still read',
    plan(PAIR, [3, MID_HEAD, '| 1 | [two](refactor/b/two.md) | Ready | — | first |', '| 2 | [one](refactor/a/one.md) | Ready | [two](refactor/b/two.md) | second |']),
    PAIR, []],
  ['a band holding most of the file, in three sizes and with no sub-band heading, is refused',
    plan(SIZES, [3, ONE, TWO, THREE]), SIZES, ['sub-band 3']],
  ['the same rows, each under the heading its phases name, pass',
    plan(SIZES, [3, SMALL_HEAD, ONE, MID_HEAD, TWO, BIG_HEAD, THREE]), SIZES, []],
  ['a row under the wrong sub-band heading is refused, and named',
    plan(SIZES, [3, SMALL_HEAD, ONE, TWO, BIG_HEAD, THREE]), SIZES, ['sub-band refactor/b/two.md']],
  ['a sub-band heading with a row left above it is refused',
    plan(SIZES, [3, ONE, MID_HEAD, TWO, BIG_HEAD, THREE]), SIZES, ['sub-band 3']],
  ['a band under half the file needs no sub-band heading, however many sizes it holds',
    plan(QUAD, [1, ONE, TWO], [3, THREE, FOUR]), QUAD, []],
  ['a band holding most of the file, every row the same size, needs none either',
    plan(PAIR, [3, ONE, TWO]), PAIR, []],
  ['a small row behind a big one belongs under its blocker\'s heading',
    plan(BEHIND, [3, BIG_HEAD, BIG_ROW, SMALL_BEHIND]), BEHIND, []],
  ['the same row under the heading its own phases name is refused',
    plan(BEHIND, [3, BIG_HEAD, BIG_ROW, SMALL_HEAD, SMALL_BEHIND]), BEHIND, ['sub-band refactor/b/small.md']],
  ['a run named in the Ticket cell is counted rather than the whole file',
    plan(RUN_ONLY, [3, MID_HEAD, RUN_ROW]), RUN_ONLY, []],
  ['the same row placed by the whole file it comes from is refused',
    plan(RUN_ONLY, [3, BIG_HEAD, RUN_ROW]), RUN_ONLY, ['sub-band refactor/a/big.md']],
  ['a ticket with no phase heading is refused rather than read as the cheapest thing in the tree',
    plan(NO_PHASES, [3, ONE]), NO_PHASES, ['phases refactor/a/one.md']],
  ['a wait on a ticket that has shipped is refused',
    plan(PAIR, [1, '| 1 | [one](refactor/a/one.md) | Ready | [gone](done/app/gone.md) | first |'], [3, TWO]),
    PAIR, ['depends done/app/gone.md']],
  ['a link in a Why here cell is not read as a row',
    plan(PAIR, [1, '| 1 | [one](refactor/a/one.md) | Ready | — | it shares a seam with [two](refactor/b/two.md) |']),
    PAIR, ['ticket refactor/b/two.md']],
  ['words after the link still name the ticket',
    plan(PAIR, [1, '| 1 | [one](refactor/a/one.md) **phases 1–4** | Ready | — | first |'], [3, TWO]), PAIR, []],
  ['a row outside any tier heading is not a row',
    `## Off the list\n\n${TABLE}${ONE}\n\n**Last ranked 9 August 2026.** Live: 2. Retired: 0. Turned down: 0.\n`,
    PAIR, ['ticket refactor/a/one.md', 'ticket refactor/b/two.md']],
  ['a fixes ticket ranked below tier 1 is refused',
    plan(MIXED, [1, '| 1 | [two](refactor/b/two.md) | Ready | — | first |'], [3, '| 2 | [f](fixes/a/f.md) | Ready | — | second |']),
    MIXED, ['fixes tier fixes/a/f.md']],
  ['the same fixes ticket in tier 1 passes', plan(FIX, [1, FIX_ROW]), FIX, []],
  ['a fixes ticket in tier 0 passes, because tier 0 sits above tier 1', plan(FIX, [0, FIX_ROW]), FIX, []],
  ['a file with no tier 1 heading at all still refuses a fixes ticket',
    plan(FIX, [3, FIX_ROW]), FIX, ['fixes tier fixes/a/f.md']],
  ['a features ticket in tier 1 is refused',
    plan(FEATURE, [1, FEATURE_ROW]), FEATURE, ['features tier features/b/g.md']],
  ['the same features ticket in tier 3 passes', plan(FEATURE, [3, FEATURE_ROW]), FEATURE, []],
];

function selfTest() {
  const fails = [];
  for (const [name, text, t, want] of CASES) {
    const got = shapeProblems(text, t).map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) {
      fails.push(`${name}: got [${got}], want [${want}]`);
    }
  }
  return fails;
}

const testFails = selfTest();
if (testFails.length) {
  console.error('plan: the rules are wrong, so the running order was not read:');
  for (const line of testFails) console.error(`  ${line}`);
  process.exit(1);
}

if (!existsSync(plans)) {
  console.log('plan: no ../docs beside this repo, so there is no running order to read');
  process.exit(0);
}

function markdown(dir, base) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdown(full, base));
    else if (entry.name.endsWith('.md')) out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

const live = new Set();
for (const folder of LIVE_PLANS) {
  const full = join(plans, folder);
  if (!existsSync(full) || !statSync(full).isDirectory()) continue;
  for (const file of markdown(full, plans)) live.add(file);
}

// A struck first cell is a ticket that shipped; the record under the tables is prose, not rows.
const retired = readFileSync(join(plans, 'done', 'PLAN.md'), 'utf8')
  .split('\n')
  .filter((line) => line.trim().startsWith('|') && line.split('|')[1]?.includes('~~')).length;

// `canceled/` holds that folder's own ranking file as well as the refused plans.
const turnedDown = markdown(join(plans, 'canceled'), plans).filter((f) => f !== 'canceled/PLAN.md').length;

// What a row costs: the slices its ticket ships in.
const phases = new Map();
for (const ticket of live) {
  const found = readFileSync(join(plans, ticket), 'utf8').match(/^###\s+Phase\b/gm);
  if (found) phases.set(ticket, found.length);
}

const text = readFileSync(join(plans, 'PLAN.md'), 'utf8');
const problems = shapeProblems(text, { live, retired, turnedDown, phases });

if (problems.length) {
  console.error('the running order has stopped ranking every live ticket:');
  for (const { message } of problems) console.error(`  ${message}`);
  console.error('Run /pm: it re-derives every row off the tree, so a ticket with no row gets one and');
  console.error('the counts at the foot are rewritten from what is actually on disk.');
  process.exit(1);
}

console.log(`plan: ${planRows(text).length} rows, one per live ticket, positions 1 to ${live.size} once each, ${retired} retired and ${turnedDown} turned down matching the tree, no row above what it waits on, every row under the sub-band heading its phases name, every fix in tier 1 and no feature in it`);
