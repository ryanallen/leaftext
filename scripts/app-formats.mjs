#!/usr/bin/env node
// What the app reads, for the checks that need to know it in Node.
//
//   node scripts/app-formats.mjs --check   prove the reader on made-up tables (`just verify`)
//
// `src/format.rs` is the only table of readable formats and their extensions, so a check that wants them asks here rather than writing a second list beside it. **One reader, not one per caller**: two regexes over that one function answered differently on three made-up tables out of five — one keeping a spelling written inside a comment, one answering seven spellings of ten without a word.
//
// **The floor is the variant list, never a number.** `DocumentFormat::ALL` names what has to be answered for, so a variant with no arm is a throw naming that variant rather than a shorter answer nobody notices. A count is a second list, kept in step by hand.
//
// **The reading is cut at the front, never at the back.** Where the arms end is a guess about indentation; where they begin is `fn extensions(self)`, which is written down. So each variant's arm is the first `Self::<variant> => &[…]` after that point, cut at its own closing bracket.
//
// **A spelling is anything between quotes inside that array.** Scoped to one arm the wide class costs nothing — there is no prose inside `&["md", "markdown"]` to catch — and it keeps a spelling a word-characters-only class drops. Swept over the whole block instead, the same class picks up a spelling quoted in a comment beside the arms and counts it as a format.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every document format in `ALL` order, as `[variant, spellings]`, off the text of `src/format.rs`. Throws, naming what it could not find, rather than answering with less than the table holds. */
export function documentRows(source) {
  const all = /const ALL: \[Self; (\d+)\] = \[([^\]]*)\]/.exec(source);
  if (!all) throw new Error('could not find `DocumentFormat::ALL` in src/format.rs');
  const variants = [...all[2].matchAll(/Self::(\w+)/g)].map((one) => one[1]);
  if (!variants.length) throw new Error('`DocumentFormat::ALL` names no variants');
  if (variants.length !== Number(all[1])) {
    throw new Error(`\`DocumentFormat::ALL\` is written [Self; ${all[1]}] and names ${variants.length} variants`);
  }
  const at = source.indexOf('fn extensions(self)');
  if (at < 0) throw new Error('could not find `fn extensions(self)` in src/format.rs');
  const arms = source.slice(at);
  return variants.map((variant) => {
    const arm = new RegExp(`Self::${variant}\\s*=>\\s*&\\[([^\\]]*)\\]`).exec(arms);
    if (!arm) throw new Error(`\`DocumentFormat::ALL\` names ${variant} and no \`Self::${variant} => &[…]\` arm answers for it`);
    const spellings = [...arm[1].matchAll(/"([^"]*)"/g)].map((one) => one[1]);
    if (!spellings.length) throw new Error(`the ${variant} arm names no extension`);
    if (spellings.some((one) => !one)) throw new Error(`the ${variant} arm holds an empty extension`);
    return [variant, spellings];
  });
}

/** The spellings of one named format, or `null` where the table could not be read. The diagram export table takes Markdown's spellings from here rather than restating them. */
export function documentExtensions(source, variant) {
  let rows;
  try {
    rows = documentRows(source);
  } catch {
    return null;
  }
  const row = rows.find(([name]) => name === variant);
  return row ? row[1] : null;
}

/** Every extension the app reads, in format order, off `src/format.rs`. */
export function appExtensions(root) {
  return documentRows(readFileSync(join(root, 'src/format.rs'), 'utf8')).flatMap(([, spellings]) => spellings);
}

const WELL_FORMED = `
impl DocumentFormat {
    pub const ALL: [Self; 3] = [Self::Markdown, Self::Xml, Self::Eml];

    pub const fn extensions(self) -> &'static [&'static str] {
        match self {
            Self::Markdown => &["md", "markdown"],
            Self::Xml => &["xml"],
            // The long spelling is "mhtml", and "mht" is the short one.
            Self::Eml => &["eml", "mht"],
        }
    }

    pub fn language_token(self) -> &'static str {
        match self {
            Self::Markdown => "markdown",
            Self::Xml => "xml",
            Self::Eml => "email",
        }
    }
}
`;

