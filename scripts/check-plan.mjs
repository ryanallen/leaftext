#!/usr/bin/env node
// Nothing looked at the shape of the running order next door, so three of its tiers emptied and it went on calling itself a ranking for days, and its own counts were out twice in one afternoon.
//
//   node scripts/check-plan.mjs   fail on a running order that has stopped ranking every live ticket
//
// Fourteen rules, every one read straight off the page. Whether a row is ranked well is the ranker's judgment and no script's.
//
// One of them is about the shipped log next door: 30 retired rows once sat above its title, under no header row and inside no tier table, and the count that would have caught it read a struck line wherever it sat. One walk answers the count and the shape so the two cannot drift apart again.
//
// The last is about the names themselves rather than the rows: the same two walks say whether a live plan has taken a name the shipped or turned-down half already holds, which is a collision the retirement otherwise meets hours later with every link to the ticket already made.
//
// Size is not a test: a band holding most of the rows is what a tree of mostly-features looks like, and no count makes a definition wrong. What makes one wrong is asking for two unrelated things at once, or asking for something no row can satisfy — read the words of a definition, never the count under it.
//
// So the only thing size buys here is a landmark: a long band is cut on cost, counted in a ticket's `### Phase` headings or in the run its cell names, and every row sits under the heading its own count names — or its blocker's, where that is dearer.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planTree, planTreeMissing } from './plan-tree.mjs';
import { links, planRows, trackOf } from './plan-rows.mjs';
import { CELL_BOUND, CELL_SHAPE, cellFor, claimsInTree, overlap, partnersFor, waitsOnEachOther } from './plan-footprints.mjs';
import { BLOCKS_BOUND, columnProblems, selfTest as waitsSelfTest, trackFiles, trackTables, waitsProblems } from './plan-waits.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plans = planTree(root);

// Every file in these is a ticket — none of them holds an index.
const LIVE_PLANS = ['features', 'refactor', 'fixes'];

// Work outside the live list. Each folder's own PLAN.md is a record, not a ticket, so none owns an index row.
const ARCHIVED_PLANS = ['done', 'canceled', 'on-hold'];

// The running order is a named document, so its name comes before its ranked work.
const TITLE = '# Leaftext Plan Log';

// A long band is cut on the reader's own question — can I start this — so the two sub-bands are whether anything live stands in front of the row. Read straight off `Blocked by`, which is computed from the declared waits under `docs/tracks/`, so neither heading can drift and neither can lie.
//
// **How many phases a ticket has plays no part in this file at all.** The cut used to be a phase count, and the lift that puts a blocked row under its blocker's heading falsified it every time it fired: a one-phase row sat under `### Five phases or more` and the heading had to be explained somewhere else to stop reading as a mistake. A heading that needs a paragraph of explanation has stopped being a landmark, so the count went rather than the lift.
const SUB_BANDS = [
  { name: 'Nothing is in front of these', blocked: false },
  { name: 'Each of these waits on a row above', blocked: true },
];

function count(text, label) {
  const found = new RegExp(`${label}:\\s*(\\d+)`).exec(text);
  return found ? Number(found[1]) : null;
}

// The owner naming a row to go first had nowhere to be written down, so a pick lived in the session that heard it and the next rewrite dropped it. Hold is the owner saying not yet, written into a band, a rule, a glossary row and a check; this is the owner saying now, written into the same four, so nobody learns a second shape.
//
// It sits above tier 1 on purpose, and the cost is real and named: a picked row outranks *wrong today*, so one can sit above a fault somebody is meeting right now. That is the owner making a call with the list in front of them, which is what Hold already lets them do at the other end.
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';

const PICKED_BAND = 'Picked by the owner';
const PICKED_HEADING = new RegExp(`^##(?!#)\\s+${PICKED_BAND}\\b`);

/// The cell saying when the owner made the pick. A day alone cannot answer when in a tree that fills one, so it carries the time beside it the way every other date the workflow writes does.
const PICKED_DATE = new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{4},\\s*\\d{1,2}:\\d{2}`, 'i');

// The file is rewritten in place, so its stamp is the only thing saying which pass a reader is holding — and a date alone cannot answer that on the day it matters, since two rankings in one afternoon leave the same six words.
const STAMP = /\*\*Last ranked ([^*]+?)\.?\*\*/;
const STAMP_TIME = /\d{1,2}:\d{2}/;

// `tree` is `{ live, retired, turnedDown, held }` — the live ticket paths and the three counts the foot of the file reports.
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

  for (const [label, want] of [['Live', tree.live.size], ['On hold', tree.held], ['Retired', tree.retired], ['Turned down', tree.turnedDown]]) {
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
    // Bounded the way `Devs with` is, and for the same reason: the Progress trunk blocks eighteen tickets under a declared wait, and eighteen links in a cell held to one sentence is not a cell anybody reads. So the cell owes the highest-ranked few and the total, never all of them.
    const ranked = [...expect]
      .filter((name) => name !== null && byTicket.has(name))
      .sort((a, b) => byTicket.get(a).position - byTicket.get(b).position);
    for (const dependent of ranked.slice(0, BLOCKS_BOUND)) {
      if (!row.blocks.includes(dependent)) {
        say('blocks', dependent, `${dependent} waits on ${row.ticket} and is one of the ${BLOCKS_BOUND} highest-ranked rows that do, and position ${row.position} does not say so in Blocks`);
      }
    }
    if (ranked.length > BLOCKS_BOUND && !new RegExp(`\\(${ranked.length} in all\\)`).test(row.cells[3] ?? '')) {
      say('blocks', row.ticket, `${ranked.length} rows wait on position ${row.position} and its Blocks cell names at most ${BLOCKS_BOUND} of them without saying how many there are — the cell ends "(${ranked.length} in all)", the way Devs with does`);
    }
  }

  // Which sub-band each row belongs in: one question, asked of the row's own `Blocked by` cell.
  const want = new Map();
  const ordered = rows.filter((r) => r.ticket !== null && tree.live.has(r.ticket)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  for (const row of ordered) {
    want.set(row.ticket, SUB_BANDS.findIndex((b) => b.blocked === (row.blockers.length > 0)));
  }

  for (const row of ordered) {
    const band = want.get(row.ticket);
    if (band === undefined || row.sub === null) continue;
    if (row.sub !== SUB_BANDS[band].name) {
      const reason = row.blockers.length
        ? `it waits on ${row.blockers.join(', ')}, which puts it under "${SUB_BANDS[band].name}"`
        : `nothing live stands in front of it, which puts it under "${SUB_BANDS[band].name}"`;
      say('sub-band', row.ticket, `position ${row.position} sits under "${row.sub}", and ${reason}`);
    }
  }

  // A band over half the file, holding rows on both sides of that question, is a run nobody can find a place in. A band whose rows all answer it the same way has nothing to cut.
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
      say('sub-band', tier, `tier ${tier} holds ${band.length} of the ${rows.length} rows, some startable today and some not, and carries no sub-band heading, so it is one run with no landmark in it`);
    } else if (loose.length) {
      say('sub-band', tier, `tier ${tier} holds ${band.length} of the ${rows.length} rows and ${loose.length} of them sit above its first sub-band heading`);
    }
  }

  // The folder is the one claim about a ticket a script can read. Tier 0 is allowed because it sits above tier 1.
  for (const row of rows) {
    if (row.ticket === null) continue;
    if (row.tier === 'hold') {
      say('hold band', row.ticket, `position ${row.position} sits in the old Hold band; parked work belongs under on-hold/ and outside the live ranking`);
      continue;
    }
    if (row.ticket.startsWith('fixes/') && row.tier > 1) {
      say('fixes tier', row.ticket, `position ${row.position} sits in tier ${row.tier}, and ${row.ticket} is filed under fixes/ — a claim to be wrong today, which is what tier 1 holds`);
    }
    if (row.ticket.startsWith('features/') && row.tier === 1) {
      say('features tier', row.ticket, `position ${row.position} sits in tier 1, and ${row.ticket} is filed under features/ — absent is not wrong, so it never reaches that tier`);
    }
  }

  for (const row of rows) {
    for (const problem of whyProblems(row)) say('why', row.ticket ?? row.position, `position ${row.position}: ${problem}`);
  }

  problems.push(...pickedProblems(text, rows));

  return problems;
}

// The owner's own pick: a band above tier 1 holding the rows they named, in the order they named them, each with the date and time of the pick. Everything else about the file goes on unchanged — positions run straight through the band, and a picked row is exempt from the tier definitions the way a held one is outside them.
function pickedProblems(text, rows) {
  const problems = [];
  const say = (subject, message) => problems.push({ rule: 'picked', subject, message });
  const lines = text.split('\n').map((line) => line.trim());
  const at = lines.findIndex((line) => PICKED_HEADING.test(line));
  if (at === -1) return problems;
  const firstTier = lines.findIndex((line) => /^##(?!#)\s+Tier\s+\d+\b/.test(line));
  if (firstTier !== -1 && at > firstTier) {
    say(PICKED_BAND, `the ${PICKED_BAND} band sits below "${lines[firstTier]}", and a pick is the owner saying now — it goes above every tier or it says nothing the ranking does not already say`);
  }
  // Which cell the band's own header row gives `Picked`. The band carries one column the tiers do not, and it sits before `Why` so the last cell stays what every other rule reads.
  let column = null;
  for (let i = at + 1; i < lines.length; i += 1) {
    if (/^##(?!#)\s/.test(lines[i])) break;
    if (!lines[i].startsWith('|')) continue;
    const cells = lines[i].replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells[0] !== '#') continue;
    column = cells.indexOf('Picked');
    break;
  }
  const picked = rows.filter((row) => row.tier === 'picked');
  if (column === -1 || column === null) {
    if (picked.length) say(PICKED_BAND, `the ${PICKED_BAND} band carries no \`Picked\` column, so nothing says when the owner made any of these calls`);
    return problems;
  }
  for (const row of picked) {
    const cell = row.cells[column] ?? '';
    if (!PICKED_DATE.test(cell)) {
      say(row.ticket ?? row.position, `position ${row.position} is picked and its Picked cell says "${cell}" — a pick carries the day and the time it was made, the way every other date this tree writes does, because two picks on one day cannot otherwise be put in order`);
    }
  }
  return problems;
}

