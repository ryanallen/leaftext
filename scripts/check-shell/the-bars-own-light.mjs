// The format bar's lit buttons: whether the bar is telling somebody what the highlighted words already are.
//
// Its own file rather than `format-bar.mjs`, which is within a few dozen lines of the hand-written ceiling and grows every time the bar does. The stand both files float the bar with lives in `stands.mjs`, because a subject file never imports another one.

import { check, formatBarStand, record } from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;
  const { barOverSelection } = formatBarStand(booted);

  // A line carrying all five formats and plain words at either end, so a highlight can be stood inside any of them or outside all of them without a second block.
  const EVERY_FORMAT = 'this line has <strong>bold words</strong> and <em>leaning words</em> and <del>struck words</del> and <code>coded words</code> and a <a href="https://example.com">linked phrase</a> and some plain words.';
  // Which button each wrapper is supposed to light, read the way the page's own list pairs them.
  const WRAPPERS = [['strong', 'bold'], ['em', 'italic'], ['del', 'strike'], ['code', 'code'], ['a', 'link']];

  check('a highlight wholly inside a format lights that button and no other', () => {
    for (const [tag, id] of WRAPPERS) {
      const stand = barOverSelection({ unlocked: true, markup: EVERY_FORMAT, startIn: tag, words: 'the words' });
      if (stand.lit.join(',') !== id) throw new Error('a highlight inside <' + tag + '> lit ' + JSON.stringify(stand.lit) + ' rather than just ' + id);
    }
  });

  // The other arm. A block somebody has clicked into is an editing host, and the browser answers for bold, italic and strikethrough before the markup is walked; before that click it answers false and the tag is what lights the button. Code and link have no command at all and are answered by the tag either side of it.
  check('the browser’s own answer lights a button the markup would not have', () => {
    const stand = barOverSelection({ unlocked: true, markup: EVERY_FORMAT, startIn: null, commandState: { bold: true }, words: 'this line has' });
    if (!stand.lit.includes('bold')) throw new Error('the engine said the highlight was bold and the bar lit ' + JSON.stringify(stand.lit));
    if (stand.lit.join(',') !== 'bold') throw new Error('one command answering lit ' + JSON.stringify(stand.lit) + ' rather than bold alone');
  });

  check('a highlight in plain words lights nothing, which is what says the check above read the engine and not the page', () => {
    const refused = barOverSelection({ unlocked: true, markup: EVERY_FORMAT, startIn: null, commandState: { bold: false, italic: false, strikeThrough: false }, words: 'this line has' });
    if (refused.lit.length) throw new Error('plain words with the engine refusing lit ' + JSON.stringify(refused.lit));
    const silent = barOverSelection({ unlocked: true, markup: EVERY_FORMAT, startIn: null, words: 'this line has' });
    if (silent.lit.length) throw new Error('plain words with no engine at all lit ' + JSON.stringify(silent.lit));
  });

  check('a locked page lights nothing even where the words carry the format', () => {
    for (const [tag] of WRAPPERS) {
      const locked = barOverSelection({ unlocked: false, markup: EVERY_FORMAT, startIn: tag, commandState: { bold: true, italic: true, strikeThrough: true } });
      if (locked.lit.length) throw new Error('a locked page lit ' + JSON.stringify(locked.lit) + ' over a highlight inside <' + tag + '>');
      if (locked.showing.includes('bold')) throw new Error('a locked page showed the inline buttons at all');
    }
  });

  check('the light goes out again when the highlight moves off the format', () => {
    const on = barOverSelection({ unlocked: true, markup: EVERY_FORMAT, startIn: 'strong' });
    if (on.lit.join(',') !== 'bold') throw new Error('the highlight inside <strong> lit ' + JSON.stringify(on.lit));
    const off = barOverSelection({ unlocked: true, markup: EVERY_FORMAT, startIn: null });
    if (off.lit.length) throw new Error('the light stayed on ' + JSON.stringify(off.lit) + ' once the highlight moved into plain words');
  });

  // ---- the light answers the whole phrase ----------------------------------
  //
  // The light answers the whole phrase, not the end the drag began at. A highlight from inside `bold words` into the plain run after it is not bold, and neither is the same phrase taken the other way round — a lit button there invites a removal and applies the format.

  check('a highlight running out of a format lights nothing, whichever end it started at', () => {
    const outward = barOverSelection({ unlocked: true, markup: EVERY_FORMAT, startIn: 'strong', endIn: null, words: 'bold words and' });
    if (outward.lit.length) throw new Error('a highlight from inside <strong> into the plain words after it lit ' + JSON.stringify(outward.lit));
    const inward = barOverSelection({ unlocked: true, markup: EVERY_FORMAT, startIn: null, endIn: 'strong', words: 'has bold' });
    if (inward.lit.length) throw new Error('the same words taken from the other end lit ' + JSON.stringify(inward.lit));
  });

  check('a highlight spanning two runs of one format lights nothing, since the words between them carry it and the ones outside do not', () => {
    const twoRuns = 'a <strong>first run</strong> and then a <strong>second run</strong> after it.';
    const across = barOverSelection({ unlocked: true, markup: twoRuns, startIn: 'strong', endIn: { tag: 'strong', nth: 1 }, words: 'first run and then a second run' });
    if (across.lit.length) throw new Error('a highlight across two separate <strong> runs lit ' + JSON.stringify(across.lit));
    // And the one that is genuinely inside one of them still lights, so the check above is not passing by lighting nothing ever.
    const inside = barOverSelection({ unlocked: true, markup: twoRuns, startIn: { tag: 'strong', nth: 1 }, words: 'second run' });
    if (inside.lit.join(',') !== 'bold') throw new Error('a highlight inside the second <strong> lit ' + JSON.stringify(inside.lit));
  });

  // A browser reports a double-click on a bold word as the block and two offsets, and those words are wholly bold — so the walk starts from the child the offset names rather than from the block.
  check('a highlight the browser reports as the block and two offsets still lights the wrapper it brackets', () => {
    const around = barOverSelection({ unlocked: true, markup: EVERY_FORMAT, bracket: 'strong', words: 'bold words' });
    if (around.lit.join(',') !== 'bold') throw new Error('a highlight bracketing <strong> at block level lit ' + JSON.stringify(around.lit));
  });
}
