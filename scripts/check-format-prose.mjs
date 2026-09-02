#!/usr/bin/env node
// A tripwire on the lists whose prose nobody reads back. It holds a written-down copy of each list's rows; change the list and this fails, naming the files whose comments describe it and asking for them to be read before the new rows are recorded.
//
//   node scripts/check-format-prose.mjs --check   fail on a list that moved, on a file it names being gone, on one nobody has accounted for, and on the page's copy drifting from the host's (`just verify`)
//
// **It reads no prose, and it cannot.** Both shapes that do were run over the tree and both scored nothing: counting the numbers a comment spells fires on 44 correct comments across the five files around the diagram export table, because a comment about part of a table honestly counts part of a table; naming the endings fires on two, both correct — one of them the comment the last build wrote as it added a row. There is no rule over the words that can tell a comment written for a smaller list from a comment written about a subset on purpose. So this does not try. It guarantees that somebody opens the files, which is the exact step that was skipped twice — once when the PDF row landed and two comments went stale, and again when the JPEG row landed, four were corrected and a fifth was missed in a file that build was editing at the time.
//
// Adding a format is therefore two edits: the table, and the recorded rows below. The second edit is what hands over the reading list.
//
// **Both lists sit here rather than in a script each** because the mechanism is a table of lists and nothing about it is one list's: a second script would be this one copied, with a second reading list to keep and a second place for the parser to rot. The diagram export formats and the document formats already share a row — the diagram table takes Markdown's spellings from `src/format.rs` — and a third list, whenever somebody finds one drifting, is a row in `LISTS` rather than a new file. What differs between them is only what can be read and what can be pinned: `DocumentFormat::ALL` has a compiler-checked length, so the compiler already refuses a wrong one there and the prose is the whole of what is unguarded, where the diagram table has a second copy in the page and that copy is pinned.
//
// **What it can be certain about is the pin.** The page keeps its own copy of the diagram export list to draw the menu a Mac gets, and nothing held the two together — `scripts/check-shell.mjs` compares the drawn menu to a third hand-kept string, which is a rendering claim rather than a list-equality one and stays where it is. Here the page's endings must be the host's endings, in the same order, because the Mac menu is drawn from one and the save window from the other. Labels are deliberately not compared: the save window says "PNG image" where the menu says "PNG".
//
// **What holds the reading list itself, and what a green run does not say.** Every path recorded here is held to a file that exists, so a file renamed or deleted out from under the list fails rather than being printed as a name with nothing behind it. Beyond that, every `.rs` and `.js` under `src/` whose comment line names two or more of a list's rows — `src/assets/vendor/` skipped as compiled output, and each list's own source skipped because the check already reads that one as the table — is either in that list's `prose` or in its `looked` with a one-line reason the format words are there for something else. A file that gains such a comment fails with the two answers offered.
//
// **That catches an addition and never an omission.** A comment whose prose names one row or none is invisible to it, and the standing example is `src/main.rs:605` — "the window carries every row the table holds" is real prose about the diagram export table and names no format word at all, so it lives in the hand-typed list and nothing but a person could have put it there. `src/tests/app_shell_chrome_icons.rs` is the same shape: two paragraphs about that table naming Markdown and nothing else. So a green run means the recorded paths are all real and nothing has quietly gained a comment about the list; it does not mean the list is every file that describes it.
//
// The rules are proved on made-up lists before the real tree is opened, so a parser that quietly stops finding rows fails the build instead of passing everything.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentExtensions, documentRows as readDocumentRows, namedExtensions } from './app-formats.mjs';

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
      'src/assets/shell/flow-export.js',
      'src/app/tests/export.rs',
      'src/tests/app_shell_chrome_icons.rs',
    ],
    looked: [
      ['src/markdown/images.rs', 'a picture named inside a mermaid box — `shot.png` is one example spelling in a comment about resolving a path, not a row of the export table'],
      ['src/assets/shell/image-sheet.js', 'the picture export table, which names the same endings for a different subject and is that list\'s own page copy'],
      ['src/tests/images.rs', 'the eleven kinds of picture the reading view draws, which is what may be shown in a document rather than what anything may be written as'],
    ],
    pageSource: 'src/assets/shell/flow-export.js',
    read: (formatSource) => ({
      actual: hostRows(read('src/app/fileops.rs'), formatSource),
      page: pageRows(read('src/assets/shell/flow-export.js')),
    }),
  },
  {
    name: 'the picture export formats',
    source: 'src/app/fileops.rs',
    what: '`PICTURE_EXPORT_FORMATS`',
    rows: [
      ['PNG image', ['png']],
      ['WebP image', ['webp']],
      ['JPEG image', ['jpg', 'jpeg']],
      ['PDF document', ['pdf']],
      ['Markdown', ['md', 'markdown', 'mdown']],
    ],
    prose: [
      'src/app/events.rs',
      'src/main.rs',
      'src/assets/shell/image-sheet.js',
      'src/app/tests/export.rs',
    ],
    looked: [
      ['src/assets/shell/flow-export.js', 'the diagram export table, which names the same endings for a different subject and is that list\'s own page copy'],
      ['src/markdown/images.rs', 'a picture named inside a mermaid box — `shot.png` is one example spelling in a comment about resolving a path, not a row of the export table'],
      ['src/tests/images.rs', 'the eleven kinds of picture the reading view draws, which is what may be shown in a document rather than what anything may be written as'],
    ],
    pageSource: 'src/assets/shell/image-sheet.js',
    read: (formatSource) => ({
      actual: hostRows(read('src/app/fileops.rs'), formatSource, 'PICTURE_EXPORT_FORMATS'),
      page: pageRows(read('src/assets/shell/image-sheet.js'), 'PICTURE_EXPORTS'),
    }),
  },
  {
    name: 'the document formats',
    source: 'src/format.rs',
    what: '`DocumentFormat::ALL`',
    rows: [
      ['Markdown', ['md', 'markdown', 'mdown', 'mdc']],
      ['Xml', ['xml']],
      ['Json', ['json']],
      ['Yaml', ['yaml', 'yml']],
      ['Eml', ['eml', 'mht', 'mhtml']],
      ['Html', ['html', 'htm']],
      ['Text', ['txt']],
      ['Ini', ['ini']],
      ['Docx', ['docx', 'docm']],
      ['Xlsx', ['xlsx', 'xlsm']],
      ['Pptx', ['pptx', 'pptm']],
      ['Odt', ['odt']],
      ['Ods', ['ods']],
      ['Odp', ['odp']],
      ['Code', ['ts', 'tsx', 'js', 'jsx', 'jsonc', 'css', 'scss', 'sh', 'bash', 'zsh', 'toml', 'rs', 'py', 'sql', 'diff', 'patch', 'env', 'graphql', 'gql']],
    ],
    prose: [
      'src/app/link_preview.rs',
      'src/app/links.rs',
      'src/assets/shell/block-controls.js',
      'src/assets/shell/code-intel.js',
      'src/assets/shell/code-view.js',
      'src/assets/shell/reading-blocks.js',
      'src/assets/shell/reading-edits.js',
      'src/assets.rs',
      'src/data.rs',
      'src/editing.rs',
      'src/html.rs',
      'src/ini.rs',
      'src/lib.rs',
      'src/minimap.rs',
      'src/store/links.rs',
      'src/text.rs',
      'src/tests/data_xml.rs',
      'src/tests/text.rs',
      'src/tests/markdown_render.rs',
      'src/tests/settings_paths.rs',
      'src/tests/web_core.rs',
      'src/xml.rs',
      'src/app/editing_cmds.rs',
      'src/app/events.rs',
      'src/assets/shell/decorate.js',
      'src/assets/shell/minimap.js',
      'src/encoding.rs',
      'src/markdown/events.rs',
      'src/tests/app_shell_reader_document.rs',
      'src/tests/app_shell_reader_editing.rs',
      'src/tests/encoding.rs',
      'src/tests/theme_registry.rs',
      'src/theme.rs',
      'src/app/vaults.rs',
      'src/tests/vault_corpus.rs',
      'src/host.rs',
      'src/office/mod.rs',
      'src/office/zip.rs',
      'src/office/docx.rs',
      'src/office/xlsx.rs',
      'src/office/pptx.rs',
      'src/office/odf.rs',
      'src/office/testing.rs',
      'src/tests/office.rs',
    ],
    looked: [
      ['src/state.rs', 'JSON names the app-owned config files and source names the saved editor state, not the formats the app admits'],
      ['src/tests/conformance/mod.rs', 'the CommonMark suite ships its own examples as JSON files — the word is the fixture\'s file type, not a format the app reads'],
      ['src/tests/conformance/yaml.rs', 'names the pair of fixture files one suite reads its cases from, which a new row in the table leaves exactly as it is'],
      ['src/tests/indexer_pager.rs', 'a walkthrough naming the three pages a test stands on in order, the way it would name three headings'],
      ['src/assets/shell/dom-to-markdown.js', 'the serializers for Markdown and TEI editing, not the formats the app admits'],
      ['src/assets/shell/glossary.js', 'why the link card refuses a block before it serializes it — the words are the shape a plain text file reaches the card in, one `pre` holding one `code`, not the formats the app admits'],
      ['src/assets/shell/speed-reader.js', 'the acronym rule and the Markdown badge, not the formats the app admits'],
      ['src/eml.rs', 'the email renderer and the HTML policy it shares with Markdown, not the formats the app admits'],
      ['src/markdown/images.rs', 'image paths written in Markdown or HTML, not the formats the app admits'],
      ['src/markdown/rawhtml.rs', 'the shared HTML sanitizer policy, not the formats the app admits'],
      ['src/scripts.rs', 'the shape and cost of one rendered-document payload, not the formats the app admits'],
      ['src/tests/images.rs', 'picture paths written in Markdown or HTML, not the formats the app admits'],
      ['src/tests/markdown_rawhtml.rs', 'raw HTML written inside Markdown, not the formats the app admits'],
      ['src/app/tests/export.rs', 'the export rows and how each one reaches the file — the word is the mermaid text a Markdown export writes, not the plain text format'],
      ['src/assets/shell/flow-canvas.js', 'where the flowchart sheet re-derives its graph from — the word is the diagram source the code pane holds'],
      ['src/assets/shell/flow-export.js', 'the diagram export table, which is that page copy of the same list — the word is the mermaid text one of its rows writes'],
      ['src/assets/shell/flow-model.js', 'the mermaid parser: the label inside a shape and what is kept above a diagram header — the word is the characters of a label'],
      ['src/assets/shell/selection-toolbar.js', 'what a block button writes in front of a selection — the word is the selected words, not a format'],
      ['src/markdown/code.rs', 'how a highlighted run is written as one element — the word is the styled run inside a code block'],
      ['src/markdown/mod.rs', 'where a frontmatter block begins in the source — the word is the characters of that block'],
      ['src/store/frontmatter.rs', 'the quote a YAML field carried and why it goes back on — the word is how YAML says a value is not a number'],
      ['src/tests/editing.rs', 'why a data block edits as source rather than as rendered words — the word is what the Markdown path would write'],
      ['src/tests/markdown_code.rs', 'what a paragraph inside a highlighted document must arrive as — the word is an unstyled run, not a format'],
      ['src/app/tests/watch.rs', 'what a live reload draws a package as — the words are the archive member a Word file is read through and the markup inside it, not the formats the app admits'],
    ],
    read: (formatSource) => documentRows(formatSource),
  },
];