// The `Why` cell says what the app does wrong or cannot do yet, and what answers it, in the words of somebody using it — the ticket's own `## Why` in one sentence. It once argued the row's place in the ranking instead, and that column grew to nearly two thirds of the file: 153 cells averaging 352 characters, the longest 956.
//
// Two faults, and the ceiling alone would not have caught either. A cell written as "behind the row above, ahead of everything under it" is a claim about a position, so every reorder falsifies every cell it moved past and nobody rewrites a hundred of them. A cell carrying the day it was found, the day it was designed and what the build will do is the ticket's own writing, copied — the ticket is where it stays true.
//
// So the cell is held to three things: it is short, it names no neighbor, and it carries no date.
const WHY_LIMIT = 200;

// Every one of these is a claim about where a row sits rather than about what it is, so every one of them is a lie the next reorder tells.
const NEIGHBOR = [
  'row above', 'rows above', 'row below', 'rows below', 'row under', 'rows under', 'row over',
  'ahead of', 'directly behind', 'behind the row', 'behind both', 'behind every', 'behind all',
  'beside the row', 'everything above', 'everything below', 'everything under',
  'top of the band', 'top of the tier', 'top of the file', 'last of the band', 'last of the tier',
  'first of the band', 'first of the tier', 'the band above', 'the band below', 'the tier above', 'the tier below',
  'position ',
];

const WHY_DATE = new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{4}`, 'i');

// A link is read at the length a reader sees it, so a cell is not made long by the path behind a name.
function whySpelled(cell) {
  return cell.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
}

function whyProblems(row) {
  const found = [];
  if (row.why === undefined || row.why === '') return found;
  const spelled = whySpelled(row.why);
  if (spelled.length > WHY_LIMIT) {
    found.push(`the Why cell runs ${spelled.length} characters and the ceiling is ${WHY_LIMIT} — what a row is comes from its tier and one sentence, and the rest of it belongs in the ticket`);
  }
  const lower = spelled.toLowerCase();
  for (const phrase of NEIGHBOR) {
    if (lower.includes(phrase)) {
      found.push(`the Why cell says "${phrase.trim()}", which is a claim about where the row sits — the next reorder makes it untrue and nobody comes back to rewrite it`);
      break;
    }
  }
  const date = WHY_DATE.exec(spelled);
  if (date) found.push(`the Why cell carries the date "${date[0]}" — when it was found, designed or asked for is the ticket's own record, and copying it here is a second copy that goes stale`);
  return found;
}

// Every live ticket belongs to a subject order next door, one step of one track, and a subject with one ticket is a track with one step. Twice now the ranking has grown a run of rows carrying no track at all: nothing said which subject they were part of, so they were read as loose faults, ranked on their own words and walked up the tiers one pass at a time until they sat above the app's own. The track cell is what stops that, and a cell nobody checks is a cell nobody fills.
//
// Three questions, because a wrong answer to each one has already been written: an em dash where a track belongs, a track named that no heading in that file spells, and a track named that the ticket is not a step of — the last is the one a reader cannot see, since the cell links a real heading and lands them on a table their ticket is nowhere in.
//
// The `Track` column is found by name in the header row, so a running order written without one is outside this rule rather than failing every row of it.
const TRACK_HEADING = /^##(?!#)\s+(.+?)\s*$/;
const EMPTY_CELL = /^[—–-]?$/;

// What a `Track` cell links: the subject's own file under `docs/tracks/`, spelled from wherever the running order sits. The file name is the anchor, which is the key every subject order is held by.
const TRACK_LINK = /\(\s*[^)\s]*tracks\/([a-z0-9-]+)\.md\s*\)/g;

// A heading's own anchor, the way every Markdown renderer in this tree spells one: lowercased, punctuation dropped, spaces hyphenated.
function anchor(heading) {
  return heading.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

// A subject's own file opens with the subject, so its track is read at either heading level — the file's title is the track.
const PART_HEADING = /^#{1,2}(?!#)\s+(.+?)\s*$/;

// `{ anchor => Map(step number => ticket path) }` — every subject order, with the step each of its rows is and the ticket that row is about. A track with no rows is still a track, so it answers with an empty map rather than being absent.
//
// One file per subject under `docs/tracks/`, which is why this takes the whole folder: the anchor a heading gives is the key, and it is the key every link naming a track carries, so a link resolves to exactly one file.
//
// **Only the row's own first link is that step's ticket.** A step's prose names its neighbors on purpose — what it rides on, what it leaves behind, what shipped before it — and reading every link on the line as a step of the track is what let a `Track` cell say *Container documents step 12* about a ticket that is really Remote storage step 3: the ticket was merely mentioned in step 12's prose, so the rule that refuses a track a ticket is not a step of found it there and passed.
function trackSteps(tables) {
  const found = new Map();
  // A part file sits one folder below the running order, so its rows name a ticket a folder further out. The map is keyed on the path the running order writes, which is what every rule here compares against.
  for (const table of tables) {
    if (table.anchor === null) continue;
    if (!found.has(table.anchor)) found.set(table.anchor, new Map());
    const steps = found.get(table.anchor);
    for (const step of table.steps) {
      if (step.ticket) steps.set(step.step, step.ticket);
    }
  }
  return found;
}

/// Every step number a ticket holds of one track, in the order the track writes them. A ticket holding two or three answers to any of them.
function stepsHeld(steps, ticket) {
  return [...steps.entries()].filter(([, held]) => held === ticket).map(([step]) => step);
}

// The index above them says what each subject is and nothing else. A step table written back into it would be a subject order in two places, and the anchor a `Track` cell names would then have two files to be — so the next pass giving a subject its first track is refused here rather than finding out when the two disagree.
function indexTableProblems(indexText) {
  const problems = [];
  let held = null;
  for (const line of indexText.split('\n')) {
    const heading = TRACK_HEADING.exec(line.trim());
    if (heading) {
      held = heading[1];
      continue;
    }
    if (held === null || !/^\|\s*\d+\s*\|/.test(line.trim())) continue;
    problems.push({
      rule: 'track-index',
      subject: 'TRACKS.md',
      message: `TRACKS.md carries a step table under "${held}" — the index says what each subject is and one row per track, and the steps go in docs/tracks/${anchor(held)}.md`,
    });
    held = null;
  }
  return problems;
}

// The column index the header row gives `Track`, or null where the file carries no such column.
function trackColumn(text) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells[0] !== '#') continue;
    const at = cells.indexOf('Track');
    return at === -1 ? null : at;
  }
  return null;
}

// The `Devs with` column says which live rows can be built alongside this one, and it is read as a promise: somebody starts a second agent on what it names. It is never written by hand — every cell is 153 set comparisons and the whole column is 11,781 — so what is refused here is a cell that is not what the bundler would have written.
//
// Found by name in the header row, the way `Track` is, so a running order carrying no such column is outside this rule rather than failing every row of it.
//
// **The symmetry rule is not `Blocks`'s, and the difference is deliberate.** `Blocks` and `Blocked by` are held to each other because each is the other read backwards over the whole file. This column is bounded at three, so row 1's three partners will not each name row 1 back — they have three of their own — and holding the two cells to each other would refuse a column that is entirely correct. What is held instead is the **disjointness**: a named pair must share no file whichever row is read first, which is the claim the cell actually makes.
const DEVS_WITH_HEADING = 'Devs with';

/// The column index the header row gives `Devs with`, or null where the file carries no such column.
function devsWithColumn(text) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells[0] !== '#') continue;
    const at = cells.indexOf(DEVS_WITH_HEADING);
    return at === -1 ? null : at;
  }
  return null;
}

// `claims` is what each live ticket's footprint says its build writes, or null where the caller has none to give — the self-tests read the shape of a cell without needing a tree of tickets behind it.
function devsWithProblems(planText, live, claims = null) {
  const problems = [];
  const say = (subject, message) => problems.push({ rule: 'devs-with', subject, message });
  const column = devsWithColumn(planText);
  if (column === null) return problems;
  const rows = claims ? planRows(planText) : null;
  let tier = null;
  for (const line of planText.split('\n').map((l) => l.trim())) {
    if (/^##(?!#)\s+Tier\s+\d+\b/.test(line) || /^##(?!#)\s+Hold\b/.test(line) || PICKED_HEADING.test(line)) {
      tier = line;
      continue;
    }
    if (/^##(?!#)\s/.test(line)) {
      tier = null;
      continue;
    }
    if (tier === null || !line.startsWith('|')) continue;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length <= column || cells[0] === '#') continue;
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    const ticket = links(cells[1])[0];
    if (!ticket || !live.has(ticket)) continue;
    const cell = cells[column];
    if (!CELL_SHAPE.test(cell)) {
      say(ticket, `position ${cells[0]} says "${cell}", which is not a cell the bundler writes — the column is an em dash, or up to ${CELL_BOUND} links and a count in brackets. Run \`just bundle-devs-with\` rather than editing it`);
      continue;
    }
    for (const named of links(cell)) {
      if (named === ticket) {
        say(ticket, `position ${cells[0]} names itself, and a ticket has one writer`);
        continue;
      }
      if (!live.has(named)) {
        say(ticket, `position ${cells[0]} names ${named}, which is not live work — a retired or refused ticket is nothing to build alongside, so the column has not been rewritten since it left. Run \`just bundle-devs-with\``);
        continue;
      }
      if (!claims) continue;
      const shared = overlap(claims.get(ticket) ?? [], claims.get(named) ?? []);
      if (shared.length) {
        say(ticket, `position ${cells[0]} names ${named}, and both builds write ${shared.join(', ')} — the column says two agents may work these alongside each other, and one would land on the other's edit. Run \`just bundle-devs-with\``);
        continue;
      }
      if (waitsOnEachOther(rows, ticket, named)) say(ticket, `position ${cells[0]} names ${named}, and one of the two waits on the other — a wait is not a parallel run, whatever their files say. Run \`just bundle-devs-with\``);
    }
    if (!claims) continue;
    // Silent where the row has already been named: the pair that collides is the reason a reader needs, and saying the whole cell disagrees on top of it buries it.
    if (problems.some((p) => p.subject === ticket)) continue;
    // The whole cell, not only what it names: a hand edit that drops a partner or reorders two reads as a correct cell by every rule above.
    const want = cellFor(partnersFor(rows, claims, ticket));
    if (cell !== want) say(ticket, `position ${cells[0]} says "${cell}" and the footprints say "${want}" — the column is generated, so a cell that disagrees is a hand edit or a footprint that moved under it. Run \`just bundle-devs-with\``);
  }
  return problems;
}

