#!/usr/bin/env node
// Nothing looked at the shape of the running order next door, so three of its tiers emptied and it went on calling itself a ranking for days, and its own counts were out twice in one afternoon.
//
//   node scripts/check-plan.mjs   fail on a running order that has stopped ranking every live ticket
//
// Twelve rules, every one read straight off the page. Whether a row is ranked well is the ranker's judgment and no script's.
//
// The last of them is about the shipped log next door: 30 retired rows once sat above its title, under no header row and inside no tier table, and the count that would have caught it read a struck line wherever it sat. One walk answers the count and the shape so the two cannot drift apart again.
//
// Size is not a test: a band holding most of the rows is what a tree of mostly-features looks like, and no count makes a definition wrong. What makes one wrong is asking for two unrelated things at once, or asking for something no row can satisfy — read the words of a definition, never the count under it.
//
// So the only thing size buys here is a landmark: a long band is cut on cost, counted in a ticket's `### Phase` headings or in the run its cell names, and every row sits under the heading its own count names — or its blocker's, where that is dearer.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planTree } from './plan-tree.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plans = planTree(root);

// Every file in these is a ticket — none of them holds an index.
const LIVE_PLANS = ['features', 'refactor', 'fixes'];

// The running order is a named document, so its name comes before its ranked work.
const TITLE = '# Leaftext Plan Log';

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
    // The Hold band: ranked rows the owner has parked, always after the numbered tiers.
    if (/^##(?!#)\s+Hold\b/.test(line)) {
      tier = 'hold';
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
    if (cells.length < 6) continue;
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
      blocks: links(cells[3]),
      blockers: links(cells[4]),
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

// The file is rewritten in place, so its stamp is the only thing saying which pass a reader is holding — and a date alone cannot answer that on the day it matters, since two rankings in one afternoon leave the same six words.
const STAMP = /\*\*Last ranked ([^*]+?)\.?\*\*/;
const STAMP_TIME = /\d{1,2}:\d{2}/;

// `tree` is `{ live, retired, turnedDown, phases }` — the live ticket paths, the two retired counts, and what each ticket costs.
function shapeProblems(text, tree) {
  const problems = [];
  // `subject` is what the refusal is about — the self-test reads it, so a rule firing on the wrong row is caught rather than counted as a pass.
  const say = (rule, subject, message) => problems.push({ rule, subject, message });
  const rows = planRows(text);

  // A title after the ranked tables is the headerless opening `done/PLAN.md` shipped, so the name comes first and the first work table sits under it.
  const opening = text.split('\n').map((line) => line.trim()).find((line) => line !== '');
  if (opening === undefined) say('title', 'an empty file', `the file holds nothing, so it does not open with \`${TITLE}\``);
  else if (opening !== TITLE) say('title', opening, `the file opens on "${opening}", and a running order opens with \`${TITLE}\``);

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

  const stamp = STAMP.exec(text);
  if (!stamp) say('stamp', 'the foot of the file', 'nothing says when this was ranked, so a rerank and the one before it read the same');
  else if (!STAMP_TIME.test(stamp[1])) say('stamp', stamp[1].trim(), `the stamp says "${stamp[1].trim()}" and gives no time, so two rankings on one day cannot be told apart`);

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

  // `Blocks` is `Blocked by` read the other way, so the two columns are held to each other and neither can drift.
  const waiting = new Map();
  for (const row of rows) {
    for (const blocker of row.blockers) {
      if (!waiting.has(blocker)) waiting.set(blocker, new Set());
      waiting.get(blocker).add(row.ticket);
    }
  }
  for (const row of rows) {
    if (row.ticket === null) continue;
    const expect = waiting.get(row.ticket) ?? new Set();
    for (const named of row.blocks) {
      if (!expect.has(named)) say('blocks', named, `position ${row.position} says it blocks ${named}, and ${named} does not wait on it`);
    }
    for (const dependent of expect) {
      if (dependent !== null && !row.blocks.includes(dependent)) {
        say('blocks', dependent, `${dependent} waits on ${row.ticket}, and position ${row.position} does not say so in Blocks`);
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

  // The folder is the one claim about a ticket a script can read. Tier 0 is allowed because it sits above tier 1, and Hold because parking a row is the owner's call.
  for (const row of rows) {
    if (row.ticket === null) continue;
    if (row.tier === 'hold') continue;
    if (row.ticket.startsWith('fixes/') && row.tier > 1) {
      say('fixes tier', row.ticket, `position ${row.position} sits in tier ${row.tier}, and ${row.ticket} is filed under fixes/ — a claim to be wrong today, which is what tier 1 holds`);
    }
    if (row.ticket.startsWith('features/') && row.tier === 1) {
      say('features tier', row.ticket, `position ${row.position} sits in tier 1, and ${row.ticket} is filed under features/ — absent is not wrong, so it never reaches that tier`);
    }
  }

  return problems;
}

// The shipped log is read by the tier a row was retired from, so its headings are what a row is found under.
const SHIPPED_TIER = /^##(?!#)\s+Retired from tier\s+(\d+)\b/;

// A row writes `\|` in its own prose, so splitting on every pipe reads four cells as seven. Both files next door are read with it.
function rowCells(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out = [];
  let cell = '';
  for (let at = 0; at < trimmed.length; at += 1) {
    if (trimmed[at] === '\\') {
      cell += trimmed[at] + (trimmed[at + 1] ?? '');
      at += 1;
      continue;
    }
    if (trimmed[at] === '|') {
      out.push(cell.trim());
      cell = '';
      continue;
    }
    cell += trimmed[at];
  }
  out.push(cell.trim());
  return out;
}

// One walk, so a file whose shape is wrong fails on the shape rather than on a count that has quietly moved with it.
function shippedProblems(text) {
  const problems = [];
  const say = (rule, subject, message) => problems.push({ rule, subject, message });
  let tier = null;
  let header = null;
  let started = false;
  let retired = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const heading = SHIPPED_TIER.exec(line);
    if (heading) {
      tier = Number(heading[1]);
      header = null;
      started = true;
      continue;
    }
    if (/^##(?!#)\s/.test(line)) {
      tier = null;
      header = null;
      continue;
    }
    if (!line.startsWith('|')) continue;
    const cells = rowCells(line);
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    if (!cells[0].includes('~~')) {
      if (tier !== null && header === null) header = cells.length;
      continue;
    }
    retired += 1;
    const named = links(cells[0])[0] ?? cells[0].replace(/\s+/g, ' ');
    if (!started) {
      say('shipped', named, `line ${i + 1}: ${named} is struck through above the first \`## Retired from tier\` heading, so it belongs to no tier and sits under no header row`);
      continue;
    }
    if (tier === null) {
      say('shipped', named, `line ${i + 1}: ${named} sits under a heading that is not a tier, so nobody finds it by where it was ranked`);
      continue;
    }
    if (header === null) {
      say('shipped', named, `line ${i + 1}: ${named} sits in tier ${tier} with no header row above it`);
      continue;
    }
    if (cells.length !== header) {
      say('shipped', named, `line ${i + 1}: ${named} carries ${cells.length} cells and the tier ${tier} header names ${header}`);
    }
  }
  return { problems, retired };
}

// The index next door is what every ticket skill says to read before writing a word. A ticket with two rows in it describes itself twice, and the older one describes the work as it was before it was designed; a ticket with none is invisible to the one pass that stops the tree planning the same thing twice. Three carried two.
//
// Only the first cell counts. A ticket is linked from other rows on purpose — what it replaces, what it rides on — so reading every link would fail on the cross-references the tree is built out of. The row a ticket owns is the one whose first cell opens the line, and only paths in `live` are counted, so a shipped or refused row is never held to the live set.
function indexProblems(text, live) {
  const problems = [];
  const say = (subject, message) => problems.push({ rule: 'index', subject, message });
  const owned = new Map();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    const path = links(rowCells(line)[0] ?? '')[0];
    if (!path || !live.has(path)) continue;
    if (!owned.has(path)) owned.set(path, []);
    owned.get(path).push(i + 1);
  }
  for (const ticket of [...owned.keys()].sort()) {
    const at = owned.get(ticket);
    if (at.length > 1) {
      say(ticket, `${ticket} opens ${at.length} rows, at lines ${at.join(', ')}: whoever reads the older one is planning against the ticket as it was before it was designed`);
    }
  }
  for (const ticket of [...live].sort()) {
    if (!owned.has(ticket)) {
      say(ticket, `${ticket} opens no row, so it is invisible to the one pass that stops the tree planning the same thing twice`);
    }
  }
  return problems;
}

// Every refusal is proved on made-up files before the real one is opened. Each case is a fault that has happened.
const TABLE = '| # | Ticket | Status | Blocks | Blocked by | Why here |\n|---|---|---|---|---|---|\n';

// `phases` is what the real run reads off each ticket. Left out, every ticket is three phases, which is the middle sub-band and the tree's own commonest row.
function tree(live, retired = 0, turnedDown = 0, phases = null) {
  const counts = new Map();
  for (const path of live) {
    const n = phases ? phases[path] : 3;
    if (n) counts.set(path, n);
  }
  return { live: new Set(live), retired, turnedDown, phases: counts };
}

// `plan(t, [3, row, row], ...)` — one entry per tier heading, each with its rows. An entry starting `###` is a sub-band heading, and the rows after it get their own table. It opens with the title every running order opens with, and the foot is written from the tree, so only a case testing one of those has to disagree with it.
function plan(t, ...tiers) {
  const bands = tiers.map(([n, ...items]) => {
    let out = n === 'hold' ? '## Hold — parked by the owner\n\n' : `## Tier ${n} — a band\n\n`;
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
  return `${TITLE}\n\n${bands.join('\n')}\n## Off the list\n\n**Last ranked 9 August 2026, 4:07pm.** Live: ${t.live.size}. Retired: ${t.retired}. Turned down: ${t.turnedDown}.\n`;
}

const PAIR = tree(['refactor/a/one.md', 'refactor/b/two.md']);
const ONE = '| 1 | [one](refactor/a/one.md) | Ready | — | — | first |';
const TWO = '| 2 | [two](refactor/b/two.md) | Ready | — | — | second |';
const FIX = tree(['fixes/a/f.md']);
const FIX_ROW = '| 1 | [f](fixes/a/f.md) | Ready | — | — | wrong today |';
const FEATURE = tree(['features/b/g.md']);
const FEATURE_ROW = '| 1 | [g](features/b/g.md) | Ready | — | — | not built yet |';

const MIXED = tree(['fixes/a/f.md', 'refactor/b/two.md']);

const SMALL_HEAD = `### ${SUB_BANDS[0].name}`;
const MID_HEAD = `### ${SUB_BANDS[1].name}`;
const BIG_HEAD = `### ${SUB_BANDS[2].name}`;

const THREE = '| 3 | [three](refactor/c/three.md) | Ready | — | — | third |';
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
const FOUR = '| 4 | [four](refactor/d/four.md) | Ready | — | — | fourth |';

// A one-phase row behind a seven-phase one: it belongs under its blocker's heading, not its own.
const BEHIND = tree(['refactor/a/big.md', 'refactor/b/small.md'], 0, 0, {
  'refactor/a/big.md': 7,
  'refactor/b/small.md': 1,
});
const BIG_ROW = '| 1 | [big](refactor/a/big.md) | Ready | [small](refactor/b/small.md) | — | first |';
const SMALL_BEHIND = '| 2 | [small](refactor/b/small.md) | Ready | — | [big](refactor/a/big.md) | second |';

const RUN_ONLY = tree(['refactor/a/big.md'], 0, 0, { 'refactor/a/big.md': 7 });
const RUN_ROW = '| 1 | [big](refactor/a/big.md) **phases 1–4** | Ready | — | — | first |';

// Each case wants the rules that fire and what each one names, so a rule firing on the wrong row is a failure.
const CASES = [
  ['a running order that agrees with the tree passes', plan(PAIR, [1, ONE], [3, TWO]), PAIR, []],
  ['a live ticket with no row is refused', plan(PAIR, [1, ONE]), PAIR, ['ticket refactor/b/two.md']],
  ['a row naming no live ticket is refused',
    plan(PAIR, [1, ONE], [3, TWO, '| 3 | [gone](refactor/b/gone.md) | Ready | — | — | third |']),
    PAIR, ['ticket refactor/b/gone.md']],
  ['a repeated position is refused',
    plan(PAIR, [1, ONE], [3, '| 1 | [two](refactor/b/two.md) | Ready | — | — | second |']),
    PAIR, ['position 1', 'position 2']],
  ['a row cut mid-pass leaves a gap and a top number above the row count, and both are named',
    plan(PAIR, [1, ONE], [3, '| 3 | [two](refactor/b/two.md) | Ready | — | — | second |']),
    PAIR, ['position 2', 'position 3']],
  ['a count that disagrees with the tree is refused',
    plan(PAIR, [1, ONE], [3, TWO]).replace('Live: 2', 'Live: 3'), PAIR, ['count Live']],
  ['a row above what it waits on is refused, sub-band heading and all',
    plan(PAIR, [3, MID_HEAD, '| 1 | [one](refactor/a/one.md) | Ready | — | [two](refactor/b/two.md) | first |', '| 2 | [two](refactor/b/two.md) | Ready | [one](refactor/a/one.md) | — | second |']),
    PAIR, ['depends refactor/b/two.md']],
  ['the same pair the other way round, under a sub-band heading, passes — so a row under a `###` line is still read',
    plan(PAIR, [3, MID_HEAD, '| 1 | [two](refactor/b/two.md) | Ready | [one](refactor/a/one.md) | — | first |', '| 2 | [one](refactor/a/one.md) | Ready | — | [two](refactor/b/two.md) | second |']),
    PAIR, []],
  ['a Blocks cell naming a row that does not wait on it is refused',
    plan(PAIR, [1, '| 1 | [one](refactor/a/one.md) | Ready | [two](refactor/b/two.md) | — | first |'], [3, TWO]),
    PAIR, ['blocks refactor/b/two.md']],
  ['a wait whose blocker does not name it back in Blocks is refused',
    plan(PAIR, [1, '| 1 | [two](refactor/b/two.md) | Ready | — | — | first |'], [3, '| 2 | [one](refactor/a/one.md) | Ready | — | [two](refactor/b/two.md) | second |']),
    PAIR, ['blocks refactor/a/one.md']],
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
    plan(PAIR, [1, '| 1 | [one](refactor/a/one.md) | Ready | — | [gone](done/app/gone.md) | first |'], [3, TWO]),
    PAIR, ['depends done/app/gone.md']],
  ['a link in a Why here cell is not read as a row',
    plan(PAIR, [1, '| 1 | [one](refactor/a/one.md) | Ready | — | — | it shares a seam with [two](refactor/b/two.md) |']),
    PAIR, ['ticket refactor/b/two.md']],
  ['words after the link still name the ticket',
    plan(PAIR, [1, '| 1 | [one](refactor/a/one.md) **phases 1–4** | Ready | — | — | first |'], [3, TWO]), PAIR, []],
  ['a row outside any tier heading is not a row',
    `${TITLE}\n\n## Off the list\n\n${TABLE}${ONE}\n\n**Last ranked 9 August 2026, 4:07pm.** Live: 2. Retired: 0. Turned down: 0.\n`,
    PAIR, ['ticket refactor/a/one.md', 'ticket refactor/b/two.md']],
  ['a fixes ticket ranked below tier 1 is refused',
    plan(MIXED, [1, '| 1 | [two](refactor/b/two.md) | Ready | — | — | first |'], [3, '| 2 | [f](fixes/a/f.md) | Ready | — | — | second |']),
    MIXED, ['fixes tier fixes/a/f.md']],
  ['the same fixes ticket in tier 1 passes', plan(FIX, [1, FIX_ROW]), FIX, []],
  ['a fixes ticket in tier 0 passes, because tier 0 sits above tier 1', plan(FIX, [0, FIX_ROW]), FIX, []],
  ['a file with no tier 1 heading at all still refuses a fixes ticket',
    plan(FIX, [3, FIX_ROW]), FIX, ['fixes tier fixes/a/f.md']],
  ['a features ticket in tier 1 is refused',
    plan(FEATURE, [1, FEATURE_ROW]), FEATURE, ['features tier features/b/g.md']],
  ['the same features ticket in tier 3 passes', plan(FEATURE, [3, FEATURE_ROW]), FEATURE, []],
  ['a fixes ticket parked in the Hold band passes, because parking is the owner\'s call',
    plan(FIX, ['hold', FIX_ROW]), FIX, []],
  ['a row whose only home is the Hold band is still counted as ranked',
    plan(PAIR, [1, ONE], ['hold', TWO]), PAIR, []],
  ['a title reached past blank lines still opens the file, so the rule reads the first line with something on it',
    `\n\n${plan(PAIR, [1, ONE], [3, TWO])}`, PAIR, []],
  ['a file opening on its first work table rather than its title is refused, and the line it opens on is named',
    plan(PAIR, [1, ONE], [3, TWO]).replace(`${TITLE}\n\n`, ''), PAIR, ['title ## Tier 1 — a band']],
  ['a stamp giving the day and no time is refused, and quoted back',
    plan(PAIR, [1, ONE], [3, TWO]).replace(', 4:07pm', ''), PAIR, ['stamp 9 August 2026']],
  ['a file with no stamp at all is refused',
    plan(PAIR, [1, ONE], [3, TWO]).replace('**Last ranked 9 August 2026, 4:07pm.**', ''), PAIR, ['stamp the foot of the file']],
  ['a stamp written round the clock is a time too',
    plan(PAIR, [1, ONE], [3, TWO]).replace('4:07pm', '16:07'), PAIR, []],
];

// `shipped([1, row, row], ...)` — one entry per tier heading, each row under the four columns the shipped tiers carry. It opens with the shipped log's own title, so only a case about a row above that title has to disagree with it.
const SHIPPED_TITLE = '# What was built, in the order it was built';
const SHIPPED_TABLE = '| Ticket | Status | What was wrong, and what landed | Cost |\n|---|---|---|---|\n';

function shipped(...tiers) {
  const bands = tiers.map(([n, ...rows]) => `## Retired from tier ${n} — a band\n\n${SHIPPED_TABLE}${rows.map((r) => `${r}\n`).join('')}`);
  return `${SHIPPED_TITLE}\n\n${bands.join('\n')}\n## What the retired rows add up to\n\nOne of them.\n`;
}

const SHIPPED_ONE = '| ~~[one](reading/one.md)~~ | Done 16 August 2026, v1.0.0 | what landed | One phase |';
const SHIPPED_TWO = '| ~~[two](repo/two.md)~~ | Done 15 August 2026 | what landed | Two phases |';
// The row that broke a naive cell count: `\|` inside the prose is one character, not a column boundary.
const SHIPPED_PIPES = '| ~~[three](repo/three.md)~~ | Done 15 August 2026 | it read `&&`, `\\|\\|` and `\\|` alike | One phase |';
const SHORT = '| ~~[short](workflow/short.md)~~ | Done 15 August 2026 | what landed |';

const SHIPPED_CASES = [
  ['a shipped log with every row inside its tier table passes', shipped([1, SHIPPED_ONE, SHIPPED_PIPES], [3, SHIPPED_TWO]), [], 3],
  ['a struck row above the first tier heading is refused, and named',
    `${SHIPPED_ONE}\n${shipped([1, SHIPPED_TWO])}`, ['shipped reading/one.md'], 2],
  ['a struck row short of its header\'s cells is refused',
    shipped([1, SHIPPED_ONE, SHORT]), ['shipped workflow/short.md'], 2],
  ['a struck row under a heading that is not a tier is refused',
    `${shipped([1, SHIPPED_ONE])}\n${SHIPPED_TABLE}${SHIPPED_TWO}\n`, ['shipped repo/two.md'], 2],
  ['a tier table with no header row above its rows is refused',
    `${SHIPPED_TITLE}\n\n## Retired from tier 1 — a band\n\n${SHIPPED_ONE}\n`, ['shipped reading/one.md'], 1],
  ['the count is the struck rows the walk found, wherever they sit',
    shipped([0, SHIPPED_ONE], [1, SHIPPED_TWO, SHIPPED_PIPES]), [], 3],
];

// `index(row, row)` — the index next door opens with its own title and one table of tickets, so the first row lands on line 5 and every row after it one line lower.
const INDEX_TABLE = '| ticket | what it is |\n| --- | --- |\n';

function index(...rows) {
  return `# The ticket README\n\n${INDEX_TABLE}${rows.map((r) => `${r}\n`).join('')}`;
}

const INDEX_ONE = '| [one](refactor/a/one.md) | what it is |';
const INDEX_ONE_AGAIN = '| [one](refactor/a/one.md) | what it was before it was designed |';
const INDEX_TWO = '| [two](refactor/b/two.md) | what it is |';
// The row that must not count as an owned row: `two` is named inside `one`'s prose as the work it rides on.
const INDEX_CROSS = '| [one](refactor/a/one.md) | rides on [two](refactor/b/two.md) |';
const INDEX_SHIPPED = '| [gone](done/c/gone.md) | what shipped |';

const INDEX_LIVE = new Set(['refactor/a/one.md', 'refactor/b/two.md']);

const INDEX_CASES = [
  ['an index with one row per live ticket passes', index(INDEX_ONE, INDEX_TWO), INDEX_LIVE, [], ''],
  ['a ticket opening two rows is refused, and both lines are named',
    index(INDEX_ONE, INDEX_TWO, INDEX_ONE_AGAIN), INDEX_LIVE, ['index refactor/a/one.md'], 'lines 5, 7'],
  ['a ticket opening no row is refused, and named',
    index(INDEX_ONE), INDEX_LIVE, ['index refactor/b/two.md'], 'opens no row'],
  ['a link later in a row is a cross-reference, not an owned row',
    index(INDEX_CROSS, INDEX_TWO), INDEX_LIVE, [], ''],
  ['a row for a ticket that shipped is never held to the live set',
    index(INDEX_ONE, INDEX_TWO, INDEX_SHIPPED), INDEX_LIVE, [], ''],
];

function selfTest() {
  const fails = [];
  for (const [name, text, t, want] of CASES) {
    const got = shapeProblems(text, t).map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) {
      fails.push(`${name}: got [${got}], want [${want}]`);
    }
  }
  for (const [name, text, want, count] of SHIPPED_CASES) {
    const read = shippedProblems(text);
    const got = read.problems.map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) {
      fails.push(`${name}: got [${got}], want [${want}]`);
    }
    if (read.retired !== count) fails.push(`${name}: counted ${read.retired} retired rows, want ${count}`);
  }
  for (const [name, text, live, want, said] of INDEX_CASES) {
    const found = indexProblems(text, live);
    const got = found.map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) {
      fails.push(`${name}: got [${got}], want [${want}]`);
    }
    if (said && !found.some((p) => p.message.includes(said))) {
      fails.push(`${name}: no message said \`${said}\``);
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
const shippedRead = shippedProblems(readFileSync(join(plans, 'done', 'PLAN.md'), 'utf8'));
const retired = shippedRead.retired;

// `canceled/` holds that folder's own ranking file as well as the refused plans.
const turnedDown = markdown(join(plans, 'canceled'), plans).filter((f) => f !== 'canceled/PLAN.md').length;

// What a row costs: the slices its ticket ships in.
const phases = new Map();
for (const ticket of live) {
  const found = readFileSync(join(plans, ticket), 'utf8').match(/^###\s+Phase\b/gm);
  if (found) phases.set(ticket, found.length);
}

const text = readFileSync(join(plans, 'PLAN.md'), 'utf8');
const problems = [...shapeProblems(text, { live, retired, turnedDown, phases }), ...shippedRead.problems];

// The same walk answers the index, so the two cannot disagree about what is live.
const indexFails = indexProblems(readFileSync(join(plans, 'README.md'), 'utf8'), live);

if (problems.length) {
  console.error('the running order has stopped ranking every live ticket:');
  for (const { message } of problems) console.error(`  ${message}`);
  console.error('Run /pm: it re-derives every row off the tree, so a ticket with no row gets one and');
  console.error('the counts at the foot are rewritten from what is actually on disk.');
  console.error('A row named above is in done/PLAN.md: /done puts one in the table for the tier it was retired from.');
}

if (indexFails.length) {
  console.error('the index every ticket is written against has stopped holding one row per live ticket:');
  for (const { message } of indexFails) console.error(`  ${message}`);
  console.error('Run /ticket: a ticket added, renamed or moved between folders is not finished until the one row');
  console.error('it opens matches. A ticket named in another row stays a cross-reference and keeps its own row.');
}

if (problems.length || indexFails.length) process.exit(1);

console.log(`plan: opening with \`${TITLE}\`, ${planRows(text).length} rows, one per live ticket, positions 1 to ${live.size} once each, ${retired} retired and ${turnedDown} turned down matching the tree, no row above what it waits on, every Blocks cell agreeing with the waits, every row under the sub-band heading its phases name, every fix in tier 1 or parked in Hold, no feature in tier 1, a stamp naming the day and the time it was ranked, every retired row inside the tier table it was retired from, square with that table's header, and one row opened per live ticket in the index beside it`);
