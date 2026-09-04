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

  // The other arm. Once somebody has clicked into a block it is an editing host, and the browser answers for bold, italic and strikethrough before the markup is ever walked — watched in a running copy, where `queryCommandState('bold')` answers false in a block nobody has opened and true in one that is open. Code and link have no command at all, so they are answered by the tag on both sides of that.
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
  // Watched in a running copy before it was fixed: a highlight from the first character of `bold words` into the plain run after it lit Bold, and pressing that lit button left the block reading `<b>bold words and</b>` — the light said the words were bold and the press made more of them bold. The same words taken the other way round lit nothing, so the bar's answer turned on which end the drag started at.

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

  // Watched in a running copy: a highlight taken this way covers words that are wholly bold, and the Bold button was dark — because the walk started at the block and stopped there. A double-click on a bold word is the everyday gesture that reports itself like this.
  check('a highlight the browser reports as the block and two offsets still lights the wrapper it brackets', () => {
    const around = barOverSelection({ unlocked: true, markup: EVERY_FORMAT, bracket: 'strong', words: 'bold words' });
    if (around.lit.join(',') !== 'bold') throw new Error('a highlight bracketing <strong> at block level lit ' + JSON.stringify(around.lit));
  });
}