function trackProblems(planText, tables, live) {
  const problems = [];
  const say = (subject, message) => problems.push({ rule: 'track', subject, message });
  const column = trackColumn(planText);
  if (column === null) return problems;
  const steps = trackSteps(tables);
  let tier = null;
  const lines = planText.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (/^##(?!#)\s+Tier\s+\d+\b/.test(line) || /^##(?!#)\s+Hold\b/.test(line) || PICKED_HEADING.test(line)) {
      tier = line;
      continue;
    }
    if (/^##(?!#)\s/.test(line)) {
      tier = null;
      continue;
    }
    if (tier === null || !line.startsWith('|')) continue;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length <= column || cells[0] === '#') continue;
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    const ticket = links(cells[1])[0];
    if (!ticket || !live.has(ticket)) continue;
    const cell = cells[column];
    if (EMPTY_CELL.test(cell)) {
      say(ticket, `position ${cells[0]} names no track for ${ticket}, so nothing says which subject it is part of — one ticket is a track with one step`);
      continue;
    }
    const named = [...cell.matchAll(TRACK_LINK)].map((m) => m[1]);
    if (!named.length) {
      say(ticket, `position ${cells[0]} says "${cell}" and links no subject order, so a reader cannot open the track it names`);
      continue;
    }
    for (const slug of named) {
      if (!steps.has(slug)) {
        say(ticket, `position ${cells[0]} names the ${slug} track, and no subject order spells it`);
        continue;
      }
      const held = stepsHeld(steps.get(slug), ticket);
      if (!held.length) {
        say(ticket, `position ${cells[0]} names the ${slug} track and ${ticket} is not a step of it, so the link lands the reader on a table their own ticket is nowhere in`);
        continue;
      }
      // The step number is written by hand today and four of them named a step their track no longer gave. A ticket holding two or three steps answers to any of them.
      const said = trackOf(cell)?.step ?? null;
      if (said === null) {
        say(ticket, `position ${cells[0]} says "${cell}" and names no step, so nothing says where in the ${slug} track the row sits — write \`step ${held[0]}\``);
      } else if (!held.includes(said)) {
        const spelled = held.length === 1 ? `step ${held[0]}` : `steps ${held.join(', ')}`;
        say(ticket, `position ${cells[0]} says step ${said} of the ${slug} track, and that track gives ${ticket} ${spelled}`);
      }
    }
  }
  return problems;
}

const PERFORMANCE_MARKER = /^> \*\*Performance finding\.\*\*\s*$/m;
const PERFORMANCE_BOOTSTRAP = 'done/workflow/nothing-files-a-performance-finding.md';