const spell = (rows) => rows.map(([variant, endings]) => `${variant}(${endings.join(' ')})`).join(' ');

/// What the reader has to answer and what it has to refuse, on made-up tables rather than on the tree's — a reader proved only against the file it reads passes on the day that file moves. A row is `[name, source, want]` for an answer spelled out, and `[name, source, words, 'refuses']` for a refusal that has to carry those words.
const CASES = [
  ['a well-formed table, with a spelling quoted in a comment beside the arms', WELL_FORMED, 'Markdown(md markdown) Xml(xml) Eml(eml mht)'],
  ['a spelling carrying a character outside a word', WELL_FORMED.replace('"eml", "mht"', '"eml", "mht", "mail.txt"'), 'Markdown(md markdown) Xml(xml) Eml(eml mht mail.txt)'],
  ['an arm written with a block body, a shape this reader does not read and refuses out loud', WELL_FORMED.replace('Self::Xml => &["xml"],', 'Self::Xml => {\n                &["xml"]\n            }'), 'names Xml and no `Self::Xml => &[…]` arm', 'refuses'],
  ['a table with no `ALL` at all', WELL_FORMED.replace(/pub const ALL[^\n]*\n/, ''), 'could not find `DocumentFormat::ALL`', 'refuses'],
  ['an `ALL` naming no variants', WELL_FORMED.replace(/\[Self::Markdown[^\]]*\]/, '[]'), 'names no variants', 'refuses'],
  ['an `ALL` whose length is not the variants it names', WELL_FORMED.replace('[Self; 3]', '[Self; 4]'), 'is written [Self; 4] and names 3 variants', 'refuses'],
  ['a variant `ALL` names with no arm to answer for it', WELL_FORMED.replace('Self::Xml => &["xml"],', ''), 'names Xml and no `Self::Xml => &[…]` arm', 'refuses'],
  ['an arm holding no extension', WELL_FORMED.replace('&["xml"]', '&[]'), 'the Xml arm names no extension', 'refuses'],
  ['an arm holding an empty extension', WELL_FORMED.replace('&["xml"]', '&["xml", ""]'), 'the Xml arm holds an empty extension', 'refuses'],
  ['a file with no extensions function', WELL_FORMED.replace('fn extensions(self)', 'fn endings(self)'), 'could not find `fn extensions(self)`', 'refuses'],
];

/** What is wrong with the reader, on the made-up tables above. Empty when every one of them is answered or refused the way it has to be. */
export function selfTest() {
  const failed = [];
  for (const [name, source, want, how] of CASES) {
    const refusal = how === 'refuses';
    let got;
    try {
      got = spell(documentRows(source));
      if (refusal) failed.push(`${name}: answered ${got} where it had to refuse, naming ${JSON.stringify(want)}`);
      else if (got !== want) failed.push(`${name}: answered ${got}, wanted ${want}`);
    } catch (error) {
      if (!refusal) failed.push(`${name}: refused with ${JSON.stringify(error.message)} where it had to answer ${want}`);
      else if (!error.message.includes(want)) failed.push(`${name}: refused with ${JSON.stringify(error.message)}, which does not name ${JSON.stringify(want)}`);
    }
  }
  return failed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  const failed = selfTest();
  if (failed.length) {
    console.error('app formats: the reader is wrong, so nothing the checks read off it is held:');
    for (const line of failed) console.error(`  ${line}`);
    process.exit(1);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const rows = documentRows(readFileSync(join(root, 'src/format.rs'), 'utf8'));
  console.log(`app formats: ok (${CASES.length} made-up tables answered or refused, and src/format.rs reads as ${spell(rows)})`);
}
