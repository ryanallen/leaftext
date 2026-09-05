// A highlight extended past the words already highlighted: one `<mark>` in the file, in one even wash, that the next press takes back off.
//
// `tidyMarks` is called on the clone the press built, so the check calls it on a clone directly and needs no selection at all — the stand's fake range refuses a selection whose two ends sit in different holders, which is exactly the range this press makes.

import { check, record } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // A paragraph spelled the way the clone is spelled, tidied, and read back the way the press reads it.
  const tidied = (markup) => {
    const block = booted.document.createElement('p');
    block.dataset.blockKind = 'paragraph';
    block.innerHTML = markup;
    booted.tidyMarks(block);
    return booted.blockDomToMarkdown(block);
  };

  check('a highlight running out of a mark is written as one mark', () => {
    // What one press writes today: the uncovered half, then the new mark with the old one nested inside it, so the overlap paints twice.
    const nested = tidied('A <mark>mar</mark><mark><mark>ked</mark> pass</mark>age here.');
    if (nested !== 'A <mark>marked pass</mark>age here.') throw new Error('a nested mark was written as ' + JSON.stringify(nested));

    // What a second press over that run writes today: six marks, two of them empty, and two coats over every word.
    const sixfold = tidied('A <mark></mark><mark><mark>mar</mark><mark>ked pass</mark></mark><mark></mark>age here.');
    if (sixfold !== 'A <mark>marked pass</mark>age here.') throw new Error('the six-mark spelling was written as ' + JSON.stringify(sixfold));
  });

  check('a document the reader spelled themselves comes back through the tidy unchanged', () => {
    // One mark on its own; two marks with words between them, which are two highlights and not one; and two marks in different holders, where merging would move words in or out of the bold.
    const SPELLINGS = ['A <mark>marked passage</mark> here.', 'A <mark>one</mark> and <mark>two</mark> here.', 'A **<mark>bo</mark>**<mark>ld</mark> word.'];
    for (const spelling of SPELLINGS) {
      const out = tidied(spelling);
      if (out !== spelling) throw new Error(JSON.stringify(spelling) + ' came back as ' + JSON.stringify(out));
    }
  });
}