// The marker records why a ticket exists, so it decides both destinations without guessing from a file name or a sentence about speed.
function performanceProblems(planText, tables, ticketTexts) {
  const problems = [];
  const say = (rule, subject, message) => problems.push({ rule, subject, message });
  const performance = new Set((trackSteps(tables).get('performance') ?? new Map()).values());
  for (const row of planRows(planText)) {
    if (row.ticket === null) continue;
    const marked = PERFORMANCE_MARKER.test(ticketTexts.get(row.ticket) ?? '');
    const inPerformance = performance.has(row.ticket);
    if (marked && row.tier !== 0) say('performance-tier', row.ticket, `position ${row.position} carries the performance-finding marker and sits in tier ${row.tier}; marked findings belong in tier 0`);
    if (marked && !inPerformance) say('performance-track', row.ticket, `position ${row.position} carries the performance-finding marker and is not a step of the Performance track`);
    if (!marked && inPerformance && row.ticket !== PERFORMANCE_BOOTSTRAP) say('performance-marker', row.ticket, `position ${row.position} is a Performance track step and carries no \`> **Performance finding.**\` line; only ${PERFORMANCE_BOOTSTRAP} is the unmarked bootstrap`);
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

// The on-hold list is derived from the folder, so a moved ticket cannot disappear from the one place that records how it returns.
function heldProblems(text, held) {
  const problems = [];
  const say = (subject, message) => problems.push({ rule: 'on-hold', subject, message });
  const opening = text.split('\n').map((line) => line.trim()).find((line) => line !== '');
  if (opening !== '# What is on hold, and why') say('title', 'the on-hold list does not open with `# What is on hold, and why`');
  const owned = new Map();
  for (const [at, line] of text.split('\n').entries()) {
    if (!line.trim().startsWith('|')) continue;
    const target = links(rowCells(line)[0] ?? '')[0];
    if (!target || target.startsWith('../')) continue;
    const ticket = `on-hold/${target}`;
    if (!owned.has(ticket)) owned.set(ticket, []);
    owned.get(ticket).push(at + 1);
  }
  for (const [ticket, lines] of owned) {
    if (!held.has(ticket)) say(ticket, `lines ${lines.join(', ')} name ${ticket}, which is not in the on-hold folder`);
    if (lines.length > 1) say(ticket, `${ticket} has ${lines.length} rows, at lines ${lines.join(', ')}`);
  }
  for (const ticket of held) {
    if (!owned.has(ticket)) say(ticket, `${ticket} has no row, so its stage and return folder are missing`);
  }
  const said = count(text, 'On hold');
  if (said !== held.size) say('count', `the foot says On hold: ${said ?? 'nothing'}, and the folder holds ${held.size}`);
  return problems;
}

// The index next door is what every ticket skill says to read before writing a word. A ticket with two rows in it describes itself twice, and the older one describes the work as it was before it was designed; a ticket with none is invisible to the one pass that stops the tree planning the same thing twice. Three carried two.
//
// Only the first cell counts. A ticket is linked from other rows on purpose — what it replaces, what it rides on — so reading every link would fail on the cross-references the tree is built out of. The row a ticket owns is the one whose first cell opens the line.
//
// The shipped and refused half is held the same way: that half is what a reader opens to find out whether this tree already answered them, so a ticket there with no row is re-planned exactly as a live one is. One shipped ticket owned none.
//
// A row is read against the file it is written in as well. The index was one file of a megabyte whose live rows were 4.7% of it, so it is four now — the live one, and one in each of the three folders the archive describes — and which file a row sits in is what says whether the ticket is waiting, shipped, held or refused. A shipped ticket among the live rows reads exactly like work that is waiting; seven did, each in the present tense with no shipped note, so a reader counting what was left counted seven things that were not.
//
// A row's link is spelled from its own file, so `done/README.md` names its tickets `c/gone.md` and a live ticket wrongly written there names one `../refactor/a/one.md`. Both resolve to the path off the tree's top before anything is asked about them, which is what lets one rule read all four files.
//
// The live half is read by kind as well. Each of the three live headings names one, and a live row's first path segment is the kind it belongs under, so somebody opening the refactors heading to see what refactoring is queued meets every refactor rather than half of them: twelve sat in the subject tables under `## Live plans — features` and twelve in a flat table under the refactors one, two tickets out of the same folder filed apart. A subject heading is below a kind heading and leaves that answer in force.
const INDEX_FILES = { live: 'README.md', done: 'done/README.md', canceled: 'canceled/README.md', 'on-hold': 'on-hold/README.md' };
const ARCHIVE_WORDS = { done: 'has already shipped', canceled: 'was turned down', 'on-hold': 'is on hold' };
const LIVE_KIND_HEADINGS = { features: '## Live plans — features', refactor: '## Live plans — refactors', fixes: '## Live plans — fixes' };

// The path off the tree's top, from a link spelled inside one of the four index files.
function resolve(folder, target) {
  const parts = folder ? folder.split('/') : [];
  for (const step of target.split('/')) {
    if (step === '..') parts.pop();
    else if (step !== '.') parts.push(step);
  }
  return parts.join('/');
}

function indexProblems(files, live, archived = new Set()) {
  const problems = [];
  const say = (subject, message) => problems.push({ rule: 'index', subject, message });
  const owned = new Map();
  for (const [half, file, text] of files) {
    const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    const lines = text.split('\n');
    let heading = null;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (line.startsWith('## ')) {
        heading = line;
        continue;
      }
      if (!line.startsWith('|')) continue;
      const target = links(rowCells(line)[0] ?? '')[0];
      if (!target) continue;
      const path = resolve(folder, target);
      if (!(live.has(path) || archived.has(path))) continue;
      if (!owned.has(path)) owned.set(path, []);
      owned.get(path).push(`${file} line ${i + 1}`);
      const parts = path.split('/');
      const belongs = live.has(path) ? 'live' : parts[0];
      const table = parts.length > 2 ? `, in the ${parts[1]}/ table` : '';
      if (belongs !== half && belongs === 'live') {
        say(path, `${file} line ${i + 1}: ${path} is still to build, so a reader counting what is left never meets it — its row belongs in ${INDEX_FILES.live}${table}`);
      } else if (belongs !== half) {
        const wrong = half === 'live' ? 'so it reads as work that is waiting' : 'and the file it is written in calls it something else';
        say(path, `${file} line ${i + 1}: ${path} ${ARCHIVE_WORDS[belongs]}, ${wrong} — its row belongs in ${INDEX_FILES[belongs]}`);
      } else if (half === 'live' && Object.values(LIVE_KIND_HEADINGS).includes(heading) && LIVE_KIND_HEADINGS[parts[0]] !== heading) {
        say(path, `${file} line ${i + 1}: ${path} sits under ${heading} and its path names ${parts[0]}, so somebody opening ${LIVE_KIND_HEADINGS[parts[0]]} to see what is queued there never meets it — its row belongs under ${LIVE_KIND_HEADINGS[parts[0]]}${table}`);
      }
    }
  }
  for (const ticket of [...owned.keys()].sort()) {
    const at = owned.get(ticket);
    if (at.length > 1) {
      say(ticket, `${ticket} opens ${at.length} rows, at ${at.join(', ')}: whoever reads the older one is planning against the ticket as it was before it was designed`);
    }
  }
  for (const ticket of [...live].sort()) {
    if (!owned.has(ticket)) {
      say(ticket, `${ticket} opens no row, so it is invisible to the one pass that stops the tree planning the same thing twice`);
    }
  }
  for (const ticket of [...archived].sort()) {
    if (!owned.has(ticket)) {
      say(ticket, `${ticket} ${ARCHIVE_WORDS[ticket.split('/')[0]]} and its row in ${INDEX_FILES[ticket.split('/')[0]]} is missing, so a reader asking whether this tree already answered them never finds it`);
    }
  }
  return problems;
}

// A plan is usually one file, so its name is the file's. Written as a folder of parts it is named by the folder, because every one of those opens a `README.md` and a name of `README` would take the name from the next ticket shaped the same way rather than from the next ticket about the same fault.
function planName(path) {
  const parts = path.split('/');
  const file = parts[parts.length - 1];
  return file === 'README.md' ? parts[parts.length - 2] : file.slice(0, -3);
}

// A ticket is named after the fault it fixes, so a fault that comes back is named the same — and retirement moves the live plan into a folder already holding that name. On this checkout two spellings of one name are one file, so that move overwrites the shipped record of the first time instead of refusing, and it is found hours after every link to the ticket has been made. The name is the only part that carries across the move: a ticket keeps its subject word between the live folders and can take a new one when it retires, so the path never matches and the name always does.
function nameProblems(live, archived) {
  const problems = [];
  // Each half's own ranking file is a record rather than a plan, so it holds no name — and one on each side would otherwise read as a collision with itself.
  const plans = (set) => [...set].filter((path) => !path.endsWith('/PLAN.md')).sort();
  const taken = new Map();
  for (const path of plans(archived)) {
    const key = planName(path).toLowerCase();
    if (!taken.has(key)) taken.set(key, path);
  }
  for (const path of plans(live)) {
    const held = taken.get(planName(path).toLowerCase());
    if (!held) continue;
    problems.push({
      rule: 'name',
      subject: path,
      message: `${path} takes a name ${held} already holds, so retiring it writes over the record of the first time rather than landing beside it — rename the live one after what is different about this time, since the archived file is the record of the first`,
    });
  }
  return problems;
}

// Every refusal is proved on made-up files before the real one is opened. Each case is a fault that has happened.
const TABLE = '| # | Ticket | Status | Blocks | Blocked by | Why |\n|---|---|---|---|---|---|\n';

function tree(live, retired = 0, turnedDown = 0, held = 0) {
  return { live: new Set(live), retired, turnedDown, held };
}

// `plan(t, [3, row, row], ...)` — one entry per tier heading, each with its rows. An entry starting `###` is a sub-band heading, and the rows after it get their own table. It opens with the title every running order opens with, and the foot is written from the tree, so only a case testing one of those has to disagree with it. The picked band carries one column the tiers do not, so its rows are written under a header of their own.
const PICKED_TABLE = '| # | Ticket | Status | Blocks | Blocked by | Picked | Why |\n|---|---|---|---|---|---|---|\n';

function plan(t, ...tiers) {
  const bands = tiers.map(([n, ...items]) => {
    let head = TABLE;
    let out = `## Tier ${n} — a band\n\n`;
    if (n === 'hold') out = '## Hold — parked by the owner\n\n';
    if (n === 'picked') {
      out = `## ${PICKED_BAND}\n\n`;
      head = PICKED_TABLE;
    }
    let open = false;
    for (const item of items) {
      if (item.startsWith('###')) {
        out += `${item}\n\n`;
        open = false;
        continue;
      }
      if (!open) {
        out += head;
        open = true;
      }
      out += `${item}\n`;
    }
    if (!open) out += head;
    return out;
  });
  return `${TITLE}\n\n${bands.join('\n')}\n## Off the list\n\n**Last ranked 9 August 2026, 4:07pm.** Live: ${t.live.size}. On hold: ${t.held}. Retired: ${t.retired}. Turned down: ${t.turnedDown}.\n`;
}

const PAIR = tree(['refactor/a/one.md', 'refactor/b/two.md']);
const ONE = '| 1 | [one](refactor/a/one.md) | Ready | — | — | first |';
const TWO = '| 2 | [two](refactor/b/two.md) | Ready | — | — | second |';
const FIX = tree(['fixes/a/f.md']);
const FIX_ROW = '| 1 | [f](fixes/a/f.md) | Ready | — | — | wrong today |';
const FEATURE = tree(['features/b/g.md']);
const FEATURE_ROW = '| 1 | [g](features/b/g.md) | Ready | — | — | not built yet |';

const MIXED = tree(['fixes/a/f.md', 'refactor/b/two.md']);

// The owner's own pick, written into the band above tier 1 with the day and the time they made it.
const PICKED_FIX = '| 1 | [f](fixes/a/f.md) | Ready | — | — | 18 August 2026, 9:11pm | wrong today |';
const PICKED_FEATURE = '| 1 | [g](features/b/g.md) | Ready | — | — | 18 August 2026, 9:11pm | not built yet |';

const FREE_HEAD = `### ${SUB_BANDS[0].name}`;
const WAIT_HEAD = `### ${SUB_BANDS[1].name}`;

// Two rows on either side of the one question a sub-band asks: `two` waits on `one`, `three` waits on nobody.
const THREE = '| 3 | [three](refactor/c/three.md) | Ready | — | — | third |';
const SIZES = tree(['refactor/a/one.md', 'refactor/b/two.md', 'refactor/c/three.md']);
const ONE_BLOCKS = '| 1 | [one](refactor/a/one.md) | Ready | [two](refactor/b/two.md) | — | first |';
const TWO_WAITS = '| 2 | [two](refactor/b/two.md) | Ready | — | [one](refactor/a/one.md) | second |';
const QUAD = tree(['refactor/a/one.md', 'refactor/b/two.md', 'refactor/c/three.md', 'refactor/d/four.md']);
const FOUR = '| 4 | [four](refactor/d/four.md) | Ready | — | — | fourth |';

// A row behind another: it belongs under the waiting heading whatever either of them costs.
const BEHIND = tree(['refactor/a/big.md', 'refactor/b/small.md']);
const BIG_ROW = '| 1 | [big](refactor/a/big.md) | Ready | [small](refactor/b/small.md) | — | first |';
const SMALL_BEHIND = '| 2 | [small](refactor/b/small.md) | Ready | — | [big](refactor/a/big.md) | second |';

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
  ['an on-hold count that disagrees with the tree is refused',
    plan(PAIR, [1, ONE], [3, TWO]).replace('On hold: 0', 'On hold: 1'), PAIR, ['count On hold']],
  ['a row above what it waits on is refused, sub-band heading and all',
    plan(PAIR, [3, WAIT_HEAD, '| 1 | [one](refactor/a/one.md) | Ready | — | [two](refactor/b/two.md) | first |', FREE_HEAD, '| 2 | [two](refactor/b/two.md) | Ready | [one](refactor/a/one.md) | — | second |']),
    PAIR, ['depends refactor/b/two.md']],
  ['the same pair the other way round, under a sub-band heading, passes — so a row under a `###` line is still read',
    plan(PAIR, [3, FREE_HEAD, '| 1 | [two](refactor/b/two.md) | Ready | [one](refactor/a/one.md) | — | first |', WAIT_HEAD, '| 2 | [one](refactor/a/one.md) | Ready | — | [two](refactor/b/two.md) | second |']),
    PAIR, []],
  ['a Blocks cell naming a row that does not wait on it is refused',
    plan(PAIR, [1, '| 1 | [one](refactor/a/one.md) | Ready | [two](refactor/b/two.md) | — | first |'], [3, TWO]),
    PAIR, ['blocks refactor/b/two.md']],
  ['a wait whose blocker does not name it back in Blocks is refused',
    plan(PAIR, [1, '| 1 | [two](refactor/b/two.md) | Ready | — | — | first |'], [3, '| 2 | [one](refactor/a/one.md) | Ready | — | [two](refactor/b/two.md) | second |']),
    PAIR, ['blocks refactor/a/one.md']],
  ['a band holding most of the file, in three sizes and with no sub-band heading, is refused',
    plan(SIZES, [3, ONE_BLOCKS, TWO_WAITS, THREE]), SIZES, ['sub-band 3']],
  ['the same rows, each under the heading its own Blocked by cell names, pass',
    plan(SIZES, [3, FREE_HEAD, ONE_BLOCKS, THREE, WAIT_HEAD, TWO_WAITS]), SIZES, []],
  ['a waiting row left under the startable heading is refused, and named',
    plan(SIZES, [3, FREE_HEAD, ONE_BLOCKS, TWO_WAITS, THREE]), SIZES, ['sub-band refactor/b/two.md']],
  ['a startable row left under the waiting heading is refused, and told nothing is in front of it',
    plan(SIZES, [3, FREE_HEAD, ONE_BLOCKS, WAIT_HEAD, TWO_WAITS, THREE]), SIZES, ['sub-band refactor/c/three.md'],
    'nothing live stands in front of it'],
  ['a sub-band heading with a row left above it is refused',
    plan(SIZES, [3, ONE_BLOCKS, THREE, WAIT_HEAD, TWO_WAITS]), SIZES, ['sub-band 3']],
  ['a band under half the file needs no sub-band heading, whichever side its rows fall',
    plan(QUAD, [1, ONE, TWO], [3, THREE, FOUR]), QUAD, []],
  ['a band holding most of the file, every row startable, needs none either',
    plan(PAIR, [3, ONE, TWO]), PAIR, []],
  ['a row behind another belongs under the waiting heading, whatever either of them costs',
    plan(BEHIND, [3, FREE_HEAD, BIG_ROW, WAIT_HEAD, SMALL_BEHIND]), BEHIND, []],
  ['the same row under the startable heading is refused, and the refusal names what it waits on',
    plan(BEHIND, [3, FREE_HEAD, BIG_ROW, SMALL_BEHIND]), BEHIND, ['sub-band refactor/b/small.md'],
    'it waits on refactor/a/big.md'],
  ['a wait on a ticket that has shipped is refused',
    plan(PAIR, [1, '| 1 | [one](refactor/a/one.md) | Ready | — | [gone](done/app/gone.md) | first |'], [3, TWO]),
    PAIR, ['depends done/app/gone.md']],
  ['a link in a Why cell is not read as a row',
    plan(PAIR, [1, '| 1 | [one](refactor/a/one.md) | Ready | — | — | it shares a seam with [two](refactor/b/two.md) |']),
    PAIR, ['ticket refactor/b/two.md']],
  ['words after the link still name the ticket',
    plan(PAIR, [1, '| 1 | [one](refactor/a/one.md) **phases 1–4** | Ready | — | — | first |'], [3, TWO]), PAIR, []],
  ['a row outside any tier heading is not a row',
    `${TITLE}\n\n## Off the list\n\n${TABLE}${ONE}\n\n**Last ranked 9 August 2026, 4:07pm.** Live: 2. On hold: 0. Retired: 0. Turned down: 0.\n`,
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
  ['the old Hold band is refused because parked work has its own folder',
    plan(FIX, ['hold', FIX_ROW]), FIX, ['hold band fixes/a/f.md']],
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
  ['a Why cell over the ceiling is refused',
    plan(PAIR, [1, `| 1 | [one](refactor/a/one.md) | Ready | — | — | ${'a word about the app '.repeat(12)}|`], [3, TWO]),
    PAIR, ['why refactor/a/one.md']],
  ['a Why cell naming the row above it is refused',
    plan(PAIR, [1, ONE], [3, '| 2 | [two](refactor/b/two.md) | Ready | — | — | behind the row above on cost |']),
    PAIR, ['why refactor/b/two.md']],
  ['a Why cell placing itself in the band is refused',
    plan(PAIR, [1, '| 1 | [one](refactor/a/one.md) | Ready | — | — | last of the band and cheapest in it |'], [3, TWO]),
    PAIR, ['why refactor/a/one.md']],
  ['a Why cell carrying the day it was found is refused',
    plan(PAIR, [1, '| 1 | [one](refactor/a/one.md) | Ready | — | — | the padlock opens on a document with nothing in it. Found 24 August 2026, 1:43pm |'], [3, TWO]),
    PAIR, ['why refactor/a/one.md']],
  ['a picked row above tier 1 passes, positions running straight through the band',
    plan(MIXED, ['picked', PICKED_FIX], [1, '| 2 | [two](refactor/b/two.md) | Ready | — | — | second |']),
    MIXED, []],
  ['a picked features ticket is exempt from the tier definitions, the way a held one is outside them',
    plan(FEATURE, ['picked', PICKED_FEATURE]), FEATURE, []],
  ['a picked band written below tier 1 is refused, because a pick that does not go first says nothing',
    plan(MIXED, [1, '| 1 | [two](refactor/b/two.md) | Ready | — | — | first |'], ['picked', PICKED_FIX.replace('| 1 |', '| 2 |')]),
    MIXED, ['picked Picked by the owner']],
  ['a pick carrying a day and no time is refused, and the cell is quoted back',
    plan(FIX, ['picked', PICKED_FIX.replace(', 9:11pm', '')]), FIX, ['picked fixes/a/f.md']],
  ['a pick with nothing at all in its cell is refused', plan(FIX, ['picked', PICKED_FIX.replace('18 August 2026, 9:11pm', '—')]), FIX, ['picked fixes/a/f.md']],
  ['a picked band with no Picked column at all is refused, and the band is named',
    plan(FIX, ['picked', PICKED_FIX]).replace(' | Picked | Why |', ' | Why |'), FIX, ['picked Picked by the owner']],
  ['a picked row naming a ticket that is not live is refused by the rule that refuses any such row',
    plan(FIX, ['picked', PICKED_FIX.replace('fixes/a/f.md', 'fixes/a/gone.md')]), FIX, ['ticket fixes/a/f.md', 'ticket fixes/a/gone.md']],
  ['a link is read at the length a reader sees it, so the path behind a name does not spend the ceiling',
    plan(PAIR, [1, `| 1 | [one](refactor/a/one.md) | Ready | — | — | it shares a seam with [the other one](refactor/${'and-another-long-word-'.repeat(12)}two.md) |`], [3, TWO]),
    PAIR, []],
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

const HELD_SET = new Set(['on-hold/plugins/paused.md']);
const HELD_FILE = '# What is on hold, and why\n\n| Ticket | Stage | Track | Return to | Put on hold | Why held |\n|---|---|---|---|---|---|\n| [paused](plugins/paused.md) | Ready | track | `features/plugins/` | — | later |\n\n**On hold: 1.**\n';
const HELD_CASES = [
  ['an on-hold row matching the folder passes', HELD_FILE, HELD_SET, []],
  ['a held ticket with no row is refused', HELD_FILE.replace('| [paused](plugins/paused.md) | Ready | track | `features/plugins/` | — | later |\n', ''), HELD_SET, ['on-hold on-hold/plugins/paused.md']],
  ['a row naming no held ticket is refused', HELD_FILE.replaceAll('paused', 'gone'), HELD_SET, ['on-hold on-hold/plugins/gone.md', 'on-hold on-hold/plugins/paused.md']],
];

// `index(row, row)` — the index next door opens with its own title and one table of tickets, so the first row lands on line 5 and every row after it one line lower.
//
// An entry opening `## ` or `### ` is a heading instead, and starts a fresh table under it. A call passing rows alone writes what it always did, byte for byte, which is what keeps the line numbers the cases above assert.
const INDEX_TABLE = '| ticket | what it is |\n| --- | --- |\n';

function index(...rows) {
  return indexFile('# The ticket README', rows);
}

// The same shape under another title: the three archive indexes open with their own, and only the rows and the `## ` headings are read.
function archive(title, ...rows) {
  return indexFile(title, rows);
}

function indexFile(title, rows) {
  let out = `${title}\n\n`;
  let open = false;
  for (const row of rows) {
    if (row.startsWith('## ') || row.startsWith('### ')) {
      out += `${open ? '\n' : ''}${row}\n\n`;
      open = false;
      continue;
    }
    if (!open) {
      out += INDEX_TABLE;
      open = true;
    }
    out += `${row}\n`;
  }
  return open ? out : `${out}${INDEX_TABLE}`;
}

const INDEX_ONE = '| [one](refactor/a/one.md) | what it is |';
const INDEX_ONE_AGAIN = '| [one](refactor/a/one.md) | what it was before it was designed |';
const INDEX_TWO = '| [two](refactor/b/two.md) | what it is |';
// The row that must not count as an owned row: `two` is named inside `one`'s prose as the work it rides on.
const INDEX_CROSS = '| [one](refactor/a/one.md) | rides on [two](refactor/b/two.md) |';
const INDEX_SHIPPED = '| [gone](done/c/gone.md) | what shipped |';
// The shipped ticket named inside a live row's prose: a cross-reference, so it owns nothing.
const INDEX_SHIPPED_CROSS = '| [one](refactor/a/one.md) | finishes what [gone](done/c/gone.md) left |';
const INDEX_REFUSED = '| [dropped](canceled/c/dropped.md) | why not |';
// The same tickets as the file that now owns them spells them: an archive index names its own folder's tickets from inside it, and reaches a live one back out through `../`.
const SHIPPED_OWN = '| [gone](c/gone.md) | what shipped |';
const SHIPPED_OWN_AGAIN = '| [gone](c/gone.md) | what it was before it shipped |';
const REFUSED_OWN = '| [dropped](c/dropped.md) | why not |';
const LIVE_IN_ARCHIVE = '| [one](../refactor/a/one.md) | what it is |';
const SHIPPED_INDEX_TITLE = '# What shipped, one line each';
const REFUSED_INDEX_TITLE = '# What was turned down, one line each';
const HELD_INDEX_TITLE = '# What is on hold, one line each';

const INDEX_LIVE = new Set(['refactor/a/one.md', 'refactor/b/two.md']);
const INDEX_ARCHIVED = new Set(['done/c/gone.md', 'canceled/c/dropped.md']);

// The kind headings the live index is navigated by, and the one that names no kind on purpose.
const LIVE_FEATURES = '## Live plans — features';
const LIVE_REFACTORS = '## Live plans — refactors';
const LIVE_FIXES = '## Live plans — fixes';
const SECOND_LOOK = '## Needs a second look';

const INDEX_CASES = [
  ['an index with one row per live ticket passes', index(INDEX_ONE, INDEX_TWO), INDEX_LIVE, [], ''],
  ['a ticket opening two rows is refused, and both its file and its lines are named',
    index(INDEX_ONE, INDEX_TWO, INDEX_ONE_AGAIN), INDEX_LIVE, ['index refactor/a/one.md'], 'README.md line 5, README.md line 7'],
  ['a ticket opening no row is refused, and named',
    index(INDEX_ONE), INDEX_LIVE, ['index refactor/b/two.md'], 'opens no row'],
  ['a link later in a row is a cross-reference, not an owned row',
    index(INDEX_CROSS, INDEX_TWO), INDEX_LIVE, [], ''],
  ['a row for a ticket that shipped is never held to the live set',
    index(INDEX_ONE, INDEX_TWO, INDEX_SHIPPED), INDEX_LIVE, [], ''],
];

// The shipped and refused half, which is the half a reader opens to find out whether the tree already answered them. It is written in the index inside the folder holding it, so every case here is a list of files rather than one, shaped `[what it asserts, the files, refusals, a phrase the message owes]`.
const ARCHIVED_INDEX_CASES = [
  ['one row per archived ticket, each in the index of the folder holding it, passes',
    [['live', 'README.md', index(INDEX_ONE, INDEX_TWO)],
      ['done', 'done/README.md', archive(SHIPPED_INDEX_TITLE, SHIPPED_OWN)],
      ['canceled', 'canceled/README.md', archive(REFUSED_INDEX_TITLE, REFUSED_OWN)]],
    [], ''],
  ['a shipped ticket opening no row is refused, and named',
    [['live', 'README.md', index(INDEX_ONE, INDEX_TWO)],
      ['done', 'done/README.md', archive(SHIPPED_INDEX_TITLE)],
      ['canceled', 'canceled/README.md', archive(REFUSED_INDEX_TITLE, REFUSED_OWN)]],
    ['index done/c/gone.md'], 'is missing, so a reader asking whether this tree already answered them'],
  ['a refused ticket opening no row is refused, and named',
    [['live', 'README.md', index(INDEX_ONE, INDEX_TWO)],
      ['done', 'done/README.md', archive(SHIPPED_INDEX_TITLE, SHIPPED_OWN)],
      ['canceled', 'canceled/README.md', archive(REFUSED_INDEX_TITLE)]],
    ['index canceled/c/dropped.md'], 'is missing, so a reader asking whether this tree already answered them'],
  ['a shipped ticket opening two rows is refused, and both files and lines are named',
    [['live', 'README.md', index(INDEX_ONE, INDEX_TWO)],
      ['done', 'done/README.md', archive(SHIPPED_INDEX_TITLE, SHIPPED_OWN, SHIPPED_OWN_AGAIN)],
      ['canceled', 'canceled/README.md', archive(REFUSED_INDEX_TITLE, REFUSED_OWN)]],
    ['index done/c/gone.md'], 'done/README.md line 5, done/README.md line 6'],
  ['a link to a shipped ticket later in a live row is a cross-reference, not an owned row',
    [['live', 'README.md', index(INDEX_SHIPPED_CROSS, INDEX_TWO)],
      ['done', 'done/README.md', archive(SHIPPED_INDEX_TITLE)],
      ['canceled', 'canceled/README.md', archive(REFUSED_INDEX_TITLE, REFUSED_OWN)]],
    ['index done/c/gone.md'], 'is missing, so a reader asking whether this tree already answered them'],
];

// Which file a row is written in, which is the whole of how the index answers what a ticket's status is. Every case carries all four tickets, so what it is asserting is the file rule and never a missing row.
const FILE_INDEX_CASES = [
  ['a shipped row written in the live index is refused, and the file it belongs in is named',
    [['live', 'README.md', index(LIVE_REFACTORS, INDEX_ONE, INDEX_TWO, INDEX_SHIPPED)],
      ['done', 'done/README.md', archive(SHIPPED_INDEX_TITLE)],
      ['canceled', 'canceled/README.md', archive(REFUSED_INDEX_TITLE, REFUSED_OWN)]],
    ['index done/c/gone.md'], 'belongs in done/README.md'],
  ['a refused row written in the live index is refused, and the file it belongs in is named',
    [['live', 'README.md', index(LIVE_REFACTORS, INDEX_ONE, INDEX_TWO, INDEX_REFUSED)],
      ['done', 'done/README.md', archive(SHIPPED_INDEX_TITLE, SHIPPED_OWN)],
      ['canceled', 'canceled/README.md', archive(REFUSED_INDEX_TITLE)]],
    ['index canceled/c/dropped.md'], 'belongs in canceled/README.md'],
  ['a live row written in an archive index is refused, and its subject table is named',
    [['live', 'README.md', index(LIVE_REFACTORS, INDEX_TWO)],
      ['done', 'done/README.md', archive(SHIPPED_INDEX_TITLE, SHIPPED_OWN, LIVE_IN_ARCHIVE)],
      ['canceled', 'canceled/README.md', archive(REFUSED_INDEX_TITLE, REFUSED_OWN)]],
    ['index refactor/a/one.md'], 'belongs in README.md, in the a/ table'],
  ['a shipped row written in the refused index is refused, and the file it belongs in is named',
    [['live', 'README.md', index(LIVE_REFACTORS, INDEX_ONE, INDEX_TWO)],
      ['done', 'done/README.md', archive(SHIPPED_INDEX_TITLE)],
      ['canceled', 'canceled/README.md', archive(REFUSED_INDEX_TITLE, REFUSED_OWN, '| [gone](../done/c/gone.md) | what shipped |')]],
    ['index done/c/gone.md'], 'belongs in done/README.md'],
  ['a heading in the live index no longer exempts anything: the row that used to be allowed to sit under `## Needs a second look` is refused by its file',
    [['live', 'README.md', index(SECOND_LOOK, INDEX_SHIPPED, LIVE_REFACTORS, INDEX_ONE, INDEX_TWO)],
      ['done', 'done/README.md', archive(SHIPPED_INDEX_TITLE)],
      ['canceled', 'canceled/README.md', archive(REFUSED_INDEX_TITLE, REFUSED_OWN)]],
    ['index done/c/gone.md'], 'belongs in done/README.md'],
  ['a live row written in the held index is refused and named, so a ticket cannot be parked by moving its row',
    [['live', 'README.md', index(LIVE_REFACTORS, INDEX_TWO)],
      ['done', 'done/README.md', archive(SHIPPED_INDEX_TITLE, SHIPPED_OWN)],
      ['on-hold', 'on-hold/README.md', archive(HELD_INDEX_TITLE, LIVE_IN_ARCHIVE)],
      ['canceled', 'canceled/README.md', archive(REFUSED_INDEX_TITLE, REFUSED_OWN)]],
    ['index refactor/a/one.md'], 'on-hold/README.md line 5: refactor/a/one.md is still to build'],
  ['a live ticket named inside an archive row of prose is a cross-reference, not a row written in the wrong file',
    [['live', 'README.md', index(LIVE_REFACTORS, INDEX_ONE, INDEX_TWO)],
      ['done', 'done/README.md', archive(SHIPPED_INDEX_TITLE, '| [gone](c/gone.md) | finished what [one](../refactor/a/one.md) starts |')],
      ['canceled', 'canceled/README.md', archive(REFUSED_INDEX_TITLE, REFUSED_OWN)]],
    [], ''],
];

// The kind heading a live row sits under, which is what somebody asking what work of one kind is queued opens. Every case carries all three live tickets, so what it is asserting is the kind rule and never a missing row.
const INDEX_FEATURE = '| [f](features/a/f.md) | not built yet |';
const INDEX_FIX = '| [x](fixes/a/x.md) | wrong today |';
const KIND_SUBJECT = '### The subject the folder names — `a/`';
const KIND_LIVE = new Set(['features/a/f.md', 'refactor/a/one.md', 'fixes/a/x.md']);

const KIND_INDEX_CASES = [
  ['each live row under the kind heading its own path names passes',
    index(LIVE_FEATURES, INDEX_FEATURE, LIVE_REFACTORS, INDEX_ONE, LIVE_FIXES, INDEX_FIX), [], ''],
  ['a refactor row under the features heading is refused, and both headings are named',
    index(LIVE_FEATURES, INDEX_FEATURE, INDEX_ONE, LIVE_FIXES, INDEX_FIX),
    ['index refactor/a/one.md'], 'sits under ## Live plans — features and its path names refactor, so somebody opening ## Live plans — refactors to see what is queued there never meets it — its row belongs under ## Live plans — refactors, in the a/ table'],
  ['a subject heading is not a kind heading, so the kind above it stays in force',
    index(LIVE_FEATURES, KIND_SUBJECT, INDEX_FEATURE, LIVE_REFACTORS, KIND_SUBJECT, INDEX_ONE, LIVE_FIXES, KIND_SUBJECT, INDEX_FIX),
    [], ''],
  ['a row below a heading outside the rule is outside it too',
    index(SECOND_LOOK, INDEX_ONE, LIVE_FEATURES, INDEX_FEATURE, LIVE_FIXES, INDEX_FIX), [], ''],
];

// The name a live plan takes, read against the half that has already shipped or been turned down. Each case is `[what it asserts, live, archived, refusals, a phrase the message owes]`.
const NAME_CASES = [
  ['a live plan whose name is free passes',
    ['refactor/a/one.md'], ['done/c/gone.md', 'canceled/c/dropped.md'], [], ''],
  ['a live plan whose name a shipped one holds is refused, and both paths are named',
    ['refactor/a/gone.md'], ['done/c/gone.md'],
    ['name refactor/a/gone.md'], 'refactor/a/gone.md takes a name done/c/gone.md already holds'],
  ['a live plan whose name a turned-down one holds is refused',
    ['fixes/a/dropped.md'], ['canceled/c/dropped.md'],
    ['name fixes/a/dropped.md'], 'canceled/c/dropped.md already holds'],
  ['two spellings differing only in case are one name, which is what makes the move overwrite',
    ['refactor/a/Gone.md'], ['done/c/gone.md'], ['name refactor/a/Gone.md'], ''],
  ['a shipped plan written as a folder of parts is named by its folder',
    ['refactor/a/split.md'], ['done/reference/split/README.md', 'done/reference/split/01-first.md'],
    ['name refactor/a/split.md'], 'done/reference/split/README.md already holds'],
  ['a README.md inside a shipped plan\'s own folder refuses nothing, so a live plan shaped the same way keeps its name',
    ['refactor/a/other/README.md'], ['done/reference/split/README.md'], [], ''],
  ['neither half\'s own ranking file is read as a plan',
    ['features/PLAN.md'], ['done/PLAN.md', 'canceled/PLAN.md'], [], ''],
];

// The track a row names, read against the folder the subject orders live in. `tracked(row, ...)` writes a running order carrying the seventh column, and the part files below stand for that folder.
const TRACKED_TABLE = '| # | Ticket | Status | Blocks | Blocked by | Track | Devs with | Why |\n|---|---|---|---|---|---|---|---|\n';

function tracked(...rows) {
  return `${TITLE}\n\n## Tier 3 — a band\n\n${TRACKED_TABLE}${rows.map((r) => `${r}\n`).join('')}\n**Last ranked 9 August 2026, 4:07pm.** Live: 1. On hold: 0. Retired: 0. Turned down: 0.\n`;
}

// The folder of subject orders, one file per subject, their rows spelled a folder deeper than the running order writes them. `three` is step 4c of the lettered subject and is named again inside step 5's prose, which is the pair the step rule turns on.
const TRACKS_FILE = [
  ['a-subject.md', '# A subject\n\n| step | Work | Waits on |\n|---|---|---|\n| 1 | [one](../refactor/a/one.md) | — |\n'],
  ['another-subject.md', '# Another subject\n\n| step | Work | Waits on |\n|---|---|---|\n| 1 | [two](../refactor/b/two.md) | — |\n'],
  ['a-part-subject.md', '# A part subject\n\nWhat this subject is.\n\n| step | Work | Waits on |\n|---|---|---|\n| 1 | [one](../refactor/a/one.md) |\n| 2 | [three](../refactor/c/three.md) |\n'],
  ['a-lettered-subject.md', '# A lettered subject\n\n| step | Work | Waits on |\n|---|---|---|\n| 4c | [three](../refactor/c/three.md) | — |\n| 5 | [four](../refactor/d/four.md) — what [three](../refactor/c/three.md) left behind | 4c |\n'],
  ['a-shared-subject.md', '# A shared subject\n\n| step | Work | Waits on |\n|---|---|---|\n| 1 | [one](../refactor/a/one.md) | — |\n| 2 | [one](../refactor/a/one.md) | — |\n'],
];
const TRACK_TABLES = trackTables(TRACKS_FILE);

// The index above them, and the same index with a step table written back into it.
const TRACK_INDEX = '# Tracks\n\n| Track | What it is | Steps |\n|---|---|---|\n| [A subject](tracks/a-subject.md) | What this subject is. | 1 |\n';
const TRACK_INDEX_WITH_TABLE = `${TRACK_INDEX}\n## A new subject\n\n| step | Work |\n|---|---|\n| 1 | [four](refactor/d/four.md) |\n`;

const TRACK_INDEX_CASES = [
  ['an index of one row per track passes', TRACK_INDEX, []],
  ['a step table written back into the index is refused, and the track is named',
    TRACK_INDEX_WITH_TABLE, ['track-index TRACKS.md'], 'A new subject'],
];

function trackIndexSelfTest() {
  const fails = [];
  for (const [name, text, want, said] of TRACK_INDEX_CASES) {
    const found = indexTableProblems(text);
    const got = found.map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) fails.push(`${name}: got [${got}], want [${want}]`);
    if (said && !found.some((p) => p.message.includes(said))) fails.push(`${name}: no message said \`${said}\``);
  }
  return fails;
}

const TRACK_LIVE = new Set(['refactor/a/one.md', 'refactor/c/three.md', 'refactor/d/four.md']);
const TRACK_ROW = '| 1 | [one](refactor/a/one.md) | Ready | — | — | [A subject](tracks/a-subject.md) step 1 | — | first |';
const TRACK_NONE = '| 1 | [one](refactor/a/one.md) | Ready | — | — | — | — | first |';
const TRACK_UNLINKED = '| 1 | [one](refactor/a/one.md) | Ready | — | — | A subject step 1 | — | first |';
const TRACK_MISSING = '| 1 | [one](refactor/a/one.md) | Ready | — | — | [Nowhere](tracks/nowhere.md) step 1 | — | first |';
const TRACK_WRONG = '| 1 | [one](refactor/a/one.md) | Ready | — | — | [Another subject](tracks/another-subject.md) step 1 | — | first |';
// A subject written in a file of its own, named the way the running order names one. Two rows, because a part file answering with only its first step would call the second row absent from its own track.
const TRACK_PART = '| 1 | [one](refactor/a/one.md) | Ready | — | — | [A part subject](tracks/a-part-subject.md) step 1 | — | first |';
const TRACK_PART_SECOND = '| 2 | [three](refactor/c/three.md) | Ready | — | — | [A part subject](tracks/a-part-subject.md) step 2 | — | second |';
// The step number in the cell, which is the half nothing read until four of them had gone stale.
const TRACK_STALE = '| 1 | [one](refactor/a/one.md) | Ready | — | — | [A subject](tracks/a-subject.md) step 9 | — | first |';
const TRACK_NO_STEP = '| 1 | [one](refactor/a/one.md) | Ready | — | — | [A subject](tracks/a-subject.md) | — | first |';
// `three` is named inside step 5's prose on the lettered subject and is a step of it at 4c, so a cell naming step 5 lands the reader on somebody else's row.
const TRACK_MENTIONED = '| 1 | [three](refactor/c/three.md) | Ready | — | — | [Another subject](tracks/another-subject.md) step 1 | — | first |';
const TRACK_LETTERED = '| 1 | [three](refactor/c/three.md) | Ready | — | — | [A lettered subject](tracks/a-lettered-subject.md) step 4c | — | first |';
// One ticket at two steps of one track, which five live tickets are today.
const TRACK_SHARED_FIRST = '| 1 | [one](refactor/a/one.md) | Ready | — | — | [A shared subject](tracks/a-shared-subject.md) step 1 | — | first |';
const TRACK_SHARED_SECOND = '| 1 | [one](refactor/a/one.md) | Ready | — | — | [A shared subject](tracks/a-shared-subject.md) step 2 | — | first |';
const TRACK_SHARED_WRONG = '| 1 | [one](refactor/a/one.md) | Ready | — | — | [A shared subject](tracks/a-shared-subject.md) step 3 | — | first |';
// The same row without the seventh column: a running order that carries no Track column is outside the rule rather than failing every row of it.
const TRACK_ABSENT = `${TITLE}\n\n## Tier 3 — a band\n\n${TABLE}${ONE}\n\n**Last ranked 9 August 2026, 4:07pm.** Live: 1. On hold: 0. Retired: 0. Turned down: 0.\n`;

const TRACK_CASES = [
  ['a row naming a track the ticket is a step of passes', tracked(TRACK_ROW), []],
  ['an em dash where a track belongs is refused, and the one-step rule is said',
    tracked(TRACK_NONE), ['track refactor/a/one.md'], 'a track with one step'],
  ['a track named in words with no link to its heading is refused',
    tracked(TRACK_UNLINKED), ['track refactor/a/one.md'], 'links no subject order'],
  ['a track written in a file of its own resolves', tracked(TRACK_PART), []],
  ['every step of a track written in a file of its own resolves, not only the first',
    tracked(TRACK_PART, TRACK_PART_SECOND), []],
  ['a track no subject order spells is refused, and the anchor is quoted',
    tracked(TRACK_MISSING), ['track refactor/a/one.md'], 'no subject order spells it'],
  ['a track the ticket is not a step of is refused, which is the one a reader cannot see',
    tracked(TRACK_WRONG), ['track refactor/a/one.md'], 'is not a step of it'],
  ['a running order with no Track column at all is outside the rule', TRACK_ABSENT, []],
  ['a cell naming a step number the track does not give is refused, and the step it does give is named',
    tracked(TRACK_STALE), ['track refactor/a/one.md'], 'and that track gives refactor/a/one.md step 1'],
  ['a cell naming no step at all is refused, and told which one to write',
    tracked(TRACK_NO_STEP), ['track refactor/a/one.md'], 'write `step 1`'],
  ['a ticket named only in another step\'s prose is not a step of that track',
    tracked(TRACK_MENTIONED), ['track refactor/c/three.md'], 'is not a step of it'],
  ['a track whose steps carry a letter suffix keeps the letter whole', tracked(TRACK_LETTERED), []],
  ['a ticket holding two steps of one track answers to either of them',
    tracked(TRACK_SHARED_FIRST), []],
  ['and to the second as readily as the first', tracked(TRACK_SHARED_SECOND), []],
  ['a cell naming a third step of a track a ticket holds two of is refused, and both are named',
    tracked(TRACK_SHARED_WRONG), ['track refactor/a/one.md'], 'gives refactor/a/one.md steps 1, 2'],
];

const PERFORMANCE_FINDING = 'refactor/performance/slow.md';
const PERFORMANCE_ROW = '| 1 | [slow](refactor/performance/slow.md) | Ready | — | — | [Performance](../../docs/tracks/performance.md) step 2 | — | repeated work |';
const PERFORMANCE_TRACKS = trackTables([['performance.md', `# Performance\n\n| step | Work | Waits on |\n|---|---|---|\n| 1 | [bootstrap](${PERFORMANCE_BOOTSTRAP}) | — |\n| 2 | [slow](${PERFORMANCE_FINDING}) | — |\n`]]);
const OTHER_TRACKS = trackTables([['performance.md', `# Performance\n\n| step | Work | Waits on |\n|---|---|---|\n| 1 | [bootstrap](${PERFORMANCE_BOOTSTRAP}) | — |\n`], ['other.md', `# Other\n\n| step | Work | Waits on |\n|---|---|---|\n| 1 | [slow](${PERFORMANCE_FINDING}) | — |\n`]]);
const MARKED_FINDING = new Map([[PERFORMANCE_FINDING, '> **Performance finding.**\n']]);
const UNMARKED_FINDING = new Map([[PERFORMANCE_FINDING, '# Slow\n']]);
const BOOTSTRAP_ROW = `| 1 | [bootstrap](${PERFORMANCE_BOOTSTRAP}) | Dev | — | — | [Performance](../../docs/tracks/performance.md) step 1 | — | the filing route |`;
const PERFORMANCE_CASES = [
  ['a marked finding in tier 0 and the Performance track passes', tracked(PERFORMANCE_ROW).replace('## Tier 3', '## Tier 0'), PERFORMANCE_TRACKS, MARKED_FINDING, []],
  ['a marked finding outside tier 0 is refused and names its row', tracked(PERFORMANCE_ROW), PERFORMANCE_TRACKS, MARKED_FINDING, [`performance-tier ${PERFORMANCE_FINDING}`]],
  ['a marked finding outside the Performance track is refused and names its row', tracked(PERFORMANCE_ROW).replace('## Tier 3', '## Tier 0'), OTHER_TRACKS, MARKED_FINDING, [`performance-track ${PERFORMANCE_FINDING}`]],
  ['an unmarked Performance step is refused and names its row', tracked(PERFORMANCE_ROW).replace('## Tier 3', '## Tier 0'), PERFORMANCE_TRACKS, UNMARKED_FINDING, [`performance-marker ${PERFORMANCE_FINDING}`]],
  ['the unmarked bootstrap passes in its owner-chosen tier', tracked(BOOTSTRAP_ROW), PERFORMANCE_TRACKS, new Map([[PERFORMANCE_BOOTSTRAP, '# Nothing files a performance finding\n']]), []],
];

// The eighth column, read the same way. `tracked(...)` writes the header this column sits in, so a row here is a `Devs with` cell in the seventh place and `Why` in the eighth.
const DEVS_ROW = (cell) => `| 1 | [one](refactor/a/one.md) | Ready | — | — | [A subject](tracks/a-subject.md) step 1 | ${cell} | first |`;
const DEVS_ABSENT = `${TITLE}\n\n## Tier 3 — a band\n\n${TABLE}${ONE}\n\n**Last ranked 9 August 2026, 4:07pm.** Live: 1. On hold: 0. Retired: 0. Turned down: 0.\n`;

// The rule reads the cell's links against what is live, so the fixture's live set has to hold the tickets a passing cell names.
const DEVS_LIVE = new Set(['refactor/a/one.md', 'refactor/b/two.md', 'refactor/b/three.md', 'a.md', 'b.md', 'c.md', 'd.md']);

const DEVS_CASES = [
  ['an em dash passes, which is what nothing disjoint reads as', tracked(DEVS_ROW('—')), []],
  ['links and a count pass, which is what the bundler writes',
    tracked(DEVS_ROW('[two](refactor/b/two.md), [three](refactor/b/three.md) (9 in all)')), []],
  ['a cell written in words is refused, because nothing here writes one',
    tracked(DEVS_ROW('anything in the front end')), ['devs-with refactor/a/one.md'], 'not a cell the bundler writes'],
  ['four links are refused, since the bundler stops at three and gives a total',
    tracked(DEVS_ROW('[a](a.md), [b](b.md), [c](c.md), [d](d.md)')), ['devs-with refactor/a/one.md'], 'not a cell the bundler writes'],
  ['a count with no number is refused',
    tracked(DEVS_ROW('[two](refactor/b/two.md) (lots in all)')), ['devs-with refactor/a/one.md'], 'not a cell the bundler writes'],
  ['a cell naming a ticket that is not live is refused, which is what a retirement nobody rewrote leaves',
    tracked(DEVS_ROW('[gone](done/a/gone.md)')), ['devs-with refactor/a/one.md'], 'is not live work'],
  ['a cell naming its own row is refused, because a ticket has one writer',
    tracked(DEVS_ROW('[one](refactor/a/one.md)')), ['devs-with refactor/a/one.md'], 'names itself'],
  ['a running order with no Devs with column at all is outside the rule', DEVS_ABSENT, []],
];

// The same column read against real footprints. Three rows: `one` and `two` share a file, `one` and `three` share none, and `four` waits on `one`.
const DEVS_CLAIMS = new Map([
  ['refactor/a/one.md', ['app/src/format.rs']],
  ['refactor/b/two.md', ['app/src/format.rs', 'app/src/lib.rs']],
  ['refactor/b/three.md', ['app/src/theme.rs']],
  ['refactor/b/four.md', ['app/src/png.rs']],
]);
const DEVS_CLAIMED_LIVE = new Set([...DEVS_CLAIMS.keys()]);

// Four rows in one table, so the whole column is read at once the way the real file is. `cell` fills row 1's; the other three carry what the footprints say.
function devsTable(cell) {
  return tracked(
    `| 1 | [one](refactor/a/one.md) | Ready | — | — | [A subject](tracks/a-subject.md) step 1 | ${cell} | first |`,
    '| 2 | [two](refactor/b/two.md) | Ready | — | — | [A subject](tracks/a-subject.md) step 1 | [three](refactor/b/three.md), [four](refactor/b/four.md) | second |',
    '| 3 | [three](refactor/b/three.md) | Ready | — | — | [A subject](tracks/a-subject.md) step 1 | [one](refactor/a/one.md), [two](refactor/b/two.md), [four](refactor/b/four.md) | third |',
    '| 4 | [four](refactor/b/four.md) | Ready | — | [one](refactor/a/one.md) | [A subject](tracks/a-subject.md) step 1 | [two](refactor/b/two.md), [three](refactor/b/three.md) | fourth |',
  );
}

const DEVS_FOOTPRINT_CASES = [
  ['the column the footprints say passes', devsTable('[three](refactor/b/three.md)'), []],
  ['a named pair whose builds write the same file is refused, which is the whole point of the column',
    devsTable('[two](refactor/b/two.md)'), ['devs-with refactor/a/one.md'], 'both builds write app/src/format.rs'],
  ['a named pair where one waits on the other is refused, whatever their files say',
    devsTable('[four](refactor/b/four.md)'), ['devs-with refactor/a/one.md'], 'waits on the other'],
  ['a cell that drops a partner is refused, since the column is generated',
    devsTable('—'), ['devs-with refactor/a/one.md'], 'the footprints say'],
];

function selfTest() {
  const fails = [];
  // The declared waits are where every `Blocked by` cell comes from, so the reader under them is proved before any rule here reads a track.
  fails.push(...waitsSelfTest());
  for (const [name, text, tracksText, ticketTexts, want] of PERFORMANCE_CASES) {
    const got = performanceProblems(text, tracksText, ticketTexts).map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) {
      fails.push(`${name}: got [${got}], want [${want}]`);
    }
  }
  fails.push(...trackIndexSelfTest());
  for (const [name, text, want, said] of TRACK_CASES) {
    const found = trackProblems(text, TRACK_TABLES, TRACK_LIVE);
    const got = found.map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) {
      fails.push(`${name}: got [${got}], want [${want}]`);
    }
    if (said && !found.some((p) => p.message.includes(said))) {
      fails.push(`${name}: no message said \`${said}\``);
    }
  }
  for (const [name, text, want, said] of DEVS_FOOTPRINT_CASES) {
    const found = devsWithProblems(text, DEVS_CLAIMED_LIVE, DEVS_CLAIMS);
    const got = found.map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) {
      fails.push(`${name}: got [${got}], want [${want}]`);
    }
    if (said && !found.some((p) => p.message.includes(said))) {
      fails.push(`${name}: no message said \`${said}\``);
    }
  }
  for (const [name, text, want, said] of DEVS_CASES) {
    const found = devsWithProblems(text, DEVS_LIVE);
    const got = found.map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) {
      fails.push(`${name}: got [${got}], want [${want}]`);
    }
    if (said && !found.some((p) => p.message.includes(said))) {
      fails.push(`${name}: no message said \`${said}\``);
    }
  }
  for (const [name, text, t, want, said] of CASES) {
    const found = shapeProblems(text, t);
    const got = found.map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) {
      fails.push(`${name}: got [${got}], want [${want}]`);
    }
    if (said && !found.some((p) => p.message.includes(said))) {
      fails.push(`${name}: no message said \`${said}\``);
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
  for (const [name, text, held, want] of HELD_CASES) {
    const got = heldProblems(text, held).map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) {
      fails.push(`${name}: got [${got}], want [${want}]`);
    }
  }
  for (const [name, text, live, want, said] of INDEX_CASES) {
    const found = indexProblems([['live', 'README.md', text]], live);
    const got = found.map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) {
      fails.push(`${name}: got [${got}], want [${want}]`);
    }
    if (said && !found.some((p) => p.message.includes(said))) {
      fails.push(`${name}: no message said \`${said}\``);
    }
  }
  // The three live-index cases are one file; the archive ones are the whole set of index files at once, because the rule they assert is which of them a row is written in.
  for (const [name, text, want, said] of KIND_INDEX_CASES) {
    const found = indexProblems([['live', 'README.md', text]], KIND_LIVE, new Set());
    const got = found.map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) {
      fails.push(`${name}: got [${got}], want [${want}]`);
    }
    if (said && !found.some((p) => p.message.includes(said))) {
      fails.push(`${name}: no message said \`${said}\``);
    }
  }
  for (const [name, files, want, said] of [...ARCHIVED_INDEX_CASES, ...FILE_INDEX_CASES]) {
    const found = indexProblems(files, INDEX_LIVE, INDEX_ARCHIVED);
    const got = found.map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) {
      fails.push(`${name}: got [${got}], want [${want}]`);
    }
    if (said && !found.some((p) => p.message.includes(said))) {
      fails.push(`${name}: no message said \`${said}\``);
    }
  }
  for (const [name, liveSet, archivedSet, want, said] of NAME_CASES) {
    const found = nameProblems(new Set(liveSet), new Set(archivedSet));
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

const missing = planTreeMissing(plans);
if (missing) {
  console.error(`plan: ${missing}`);
  process.exit(1);
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

// Each of these folders holds its own ranking file and its own index beside the plans: the shipped log supplies the retired rows, the refused one is derived by /pm, and the index is where the rows themselves are written — so none of the three is a ticket and none owns a row of its own.
const archived = new Set();
for (const folder of ARCHIVED_PLANS) {
  const full = join(plans, folder);
  if (!existsSync(full) || !statSync(full).isDirectory()) continue;
  for (const file of markdown(full, plans)) {
    if (file !== `${folder}/PLAN.md` && file !== `${folder}/README.md`) archived.add(file);
  }
}

// A struck first cell is a ticket that shipped; the record under the tables is prose, not rows.
const shippedRead = shippedProblems(readFileSync(join(plans, 'done', 'PLAN.md'), 'utf8'));
const retired = shippedRead.retired;

const turnedDown = [...archived].filter((f) => f.startsWith('canceled/')).length;
const held = [...archived].filter((f) => f.startsWith('on-hold/')).length;

// Every live ticket's own words, for the rules that read one. Nothing counts its `### Phase` headings any more: how many phases a ticket has plays no part in where its row sits or in what order the rows are read.
const ticketTexts = new Map();
for (const ticket of live) ticketTexts.set(ticket, readFileSync(join(plans, ticket), 'utf8'));

const text = readFileSync(join(plans, 'PLAN.md'), 'utf8');

// The subject orders: the index, and every step table in the folder under it, read once and handed to all four rules that ask about them.
const tracks = {
  index: readFileSync(join(plans, 'TRACKS.md'), 'utf8'),
  tables: trackTables(trackFiles(plans)),
};

const problems = [
  ...shapeProblems(text, { live, retired, turnedDown, held }),
  ...shippedRead.problems,
  ...heldProblems(readFileSync(join(plans, 'on-hold', 'PLAN.md'), 'utf8'), new Set([...archived].filter((file) => file.startsWith('on-hold/')))),
  ...trackProblems(text, tracks.tables, live),
  ...performanceProblems(text, tracks.tables, ticketTexts),
  ...indexTableProblems(tracks.index),
  ...devsWithProblems(text, live, claimsInTree(plans)),
  ...waitsProblems(tracks.tables, live),
  ...columnProblems(text, planRows(text), tracks.tables),
];

// The same walks answer the index, so the two cannot disagree about what is live or what is archived.
const indexes = Object.entries(INDEX_FILES).map(([half, file]) => [half, file, readFileSync(join(plans, file), 'utf8')]);
const indexFails = indexProblems(indexes, live, archived);

// The same two walks again, asked the one question the retirement asks too late.
const nameFails = nameProblems(live, archived);

if (problems.length) {
  console.error('the running order has stopped ranking every live ticket:');
  for (const { message } of problems) console.error(`  ${message}`);
  console.error('Run /pm: it re-derives every row off the tree, gives every ticket its track, so a ticket with no row gets one and');
  console.error('the counts at the foot are rewritten from what is actually on disk.');
  console.error('A row named above is in done/PLAN.md: /done puts one in the table for the tier it was retired from.');
}

if (indexFails.length) {
  console.error('the index every ticket is written against has stopped holding one row per ticket, live or archived:');
  for (const { message } of indexFails) console.error(`  ${message}`);
  console.error('Run /ticket: a ticket added, renamed or moved between folders is not finished until the one row');
  console.error('it opens matches. A ticket named in another row stays a cross-reference and keeps its own row.');
  console.error('A shipped or turned-down ticket owns a row too, in the index inside the folder holding it: that half is what a reader opens to find out whether the tree already answered them.');
}

if (nameFails.length) {
  console.error('a live ticket has taken a name a shipped or turned-down plan already holds:');
  for (const { message } of nameFails) console.error(`  ${message}`);
  console.error('Rename it now, while the links to it can still be counted: its index row, its running-order row, and');
  console.error('the found line on anything filed beside it. Left alone, /done moves it onto the older file rather than beside it.');
}

if (problems.length || indexFails.length || nameFails.length) process.exit(1);

console.log(`plan: opening with \`${TITLE}\`, ${planRows(text).length} rows, one per live ticket, positions 1 to ${live.size} once each, ${held} on hold, ${retired} retired and ${turnedDown} turned down matching the tree, no row above what it waits on, every Blocks cell agreeing with the waits, every row under the sub-band heading its own Blocked by cell names, every fix in tier 1, no feature in tier 1, a stamp naming the day and the time it was ranked, every row naming a track it is a step of under docs/tracks/, every declared wait naming a step its own track has or a ticket some track holds, both blocker columns the ones those waits give, no step table left in the index above them, every Devs with cell the one the footprints give and every pair it names sharing no file and waiting on nothing, every retired row inside the tier table it was retired from, square with that table's header, and one row opened per ticket in the index beside it, ${live.size} live and ${archived.size} outside it, no live one taking a name the shipped, refused or held work already holds`);
