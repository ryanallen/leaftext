#!/usr/bin/env node
// A tripwire on the lists whose prose nobody reads back. It holds a written-down copy of each list's rows; change the list and this fails, naming every file whose comments describe it and asking for them to be read before the new rows are recorded.
//
//   node scripts/check-format-prose.mjs --check   fail on a list that moved, and on the page's copy drifting from the host's (`just verify`)
//
// **It reads no prose, and it cannot.** Both shapes that do were run over the tree and both scored nothing: counting the numbers a comment spells fires on 44 correct comments across the five files around the diagram export table, because a comment about part of a table honestly counts part of a table; naming the endings fires on two, both of them comments the last build wrote correctly. There is no rule over the words that can tell a comment written for a smaller list from a comment written about a subset on purpose. So this does not try. It guarantees that somebody opens the files, which is the exact step that was skipped twice — once when the PDF row landed and two comments went stale, and again when the JPEG row landed, four were corrected and a fifth was missed in a file that build was editing at the time.
//
// Adding a format is therefore two edits: the table, and the recorded rows below. The second edit is what hands over the reading list.
//
// **Both lists sit here rather than in a script each** because the mechanism is a table of lists and nothing about it is one list's: a second script would be this one copied, with a second reading list to keep and a second place for the parser to rot. The diagram export formats and the document formats already share a row — the diagram table takes Markdown's spellings from `src/format.rs` — and a third list, whenever somebody finds one drifting, is a row in `LISTS` rather than a new file. What differs between them is only what can be read and what can be pinned: `DocumentFormat::ALL` is `[Self; 5]`, so the compiler already refuses a wrong length there and the prose is the whole of what is unguarded, where the diagram table has a second copy in the page and that copy is pinned.
//
// **What it can be certain about is the pin.** The page keeps its own copy of the diagram export list to draw the menu a Mac gets, and nothing held the two together — `scripts/check-shell.mjs` compares the drawn menu to a third hand-kept string, which is a rendering claim rather than a list-equality one and stays where it is. Here the page's endings must be the host's endings, in the same order, because the Mac menu is drawn from one and the save window from the other. Labels are deliberately not compared: the save window says "PNG image" where the menu says "PNG".
//
// The rules are proved on made-up lists before the real tree is opened, so a parser that quietly stops finding rows fails the build instead of passing everything.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/// Every list this check holds, and the files whose comments describe each one. A row is `[label, endings]`, in the table's own order — the order is load-bearing in both of them, since Windows names a file with no ending off the first row.
const LISTS = [
  {
    name: 'the diagram export formats',
    source: 'src/app/fileops.rs',
    what: '`DIAGRAM_EXPORT_FORMATS`',
    rows: [
      ['Markdown', ['md', 'markdown', 'mdown']],
      ['PNG image', ['png']],
      ['WebP image', ['webp']],
      ['PDF document', ['pdf']],
      ['JPEG image', ['jpg', 'jpeg']],
    ],
    prose: [
      'src/app/events.rs',
      'src/main.rs',
      'src/assets/shell/flow-canvas.js',
      'src/app/tests.rs',
      'src/tests/app_shell_chrome.rs',
    ],
    read: (formatSource) => ({
      actual: hostRows(read('src/app/fileops.rs'), formatSource),
      page: pageRows(read('src/assets/shell/flow-canvas.js')),
    }),
  },
  {
    name: 'the document formats',
    source: 'src/format.rs',
    what: '`DocumentFormat::ALL`',
    rows: [
      ['Markdown', ['md', 'markdown', 'mdown']],
      ['Xml', ['xml']],
      ['Json', ['json']],
      ['Yaml', ['yaml', 'yml']],
      ['Eml', ['eml', 'mht', 'mhtml']],
    ],
    prose: [
      'src/assets/shell/block-controls.js',
      'src/assets/shell/code-intel.js',
      'src/assets/shell/code-view.js',
      'src/assets/shell/reading-edits.js',
      'src/editing.rs',
      'src/lib.rs',
    ],
    read: (formatSource) => ({ actual: documentRows(formatSource) }),
  },
];