/// One of the host's export tables, read out of `src/app/fileops.rs` by name. A row's endings are either written out, asked of a format's own spellings, or asked of a named constant beside that table — which is how the export endings stay a shorter list than the app reads.
export function hostRows(fileopsSource, formatSource, constant = 'DIAGRAM_EXPORT_FORMATS') {
  const table = fileopsSource.match(new RegExp(`const ${constant}[^=]*=\\s*&\\[([\\s\\S]*?)\\n\\];`));
  if (!table) return null;
  const rows = [];
  for (const row of table[1].matchAll(/\(\s*"([^"]*)"\s*,\s*([^\n]+?)\s*\),/g)) {
    const [, label, endings] = row;
    const written = endings.match(/^&\[([^\]]*)\]$/);
    if (written) {
      rows.push([label, [...written[1].matchAll(/"([^"]*)"/g)].map((m) => m[1])]);
      continue;
    }
    const named = endings.match(/^([A-Z][A-Z0-9_]*)$/);
    if (named) {
      let spellings;
      try {
        spellings = namedExtensions(formatSource, named[1]);
      } catch {
        return null;
      }
      rows.push([label, spellings]);
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

/// The page's copy of one of those lists, read out of the fragment that draws its menu.
export function pageRows(shellSource, constant = 'DIAGRAM_EXPORTS') {
  const table = shellSource.match(new RegExp(`const ${constant} = \\[([\\s\\S]*?)\\n\\];`));
  if (!table) return null;
  const rows = [];
  for (const row of table[1].matchAll(/id:\s*'([^']*)'\s*,\s*endings:\s*\[([^\]]*)\]/g)) {
    rows.push([row[1], [...row[2].matchAll(/'([^']*)'/g)].map((m) => m[1])]);
  }
  return rows.length ? rows : null;
}

/// The document formats, off the one reader in `scripts/app-formats.mjs` — the order `ALL` lists them in, and the spellings each one answers to. That reader throws, naming what it could not find; this check says the same thing in its own sentence, so the reason travels into the message rather than out as a stack trace.
export function documentRows(formatSource) {
  try {
    return { actual: readDocumentRows(formatSource) };
  } catch (error) {
    return { actual: null, why: error.message };
  }
}

/// The recorded paths that are no longer files. `exists` answers for one path, so the rule is proved on made-up lists before the tree is opened.
export function missingProse(list, exists) {
  return list.prose.filter((path) => !exists(path));
}

/// The sweep's hits that are in neither of a list's two arrays. A file that gains a comment naming two rows has to be read once and put somewhere, so the reading list grows with the tree rather than staying whatever the last person typed.
export function unaccountedFor(list, hits) {
  const known = new Set([...list.prose, ...(list.looked || []).map(([path]) => path)]);
  return hits.filter((path) => !known.has(path));
}

/// Where a `/` in JavaScript opens a pattern rather than divides. A pattern is skipped whole because one holding a backtick — `/^[ \t]*(`{3,}|~{3,})[^\n]*\n/` in `reading-edits.js` — otherwise reads as a template string opening, and the scanner then treats the next three hundred lines of comments as string and finds none of them.
const PATTERN_MAY_START = /(?:[(,=:[!&|?{};+\-*%~^<>]|\b(?:return|typeof|case|in|of|new|do|else|void|yield|await))\s*$/;

/// The comment text on each line of a source file, string literals and JavaScript patterns taken out, returned as `[line, text]` for every line that carries any. A sweep that read the raw line would fire on a format name inside a string, which is not prose about anything.
export function commentLines(source, extension) {
  const js = extension === '.js';
  const quotes = js ? '"\'`' : '"';
  const lines = [];
  let line = 1;
  let text = '';
  let state = 'code';
  let quote = '';
  let inClass = false;
  let tail = '(';
  const keep = () => {
    if (text.trim()) lines.push([line, text]);
    text = '';
  };
  for (let i = 0; i < source.length; i += 1) {
    const here = source[i];
    const next = source[i + 1];
    if (here === '\n') {
      keep();
      line += 1;
      if (state === 'line' || state === 'pattern') state = 'code';
      if (state === 'code') tail = `${tail}\n`.slice(-24);
      continue;
    }
    if (state === 'code') {
      if (quotes.includes(here)) {
        state = 'string';
        quote = here;
      } else if (here === '/' && next === '/') {
        state = 'line';
        i += 1;
      } else if (here === '/' && next === '*') {
        state = 'block';
        i += 1;
      } else if (js && here === '/' && PATTERN_MAY_START.test(tail)) {
        state = 'pattern';
        inClass = false;
      } else {
        tail = (tail + here).slice(-24);
      }
      continue;
    }
    if (state === 'string') {
      if (here === '\\') i += 1;
      else if (here === quote) {
        state = 'code';
        tail = `${tail}x`.slice(-24);
      }
      continue;
    }
    if (state === 'pattern') {
      if (here === '\\') i += 1;
      else if (here === '[') inClass = true;
      else if (here === ']') inClass = false;
      else if (here === '/' && !inClass) {
        state = 'code';
        tail = `${tail}x`.slice(-24);
      }
      continue;
    }
    if (state === 'block' && here === '*' && next === '/') {
      state = 'code';
      i += 1;
      continue;
    }
    text += here;
  }
  keep();
  return lines;
}

/// The words that name one row: its endings and the first word of its label, lowercased. Anything shorter than three letters is dropped — `md` lands in the middle of prose that has nothing to do with a format.
export function rowWords(rows) {
  return rows.map(([label, endings]) => [
    ...new Set([label.split(/\s+/)[0].toLowerCase(), ...endings.map((ending) => ending.toLowerCase())]),
  ].filter((word) => word.length > 2));
}

/// Whether one comment line names two or more different rows, each by whole word. Two spellings of one row are one row: `yaml` beside `yml` is a comment about YAML, not about two formats.
export function namesTwoRows(text, words) {
  let named = 0;
  for (const row of words) {
    if (row.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(text))) named += 1;
    if (named > 1) return true;
  }
  return false;
}

/// Every file whose comments name two or more of a list's rows on one line — the candidates to read, never the reading list itself. `files` is `[path, source]` pairs; the list's own `source` file is dropped, because the check already reads that one as the table and a row moving there is what makes it fail in the first place.
export function sweep(files, rows, source) {
  const words = rowWords(rows);
  return files
    .filter(([path]) => path !== source)
    .filter(([path, text]) =>
      commentLines(text, path.endsWith('.rs') ? '.rs' : '.js').some(([, comment]) => namesTwoRows(comment, words))
    )
    .map(([path]) => path);
}

/// Every `.rs` and `.js` under `src/`, minus `src/assets/vendor/` — compiled bundles nobody writes, which carry the format words for ever and are not prose. Read once and handed to each list's sweep.
function sourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (path !== 'src/assets/vendor') walk(path);
      } else if (path.endsWith('.rs') || path.endsWith('.js')) {
        files.push([path, read(path)]);
      }
    }
  };
  walk('src');
  return files;
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
  for (const { list, actual, why, page, missing, unaccounted } of readings) {
    for (const path of missing || []) {
      found.push(`${list.source} — the reading list for ${list.name} names ${path}, and there is no such file. A recorded path that has been renamed or deleted hands the next reader a name and nothing to open`);
    }
    for (const path of unaccounted || []) {
      found.push(`${path} — a comment there names two or more of ${list.name}, and scripts/check-format-prose.mjs neither lists it nor writes it off. Read it once: if it describes the list, it belongs in that list's \`prose\`; if the format words are there for another reason, it belongs in \`looked\` with the one-line reason`);
    }
    if (!actual) {
      found.push(`${list.source} — ${list.what} could not be read at all, so nothing was held${why ? `: ${why}` : ''}. The parser that reads it has stopped matching the table it was written for`);
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
      found.push(`${list.pageSource} — the page's copy of ${list.name} could not be read at all, so it was held to nothing`);
      continue;
    }
    const hostEndings = actual.map(([, endings]) => endings.join(','));
    const pageEndings = page.map(([, endings]) => endings.join(','));
    if (hostEndings.join(' | ') !== pageEndings.join(' | ')) {
      found.push(`the page's copy of ${list.name} is not the host's: the Mac menu is drawn from one and the save window from the other, so a row in one and not the other is a format a reader can pick and not save, or save and never see offered.`);
      found.push(`  ${list.source}: ${hostEndings.join(' | ')}`);
      found.push(`  ${list.pageSource}: ${pageEndings.join(' | ')}`);
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
  looked: [['f.rs', 'a made-up reason']],
  pageSource: 'a.js',
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
  ['a table that cannot be read at all, with the reader\'s own reason carried through',
    [{ list: FIXTURE, actual: null, why: 'could not find `DocumentFormat::ALL` in src/format.rs' }], 1],

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

  ['every recorded path is a file that is there',
    [{ list: FIXTURE, missing: [], actual: [['Markdown', ['md', 'markdown']], ['PNG image', ['png']]] }], 0],
  ['a recorded path that is gone, on a list that otherwise agrees',
    [{ list: FIXTURE, missing: ['b.rs'], actual: [['Markdown', ['md', 'markdown']], ['PNG image', ['png']]] }], 1],
  ['both recorded paths gone at once',
    [{ list: SECOND, missing: ['d.rs', 'e.rs'], actual: [['Json', ['json']], ['Yaml', ['yaml', 'yml']]] }], 2],
  ['a recorded path gone and the table moved under it',
    [{ list: FIXTURE, missing: ['b.rs'], actual: [['Markdown', ['md', 'markdown']]] }], 6],

  ['a sweep hit that the reading list already names',
    [{ list: FIXTURE, unaccounted: unaccountedFor(FIXTURE, ['b.rs']), actual: [['Markdown', ['md', 'markdown']], ['PNG image', ['png']]] }], 0],
  ['a sweep hit that is written off with a reason',
    [{ list: FIXTURE, unaccounted: unaccountedFor(FIXTURE, ['f.rs']), actual: [['Markdown', ['md', 'markdown']], ['PNG image', ['png']]] }], 0],
  ['a sweep hit in neither array',
    [{ list: FIXTURE, unaccounted: unaccountedFor(FIXTURE, ['b.rs', 'f.rs', 'g.rs']), actual: [['Markdown', ['md', 'markdown']], ['PNG image', ['png']]] }], 1],
  ['two sweep hits in neither array, on a list with nothing written off',
    [{ list: SECOND, unaccounted: unaccountedFor(SECOND, ['d.rs', 'g.rs', 'h.rs']), actual: [['Json', ['json']], ['Yaml', ['yaml', 'yml']]] }], 2],
];

/// The rows the sweep is proved against — the document formats, whose row names are the words themselves.
const SWEEP_ROWS = [
  ['Markdown', ['md', 'markdown', 'mdown']],
  ['Xml', ['xml']],
  ['Json', ['json']],
  ['Yaml', ['yaml', 'yml']],
];

const SWEEP_CASES = [
  ['a comment naming two rows', 'a.rs', '// Markdown and JSON are both read here.', true],
  ['a comment naming one row twice', 'b.rs', '/// Markdown, and the markdown spellings beside it.', false],
  ['two rows split over two comment lines, one each', 'c.rs', '// Markdown here.\n// JSON there.', false],
  ['two rows on one line of a block comment', 'd.rs', 'fn a() {}\n/* Opening line.\n   Markdown and XML together.\n*/', true],
  ['a block comment naming one row per line', 'd2.rs', 'fn a() {}\n/* Markdown here.\n   XML there.\n*/', false],
  ['two rows inside a string rather than a comment', 'e.rs', 'let hint = "markdown and json";', false],
  ['two rows inside longer words', 'f.rs', '// A jsonl file and an xmlns attribute.', false],
  ['a file with no comments at all', 'g.rs', 'fn markdown_and_json() {}', false],
  ['two rows in a comment after a string on the same line', 'h.rs', 'let hint = "nothing"; // Markdown and YAML.', true],
  ['a page fragment naming two rows', 'i.js', "const a = 'json'; // both YAML and Markdown arrive here", true],
  ['a page fragment whose two rows are in a template string', 'j.js', 'const a = `markdown and json`;', false],
  ['two spellings of one row are one row', 'k.rs', '// Both yaml and yml land on the same reader.', false],
  ['a comment after a pattern holding a backtick', 'l.js', 'const fence = /^(`{3,})/.exec(s);\n// Markdown and XML both come through here.', true],
  ['a comment after a division sign', 'm.js', 'const half = width / 2;\n// Markdown and XML both come through here.', true],
];

const testFails = [];
for (const [name, readings, want] of CASES) {
  const got = problems(readings).length;
  if (got !== want) testFails.push(`${name}: ${got} lines, wanted ${want}`);
}
for (const [name, path, source, want] of SWEEP_CASES) {
  const got = sweep([[path, source]], SWEEP_ROWS, 'the-table.rs').length === 1;
  if (got !== want) testFails.push(`the sweep on ${name}: ${got ? 'found it' : 'missed it'}`);
}
if (sweep([['the-table.rs', '// Markdown and JSON are both read here.']], SWEEP_ROWS, 'the-table.rs').length) {
  testFails.push("the sweep on a list's own source file: found it, and that file is the table this check already reads");
}
if (testFails.length) {
  console.error('format prose: the rules are wrong, so nothing was read:');
  for (const line of testFails) console.error(`  ${line}`);
  process.exit(1);
}

const formatSource = read('src/format.rs');
const onDisk = (path) => existsSync(join(root, path));
const tree = sourceFiles();
const readings = LISTS.map((list) => ({
  list,
  missing: missingProse(list, onDisk),
  unaccounted: unaccountedFor(list, sweep(tree, list.rows, list.source)),
  ...list.read(formatSource),
}));

const found = problems(readings);
if (found.length) {
  console.error('a format list has moved, and the prose describing it has not been read:');
  for (const line of found) console.error(`  ${line}`);
  console.error('This check cannot tell whether a comment is right. It can only make sure somebody looks, which is the step that was skipped the last two times a row landed.');
  process.exit(1);
}

const rows = readings.reduce((n, { actual }) => n + (actual ? actual.length : 0), 0);
const listed = LISTS.reduce((n, list) => n + list.prose.length + (list.looked || []).length, 0);
console.log(`format prose: ok (${LISTS.length} lists, ${rows} rows recorded, the page's copy is the host's, and ${listed} files across ${tree.length} swept either carry the prose or say why they do not — a comment naming one row or none is still nobody's to find)`);
