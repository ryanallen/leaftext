// The script parses, the page boots, and the boot fills the record every other subject reads.

import { join } from 'node:path';
import vm from 'node:vm';
import {
  check,
  fakeElement,
  fakePage,
  node,
  pageSnapshot,
  record,
  registrationsOn,
  root,
  runShell,
  selectorParts,
  source,
  topLevelNames,
  writeOnlyNames,
} from './shared.mjs';

export function run() {

  // ---- 1. it parses -----------------------------------------------------------

  check('the page parses', () => {
    new vm.Script(source, { filename: 'app-shell.js' });
  });

  // ---- 1a. nothing is written and never read ----------------------------------
  //
  // A top-level value the page writes and nobody reads is worse than no value at all: whoever opens the fragment has to prove the thing does not matter before they may touch the line, and whoever moves the code has to keep it right for a reader that does not exist. Two shipped at once — the point a flowchart menu was opened at, and a cached handle to the link row on the selection bar — which is what makes it a class rather than a slip. There is no allow-list: a binding named here is read by name, or it comes out.
  //
  // The planted source comes first because a scanner that finds nothing because it is broken passes exactly like one that finds nothing because the tree is clean.

  check('no value the page declares is written and never read', () => {
    const planted = [
      'let readAndWritten = 0;',
      'let onlyWritten = null;',
      'let countedUp = 0;',
      'let itself = 1;',
      'function drive() {',
      '  readAndWritten = 1;',
      '  onlyWritten = { x: 0 };',
      '  countedUp = 0;',
      '  countedUp += 1;',
      '  itself = itself + 1;',
      '  return readAndWritten;',
      '}',
    ].join('\n');
    const plantedFound = writeOnlyNames(planted);
    if (!plantedFound.includes('onlyWritten')) throw new Error('this scan missed a value written and never read');
    if (plantedFound.length !== 1) throw new Error(`this scan named ${plantedFound.join(', ')} — a compound assignment and a self-referring one both read the value`);

    const dead = writeOnlyNames(source);
    if (dead.length) throw new Error(`${dead.join(', ')} is written and never read — read it by name, or take it out`);
  });

  // ---- 2. it boots ------------------------------------------------------------

  check('the page boots', () => {
    record.booted = runShell(source);
  });
  // From here every check is handed the page the boot made, whatever the check before it did to it.
  const booted = record.booted;
  if (booted) record.restore = pageSnapshot(booted, source);

  // ---- 2a. the page is handed back the way it was found -----------------------
  //
  // The page boots once and every check after it reads the same one, so without the hand-back a check that drives the app — opens the pane, folds the bar, switches a view — leaves the next check standing in whatever it left behind, failing on something it never names: the rail check opened the library pane and took two app-bar checks two hundred lines below it with it. These two are the proof the hand-back happens, and they are a pair because the page holds what it is in two places, its tree and its own values, and a walk over one reaches nothing of the other.

  check('a check that drives the shared page leaves the next one reading the page the boot made', () => {
    const shell = booted.document.getElementById('libraryShell');
    const surface = booted.document.getElementById('appSurface');
    const closed = shell.classList.contains('library-closed');
    const wasChildren = surface.children.length;
    const wasRail = booted.document.documentElement.style.getPropertyValue('--library-rail-width');

    // The gesture that found this: opening the pane refits the bar around it and leaves a rail width on the page.
    shell.clientWidth = 1280;
    booted.toggleLibrary();
    const drawn = booted.document.createElement('div');
    drawn.className = 'left-behind';
    surface.appendChild(drawn);
    booted.document.documentElement.style.setProperty('--library-rail-width', '999px');

    // Put back by the harness, not by this check: what is read here is the state the *next* check would meet, so the restore is run rather than waited for.
    record.restore();

    if (shell.classList.contains('library-closed') !== closed) throw new Error('the pane was left standing in the state a check put it in');
    if (surface.children.length !== wasChildren) throw new Error('an element a check drew was left on the page');
    if (booted.document.documentElement.style.getPropertyValue('--library-rail-width') !== wasRail) throw new Error('a custom property a check wrote was left on the page');
  });

  check('a check that writes one of the page own values leaves the next one reading the value the boot left', () => {
    const read = (name) => vm.runInContext(name, booted);
    // Two of the page's own top-level values, neither of which any element holds: one the app bar reads on every refit, and one the reader's own state.
    const wasChevron = read('overflowChevronUp');
    const wasCode = read('codeViewActive');
    vm.runInContext('overflowChevronUp = true; codeViewActive = true;', booted);

    record.restore();

    if (read('overflowChevronUp') !== wasChevron) throw new Error('a value a check wrote was left standing');
    if (read('codeViewActive') !== wasCode) throw new Error('a second value a check wrote was left standing');
    // And the list is scanned rather than written down, so a value added to a fragment next week is covered without anybody being told.
    const scanned = topLevelNames(source);
    if (!scanned.includes('overflowChevronUp') || !scanned.includes('codeViewActive')) throw new Error('the scan of the page own values missed one the fragments declare');
    if (scanned.length < 200) throw new Error(`the scan found only ${scanned.length} of the page own values`);
  });

  check('a check that arms a handler or queues a frame leaves neither standing for the next one', () => {
    const button = booted.document.getElementById('openButton');
    const wasOnButton = (button.listeners.get('click') || []).length;
    const wasOnWindow = (booted.__windowListeners.get('resize') || []).length;
    const wasWatchers = booted.__watchers.length;
    const wasWaiting = booted.__frames.waiting();

    let fired = 0;
    button.addEventListener('click', () => (fired += 1));
    booted.window.addEventListener('resize', () => (fired += 1));
    new booted.ResizeObserver(() => (fired += 1)).observe(button, {});
    booted.requestAnimationFrame(() => (fired += 1));

    record.restore();

    if ((button.listeners.get('click') || []).length !== wasOnButton) throw new Error('a handler armed on an element was left standing');
    if ((booted.__windowListeners.get('resize') || []).length !== wasOnWindow) throw new Error('a handler armed on the window was left standing');
    if (booted.__watchers.length !== wasWatchers) throw new Error('a watcher a check registered was left standing');
    if (booted.__frames.waiting() !== wasWaiting) throw new Error('a frame a check queued was left waiting for the next one');

    // And nothing the check armed runs afterwards, which is the whole of what a left-behind handler costs.
    (button.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
    booted.__frames.drain();
    if (fired) throw new Error(`${fired} of the handlers a check armed ran after the page was handed back`);
  });

  // ---- 2b. an update that did not install says so at boot ---------------------
  //
  // The host reads the applier's verdict before the event loop starts, so it arrives as a seeded flag rather than a message. Read off the drawn toast rather than off the flag: what makes a failed install invisible is that the old build comes back looking like a new one, and only the sentence carries the version still running.

  /** Every growl standing on the app surface after a boot seeded with `extras`. */
  function bootGrowls(extras) {
    const context = runShell(source, extras);
    const surface = context.document.getElementById('appSurface');
    return surface.children.filter((child) => String(child.className || '').includes('app-toast'));
  }

  check('a failed install growls once at boot, carrying all three parts', () => {
    const growls = bootGrowls({
      __leafUpdateFailed: { version: '1.14.13', message: 'Leaftext was still open, so nothing was changed' },
      __leafVersion: '1.14.12',
    });
    if (growls.length !== 1) throw new Error(`expected one growl, got ${growls.length}`);
    const said = String(growls[0].textContent);
    for (const part of ['v1.14.13', 'Leaftext was still open', 'still on v1.14.12']) {
      if (!said.includes(part)) throw new Error(`the growl lost "${part}": ${said}`);
    }
    if (!growls[0].className.includes('is-error')) throw new Error(`a failure drew the quiet growl: ${growls[0].className}`);
  });

  check('a malformed staging path never draws a bare v', () => {
    const [growl] = bootGrowls({ __leafUpdateFailed: { version: '', message: 'no staged update to apply' }, __leafVersion: '1.14.12' });
    if (!growl) throw new Error('a failure with no version said nothing at all');
    if (/\bv\b|v:/.test(String(growl.textContent).replace(/v1\.14\.12/g, ''))) {
      throw new Error(`a bare v reached the page: ${growl.textContent}`);
    }
  });

  check('a launch after an install that worked growls nothing', () => {
    if (bootGrowls({ __leafUpdateFailed: null }).length !== 0) throw new Error('a null flag still growled');
  });

  // ---- 2c. a theme change runs the sweep it registered ------------------------
  //
  // The picker, the system's own light/dark switch and the resolution at startup all reach the page as the theme attribute changing on the root element, so one sweep answers all three — and a name retired out of it throws on every one of them. Fired here rather than read as text: running it catches any retired name in the sweep, including the ones nobody has thought of. Its own page, because the sweep empties the page-level mermaid sheet the checks below set up.

  check('a theme change runs the sweep to its end', () => {
    const context = runShell(source);
    const root = context.document.documentElement;
    const sweeps = context.__watchers.filter(
      (one) => one.target === root && (one.options.attributeFilter || []).includes('data-theme'),
    );
    if (sweeps.length === 0) throw new Error('nothing watches the theme attribute on the root element');
    root.dataset.theme = 'forest';
    root.dataset.leafTheme = 'forest';
    for (const sweep of sweeps) sweep.callback([{ type: 'attributes', attributeName: 'data-theme', target: root }]);
  });

  // ---- 2d. every watcher the page registers is held -------------------------
  //
  // A registration nothing keeps is a callback no check can ever run, and a callback no check runs is where a name retired out of the page sits throwing at a reader. So the record is what a boot registered, by element, and a watcher that stops being registered fails here rather than in somebody's window.

  /** Throws unless the record holds exactly the registrations `wanted` names, one each. */
  function holdsRegistrations(watchers, wanted) {
    for (const [name, kind, target] of wanted) {
      const held = registrationsOn(watchers, kind, target);
      if (held.length !== 1) throw new Error(`${name}: expected one registration, the record holds ${held.length}`);
    }
    if (watchers.length !== wanted.length) throw new Error(`the record holds ${watchers.length} registrations, not the ${wanted.length} named here`);
  }

  /** The five a bare boot makes, each top-level in its own fragment. */
  function bootRegistrations(context) {
    const { document } = context;
    return [
      ['the theme sweep', 'MutationObserver', document.documentElement],
      ['the minimap width fit', 'ResizeObserver', document.getElementById('app')],
      ['the crumb trail fit', 'ResizeObserver', document.getElementById('libraryCrumbs')],
      ['the app bar refit', 'ResizeObserver', document.getElementById('appBar')],
      ['the reader bar hold', 'ResizeObserver', document.getElementById('readerToolbar')],
    ];
  }

  check('a bare boot holds every watcher it registered, against the element it watches', () => {
    const context = runShell(source);
    const wanted = bootRegistrations(context);
    holdsRegistrations(context.__watchers, wanted);
    // The theme sweep is the one that has already shipped a fault, so its filter is read as well as its element.
    const [sweep] = registrationsOn(context.__watchers, 'MutationObserver', context.document.documentElement);
    if (!(sweep.options.attributeFilter || []).includes('data-theme')) throw new Error('the theme sweep is watching the root element without asking for the theme attribute');
    // A dropped registration has to fail rather than pass quietly, which is the whole reason the record exists.
    let dropped = false;
    try {
      holdsRegistrations(context.__watchers.filter((one) => one.target !== context.document.getElementById('appBar')), wanted);
    } catch (_) {
      dropped = true;
    }
    if (!dropped) throw new Error('the record still read as complete with a registration taken out of it');
  });

  // The other eight sit inside installers a bare boot never calls — a diagram drawn, the find bar opened, the code view under Monaco, a minimap bound, a graph scene wired. Called by name off the booted page, so a watcher moved out of one of them, or an installer that stops registering at all, fails here.

  /** Calls those installers off a booted page and answers the eight registrations they make, so the check below and the firing check share one drive. */
  function installerRegistrations(context) {
    const { document } = context;
    const appEl = document.getElementById('app');
    const body = fakeElement('documentBody');
    // One more drawing than the two picture memos hold: under that the document keeps every drawing it makes and the recycler returns before it ever makes a watcher.
    const drawn = Array.from({ length: 201 }, () => fakeElement('drawnDiagram'));
    body.querySelectorAll = (selector) => (String(selector) === 'pre.mermaid' ? drawn : []);
    const rail = fakeElement('monacoMinimapRail');
    const track = fakeElement('minimapTrack');
    const nearDiagram = fakeElement('nearDiagram');
    const farDiagram = fakeElement('farDiagram');
    const canvas = document.getElementById('readerGraphCanvas');
    const wasQuery = appEl.querySelector;
    // The fake page answers an id and one bare class; these are the two the installers reach for that it cannot, and both have to answer with the same element twice — the installers read them again on the way through.
    appEl.querySelector = (selector) => {
      const one = String(selector);
      if (one === '.document-body') return body;
      if (one === '.code-view-monaco .monaco-editor .minimap') return rail;
      return wasQuery.call(appEl, one);
    };
    try {
      context.watchMermaidDiagrams([nearDiagram]);
      context.watchMermaidForRecycling(farDiagram);
      context.watchFindRender();
      context.watchMinimapSlider();
      context.bindDocumentMinimapPreview(track);
      context.observeReaderReflow();
      context.wireGraphResize({});
    } finally {
      appEl.querySelector = wasQuery;
    }
    return [
      ['the diagram draw watch', 'IntersectionObserver', nearDiagram],
      ['the diagram recycler', 'IntersectionObserver', farDiagram],
      ['the find bar re-render watch', 'MutationObserver', appEl],
      ['the code view slider clamp', 'MutationObserver', rail],
      ['the minimap clone watch', 'MutationObserver', body],
      ['the minimap rail fit', 'ResizeObserver', track],
      ['the reader reflow watch', 'ResizeObserver', body],
      ['the graph canvas fit', 'ResizeObserver', canvas],
    ];
  }

  check('the eight installers a bare boot never calls each register their watcher', () => {
    const context = runShell(source);
    const wanted = [...bootRegistrations(context), ...installerRegistrations(context)];
    holdsRegistrations(context.__watchers, wanted);
    const [, , rail] = wanted.find(([name]) => name === 'the code view slider clamp');
    let dropped = false;
    try {
      holdsRegistrations(context.__watchers.filter((one) => one.target !== rail), wanted);
    } catch (_) {
      dropped = true;
    }
    if (!dropped) throw new Error('the record still read as complete with a registration taken out of it');
  });

  // ---- 2e. every kept callback is fired once ---------------------------------
  //
  // A kept registration is still a callback nobody has ever run, which is where a name retired out of the page sits: the theme sweep called a function deleted from the shell and passed every check while it threw at a reader on every theme change. So each one is fired once with a stand-in entry shaped for its kind, and a throw fails here naming the watcher and what it watches. A fire proves the body runs and its bare calls resolve, not every branch — the zero-size stand-ins take the early returns, and that is the shape the shipped fault had.

  /** The one entry a `kind` watcher's callback is handed, shaped the way the browser shapes it. An empty list would walk past the two diagram recyclers' whole bodies, which are loops over what they are given. */
  function standInEntry(kind, target, options) {
    if (kind === 'IntersectionObserver') return { target, isIntersecting: false, intersectionRatio: 0 };
    if (kind === 'ResizeObserver') {
      return { target, contentRect: { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }, contentBoxSize: [{ inlineSize: 0, blockSize: 0 }] };
    }
    return { type: 'attributes', attributeName: (options.attributeFilter || [])[0] || 'class', target, addedNodes: [], removedNodes: [] };
  }

  /** What to call a watched element in a failure, so the throw names something a reader can find. */
  function describeWatchTarget(target) {
    if (!target) return 'nothing';
    return target.id || String(target.className || '').trim() || String(target.tagName || 'element').toLowerCase();
  }

  /** Fires every kept callback once, rethrowing with the watcher's kind and target. */
  function fireEveryCallback(watchers) {
    for (const one of watchers) {
      try {
        one.callback([standInEntry(one.kind, one.target, one.options)], one);
      } catch (error) {
        throw new Error(`the ${one.kind} on ${describeWatchTarget(one.target)} threw when it was fired: ${(error && error.message) || error}`);
      }
    }
  }

  check('every watcher callback the page registers runs to its end when it is fired', () => {
    const context = runShell(source);
    installerRegistrations(context);
    fireEveryCallback(context.__watchers);
  });

  check('a callback naming something the page no longer defines fails, and the failure names its watcher', () => {
    const context = runShell(source);
    const target = fakeElement('retiredNameHolder');
    // Its own record rather than the page's, so this proves the wrapper and never doubles as a second reading of the check above.
    const retired = [{ kind: 'ResizeObserver', callback: () => context.thisNameWasRetiredOutOfThePage(), target, options: {} }];
    let said = '';
    try {
      fireEveryCallback(retired);
    } catch (error) {
      said = String(error.message);
    }
    if (!said) throw new Error('a callback calling a name the page does not define was fired and passed');
    for (const part of ['ResizeObserver', 'retiredNameHolder']) {
      if (!said.includes(part)) throw new Error(`the failure never named ${part}: ${said}`);
    }
  });

  // ---- 2f. one call, several children ----------------------------------------
  //
  // Three fragments build their own markup with `append` rather than a child at a time, so a stand-in page without it throws before the first line of a build — and the checks standing in its place had to read the fragment as text, which passes on a binding that is written correctly and never reached.

  check('the stand-in page takes several children in one call, and a string among them as text', () => {
    const { document } = fakePage();
    const parent = fakeElement('appendHolder');
    const first = document.createElement('div');
    const last = document.createElement('div');
    if (parent.append(first, 'between', last) !== undefined) throw new Error('append answered something; the platform answers nothing');
    if (parent.childNodes.length !== 3) throw new Error(`one call put ${parent.childNodes.length} nodes in the parent`);
    if (parent.childNodes[0] !== first || parent.childNodes[2] !== last) throw new Error('the children did not land in the order they were handed over');
    // The run of words is a node and not an element, so the element list beside it holds the two elements alone.
    if (parent.children.length !== 2 || parent.children[0] !== first || parent.children[1] !== last) throw new Error('a run of words was listed as one of the container\u2019s elements');
    // The same node createTextNode answers, so a builder mixing a string with a created node reads back as one list of children.
    const made = document.createTextNode('between');
    const written = parent.childNodes[1];
    if (written.textContent !== made.textContent || written.tagName !== undefined) {
      throw new Error('a string among the children is not the text node createTextNode answers');
    }
    // A real move, the way appendChild is one: the app-bar fold takes a button out of one container and puts it in another.
    const elsewhere = fakeElement('appendMovedTo');
    elsewhere.append(first);
    if (parent.childNodes.includes(first)) throw new Error('a child moved by append is still listed in the parent that was holding it');
    if (first.parentElement !== elsewhere) throw new Error('a child moved by append never reached the parent it was moved to');
    // The fragment the speed reader builds its words in is the same stand-in, so it takes them the same way.
    const fragment = document.createDocumentFragment();
    fragment.append(document.createElement('span'), ' ', document.createElement('span'));
    if (fragment.childNodes.length !== 3) throw new Error('the fragment the page builds in cannot take children in one call');
  });

  // ---- 2g. an emptied container is empty --------------------------------------
  //
  // A stand-in that keeps what a container was told to drop cannot tell a redraw from a doubling — and a check pressing a control the app has already taken off the screen finds it and passes.

  check('the stand-in page empties a container when its text or its markup is written', () => {
    const { document } = fakePage();
    for (const name of ['textContent', 'innerHTML']) {
      const parent = fakeElement(`emptied-${name}`);
      parent.appendChild(document.createElement('div'));
      parent.appendChild(document.createElement('div'));
      parent[name] = '';
      if (parent.children.length) throw new Error(`writing ${name} left ${parent.children.length} children standing`);
      if (parent[name] !== '') throw new Error(`${name} read back as ${JSON.stringify(parent[name])}`);
      // A nonempty write is the same write: the string is held and read back, and the children still go.
      parent.appendChild(document.createElement('div'));
      parent[name] = 'a line';
      if (parent.children.length) throw new Error(`a nonempty ${name} left the children standing`);
      if (parent[name] !== 'a line') throw new Error(`${name} read back as ${JSON.stringify(parent[name])} rather than what was written`);
    }
    // The other name is left standing on purpose: eight checks rebind it to hand-made text for a line being typed on.
    const typed = fakeElement('emptied-typed-on');
    typed.childNodes = [document.createTextNode('what was typed')];
    typed.textContent = '';
    if (typed.childNodes.length !== 1) throw new Error('emptying the text took down a childNodes a check had rebound');
    // Still one holder behind the two names, so a raw-source block reads back the bytes it was given.
    const block = fakeElement('emptied-source');
    block.innerText = '# Title\n';
    if (block.textContent !== '# Title\n' || block.innerText !== '# Title\n') throw new Error('innerText stopped mirroring the text');
    // The markup becomes children, because a panel the page drew is a panel the next line reaches back into. The text parses nothing: it is words, and eight checks rebind it to hand-made ones.
    const drawn = fakeElement('emptied-markup');
    drawn.innerHTML = '<section class="empty-state"><button type="button" class="primary-open">Choose file</button><img src="leaf.png"><p class="empty-vault-help">One folder of notes</p></section>';
    if (drawn.children.length !== 1) throw new Error(`a written panel hung ${drawn.children.length} elements off the container rather than its one section`);
    const section = drawn.children[0];
    if (section.tagName !== 'SECTION' || !section.classList.contains('empty-state')) {
      throw new Error(`the panel came back as a ${section.tagName} wearing ${JSON.stringify(section.className)}`);
    }
    // Both of the two ways the page asks for what it drew: by class and by tag, at whatever depth it landed.
    const button = section.children[0];
    if (!button || button.tagName !== 'BUTTON' || !button.classList.contains('primary-open')) throw new Error('the button the panel names was not built');
    if (button.getAttribute('type') !== 'button') throw new Error(`the button lost the attributes its markup gave it: ${JSON.stringify(button.getAttribute('type'))}`);
    // A tag that closes itself takes nothing inside it, or everything after a picture is drawn as its child.
    const picture = section.children[1];
    if (!picture || picture.tagName !== 'IMG' || picture.children.length) throw new Error('a self-closing tag was left holding what came after it');
    const help = section.children[2];
    if (!help || help.tagName !== 'P' || !help.classList.contains('empty-vault-help')) throw new Error('the line after the picture is not standing beside it');
    // A redraw replaces what was there rather than stacking a second drawing on it.
    drawn.innerHTML = '<p class="empty-subtitle"></p>';
    if (drawn.children.length !== 1 || drawn.children[0].tagName !== 'P') throw new Error('a second write left the first drawing standing');
    const words = fakeElement('emptied-words');
    words.textContent = '<div></div>';
    if (words.children.length) throw new Error('the text was parsed as markup');
  });

  // ---- 2h. a node taken out has no holder -------------------------------------
  //
  // Taking a node out of the page sets its parent to nothing, and that is how the page asks whether the thing it is closing is still standing: the diagram menu and the box its label is typed into both close that way. A stand-in keeping the old holder leaves each of those guards on one branch for ever — a check closing a menu twice proves nothing about the second close, and a guard broken the other way, so that it stops taking a live node out, passes exactly the same.

  check('the stand-in page lets the old holder go on every way of taking a child out', () => {
    const { document } = fakePage();
    const ways = {
      removeChild: (parent, child) => parent.removeChild(child),
      remove: (parent, child) => child.remove(),
      textContent: (parent) => {
        parent.textContent = '';
      },
      innerHTML: (parent) => {
        parent.innerHTML = '';
      },
    };
    for (const [name, take] of Object.entries(ways)) {
      const parent = fakeElement(`released-${name}`);
      const child = document.createElement('div');
      parent.appendChild(child);
      if (child.parentElement !== parent || child.parentNode !== parent) throw new Error(`a child appended before ${name} never named the parent holding it`);
      take(parent, child);
      if (parent.children.includes(child)) throw new Error(`${name} left the child listed in the parent`);
      if (child.parentElement !== null) throw new Error(`${name} left parentElement naming ${child.parentElement.id}`);
      if (child.parentNode !== null) throw new Error(`${name} left parentNode naming ${child.parentNode.id}`);
    }
    // A move is not a removal: the same detach runs first and the new holder is assigned straight after it, by either route in.
    const from = fakeElement('releasedMoveFrom');
    const to = fakeElement('releasedMoveTo');
    const moved = document.createElement('div');
    from.appendChild(moved);
    to.appendChild(moved);
    if (from.children.includes(moved)) throw new Error('a moved child is still listed in the parent that was holding it');
    if (moved.parentElement !== to || moved.parentNode !== to) throw new Error('a moved child does not name the parent it was moved to');
    from.prepend(moved);
    if (moved.parentElement !== from) throw new Error('a child put at the front of a parent does not name it');
    // Losing a holder is not leaving the rendered page: only remove says a node and everything under it is disconnected.
    const kept = fakeElement('releasedConnected');
    const staying = document.createElement('div');
    kept.appendChild(staying);
    kept.removeChild(staying);
    if (!staying.isConnected) throw new Error('removeChild marked a node disconnected; only remove does that');
    const emptied = fakeElement('releasedConnectedEmptied');
    const alsoStaying = document.createElement('div');
    emptied.appendChild(alsoStaying);
    emptied.textContent = '';
    if (!alsoStaying.isConnected) throw new Error('emptying the text marked a node disconnected; only remove does that');
    const going = document.createElement('div');
    const under = document.createElement('span');
    going.appendChild(under);
    fakeElement('releasedDisconnected').appendChild(going);
    going.remove();
    if (going.isConnected || under.isConnected) throw new Error('remove left the node or something under it connected');
  });

  // ---- 2i. a class query finds what the page drew -----------------------------
  //
  // A page answering only for the classes its markup declares says null for every control the app draws — a growl, a menu, a sheet, the rename box — while the thing is standing on the surface. That is the same answer as nothing being there, so code that finds an element by class cannot be checked at all, and a guard reading it takes the same branch on every run and can never be seen to be wrong.

  check('the stand-in page finds a class the page drew, and stops finding it once it goes', () => {
    // Its own boot rather than the shared one: the query reads the page as it stands, so a growl an earlier check left standing on the shared surface would let this pass with nothing drawn.
    const page = runShell(source);
    const surface = page.document.getElementById('appSurface');
    if (page.document.querySelector('.app-toast')) throw new Error('a growl was standing before one was drawn');
    page.leafToast('probe growl');
    const growl = page.document.querySelector('.app-toast');
    if (!growl) throw new Error('a growl standing on the surface is not found by its class');
    if (!surface.children.includes(growl)) throw new Error('the class query answered with something the surface is not holding');
    if (String(growl.textContent) !== 'probe growl') throw new Error(`the class query found some other element: ${growl.textContent}`);
    // The surface carries the class the walk starts at, so a walk over its children alone would answer null for this one.
    if (page.document.querySelector('.app-surface') !== surface) throw new Error('the surface is not found by its own class');
    // A class the markup declares still answers, and with the page's own element every time — two fragments asking for the same container have to get the same container.
    const lead = page.document.querySelector('.app-bar-lead');
    if (!lead || lead !== page.document.querySelector('.app-bar-lead')) throw new Error('a class the markup declares stopped answering, or answered twice with different elements');
    // Deeper than the surface's own children, which is where every drawn control that is not a growl lands.
    const nested = page.document.createElement('div');
    nested.className = 'probe-nested';
    lead.appendChild(nested);
    if (page.document.querySelector('.probe-nested') !== nested) throw new Error('a class drawn below the surface\'s own children is not found');
    // One of several classes on an element answers, the way a real class attribute does.
    nested.className = 'probe-nested probe-second';
    if (page.document.querySelector('.probe-second') !== nested) throw new Error('the second of two classes on an element is not found');
    // Marked gone by hand while still listed in its holder, which is how several checks retire a line: refused, the same as an id taken out of the page is.
    nested.isConnected = false;
    if (page.document.querySelector('.probe-nested')) throw new Error('an element marked gone is still found by its class');
    nested.isConnected = true;
    growl.remove();
    nested.remove();
    if (page.document.querySelector('.app-toast')) throw new Error('a growl taken out of the page is still found by its class');
    if (page.document.querySelector('.probe-nested')) throw new Error('an element taken out of the page is still found by its class');
  });

  // ---- 2j. an element answers about its own children --------------------------
  //
  // An element answering any query with a fresh element is never holding nothing, so a guard written as "refuse this if the line is carrying a picture, a table or a rule" can only ever be told it is — and every check wanting the other answer has to switch the query off in the line above the press. That is a guard stuck on one branch and a workaround somebody writes on purpose.

  check('a stand-in element answers a query about its own children, and answers nothing when it has none', () => {
    const { document } = fakePage();
    const line = document.createElement('p');
    // Nothing in it: the answer the reflex could never give, and the one the plus's own refusal turns on.
    if (line.querySelector('img, svg, hr, table, video, iframe, input') !== null) throw new Error('a line holding nothing was told it is holding something');
    if (line.querySelectorAll('img').length) throw new Error('a list query over an empty line answered with something');
    const picture = document.createElement('img');
    line.appendChild(picture);
    if (line.querySelector('img, svg, hr, table, video, iframe, input') !== picture) throw new Error('a line holding a picture did not answer with it');
    // The tag it was made with, not the one the query happened to name: a query for something else is still nothing.
    if (line.querySelector('table') !== null) throw new Error('a line holding a picture answered a query for a table');
    // Below the first row of children, which is where a rendered document puts most of what a guard asks about.
    const quote = document.createElement('blockquote');
    const inner = document.createElement('table');
    quote.appendChild(document.createElement('p'));
    quote.children[0].appendChild(inner);
    if (quote.querySelector('table') !== inner) throw new Error('a table one level down was not found');
    // By class as well as by tag, and both ways a class is written on the page.
    const drawn = document.createElement('div');
    const added = document.createElement('span');
    added.classList.add('block-insert-row');
    const written = document.createElement('span');
    written.className = 'block-insert-row';
    drawn.append(added, written);
    if (drawn.querySelector('.block-insert-row') !== added) throw new Error('a class put on with the list is not found, or not the first of two');
    if (drawn.querySelectorAll('.block-insert-row').length !== 2) throw new Error('the list query missed one of the two ways a class is written');
    // Document order, so the first result is the first one drawn.
    if (drawn.querySelectorAll('span')[1] !== written) throw new Error('the list query answered out of the order the children stand in');
  });

  // ---- 2k. one class, reached by either name ----------------------------------
  //
  // A browser keeps a class in one place. Two stores that never meet mean a class put on through the list is invisible to the name and a class written by name is invisible to the list — so eight guards asking an element whether it wears a class the markup, a rendered document or a name write gave it are told no for ever, and every check that needs the other answer hand-rolls an element beside the press.

  check('a class on the stand-in element is one class, whichever name put it there', () => {
    // Its own boot, so the probes below are the only ones on the surface and the markup's own class is read off a page nothing has edited.
    const page = runShell(source);
    const element = page.document.createElement('div');
    // In through the list, out through the name — and found by the page's class query, which is written over the name.
    element.classList.add('probe-listed');
    if (element.className !== 'probe-listed') throw new Error(`a class added through the list reads back by name as ${JSON.stringify(element.className)}`);
    page.document.getElementById('appSurface').appendChild(element);
    if (page.document.querySelector('.probe-listed') !== element) throw new Error('a class added through the list is not found by the page');
    // In through the name, out through the list — both of them, because one write carries several classes.
    element.className = 'probe-written probe-second';
    if (!element.classList.contains('probe-written') || !element.classList.contains('probe-second')) {
      throw new Error(`a class written by name did not reach the list: ${element.className}`);
    }
    // All of them come back, not the first: an element wears every class it was written with.
    if (element.className !== 'probe-written probe-second') throw new Error(`two classes written by name read back as ${JSON.stringify(element.className)}`);
    // A write replaces what was there rather than adding to it, the way the attribute does.
    if (element.classList.contains('probe-listed')) throw new Error('a write by name left the class it replaced standing on the list');
    // Out through the list, and what is left still reads back by name.
    element.classList.remove('probe-written');
    if (element.className !== 'probe-second') throw new Error(`a removal through the list left ${JSON.stringify(element.className)} behind the name`);
    // The class the app-shell markup declares, which arrives by name and is the one those eight guards ask the list about.
    const surface = page.document.getElementById('appSurface');
    if (!surface.classList.contains('app-surface')) throw new Error(`a class the markup declared does not reach the list: ${surface.className}`);
  });

  // ---- 2l. the words come with the markup -------------------------------------
  //
  // The page draws whole panels as one string and reaches straight back into what it drew, so the words between the tags have to come with the elements. A container that held only the elements says nothing for every panel alike, which is an answer that is always the same in the direction that reads as a guard having fired: `blockIsEmpty` calls a line empty on its text alone, so every panel the page really drew with a sentence in it would pass the emptiness test.

  check('the words in the markup the page draws come with the elements', () => {
    const drawn = fakeElement('worded-panel');
    drawn.innerHTML = '<section class="empty-state"><h1>Open a file</h1><p>Or drop one here</p></section>';
    const section = drawn.children[0];
    const heading = section.children[0];
    if (heading.textContent !== 'Open a file') throw new Error(`a heading the page drew says ${JSON.stringify(heading.textContent)}`);
    // An element wrapping another answers with what both of them say, at whatever depth the words landed.
    if (section.textContent !== 'Open a fileOr drop one here') throw new Error(`the panel around them says ${JSON.stringify(section.textContent)}`);
    // Words on either side of a child come back in the order they were written, which two buckets joined one after the other could not do.
    const line = fakeElement('worded-line');
    line.innerHTML = '<p>A <b>bold</b> word</p>';
    if (line.textContent !== 'A bold word') throw new Error(`words on either side of a child read back as ${JSON.stringify(line.textContent)}`);
    // Words with no tag around them are text in a browser too.
    const bare = fakeElement('worded-bare');
    bare.innerHTML = 'a line';
    if (bare.textContent !== 'a line') throw new Error(`markup with no tag in it says ${JSON.stringify(bare.textContent)}`);
    // The guard the whole family was found through, taken off the page itself rather than written a second time here.
    if (!booted) throw new Error('the page never booted, so the guard could not be asked');
    const guard = booted.blockIsEmpty;
    if (typeof guard !== 'function') throw new Error('the page no longer carries the guard that reads a line for what is on it');
    if (guard(heading)) throw new Error('the guard calls a drawn heading with a sentence in it empty');
    const blank = fakeElement('worded-blank');
    blank.innerHTML = '<p></p>';
    if (!guard(blank.children[0])) throw new Error('the guard calls a line drawn with nothing in it a line that says something');
    // A write of the text still replaces the lot, so a parsed element says only what was written over it.
    line.textContent = 'plain';
    if (line.children.length) throw new Error('a write over parsed markup left the children standing');
    if (line.textContent !== 'plain') throw new Error(`a write over parsed markup left it saying ${JSON.stringify(line.textContent)}`);
    // And a redraw with nothing in it does not answer with what the container said before.
    drawn.innerHTML = '';
    if (drawn.textContent !== '') throw new Error(`a redrawn container still says ${JSON.stringify(drawn.textContent)}`);
  });

  // ---- 2m. an element hands over the first thing it is holding ----------------
  //
  // The reading render draws a document as one string and takes the layout it just drew back out of the surface by this name, then hands it to the pass that asks a document's fields for a growl. A stand-in without the name hands over nothing, and that pass throws on the first line of it — so the whole render is unreachable without this.

  check('an element hands over the first element it is holding, and nothing when it holds none', () => {
    const empty = fakeElement('first-empty');
    if (empty.firstElementChild !== null) throw new Error('an element holding nothing handed over something');
    const drawn = fakeElement('first-drawn');
    drawn.innerHTML = '<div class="reader-layout"><div class="document-body"><p>a line</p></div></div>';
    const layout = drawn.children[0];
    if (drawn.firstElementChild !== layout) throw new Error('the first element the markup declared is not the one handed over');
    if (layout.firstElementChild !== layout.children[0]) throw new Error('the name does not follow down into what the layout is holding');
    // Words with no tag around them are contents and not children, so the first *element* is still the element.
    const worded = fakeElement('first-worded');
    worded.innerHTML = 'a run of words<span>and a child</span>';
    if (worded.firstElementChild !== worded.children[0]) throw new Error('a run of words before the first child was handed over as the first element');
    // It follows the children rather than being read once, which is what an assignment beside them would do.
    const moving = fakeElement('first-moving');
    const one = fakeElement('first-one');
    const two = fakeElement('first-two');
    moving.append(one, two);
    if (moving.firstElementChild !== one) throw new Error('the first of two children is not the one handed over');
    one.remove();
    if (moving.firstElementChild !== two) throw new Error('the first child going left the name still answering with it');
    // A redraw empties it, the way it empties everything else the container was holding.
    moving.innerHTML = '';
    if (moving.firstElementChild !== null) throw new Error('a redrawn container still hands over what it used to hold');
  });

  // ---- 2n. an attribute the markup declared is something a query can find -----
  //
  // A rendered block carries where it starts in the source as an attribute, and both landings that put a returning reader back where they were ask for it: the render asks the document body for every block carrying one, and the source button asks the element under the reader for its nearest. A matcher that reads a tag and a class and nothing else answers the first with an empty list and the second with null for ever — so the landing falls through to the top of the document and the toggle arms nothing, on every run, with no way to see it.

  check('a query and a nearest walk both find the block the markup declared by its source start', () => {
    const body = fakeElement('src-body');
    body.innerHTML = '<div class="document-body"><h1 data-src-start="0">Title</h1><p data-src-start="12">A line <em>with a word in it</em></p><p class="stray">no range</p></div>';
    const found = body.querySelectorAll('[data-src-start]');
    if (found.length !== 2) throw new Error(`the blocks carrying a source range came back as ${found.length}`);
    if (found[0].dataset.srcStart !== '0' || found[1].dataset.srcStart !== '12') throw new Error('the blocks came back out of the order the markup declared them');
    // The single form answers with the first of them, the way the list's first entry does.
    if (body.querySelector('[data-src-start]') !== found[0]) throw new Error('the single query answered with something other than the first block');
    // A name the markup never declared finds nothing, or every block in every document would answer as the one the reader is on.
    if (body.querySelectorAll('[data-line-start]').length) throw new Error('a name the markup did not declare was found on something');
    if (body.querySelector('[data-line-start]') !== null) throw new Error('the single query answered for a name the markup did not declare');
    // The walk up, which is the question the source button asks: from the word the reader is on, out to the block holding it.
    const word = found[1].children[0];
    if (word.closest('[data-src-start]') !== found[1]) throw new Error('the walk up from a word inside a block did not answer with the block');
    // Starting at the element itself, the way the platform's does.
    if (found[1].closest('[data-src-start]') !== found[1]) throw new Error('a block carrying a source range did not answer with itself');
    // Past a block that carries none, to the first one above it that does — nothing here stops at the first parent.
    const stray = body.querySelector('.stray');
    if (stray.closest('[data-src-start]') !== null) throw new Error('a block outside every source range answered with one');
    const deep = fakeElement('src-deep');
    deep.innerHTML = '<section data-src-start="40"><div class="wrap"><span class="leaf">word</span></div></section>';
    const leaf = deep.querySelector('.leaf');
    if (leaf.closest('[data-src-start]') !== deep.children[0]) throw new Error('the walk up stopped at a holder carrying no source range');
    // A class and a tag answer the walk up too, since the page asks it for all three.
    if (leaf.closest('.wrap') !== deep.querySelector('.wrap')) throw new Error('the walk up no longer answers a class');
    if (leaf.closest('section') !== deep.children[0]) throw new Error('the walk up no longer answers a tag');
    if (leaf.closest('.no-such-class') !== null) throw new Error('the walk up answered a class nothing wears');
    // An attribute with no data- in front of it is asked of the element's own attributes.
    const flagged = fakeElement('src-flagged');
    flagged.innerHTML = '<button type="button" disabled>Save</button>';
    if (flagged.querySelectorAll('[type]').length !== 1) throw new Error('an attribute with no data- in front of it was not found');
    if (flagged.querySelectorAll('[name]').length) throw new Error('an attribute the markup did not declare was found');
  });

  check('an attribute value names only the element carrying that value', () => {
    const holder = fakeElement('valued-attributes');
    holder.innerHTML = '<input type="checkbox" data-block-kind="table"><input type="text" data-block-kind="note"><div contenteditable=""></div>';
    const [checkbox, text, empty] = holder.children;
    if (holder.querySelector('input[type="checkbox"]') !== checkbox) throw new Error('a quoted attribute value did not find its element');
    if (holder.querySelector("input[type='text']") !== text) throw new Error('a single-quoted attribute value did not find its element');
    if (holder.querySelector('input[type=button]') !== null) throw new Error('an attribute value found an element carrying another value');
    if (holder.querySelector('[data-block-kind="table"]') !== checkbox) throw new Error('a data- attribute value did not find its element');
    if (holder.querySelector('[data-block-kind="card"]') !== null) throw new Error('a data- attribute value found an element carrying another value');
    if (holder.querySelector('[contenteditable=""]') !== empty) throw new Error('an empty attribute value did not find the empty attribute');
    if (holder.querySelector('[type=""]') !== null) throw new Error('an empty attribute value found a nonempty attribute');
  });

  check('a bare attribute name still answers for every value', () => {
    const holder = fakeElement('bare-attributes');
    holder.innerHTML = '<input type="checkbox" data-block-kind="table"><input type="text" data-block-kind="note">';
    if (holder.querySelectorAll('[type]').length !== 2) throw new Error('a bare attribute name stopped answering for one value');
    if (holder.querySelectorAll('[data-block-kind]').length !== 2) throw new Error('a bare data- attribute name stopped answering for one value');
  });

  check('a drawn diagram is refused by the selector for an undrawn diagram', () => {
    const holder = fakeElement('diagram-state');
    holder.innerHTML = '<pre class="mermaid" data-processed="true">drawn</pre><pre class="mermaid">waiting</pre>';
    const found = holder.querySelectorAll('pre.mermaid:not([data-processed="true"])');
    if (found.length !== 1 || found[0] !== holder.children[1]) throw new Error('the undrawn-diagram selector answered for a diagram already drawn');
  });

  check('an unsupported attribute operator fails with the selector named', () => {
    const holder = fakeElement('attribute-operators');
    holder.innerHTML = '<input type="checkbox">';
    for (const operator of ['~=', '|=', '^=', '$=', '*=']) {
      const selector = `[type${operator}"checkbox"]`;
      let message = '';
      try {
        holder.querySelector(selector);
      } catch (error) {
        message = String(error && error.message);
      }
      if (!message.includes(selector)) throw new Error(`${operator} did not fail with its selector named`);
    }
  });

  check('a scoped table query answers only its head row', () => {
    const holder = fakeElement('scoped-table');
    holder.innerHTML = '<table><thead><tr class="head"><th>Name</th></tr></thead><tbody><tr class="body"><td>Leaftext</td></tr></tbody></table>';
    const table = holder.children[0];
    const found = table.querySelectorAll(':scope > thead > tr');
    if (found.length !== 1 || !found[0].classList.contains('head')) throw new Error('the scoped table query did not answer with only the head row');
  });

  check('scope belongs to the element the query was asked of', () => {
    const holder = fakeElement('scope-owner');
    holder.innerHTML = '<section><div class="group"><p class="leaf">one</p></div></section>';
    const section = holder.children[0];
    const group = section.children[0];
    const leaf = group.children[0];
    if (section.querySelector(':scope > .leaf') !== null) throw new Error('a query answered scope as a nested element rather than the element asked');
    if (group.querySelector(':scope > .leaf') !== leaf) throw new Error('the same markup did not answer against its own scope');
    if (!group.matches(':scope')) throw new Error('an element did not answer its own scope through matches');
    if (leaf.closest(':scope') !== leaf) throw new Error('a nearest walk did not keep the element it was asked of as scope');
    if (leaf.closest(':hover') !== null) throw new Error('an unmodeled pseudo-class started answering');
  });

  // ---- 2o. one node against one whole selector --------------------------------
  //
  // The page has one guard that asks a box what it is rather than being told: whether the pointer resting near an edge is on that box's own scrollbar gutter, which is what raises the bar so it can be grabbed. It asks with the list of boxes that wear one, and that list spends a refusal, a child step, a descendant step and an either-of list — none of which a matcher reading a class, a bare attribute or a tag can answer. Worse than a no: comparing a tag to everything before the first space reads `pre > code` as `pre`, so every code block's holder answers yes to a wearer it is not.

  check('one selector is read as its own parts rather than as its first word', () => {
    const wearers = '.leaf-scroll, .library-scroll, .reader-shell:not(.has-minimap), .table-lane > table, .document-body :is(pre, pre > code, .math-display, .frontmatter, table)';
    const entries = selectorParts(wearers);
    // Five wearers, not nine pieces: the commas inside `:is(...)` group selectors within one entry, and cutting there hands the matcher `.document-body :is(pre` and `table)`, which are not selectors at all.
    if (entries.length !== 5) throw new Error(`the wearer list came back as ${entries.length} pieces: ${entries.join(' | ')}`);
    if (entries[4] !== '.document-body :is(pre, pre > code, .math-display, .frontmatter, table)') throw new Error(`the either-of list did not arrive whole: ${entries[4]}`);

    const holder = fakeElement('selector-holder');
    holder.innerHTML = '<p class="leaf-editable" data-src-start="4">A line</p><p class="leaf-editable">No range</p><pre class="hljs">code</pre><section class="reader-shell">reading</section><section class="reader-shell has-minimap">reading</section>';
    const [ranged, plain, block, bare, mapped] = holder.children;
    // Asked through the walk up, which starts at the node itself, so the walk and the query below are held to reading one selector the same way.
    const asks = (node, selector) => node.closest(selector) === node;

    // A compound is every part of it answering on the one node, so a part that does not answer refuses the whole.
    if (!asks(ranged, 'p.leaf-editable[data-src-start]')) throw new Error('a node wearing every part of a compound was refused by it');
    if (asks(plain, 'p.leaf-editable[data-src-start]')) throw new Error('a node missing one part of a compound was matched by it');
    if (asks(block, 'p.leaf-editable')) throw new Error('a compound matched a node of another tag');

    // A refusal, each way round.
    if (!asks(bare, '.reader-shell:not(.has-minimap)')) throw new Error('a reading surface with no minimap was refused by the one entry that names it');
    if (asks(mapped, '.reader-shell:not(.has-minimap)')) throw new Error('a reading surface that has a minimap answered the entry that refuses one');

    // An either-of list, each way round.
    if (!asks(block, ':is(pre, .math-display)')) throw new Error('a node named by an either-of list was refused by it');
    if (asks(plain, ':is(pre, .math-display)')) throw new Error('a node named by no part of an either-of list answered it');

    // The false yes this check exists for: a selector is read as its steps and a tag as a whole word, so `pre > code` is not the tag `pre`.
    if (asks(block, 'pre > code')) throw new Error('a code block holder answered a selector naming what is inside it');
    if (!asks(block, 'pre')) throw new Error('a tag on its own stopped answering');

    // And the query down reads the same selector the same way, since both ask the one matcher.
    if (holder.querySelectorAll('.reader-shell:not(.has-minimap)').length !== 1) throw new Error('the query down disagreed with the walk up about a refusal');
    if (holder.querySelectorAll('pre > code').length) throw new Error('the query down answered a code block holder for what is inside it');
  });

  // ---- 2p. an element says its own markup -------------------------------------
  //
  // Five fragments reach for an element's markup: the page exported as one file, the ghost carrying a dragged row, the card's section lift, the two memos that keep what was drawn, and the vault glyph, which writes one. An element that answered with the string somebody last assigned could say none of them — the drawing memo is read after a shared sheet has been lifted out of the picture and a class put on it, which is the one moment the written string cannot describe.

  check('a block built by appending children says the markup those children are', () => {
    const body = fakeElement('markup-body');
    const line = fakeElement('');
    line.tagName = 'P';
    line.className = 'lead';
    line.append('A line');
    body.appendChild(line);
    if (body.innerHTML !== '<p class="lead">A line</p>') throw new Error(`a block built by appending says ${JSON.stringify(body.innerHTML)}`);
    if (line.outerHTML !== '<p class="lead">A line</p>') throw new Error(`the block itself says ${JSON.stringify(line.outerHTML)}`);
    // Its own tag around its own contents, all the way down.
    if (body.outerHTML !== '<div id="markup-body"><p class="lead">A line</p></div>') throw new Error(`the holder says ${JSON.stringify(body.outerHTML)}`);
    // An element holding nothing still says its tag, rather than nothing at all.
    const bare = fakeElement('');
    bare.tagName = 'SPAN';
    if (bare.outerHTML !== '<span></span>') throw new Error(`an element holding nothing says ${JSON.stringify(bare.outerHTML)}`);
  });

  check('a block that loses a child says what it is holding rather than the string it was given', () => {
    const picture = fakeElement('markup-picture');
    picture.innerHTML = '<svg id="good"><style>.a{}</style><g class="node"></g></svg>';
    const drawing = picture.children[0];
    // The order the drawing memo's own comment is about: the shared sheet is lifted out of the picture, and the sheet's class goes on afterwards.
    drawing.querySelector('style').remove();
    drawing.classList.add('lt-mmd-0');
    if (drawing.outerHTML !== '<svg id="good" class="lt-mmd-0"><g class="node"></g></svg>') throw new Error(`the picture says ${JSON.stringify(drawing.outerHTML)}`);
    // The words come back spelled the way they went in, because the walker reads every entity the writer writes and no others. One round trip over the whole of both sets: a reader unescaping something the writer never escapes grows a pile of `&amp;amp;` here rather than in whatever check happened to meet it first.
    const words = fakeElement('markup-words');
    words.innerHTML = '<p>a &amp; b &gt; c&nbsp;d</p>';
    if (words.innerHTML !== '<p>a &amp; b &gt; c&nbsp;d</p>') throw new Error(`a run of words came back as ${JSON.stringify(words.innerHTML)}`);
  });

  check('a picture and a line break close themselves rather than swallowing what follows', () => {
    const line = fakeElement('markup-void');
    line.innerHTML = '<p><img src="a.png" alt="A picture"><br>after</p>';
    if (line.innerHTML !== '<p><img src="a.png" alt="A picture"><br>after</p>') throw new Error(`a void tag came back as ${JSON.stringify(line.innerHTML)}`);
    const block = line.children[0];
    if (block.children.length !== 2) throw new Error(`the void tags took ${block.children.length} places rather than two`);
    if (block.children[0].children.length) throw new Error('the picture swallowed what was written after it');
  });

  check('an attribute set by hand comes back out in the markup, and a data- name follows its dataset', () => {
    // An element the page built rather than one the markup walker made, which has to answer for a name written onto it exactly as a parsed one does.
    const ghost = fakeElement('');
    ghost.tagName = 'LI';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.setAttribute('draggable', 'true');
    if (ghost.getAttribute('aria-hidden') !== 'true') throw new Error('an element the page built dropped the name written onto it');
    if (!ghost.hasAttribute('draggable')) throw new Error('an element the page built says it is not wearing what it was given');
    if (ghost.outerHTML !== '<li aria-hidden="true" draggable="true"></li>') throw new Error(`the element says ${JSON.stringify(ghost.outerHTML)}`);
    ghost.removeAttribute('draggable');
    if (ghost.outerHTML !== '<li aria-hidden="true"></li>') throw new Error(`a name taken off is still in the markup: ${ghost.outerHTML}`);
    // The two stores never meet, so a name written or deleted through the dataset has to be the one the markup says.
    const block = fakeElement('markup-dataset');
    block.innerHTML = '<div data-diagram-wait="true"></div>';
    const drawn = block.children[0];
    delete drawn.dataset.diagramWait;
    drawn.dataset.processed = 'true';
    if (drawn.outerHTML !== '<div data-processed="true"></div>') throw new Error(`the dataset and the markup disagree: ${drawn.outerHTML}`);
    // A flag the page spells bare is written bare.
    const hidden = fakeElement('');
    hidden.tagName = 'SECTION';
    hidden.hidden = true;
    if (hidden.outerHTML !== '<section hidden></section>') throw new Error(`a hidden element says ${JSON.stringify(hidden.outerHTML)}`);
  });

  check('a reader\u2019s own words in a run of text are written out the way a browser writes them, and read back whole', () => {
    // The fault this pair holds: a title holding a tag-shaped fragment written out as a tag loses eight characters on the way back and gains a child nobody put there.
    const title = fakeElement('markup-title');
    const line = fakeElement('');
    line.tagName = 'DIV';
    title.appendChild(line);
    line.textContent = 'Notes <b> and </b> drafts';
    if (line.outerHTML !== '<div>Notes &lt;b&gt; and &lt;/b&gt; drafts</div>') throw new Error(`the title composed as ${JSON.stringify(line.outerHTML)}`);
    const read = fakeElement('markup-title-read');
    read.innerHTML = line.outerHTML;
    if (read.children[0].textContent !== 'Notes <b> and </b> drafts') throw new Error(`the title read back as ${JSON.stringify(read.children[0].textContent)}`);
    if (read.children[0].children.length) throw new Error(`reading the title back invented ${read.children[0].children.length} child element(s)`);
    // A bare angle bracket left unescaped stops the document at it, and everything after it is simply gone.
    line.textContent = 'a <unclosed thing';
    const stopped = fakeElement('markup-bare-angle');
    stopped.innerHTML = line.outerHTML;
    if (stopped.children[0].textContent !== 'a <unclosed thing') throw new Error(`a bare angle bracket read back as ${JSON.stringify(stopped.children[0].textContent)}`);
    // The hard space is read as the character it names rather than as a plain space, or a name holding one loses it silently.
    line.textContent = 'two words';
    if (line.outerHTML !== '<div>two&nbsp;words</div>') throw new Error(`a hard space composed as ${JSON.stringify(line.outerHTML)}`);
    const spaced = fakeElement('markup-hard-space');
    spaced.innerHTML = line.outerHTML;
    if (spaced.children[0].textContent !== 'two words') throw new Error('a hard space came back as a plain space');
  });

  check('an attribute value holding a quote composes as markup this page\u2019s own walker reads back', () => {
    // A quote written straight out closes its own attribute, so the words are truncated at it and nothing says so.
    const field = fakeElement('');
    field.tagName = 'INPUT';
    field.setAttribute('value', 'she said "go"');
    if (field.outerHTML !== '<input value="she said &quot;go&quot;">') throw new Error(`the value composed as ${JSON.stringify(field.outerHTML)}`);
    const read = fakeElement('markup-value');
    read.innerHTML = field.outerHTML;
    if (read.children[0].getAttribute('value') !== 'she said "go"') throw new Error(`the value read back as ${JSON.stringify(read.children[0].getAttribute('value'))}`);
    // An angle bracket standing inside a value needs no escape, and a browser leaves one alone — so the writer must not add one the walker would then have to read.
    field.setAttribute('value', 'a < b & c');
    if (field.outerHTML !== '<input value="a < b &amp; c">') throw new Error(`an angle bracket in a value composed as ${JSON.stringify(field.outerHTML)}`);
  });

  check('an element whose text is set says those words in its own markup, and a child\u2019s words reach its parent\u2019s', () => {
    // The safe way a fragment puts a reader’s words on the page. A string kept to one side of the element leaves the markup saying `<span></span>` however well the escapes work.
    const holder = fakeElement('markup-set-text');
    const name = fakeElement('');
    name.tagName = 'SPAN';
    holder.appendChild(name);
    name.textContent = 'Notes & <drafts>';
    if (name.innerHTML !== 'Notes &amp; &lt;drafts&gt;') throw new Error(`an element whose text was set says ${JSON.stringify(name.innerHTML)}`);
    if (holder.innerHTML !== '<span>Notes &amp; &lt;drafts&gt;</span>') throw new Error(`the child\u2019s words did not reach the parent: ${JSON.stringify(holder.innerHTML)}`);
    // Written again it replaces the run rather than stacking a second one, and cleared it empties the element.
    name.textContent = 'Just notes';
    if (name.innerHTML !== 'Just notes') throw new Error(`rewriting the text stacked a second run: ${JSON.stringify(name.innerHTML)}`);
    name.textContent = '';
    if (name.innerHTML !== '' || name.contents.length) throw new Error(`clearing the text left ${JSON.stringify(name.innerHTML)}`);
  });

  check('a file path the front end escapes into an attribute reads back as the path that went in', () => {
    // The whole point of the pair: the page spells a backtick `&#96;`, which no browser writes, so a walker reading a browser-shaped set alone hands a path with one in it back wrong.
    const path = "C:\\\\Notes\\\\Tom's `draft` & co.md";
    const escaped = vm.runInContext(`escapeAttr(${JSON.stringify(path)})`, booted);
    const row = fakeElement('markup-path');
    row.innerHTML = `<li data-home-favorite="${escaped}" title="${escaped}"></li>`;
    const one = row.children[0];
    if (one.getAttribute('title') !== path) throw new Error(`the path read back as ${JSON.stringify(one.getAttribute('title'))}`);
    if (one.dataset.homeFavorite !== path) throw new Error(`the dataset read the path back as ${JSON.stringify(one.dataset.homeFavorite)}`);
  });
  check('writing an element markup swaps it for what the markup declares', () => {
    const row = fakeElement('markup-row');
    row.innerHTML = '<span class="lt-icon lt-icon-package"></span><span class="name">Notes</span>';
    const glyph = row.querySelector('.lt-icon');
    glyph.outerHTML = '<span class="lt-icon lt-icon-cloud"></span>';
    if (row.querySelector('.lt-icon-package')) throw new Error('the holder still finds the element that was written over');
    if (!row.querySelector('.lt-icon-cloud')) throw new Error('what the markup declared is not in the holder');
    if (row.children.length !== 2) throw new Error(`the holder came back with ${row.children.length} children rather than two`);
    if (row.innerHTML !== '<span class="lt-icon lt-icon-cloud"></span><span class="name">Notes</span>') throw new Error(`the swap landed out of place: ${row.innerHTML}`);
    if (glyph.parentElement !== null) throw new Error('the element that was written over still names a holder');
  });

  // ---- 2q. one node list, read under the name the page uses -------------------
  //
  // The page reads what a container is holding by `childNodes` and by its two ends, and a run of words counts as one of them: the selection toolbar's tag fold moves each child into a replacement until the first one is gone, so an end that skipped words would move the elements, drop the sentence, and read back as a fold that worked.

  check('a container reads its nodes back under the name the page uses, words and elements told apart', () => {
    const holder = fakeElement('node-list');
    holder.innerHTML = 'before <span class="kept">a child</span> after';
    if (holder.childNodes.length !== 3) throw new Error(`the container reads back ${holder.childNodes.length} nodes rather than three`);
    // The element list beside it is elements alone, which is what it means in a browser and what the first-element name is read off.
    if (holder.children.length !== 1 || holder.children[0].className !== 'kept') throw new Error('the element list beside the node list is not elements alone');
    // Both names are the one array, so nothing can drift between them.
    if (holder.childNodes !== holder.contents) throw new Error('the two names are two arrays, which is the drift this check exists to stop');
    // Each node says what it is, because a walk over the list branches on exactly that.
    const [first, middle, last] = holder.childNodes;
    if (first.nodeType !== 3 || first.nodeValue !== 'before ') throw new Error(`the first run of words says ${first.nodeType} and ${JSON.stringify(first.nodeValue)}`);
    if (middle.nodeType !== 1 || middle.tagName !== 'SPAN') throw new Error('the child element does not say it is an element');
    if (last.nodeType !== 3 || last.textContent !== ' after') throw new Error('the last run of words is not a text node answering its words');
    // The ends are the list's ends, runs of words included.
    if (holder.firstChild !== first) throw new Error('the first node handed over is not the run of words the markup opened with');
    if (holder.lastChild !== last) throw new Error('the last node handed over is not the run of words the markup ended with');
    // They follow the list rather than being read once, which is what an assignment beside it would do.
    holder.appendChild(fakeElement('node-list-added'));
    if (holder.lastChild.id !== 'node-list-added') throw new Error('a node put on the end did not become the last one');
    // A run of words the text write made is the same node the markup walker makes, so a container reads back the same way whichever way it was filled.
    const written = fakeElement('node-list-text');
    written.textContent = 'just words';
    if (written.childNodes.length !== 1 || written.firstChild !== written.lastChild) throw new Error('a container written as text holds something other than one run of words');
    if (written.firstChild.nodeType !== 3 || written.firstChild.nodeValue !== 'just words') throw new Error('the text write did not leave a run of words that says what it is');
    if (written.children.length) throw new Error('the text write left a run of words in the element list');
    // An emptied container answers nothing at either end, so a check pressing what a redraw took away finds nothing.
    written.innerHTML = '';
    if (written.childNodes.length || written.firstChild !== null || written.lastChild !== null) throw new Error('an emptied container still hands over what it was holding');
  });

  // ---- 2r. the two moves that are not moves -----------------------------------
  //
  // The tab drag settles a dragged tab into its slot with one and four fragments take an element off the page with the other, so a stub that hands the node back reads as a drop that worked while the strip is in the order it started.

  check('a node moved to a place lands there, and a node swapped out leaves nothing of itself behind', () => {
    const strip = fakeElement('move-strip');
    const one = fakeElement('move-one');
    const two = fakeElement('move-two');
    const three = fakeElement('move-three');
    strip.append(one, two, three);
    if (strip.insertBefore(three, one) !== three) throw new Error('the move answered something other than the node it moved');
    if (strip.children.map((tab) => tab.id).join(',') !== 'move-three,move-one,move-two') throw new Error(`the strip reads back ${strip.children.map((tab) => tab.id).join(',')}`);
    if (strip.childNodes.length !== 3) throw new Error('the move left a copy of the tab it moved');
    // Nothing as the reference is the end, which is what the platform does with it.
    strip.insertBefore(three, null);
    if (strip.lastChild !== three) throw new Error('a move with nothing as the reference did not go on the end');
    // A tab taken from one strip reaches the other and stops being listed by the one that had it.
    const elsewhere = fakeElement('move-elsewhere');
    elsewhere.insertBefore(one, null);
    if (strip.childNodes.includes(one)) throw new Error('a tab moved to another strip is still listed by the one it left');
    if (one.parentElement !== elsewhere) throw new Error('a tab moved to another strip never named the strip it reached');
    // A run of words is a place too, so a node moved in front of one lands in front of the words rather than on the end.
    const worded = fakeElement('move-worded');
    worded.innerHTML = 'lead words<b>bold</b>';
    const put = fakeElement('move-put');
    worded.insertBefore(put, worded.firstChild);
    if (worded.firstChild !== put) throw new Error('a node moved in front of a run of words did not land in front of it');
    if (worded.children[0] !== put) throw new Error('the element list does not put it in front of the element that was already there');

    // The swap: what is handed over stands where the element stood, in order, and the element stops being held at all.
    const holder = fakeElement('swap-holder');
    holder.innerHTML = '<i>before</i><em>gone</em><i>after</i>';
    const going = holder.querySelector('em');
    const first = fakeElement('swap-first');
    going.replaceWith(first, 'and words');
    if (holder.children.map((el) => el.tagName + (el.id ? '#' + el.id : '')).join(',') !== 'I,DIV#swap-first,I') throw new Error(`the swap landed out of place: ${holder.children.map((el) => el.id || el.tagName).join(',')}`);
    if (holder.textContent !== 'beforeand wordsafter') throw new Error(`the words landed out of place: ${JSON.stringify(holder.textContent)}`);
    if (holder.childNodes.includes(going)) throw new Error('the element that was swapped out is still listed by its holder');
    if (going.parentElement !== null) throw new Error('the element that was swapped out still names the holder that dropped it');
    // Its own children are what an unwrap hands over, so the swap has to cope with taking them out of it on the way.
    const wrapper = fakeElement('swap-wrapper');
    const around = fakeElement('swap-around');
    around.appendChild(wrapper);
    wrapper.innerHTML = 'kept <b>words</b>';
    wrapper.replaceWith(...wrapper.childNodes);
    if (around.textContent !== 'kept words') throw new Error(`unwrapping lost the words: ${JSON.stringify(around.textContent)}`);
    if (around.childNodes.includes(wrapper)) throw new Error('the wrapper stayed behind the words it was holding');
    if (wrapper.childNodes.length) throw new Error('the wrapper kept a copy of the words it handed over');
  });

  // ---- 2s. a node placed beside another --------------------------------------
  //
  // The plus above a block and Enter under one both put the new line into the page this way, and the word is the only difference between them. Without the name the stand-in throws before either path can be booted at all, and a stub keeping the block in a variable proves a block was built rather than where it landed.

  check('a node placed beside another lands where a browser puts it', () => {
    const holder = fakeElement('beside-holder');
    const first = fakeElement('beside-first');
    const last = fakeElement('beside-last');
    holder.append(first, last);
    const above = fakeElement('beside-above');
    if (first.insertAdjacentElement('beforebegin', above) !== above) throw new Error('the placement answered something other than the node it placed');
    const under = fakeElement('beside-under');
    first.insertAdjacentElement('afterend', under);
    if (holder.children.map((el) => el.id).join(',') !== 'beside-above,beside-first,beside-under,beside-last') {
      throw new Error(`the holder reads back ${holder.children.map((el) => el.id).join(',')}`);
    }
    // The two inside words, at the front of the reference and on the end of it.
    const inFront = fakeElement('beside-in-front');
    const onEnd = fakeElement('beside-on-end');
    first.insertAdjacentElement('beforeend', onEnd);
    first.insertAdjacentElement('afterbegin', inFront);
    if (first.children.map((el) => el.id).join(',') !== 'beside-in-front,beside-on-end') {
      throw new Error(`the reference is holding ${first.children.map((el) => el.id).join(',')}`);
    }
    // The word is read whatever it is spelled in, the way a browser reads it.
    const shouted = fakeElement('beside-shouted');
    last.insertAdjacentElement('afterEnd', shouted);
    if (holder.lastChild !== shouted) throw new Error('a word spelled the platform’s own way was not read');
    // A real move, so a node taken from inside the reference leaves it rather than standing in both places.
    onEnd.insertAdjacentElement('beforebegin', inFront);
    if (first.children.map((el) => el.id).join(',') !== 'beside-in-front,beside-on-end') throw new Error('a node moved beside a sibling did not stay in the order it was moved to');
    first.insertAdjacentElement('afterend', onEnd);
    if (first.childNodes.includes(onEnd)) throw new Error('a node moved out of the reference is still listed inside it');
    if (onEnd.parentElement !== holder) throw new Error('a node moved out of the reference never named the holder it reached');
    // Nothing is beside a node standing in no holder, which is the answer a browser gives and the one the gutter checks need, since they build their blocks holderless.
    const loose = fakeElement('beside-loose');
    const refused = fakeElement('beside-refused');
    if (loose.insertAdjacentElement('beforebegin', refused) !== null) throw new Error('a reference with no holder answered something other than nothing');
    if (loose.insertAdjacentElement('afterend', refused) !== null) throw new Error('a reference with no holder answered something other than nothing');
    if (refused.parentElement !== null) throw new Error('a node handed to a reference with no holder was placed somewhere anyway');
    // A word the page does not know throws, because a placement that quietly did nothing would read as one that worked.
    let said = '';
    try {
      first.insertAdjacentElement('inthemiddle', fakeElement('beside-unknown'));
    } catch (error) {
      said = String(error);
    }
    if (!said.includes('inthemiddle')) throw new Error(`a word the page does not know was taken rather than refused: ${said || 'nothing was thrown'}`);
  });
}
