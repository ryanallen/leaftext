// The order the checks themselves run in: one awaiting check at a time against the one booted page.

import vm from 'node:vm';
import { check, checkSettled, createCollector, failures, record, settle } from './shared.mjs';

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

  // ---- the page goes back between awaiting bodies -----------------------------
  //
  // A synchronous check has always been handed the page the boot made, because the collector runs the boot's snapshot after every one. An awaiting body got nothing, so the next one started on whatever the last one left — once the queue put them in a row that became repeatable rather than random, and no easier to read, since the check that caused the failure is the one above it and passes. These two are the proof, and the first writes in three places on purpose: the page holds what it is in its tree, in the values on its root, and in its script's own top-level names, and a walk over one reaches nothing of the others.

  const asBooted = {};
  checkSettled('an awaiting check may leave the shared page anywhere it drove it', async () => {
    const surface = record.booted.document.getElementById('appSurface');
    asBooted.children = surface.children.length;
    asBooted.rail = record.booted.document.documentElement.style.getPropertyValue('--library-rail-width');
    asBooted.code = vm.runInContext('codeViewActive', record.booted);

    // Across a pause, so what the next body meets is what a real awaiting check leaves rather than what a synchronous one would.
    await settle();

    const drawn = record.booted.document.createElement('div');
    drawn.className = 'left-behind-by-an-awaiting-check';
    surface.appendChild(drawn);
    record.booted.document.documentElement.style.setProperty('--library-rail-width', '999px');
    vm.runInContext(`codeViewActive = ${!asBooted.code};`, record.booted);
  });

  checkSettled('the next awaiting check reads the page the boot made, not what the one above it left', async () => {
    const surface = record.booted.document.getElementById('appSurface');
    if (surface.children.length !== asBooted.children) throw new Error('an element the awaiting check above drew was left on the page');
    const rail = record.booted.document.documentElement.style.getPropertyValue('--library-rail-width');
    if (rail !== asBooted.rail) throw new Error(`the rail width the awaiting check above wrote was left at ${JSON.stringify(rail)}`);
    if (vm.runInContext('codeViewActive', record.booted) !== asBooted.code) throw new Error('a page own value the awaiting check above wrote was left standing');
  });

  // The edge of what the hand-back reaches, and the reason a handful of put-back lines are still written by hand. The snapshot takes the names the window had at boot and puts those back; it removes none, so a name a check adds outlives it — which is why every stand-in on `mermaid` is still taken down by the check that set it. Pinned here rather than trusted, because the day the snapshot learns to delete, those lines are the ones that can go.
  checkSettled('the hand-back puts back the names the boot had and leaves a name a check added standing', async () => {
    const surroundings = 'leafCheckAddedName';
    if (surroundings in record.booted) throw new Error('the page already carries the name this check adds, so it proves nothing');
    const wasToast = record.booted.leafToast;
    record.booted.leafToast = () => {};
    record.booted[surroundings] = 'left behind';

    await settle();

    record.restore();
    if (record.booted.leafToast !== wasToast) throw new Error('a name the boot had was not put back');
    if (record.booted[surroundings] !== 'left behind') throw new Error('the hand-back removed a name a check added, so the put-back lines written for that case can go');
    delete record.booted[surroundings];
  });

  checkSettled('a failed awaiting check does not lend its fault to the checks after it', async () => {
    const isolated = createCollector();
    const runFailures = failures.length;
    const isolatedRan = [];

    isolated.checkSettled('first', () => {
      isolatedRan.push('first');
      throw new Error('the real fault');
    });
    isolated.checkSettled('second', () => {
      isolatedRan.push('second');
      throw new Error('the second fault');
    });
    isolated.checkSettled('third', () => isolatedRan.push('third'));

    await Promise.all(isolated.settled);
    const order = isolatedRan.join(', ');
    if (order !== 'first, second, third') throw new Error(`the isolated bodies ran ${order}, so a failed body stopped the queue behind it`);
    const reported = isolated.failures.join(', ');
    if (reported !== 'first: the real fault, second: the second fault') throw new Error(`the isolated collector reported ${reported}, so a fault landed under the wrong check name`);
    if (failures.length !== runFailures) throw new Error('an isolated collector added its deliberate failure to the run report');
  });
}
