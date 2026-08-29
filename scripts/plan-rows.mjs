#!/usr/bin/env node
// A row of the running order, read once. Two things read `../docs/PLAN.md` for its rows — the check that holds thirteen rules over them, and the module that says which of them can be built alongside each other — and a second reader of the same table is how the two would come to disagree about what a row even is.
//
// It answers only what the table says: where the row sits, which ticket it names, what it blocks, what it waits on, and the sub-band heading it is under. Whether any of that is *right* is `check-plan.mjs`'s, and every rule stays there.
//
// A `Track` column may or may not be in the file, which is why `Why` is taken as the last cell rather than by index. Nothing here reads `Track` or `Devs with`: both are found by name where they are needed.

const LINK = /\[[^\]]*\]\(\s*([^)\s]+)\)/g;

/// Every document a cell links, without its anchor. A cell can carry words and more than one link, so the caller picks.
export function links(cell) {
  return [...cell.matchAll(LINK)].map((m) => m[1].split('#')[0]);
}

// An empty tier is deleted heading and all, so this reads the headings it finds rather than expecting five.
export function planRows(text) {
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
      // The first link only: a `Ticket` cell can carry words after it, and a `Why` cell links neighbors.
      ticket: links(cells[1])[0] ?? null,
      shown: cells[1].replace(/\s+/g, ' '),
      blocks: links(cells[3]),
      blockers: links(cells[4]),
      // The last cell is always `Why`, whether or not the file carries a `Track` column.
      why: cells[cells.length - 1],
      cells,
    });
  }
  return rows;
}