/// The extensions `src/format.rs` names for one document format. The diagram table takes Markdown's spellings from there rather than restating them, so this check has to follow it to the same place.
export function documentExtensions(formatSource, variant) {
  const block = formatSource.match(/fn extensions\(self\)[\s\S]*?\n    \}/);
  if (!block) return null;
  const arm = block[0].match(new RegExp(`Self::${variant}\\s*=>\\s*&\\[([^\\]]*)\\]`));
  if (!arm) return null;
  return [...arm[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

/// The host's diagram export rows, read out of `src/app/fileops.rs`. A row's endings are either written out or asked of `src/format.rs`.
export function hostRows(fileopsSource, formatSource) {
  const table = fileopsSource.match(/const DIAGRAM_EXPORT_FORMATS[^=]*=\s*&\[([\s\S]*?)\n\];/);
  if (!table) return null;
  const rows = [];
  for (const row of table[1].matchAll(/\(\s*"([^"]*)"\s*,\s*([^\n]+?)\s*\),/g)) {
    const [, label, endings] = row;
    const written = endings.match(/^&\[([^\]]*)\]$/);
    if (written) {
      rows.push([label, [...written[1].matchAll(/"([^"]*)"/g)].map((m) => m[1])]);
      continue;
    }
    const asked = endings.match(/DocumentFormat::(\w+)\.extensions\(\)/);
    if (!asked) return null;
    const spellings = documentExtensions(formatSource, asked[1]);
    if (!spellings) return null;
    rows.push([label, spellings]);
  }
  return rows.length ? rows : null;
}

/// The page's copy of that list, read out of `src/assets/shell/flow-canvas.js`.
export function pageRows(shellSource) {
  const table = shellSource.match(/const DIAGRAM_EXPORTS = \[([\s\S]*?)\n\];/);
  if (!table) return null;
  const rows = [];
  for (const row of table[1].matchAll(/id:\s*'([^']*)'\s*,\s*endings:\s*\[([^\]]*)\]/g)) {
    rows.push([row[1], [...row[2].matchAll(/'([^']*)'/g)].map((m) => m[1])]);
  }
  return rows.length ? rows : null;
}

/// The document formats, read out of `src/format.rs`: the order `ALL` lists them in, and the spellings each one answers to. The compiler already refuses a wrong length there, so what is recorded here is the prose files rather than the count.
export function documentRows(formatSource) {
  const all = formatSource.match(/const ALL: \[Self; \d+\] = \[([^\]]*)\]/);
  if (!all) return null;
  const variants = [...all[1].matchAll(/Self::(\w+)/g)].map((m) => m[1]);
  if (!variants.length) return null;
  const rows = [];
  for (const variant of variants) {
    const spellings = documentExtensions(formatSource, variant);
    if (!spellings) return null;
    rows.push([variant, spellings]);
  }
  return rows;
}

/// How a row reads in a message.
const spell = ([label, endings]) => `${label} (${endings.join(', ')})`;

/// The reading list, which is the whole point of the failure: the message is what hands somebody the files rather than leaving them to guess which comments were written for the old shape.
function readThese(list) {
  return [
    `  Read the comments in these before recording the new rows in scripts/check-format-prose.mjs:`,
    ...list.prose.map((path) => `    ${path}`),
  ];
}

/// What is wrong with a set of lists and what was read for each. Pure, so every refusal can be proved on made-up input.
export function problems(readings) {
  const found = [];
  for (const { list, actual, page } of readings) {
    if (!actual) {
      found.push(`${list.source} — ${list.what} could not be read at all, so nothing was held. The parser in scripts/check-format-prose.mjs has stopped matching the table it was written for`);
      continue;
    }
    const recorded = list.rows;
    const differs =
      recorded.length !== actual.length ||
      recorded.some(([label, endings], i) =>
        label !== actual[i][0] || endings.join(',') !== actual[i][1].join(',')
      );
    if (differs) {
      found.push(`${list.source} — ${list.what} is no longer the list this check recorded for ${list.name}.`);
      found.push(`  recorded: ${recorded.map(spell).join(' | ')}`);
      found.push(`  in the tree: ${actual.map(spell).join(' | ')}`);
      found.push(...readThese(list));
    }
    if (page === undefined) continue;
    if (!page) {
      found.push(`src/assets/shell/flow-canvas.js — \`DIAGRAM_EXPORTS\` could not be read at all, so the page's copy was held to nothing`);
      continue;
    }
    const hostEndings = actual.map(([, endings]) => endings.join(','));
    const pageEndings = page.map(([, endings]) => endings.join(','));
    if (hostEndings.join(' | ') !== pageEndings.join(' | ')) {
      found.push(`the page's copy of ${list.name} is not the host's: the Mac menu is drawn from one and the save window from the other, so a row in one and not the other is a format a reader can pick and not save, or save and never see offered.`);
      found.push(`  ${list.source}: ${hostEndings.join(' | ')}`);
      found.push(`  src/assets/shell/flow-canvas.js: ${pageEndings.join(' | ')}`);
    }
  }
  return found;
}

const FIXTURE = {
  name: 'a made-up list',
  source: 'a.rs',
  what: '`A_TABLE`',
  rows: [
    ['Markdown', ['md', 'markdown']],
    ['PNG image', ['png']],
  ],
  prose: ['b.rs'],
};

/// A second made-up list, with no page copy and a reading list of its own, so a failure is proved to hand over the files that describe the list that moved rather than every file the check knows.
const SECOND = {
  name: 'a second made-up list',
  source: 'c.rs',
  what: '`ANOTHER_TABLE`',
  rows: [
    ['Json', ['json']],
    ['Yaml', ['yaml', 'yml']],
  ],
  prose: ['d.rs', 'e.rs'],
};

const CASES = [
  ['the recorded rows and the table agree, with no page copy in it',
    [{ list: FIXTURE, actual: [['Markdown', ['md', 'markdown']], ['PNG image', ['png']]] }], 0],
  ['the page carries the same endings in the same order, under its own labels',
    [{ list: FIXTURE, actual: [['Markdown', ['md', 'markdown']], ['PNG image', ['png']]], page: [['md', ['md', 'markdown']], ['png', ['png']]] }], 0],

  ['a row the table no longer holds',
    [{ list: FIXTURE, actual: [['Markdown', ['md', 'markdown']]] }], 5],
  ['a row the table gained and nothing recorded',
    [{ list: FIXTURE, actual: [['Markdown', ['md', 'markdown']], ['PNG image', ['png']], ['JPEG image', ['jpg']]] }], 5],
  ['a row that gained a second spelling',
    [{ list: FIXTURE, actual: [['Markdown', ['md', 'markdown']], ['PNG image', ['png', 'apng']]] }], 5],
  ['a row renamed',
    [{ list: FIXTURE, actual: [['Markdown', ['md', 'markdown']], ['PNG picture', ['png']]] }], 5],
  ['the same rows in a different order',
    [{ list: FIXTURE, actual: [['PNG image', ['png']], ['Markdown', ['md', 'markdown']]] }], 5],
  ['a table that cannot be read at all',
    [{ list: FIXTURE, actual: null }], 1],

  ['the page in a different order from the host',
    [{ list: FIXTURE, actual: [['Markdown', ['md', 'markdown']], ['PNG image', ['png']]], page: [['png', ['png']], ['md', ['md', 'markdown']]] }], 3],
  ['a row the page never gained',
    [{ list: FIXTURE, actual: [['Markdown', ['md', 'markdown']], ['PNG image', ['png']]], page: [['md', ['md', 'markdown']]] }], 3],
  ['a spelling the page permits and the host does not',
    [{ list: FIXTURE, actual: [['Markdown', ['md', 'markdown']], ['PNG image', ['png']]], page: [['md', ['md', 'markdown', 'mdown']], ['png', ['png']]] }], 3],
  ['a page copy that cannot be read at all',
    [{ list: FIXTURE, actual: [['Markdown', ['md', 'markdown']], ['PNG image', ['png']]], page: null }], 1],

  ['a second list with no page copy, agreeing',
    [{ list: SECOND, actual: [['Json', ['json']], ['Yaml', ['yaml', 'yml']]] }], 0],
  ['a second list that gained a row, naming its own files and not the first list\'s',
    [{ list: SECOND, actual: [['Json', ['json']], ['Yaml', ['yaml', 'yml']], ['Eml', ['eml']]] }], 6],
  ['a second list whose row gained a spelling',
    [{ list: SECOND, actual: [['Json', ['json']], ['Yaml', ['yaml', 'yml', 'yamls']]] }], 6],
  ['both lists moved at once, each handing over its own reading list',
    [
      { list: FIXTURE, actual: [['Markdown', ['md', 'markdown']]] },
      { list: SECOND, actual: [['Json', ['json']]] },
    ], 11],
];

const testFails = [];
for (const [name, readings, want] of CASES) {
  const got = problems(readings).length;
  if (got !== want) testFails.push(`${name}: ${got} lines, wanted ${want}`);
}
if (testFails.length) {
  console.error('format prose: the rules are wrong, so nothing was read:');
  for (const line of testFails) console.error(`  ${line}`);
  process.exit(1);
}

const formatSource = read('src/format.rs');
const readings = LISTS.map((list) => ({ list, ...list.read(formatSource) }));

const found = problems(readings);
if (found.length) {
  console.error('a format list has moved, and the prose describing it has not been read:');
  for (const line of found) console.error(`  ${line}`);
  console.error('This check cannot tell whether a comment is right. It can only make sure somebody looks, which is the step that was skipped the last two times a row landed.');
  process.exit(1);
}

const rows = readings.reduce((n, { actual }) => n + (actual ? actual.length : 0), 0);
console.log(`format prose: ok (${LISTS.length} lists, ${rows} rows recorded, and the page's copy is the host's)`);
