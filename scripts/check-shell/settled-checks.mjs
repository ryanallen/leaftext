// The order the checks themselves run in: one awaiting check at a time against the one booted page.

import { check, checkSettled, settle } from './shared.mjs';

export function run() {
  // ---- one awaiting check at a time -------------------------------------------
  //
  // Every subject shares one booted page, so a body that pauses hands that page to whoever else was waiting. Started together, a check that opened a menu made a check three files away fail on a hover card the menu had taken down — and the check that caused it passed. What is held here is when a body runs, which nothing in the source of `collector.mjs` says, so it is held by running bodies and reading the order back rather than by reading that file.
  //
  // These three register next to each other and the queue keeps them next to each other. The synchronous one is written last on purpose: it still runs first, because a promise body cannot start until the call stack that registered it has finished.

  const ran = [];
  // The one thing two bodies would trample: a word only whoever owns the queue may hold.
  let held = 'nobody';

  checkSettled('an awaiting check keeps the page it set up across every pause in it', async () => {
    ran.push('first:start');
    if (ran[0] !== 'sync') throw new Error(`the awaiting body ran with ${JSON.stringify(ran)} behind it, so a synchronous check can be cut in half by one that waits`);
    held = 'first';
    await settle();
    await settle();
    if (held !== 'first') throw new Error(`another awaiting check took the page mid-pause and left ${JSON.stringify(held)} on it, so every check that waits is reading somebody else's setup`);
    held = 'nobody';
    ran.push('first:done');
  });

  checkSettled('the next awaiting check starts only once the one before it has put the page back', async () => {
    ran.push('second:start');
    if (held !== 'nobody') throw new Error(`this body started while ${JSON.stringify(held)} still held the page, so the queue let two checks own it at once`);
    const order = ran.join(', ');
    if (order !== 'sync, first:start, first:done, second:start') throw new Error(`the bodies ran ${order} rather than one after another, so a failure lands on whichever check was passing through`);
    held = 'second';
    await settle();
    held = 'nobody';
  });

  check('a synchronous check finishes before any awaiting body starts', () => {
    if (ran.length) throw new Error(`${JSON.stringify(ran)} ran before this call, so an awaiting body registered above started inside the run rather than after it`);
    ran.push('sync');
  });
}
