let mermaidLoadPromise = null;
let katexLoadPromise = null;

function loadMermaid() {
  if (window.mermaid) {
    return Promise.resolve(window.mermaid);
  }
  if (mermaidLoadPromise) {
    return mermaidLoadPromise;
  }
  mermaidLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MERMAID_SCRIPT_URL;
    // Anonymous mode, paired with the asset response's allow-origin header, so a throw inside the runtime reaches window.onerror unmasked.
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.onload = () => {
      if (window.mermaid) {
        resolve(window.mermaid);
        return;
      }
      reject(new Error('Mermaid runtime loaded without exposing window.mermaid'));
    };
    script.onerror = () => reject(new Error('Mermaid runtime failed to load'));
    document.head.appendChild(script);
  });
  return mermaidLoadPromise;
}

// The app's own drawings, handed over once, so `A@{ icon: "leaf:back" }` draws the back arrow the app bar wears. Nothing is fetched: the set is a fragment of this same script, generated from design/icons.md by `just bundle-icons`.
let mermaidIconsRegistered = false;
function registerMermaidIcons(mermaid) {
  if (mermaidIconsRegistered || typeof mermaid.registerIconPacks !== 'function') return;
  mermaidIconsRegistered = true;
  mermaid.registerIconPacks([{ name: LEAF_MERMAID_ICON_PREFIX, icons: LEAF_MERMAID_ICONS }]);
}

// Where both failures land: an icon we have no drawing for, and a picture that will not load. Mermaid's own stand-in is an 80x80 square in a hardcoded #087ebf, the one color a diagram could show that no theme chose.
const MERMAID_FALLBACK_ICON = LEAF_MERMAID_ICON_PREFIX + ':missing-image';

function mermaidHasIcon(name) {
  const at = (name || '').indexOf(':');
  if (at < 0) return false;
  return (
    name.slice(0, at) === LEAF_MERMAID_ICON_PREFIX &&
    Object.prototype.hasOwnProperty.call(LEAF_MERMAID_ICONS.icons, name.slice(at + 1))
  );
}

// Mermaid throws out of its own renderer on a URL it cannot decode, and the catch upstream can only mark the whole batch of three failed — so a bad picture would cost two innocent diagrams their toolbar. Answered once per URL, because a theme switch redraws the page.
const mermaidPictureAnswers = new Map();
function mermaidPictureDraws(url) {
  let answer = mermaidPictureAnswers.get(url);
  if (!answer) {
    answer = new Promise((resolve) => {
      const probe = new Image();
      // Decoded, not just fetched: decoding is the step mermaid does and the step that threw.
      probe.onload = () => (probe.decode ? probe.decode().then(() => resolve(true), () => resolve(false)) : resolve(true));
      probe.onerror = () => resolve(false);
      probe.src = url;
    });
    mermaidPictureAnswers.set(url, answer);
  }
  return answer;
}

// Every key inside a box's `@{ … }`, rewritten where `rewrite` hands back a replacement. Only in there: the same words in a label are the reader's own text. Quotes are tracked because a label may hold the brace and the comma these are made of.
function mermaidRewriteTyped(source, rewrite) {
  let out = '';
  let rest = source;
  for (;;) {
    const open = rest.indexOf('@{');
    if (open < 0) return out + rest;
    out += rest.slice(0, open + 2);
    const body = rest.slice(open + 2);
    let close = -1;
    let quoted = false;
    for (let at = 0; at < body.length; at += 1) {
      const char = body[at];
      if (char === '"') quoted = !quoted;
      else if (char === '}' && !quoted) {
        close = at;
        break;
      }
    }
    if (close < 0) return out + body;
    out += mermaidRewriteTypedBody(body.slice(0, close), rewrite) + '}';
    rest = body.slice(close + 1);
  }
}

const MERMAID_TYPED_KEY_RE = /^(\s*)([A-Za-z_][\w-]*)\s*:\s*([\s\S]*?)(\s*)$/;
function mermaidRewriteTypedBody(body, rewrite) {
  const parts = [];
  let start = 0;
  let quoted = false;
  for (let at = 0; at <= body.length; at += 1) {
    const char = body[at];
    if (char === '"') quoted = !quoted;
    else if ((at === body.length || char === ',') && !quoted) {
      parts.push(body.slice(start, at));
      start = at + 1;
    }
  }
  return parts
    .map((part) => {
      const named = MERMAID_TYPED_KEY_RE.exec(part);
      if (!named) return part;
      const value = named[3].replace(/^"([\s\S]*)"$/, '$1');
      const swap = rewrite(named[2], value);
      // The spacing either side is the reader's, and this text goes on to be drawn.
      return swap == null ? part : named[1] + swap + named[4];
    })
    .join(',');
}

// What mermaid is actually handed: the block with anything it cannot draw turned into the missing-picture mark. Never the cache key — `__mermaidSource` stays what the reader typed, so both editors still open their own words.
async function mermaidDrawableSource(source) {
  if (!source || source.indexOf('@{') < 0) return source;
  const pictures = [];
  mermaidRewriteTyped(source, (key, value) => {
    if (key === 'img' && value) pictures.push(value);
    return null;
  });
  const dead = new Set();
  if (pictures.length) {
    const draws = await Promise.all(pictures.map(mermaidPictureDraws));
    pictures.forEach((url, at) => {
      if (!draws[at]) dead.add(url);
    });
  }
  return mermaidRewriteTyped(source, (key, value) => {
    if (key === 'icon') return mermaidHasIcon(value) ? null : 'icon: "' + MERMAID_FALLBACK_ICON + '"';
    // The key changes too: an icon box is the one shape the page's own ink can paint our drawing into.
    if (key === 'img' && dead.has(value)) return 'icon: "' + MERMAID_FALLBACK_ICON + '"';
    return null;
  });
}

// Rendered-diagram memo: diagram source (+ theme) → finished SVG. Editing re-renders the whole document per commit, resetting diagrams to raw text; unchanged ones restore from here instantly, so only new/edited ones re-render.
const mermaidRenderCache = new Map();
const MERMAID_CACHE_CAP = 200;
// Keyed on the family as well as light or dark: two themes of the same appearance draw the same diagram in different colors, and a key that cannot tell them apart hands back the previous theme's picture.
function mermaidCacheKey(source) {
  const root = document.documentElement.dataset;
  return (root.themeFamily || '') + '\n' + (root.theme || '') + '\n' + source;
}
// A drawing wider than the reading column is scaled to fit it, so its height is only true at that width — measured at 640px and at 749px in two window sizes on the same day. The picture memo keeps the key above: an SVG scales, and throwing every drawing away on a resize would redraw the document.
function mermaidHeightKey(source) {
  const body = app.querySelector('.document-body');
  const width = body ? Math.round(body.getBoundingClientRect().width) : 0;
  return width + '\n' + mermaidCacheKey(source);
}
// Keyed like the picture memo plus the column's width, so a box refilled at the height its drawing had moves nothing above the reader.
const mermaidDrawnHeights = new Map();
// More diagrams than either memo holds. Both empty wholesale at their cap rather than dropping the oldest, so past it the page has no reliable memory of anything it drew — which is the one boundary that decides both what is warmed and what is handed back. Measured: a 250-diagram document keeping every drawing costs 8.9 times the same document as boxes and gives up a whole second in one frame, where a 67-diagram one costs 1.6 times its own.
function mermaidDocumentPastMemory() {
  const body = app.querySelector('.document-body');
  return !!body && body.querySelectorAll('pre.mermaid').length > MERMAID_CACHE_CAP;
}
// One window either way. Sixty drawn on open stalled the window for three and a half seconds.
const MERMAID_NEAR_SCREENS = 1;
function mermaidViewHeight() {
  return app.clientHeight || window.innerHeight || 800;
}
// For the pass that runs before the observer below has reported anything.
function mermaidIsNearReader(diagram) {
  const rect = diagram.getBoundingClientRect();
  const height = mermaidViewHeight();
  const margin = height * MERMAID_NEAR_SCREENS;
  return rect.bottom >= -margin && rect.top <= height + margin;
}
// Waiting its turn, or too far away to be queued. Only the waiting one spins, so a page of boxes is not fifty-seven spinners.
function markMermaidWait(diagram, near) {
  diagram.dataset.diagramWait = near ? 'near' : 'far';
  // A box has no drawing to skip, and its own height is what holds the page still.
  drawMermaidPaintAlways(diagram);
  const known = mermaidDrawnHeights.get(mermaidHeightKey(diagram.__mermaidSource || diagram.textContent));
  // Exact, and the stylesheet's floor comes off with it: 19 of the 60 diagrams in the test document draw *shorter* than their own source text, and `min-height` cannot make a block shorter than its contents in either direction. Cleared when unknown: a theme or column-width change keys the memo afresh, and the old height would hold the box open.
  if (known) {
    diagram.style.height = `${known}px`;
    diagram.style.minHeight = '0px';
  } else {
    diagram.style.removeProperty('height');
    diagram.style.removeProperty('min-height');
  }
}
function renderMermaidDiagrams() {
  // A render swaps in a fresh body, so the boxes the watcher held are detached. Identity catches that; re-observing does not.
  const body = app.querySelector('.document-body');
  if (body !== mermaidWatchedBody) {
    forgetMermaidWatch();
    mermaidWatchedBody = body;
  }
  // The full-window stage is a `pre.mermaid` inside `app` too, but it draws itself: an overlay-sized SVG in the memo comes back in the page at that size.
  const candidates = Array.from(app.querySelectorAll('pre.mermaid:not([data-processed="true"]):not([data-mermaid-render="failed"]):not([data-diagram-stage])'));
  if (!candidates.length) {
    return;
  }
  const near = [];
  candidates.forEach((diagram) => {
    // The only copy of the text once the SVG has replaced it, and a theme change needs it back.
    diagram.__mermaidSource = diagram.textContent;
    const isNear = mermaidIsNearReader(diagram);
    markMermaidWait(diagram, isNear);
    if (isNear) near.push(diagram);
  });
  watchMermaidDiagrams(candidates);
  drawMermaidDiagrams(near);
  mermaidNoteColumnWidth();
  scheduleMermaidWarmPass();
}

// ---- warming the whole document ---------------------------------------------
// A box that has never been drawn is as tall as its own source code, which has nothing to do with the drawing: measured over 60 of them, the median box moves 136px when it draws and the worst 790px. So every first draw in a document is a resize, and reading down a page of diagrams is a page that never stops settling. Draw them all once while nobody is scrolling and that stops: the scrollbar and the rail are honest from the first minute, and a scroll to the bottom moves nothing. It costs 6.8 seconds on a 67-diagram document, none of it on the path to the words.
//
// This pass hands nothing back itself. A finished drawing already asks to be watched for recycling, and the watcher already puts a far one back as a box at its drawn height — so warming is a queue and a yield, not a second copy of that path.
const MERMAID_WARM_SETTLE_MS = 400;
let mermaidWarmTimer = 0;
// What is worth drawing: everything the document holds whose height has never been measured at this column width. A recycled box has one, so it is left alone; a theme change or a change in the column's width keys the memo afresh, which makes every diagram a candidate again and re-runs the pass without anything having to notice why.
function mermaidWarmCandidates() {
  const body = app.querySelector('.document-body');
  if (!body) return [];
  // Past the cap both memos empty wholesale rather than dropping the oldest, so a warm pass into them is a redraw of the document on every scroll — worse than the jolt it set out to fix. A document this size is left exactly as it ships.
  if (mermaidDocumentPastMemory()) return [];
  const waiting = Array.from(body.querySelectorAll('pre.mermaid:not([data-processed="true"]):not([data-mermaid-render="failed"]):not([data-diagram-stage])'));
  return waiting.filter((diagram) => diagram.__mermaidSource != null
    && !mermaidDrawnHeights.has(mermaidHeightKey(diagram.__mermaidSource)));
}
function scheduleMermaidWarmPass() {
  markMinimapWarming();
  if (mermaidWarmTimer) return;
  mermaidWarmTimer = window.setTimeout(() => {
    mermaidWarmTimer = 0;
    // Their gesture comes first; the settle after their last wheel click calls back.
    if (readerScrolling) return;
    // An export is already drawing the whole document, and a second pass into it would bump the generation that one is watching and cancel it. It calls back when it is done.
    if (mermaidExportDrawing) return;
    const queue = mermaidWarmCandidates();
    if (queue.length) drawMermaidDiagrams(queue, true);
  }, MERMAID_WARM_SETTLE_MS);
}
// Until every diagram has been measured once, the little picture down the side is a picture of boxes: it is a clone of the page, and a diagram nothing has drawn yet has nothing in the memo for the clone to take. So the rail wears its own spinner for the whole warm and drops it when the last box is measured — one state for the wait rather than one per pass, which is what made the position box blink every few hundred milliseconds.
function markMinimapWarming() {
  const minimap = document.querySelector('.document-minimap');
  if (!minimap) return;
  if (mermaidWarmCandidates().length) minimap.classList.add('is-loading');
  else minimap.classList.remove('is-loading');
}
// ---- drawing the whole document for an export -------------------------------
// An export is one render rather than a scroll, so neither of the two things that hold the warm pass back applies to it: the cap that leaves a big document as boxes, and the recycler that hands a far drawing back. Both stand down outright rather than being stepped around — the recycler's own pass calls the drawing path again, which bumps the generation the batch loop checks every batch, and that is what stopped a pass over 220 diagrams at ten of them.
let mermaidExportDrawing = 0;
// Held from the moment an export starts drawing until the reader scrolls again. The save window stands open for as long as they take over it and the render reads the page after that, so a recycling pass anywhere in between puts far drawings back to boxes and prints the empty frames this was built to stop. Their next scroll is the first moment they are reading rather than exporting, and it is where the queue that built up is drained.
let mermaidExportHolding = false;
// Every box in the document that is not drawn, read off the element rather than out of a selector so a block the page has already drawn is one this cannot ask for twice. A block the decorating pass has not reached yet has no recorded source, so it is given its own text as one — pressing Export the moment a document opens draws it like any other.
function mermaidWaitingForExport() {
  const body = app ? app.querySelector('.document-body') : null;
  if (!body) return [];
  return Array.from(body.querySelectorAll('pre.mermaid')).filter((diagram) => {
    if (diagram.dataset.processed === 'true' || diagram.dataset.mermaidRender === 'failed' || diagram.dataset.diagramStage != null) return false;
    if (diagram.__mermaidSource == null) diagram.__mermaidSource = diagram.textContent;
    return true;
  });
}
// Rounds rather than one call: a theme change or a fresh render bumps the generation and returns the pass part-way, so it is run again until nothing is waiting. A round that shrank nothing is not the end on its own — the first font load after a document opens repaints every drawing back to a box, and a pass that stopped on that one round sent a 67-diagram document with 376 frames on it. Three such rounds in a row is a block nothing can draw, and that is where it gives up.
const MERMAID_EXPORT_STALLED_ROUNDS = 3;
async function drawEveryMermaidDiagram() {
  mermaidExportDrawing += 1;
  mermaidExportHolding = true;
  try {
    let waiting = mermaidWaitingForExport();
    let stalled = 0;
    while (waiting.length) {
      await drawMermaidDiagrams(waiting);
      const left = mermaidWaitingForExport();
      stalled = left.length >= waiting.length ? stalled + 1 : 0;
      if (stalled >= MERMAID_EXPORT_STALLED_ROUNDS) return;
      waiting = left;
    }
  } finally {
    mermaidExportDrawing -= 1;
  }
}

// The rail is a clone of the page, so a box the page has handed back clones as a blank — a document read once left the picture mostly empty boxes. The drawing is still in the memo, so the clone takes it from there. Done on the detached copy before it goes on screen, so nothing on the page is touched, and the box keeps the exact height it has in the document, which is what holds the thumbnail lined up with the real thing.
function fillMermaidClone(preview) {
  for (const box of preview.querySelectorAll('pre.mermaid:not([data-processed="true"]):not([data-mermaid-render="failed"])')) {
    const drawing = mermaidRenderCache.get(mermaidCacheKey(box.textContent));
    if (!drawing) continue;
    box.innerHTML = drawing;
    ensureMermaidSheets(box);
    box.dataset.processed = 'true';
    delete box.dataset.diagramWait;
  }
}
// The reading column's width is half the height key, so a change to it makes every remembered height a guess. Re-mark the waiting boxes, so none is left pinned to a height measured at another width, and warm again to learn the new ones.
let mermaidColumnWidth = -1;
function mermaidNoteColumnWidth() {
  const body = app.querySelector('.document-body');
  mermaidColumnWidth = body ? Math.round(body.getBoundingClientRect().width) : 0;
}
function mermaidColumnWidthChanged() {
  const body = app.querySelector('.document-body');
  const width = body ? Math.round(body.getBoundingClientRect().width) : 0;
  if (width === mermaidColumnWidth) return;
  mermaidColumnWidth = width;
  if (!body) return;
  for (const diagram of body.querySelectorAll('pre.mermaid:not([data-processed="true"]):not([data-mermaid-render="failed"])')) {
    if (diagram.__mermaidSource != null) markMermaidWait(diagram, diagram.dataset.diagramWait !== 'far');
  }
  scheduleMermaidWarmPass();
}
window.addEventListener('resize', mermaidColumnWidthChanged);

// Restore what the memo has, queue the rest. Called with the diagrams near the reader, on open and on every scroll — and with the whole document behind it when the page is being warmed, which is the only pass a reader's gesture is allowed to stop. Hands back the drawing it started, so an export can wait for it.
function drawMermaidDiagrams(candidates, warming) {
  if (!candidates.length) {
    return;
  }
  const diagrams = [];
  let restored = false;
  candidates.forEach((diagram) => {
    const cached = mermaidRenderCache.get(mermaidCacheKey(diagram.__mermaidSource));
    if (cached) {
      diagram.innerHTML = cached;
      // The drawing's rules are the page's now, and a theme the reader left and came back to dropped them on the way out.
      ensureMermaidSheets(diagram);
      diagram.dataset.processed = 'true';
      finishMermaidDiagram(diagram);
      addMermaidControls(diagram);
      restored = true;
      return;
    }
    diagrams.push(diagram);
  });
  if (restored) {
    mermaidPageTextChanged();
  }
  if (!diagrams.length) {
    return;
  }
  // Nearest the reader first, a few at a time. Sixty diagrams in one batch froze the window for five seconds, nothing painted until the last was done.
  diagrams.sort((a, b) => mermaidReaderDistance(a) - mermaidReaderDistance(b));
  mermaidRenderGeneration += 1;
  return drawMermaidBatches(diagrams, mermaidRenderGeneration, warming);
}

// The height it drew to is worth keeping: a box refilled at that height moves nothing on the page. A `click A "…"` box is drawn as a real SVG anchor, and mermaid writes only `xlink:href` — which `documentLinkFor` does not match, so the click was the web view's and it navigated the whole app out of the app. Copying the target onto `href` hands the box to the reader's own link handlers.
const MERMAID_XLINK_NS = 'http://www.w3.org/1999/xlink';
function claimMermaidLinks(diagram) {
  for (const link of diagram.querySelectorAll('a')) {
    if (link.hasAttribute('href')) continue;
    const target = link.getAttributeNS(MERMAID_XLINK_NS, 'href');
    if (target) link.setAttribute('href', target);
  }
}

// ---- one sheet for every drawing that draws the same ------------------------
// Mermaid writes a whole stylesheet into each drawing it makes, every rule scoped by that drawing's own svg id — so 67 diagrams carry 67 sheets and 44 of them are byte-identical. Hoist them: normalize the id out, keep one copy of each distinct sheet in the page's head, and give the drawing a class where its rules had the id. Measured on the test document, that alone is 1.8x the scroll.
const MERMAID_SHEET_ID = 'leaf-mermaid-sheets';
const MERMAID_SHEET_CLASS = 'lt-mmd-';
// The id stands out of the text while it is being matched, so a sheet is keyed on what it says rather than on which drawing said it. Not a character CSS can hold.
const MERMAID_SHEET_MARK = String.fromCharCode(0);
// What each distinct sheet is called, and what it says. Both are kept for the life of the page even when the rules are dropped: the picture memo still holds drawings from a theme that has been left, and restoring one has to be able to put its sheet back.
const mermaidSheetClasses = new Map();
const mermaidSheetTexts = new Map();
// What is written into the page right now, and every animation any sheet has asked for.
const mermaidLiveSheets = new Set();
const mermaidSheetFrames = new Set();
let mermaidSheetHolder = null;
function mermaidSheetElement() {
  if (!mermaidSheetHolder) {
    mermaidSheetHolder = document.createElement('style');
    mermaidSheetHolder.id = MERMAID_SHEET_ID;
    document.head.appendChild(mermaidSheetHolder);
  }
  return mermaidSheetHolder;
}
// A sheet's `@keyframes` blocks, taken out of it. They carry no id to normalize and no color to re-theme, so they are the one part written once for the whole page rather than once per distinct sheet — and they stay when a theme change drops the rest.
function splitMermaidFrames(text) {
  let rules = '';
  const frames = [];
  let at = 0;
  for (;;) {
    const start = text.indexOf('@keyframes', at);
    if (start < 0) {
      rules += text.slice(at);
      return { rules, frames };
    }
    rules += text.slice(at, start);
    let cut = text.indexOf('{', start);
    if (cut < 0) {
      rules += text.slice(start);
      return { rules, frames };
    }
    let depth = 0;
    for (; cut < text.length; cut += 1) {
      if (text[cut] === '{') depth += 1;
      else if (text[cut] === '}') {
        depth -= 1;
        if (!depth) {
          cut += 1;
          break;
        }
      }
    }
    frames.push(text.slice(start, cut));
    at = cut;
  }
}
// Written into the page, once. Appended rather than rebuilt: the browser re-reads the whole sheet either way, and there are 23 of them on a document of 67 drawings.
function keepMermaidSheet(cls) {
  if (mermaidLiveSheets.has(cls)) return;
  mermaidLiveSheets.add(cls);
  mermaidSheetElement().textContent += mermaidSheetTexts.get(cls) || '';
}
// A drawing restored from the picture memo carries its class and no sheet of its own, so whatever it names has to be in the page before it is put back — a theme the reader has been away from and come back to dropped its rules on the way out.
function ensureMermaidSheets(node) {
  const svg = node && typeof node.querySelector === 'function' ? node.querySelector('svg') : null;
  const names = svg && svg.getAttribute ? String(svg.getAttribute('class') || '').split(/\s+/) : [];
  for (const name of names) if (mermaidSheetTexts.has(name)) keepMermaidSheet(name);
}
// The drawing's own sheet, hoisted. Called before the picture memo is written, so what is remembered — and what the rail clones out of it — carries the class rather than a second copy of the sheet.
function shareMermaidSheet(diagram) {
  const svg = diagram.querySelector('svg');
  const style = svg ? svg.querySelector('style') : null;
  if (!svg || !style) return;
  const split = splitMermaidFrames(style.textContent || '');
  for (const frame of split.frames) {
    if (mermaidSheetFrames.has(frame)) continue;
    mermaidSheetFrames.add(frame);
    mermaidSheetElement().textContent += frame;
  }
  const id = svg.id;
  const normalized = id ? split.rules.split('#' + id).join(MERMAID_SHEET_MARK) : split.rules;
  let cls = mermaidSheetClasses.get(normalized);
  if (!cls) {
    // Numbered by how many distinct sheets have ever been seen, and never reused: a drawing left in the picture memo from an earlier theme still names the class it was given.
    cls = MERMAID_SHEET_CLASS + mermaidSheetClasses.size;
    mermaidSheetClasses.set(normalized, cls);
    mermaidSheetTexts.set(cls, normalized.split(MERMAID_SHEET_MARK).join('.' + cls));
  }
  keepMermaidSheet(cls);
  svg.classList.add(cls);
  style.remove();
}
// The theme changed, so every rule in there paints the theme being left. Dropped rather than left to grow one set per theme a reader tries; the animations stay, and the text of each sheet is kept so a drawing restored from the memo can put its own back.
function forgetMermaidSheets() {
  if (!mermaidLiveSheets.size) return;
  mermaidLiveSheets.clear();
  mermaidSheetElement().textContent = Array.from(mermaidSheetFrames).join('');
}

// A drawing off screen stops paying for itself: the browser skips painting inside the block while it is away, and is told the exact height to hold the place open with. Only ever after the height has been measured — the skip is what would otherwise make that measurement the placeholder's own size. `auto` in front of it means the browser prefers what it last drew and falls back to ours, so a drawing that has been on screen once never guesses.
function skipMermaidPaintOffScreen(diagram, height) {
  // The stand-in size is the box's contents, and the height measured is the whole block — so the padding around a diagram has to come off, or every skipped block stands 25px taller than the drawing it is holding a place for and the document grows by that much per diagram.
  const around = window.getComputedStyle(diagram);
  const edges = ['padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width']
    .reduce((sum, name) => sum + (Number.parseFloat(around.getPropertyValue(name)) || 0), 0);
  diagram.style.containIntrinsicSize = `auto ${Math.max(0, Math.round(height - edges))}px`;
  diagram.style.contentVisibility = 'auto';
}
function drawMermaidPaintAlways(diagram) {
  diagram.style.removeProperty('content-visibility');
  diagram.style.removeProperty('contain-intrinsic-size');
}

function finishMermaidDiagram(diagram) {
  claimMermaidLinks(diagram);
  delete diagram.dataset.diagramWait;
  // All three, and before the height is read: a drawing left holding the exact height its box was given would be clamped to what it measured last time for ever, and one still skipping its own paint would measure the size it was standing in for.
  diagram.style.removeProperty('height');
  diagram.style.removeProperty('min-height');
  drawMermaidPaintAlways(diagram);
  if (mermaidViewObserver) mermaidViewObserver.unobserve(diagram);
  if (diagram.__mermaidSource == null) return;
  const height = Math.round(diagram.getBoundingClientRect().height);
  if (!height) return;
  if (mermaidDrawnHeights.size >= MERMAID_CACHE_CAP) mermaidDrawnHeights.clear();
  mermaidDrawnHeights.set(mermaidHeightKey(diagram.__mermaidSource), height);
  skipMermaidPaintOffScreen(diagram, height);
  watchMermaidForRecycling(diagram);
}

// A drawing you have already read stays on the page: it costs one shared sheet and no paint at all while it is away, and taking it back is what made a document read twice a document of blanks. Only a document neither memo can remember still hands them back — there the drawing is gone from the memo anyway, so a box put back has to be redrawn from scratch, and a page holding all of them gives up a second in one frame.
const MERMAID_FAR_SCREENS = 3;
let mermaidRecycleObserver = null;
const mermaidLeavingView = new Set();
function watchMermaidForRecycling(diagram) {
  if (typeof IntersectionObserver === 'undefined') return;
  // Nothing to watch for on a document that keeps every drawing it makes.
  if (!mermaidDocumentPastMemory()) return;
  if (!mermaidRecycleObserver) {
    mermaidRecycleObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) mermaidLeavingView.delete(entry.target);
        else mermaidLeavingView.add(entry.target);
      }
      if (mermaidLeavingView.size) scheduleMermaidPass();
    }, { root: app, rootMargin: `${MERMAID_FAR_SCREENS * 100}% 0px` });
  }
  mermaidRecycleObserver.observe(diagram);
}
// What must keep its drawing however far away it is.
function mermaidMayRecycle(diagram) {
  // Whatever is far from the reader is on the paper all the same.
  if (mermaidExportDrawing || mermaidExportHolding) return false;
  // A document the memos can hold keeps every drawing it makes, which is the whole of this: the empty box was the app's second-most-named fault and nothing on a page this size is worth it.
  if (!mermaidDocumentPastMemory()) return false;
  if (!diagram.isConnected || diagram.dataset.processed !== 'true') return false;
  // Being edited, or held somewhere other than where the page put it: taking one back throws away what the reader did to it.
  if (diagram.dataset.editingSource === 'true') return false;
  if (diagram.classList.contains('is-moved') || diagram.classList.contains('is-panning')) return false;
  const overlay = diagramOverlayElement();
  if (overlay && overlay.__diagramBlock === diagram) return false;
  if (diagram.__mermaidSource == null) return false;
  // Past its cap the memo empties wholesale, so a box refilled after that redraws from scratch — worse on every scroll than the stylesheet it carries. A height nothing measured at this column width would move the page.
  return mermaidRenderCache.has(mermaidCacheKey(diagram.__mermaidSource))
    && mermaidDrawnHeights.has(mermaidHeightKey(diagram.__mermaidSource));
}
// Back to a box, at exactly the height the drawing had, so nothing on the page moves.
function recycleMermaidDiagram(diagram) {
  if (!mermaidMayRecycle(diagram)) return false;
  if (mermaidRecycleObserver) mermaidRecycleObserver.unobserve(diagram);
  diagram.textContent = diagram.__mermaidSource;
  delete diagram.dataset.processed;
  markMermaidWait(diagram, false);
  if (mermaidViewObserver) mermaidViewObserver.observe(diagram);
  return true;
}

// Drawing swaps a diagram's source out for its labels, so Ctrl+F re-walks and re-lands on the drawn label where the source was.
function mermaidPageTextChanged() {
  readerAnchorBlocks = null;
  refreshFind();
}

// One window of margin either way, so a diagram is drawn before it is scrolled to rather than after.
let mermaidViewObserver = null;
let mermaidWatchedBody = null;
const mermaidWaitingNearby = new Set();
let mermaidDrainTimer = 0;
function watchMermaidDiagrams(candidates) {
  if (typeof IntersectionObserver === 'undefined') {
    // No watcher: nothing will ever report a diagram as near, so draw them all.
    drawMermaidDiagrams(candidates);
    return;
  }
  if (!mermaidViewObserver) {
    mermaidViewObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const diagram = entry.target;
        if (diagram.dataset.processed === 'true' || diagram.dataset.mermaidRender === 'failed') {
          mermaidViewObserver.unobserve(diagram);
          continue;
        }
        markMermaidWait(diagram, entry.isIntersecting);
        if (entry.isIntersecting) mermaidWaitingNearby.add(diagram);
        else mermaidWaitingNearby.delete(diagram);
      }
      if (mermaidWaitingNearby.size) scheduleMermaidPass();
    }, { root: app, rootMargin: `${MERMAID_NEAR_SCREENS * 100}% 0px` });
  }
  for (const diagram of candidates) mermaidViewObserver.observe(diagram);
}
// Wait for the gesture to stop: a diagram growing above the reader mid-scroll shifts the page under their thumb, and the re-pin that would undo that stands aside while they scroll.
function scheduleMermaidPass() {
  if (mermaidDrainTimer) return;
  mermaidDrainTimer = window.setTimeout(() => {
    mermaidDrainTimer = 0;
    // Still scrolling: drop the pass rather than set another timer. The settle after the last wheel click calls back.
    if (readerScrolling) return;
    // The same stand-down the warm pass takes: a pass into a document an export is drawing bumps the generation that one is watching and cancels it part-way.
    if (mermaidExportDrawing) return;
    // Boxes back first: a recycled box holds its drawing's height, so only the drawings can move anything. The queue is left standing rather than dropped while an export is still to be rendered, so the reader's own next scroll is what drains it.
    if (!mermaidExportHolding) {
      for (const diagram of mermaidLeavingView) recycleMermaidDiagram(diagram);
      mermaidLeavingView.clear();
    }
    const queue = Array.from(mermaidWaitingNearby).filter((diagram) => diagram.isConnected
      && diagram.dataset.processed !== 'true'
      && diagram.dataset.mermaidRender !== 'failed');
    mermaidWaitingNearby.clear();
    drawMermaidDiagrams(queue);
  }, READER_SCROLL_SETTLE_MS);
}
// The gesture stopped, so anything held for it can go now. Only when something is actually waiting: a settle with an empty queue has nothing to draw.
function readerScrollSettled() {
  // They are reading again rather than exporting, so whatever the export was holding drawn can go back to boxes.
  mermaidExportHolding = false;
  if (mermaidWaitingNearby.size || mermaidLeavingView.size) scheduleMermaidPass();
  scheduleMermaidWarmPass();
}
// A render replaces the document, so every box the old one was watching is gone.
function forgetMermaidWatch() {
  // A fresh document is not the one an export was holding drawings for.
  mermaidExportHolding = false;
  if (mermaidViewObserver) {
    mermaidViewObserver.disconnect();
    mermaidViewObserver = null;
  }
  if (mermaidRecycleObserver) {
    mermaidRecycleObserver.disconnect();
    mermaidRecycleObserver = null;
  }
  mermaidWaitingNearby.clear();
  mermaidLeavingView.clear();
  if (mermaidDrainTimer) {
    window.clearTimeout(mermaidDrainTimer);
    mermaidDrainTimer = 0;
  }
  if (mermaidWarmTimer) {
    window.clearTimeout(mermaidWarmTimer);
    mermaidWarmTimer = 0;
  }
}

// How far a diagram is from the middle of the window, for the order within a batch.
function mermaidReaderDistance(diagram) {
  const rect = diagram.getBoundingClientRect();
  const middle = mermaidViewHeight() / 2;
  return Math.abs(rect.top + rect.height / 2 - middle);
}

// A block grows downward, so only one whose bottom edge is already at or above the reader's top edge shoves what they can see. One straddling that edge grows into the room under their eyes, and paying for it would drag the diagram they are reading up off the top of the window.
function mermaidBlocksAboveReader(batch) {
  const topEdge = app.getBoundingClientRect().top;
  const above = [];
  for (const diagram of batch) {
    const rect = diagram.getBoundingClientRect();
    if (rect.bottom <= topEdge) above.push({ diagram, height: rect.height });
  }
  return above;
}
// Pay back what they gained, in the same task as the draw. Mermaid hands the page back nowhere inside one `mermaid.run` — a timer, a message task and an animation frame queued in front of it all fired after it resolved — so this lands before the browser's next chance to paint and the reader never sees the shove. Negative when a drawing came out shorter than the box that held it, which moves the page the other way and is owed just the same. Nothing is re-recorded afterwards: the reader's place is a block plus its offset from the top edge, and an exact repayment leaves that pair untouched, so the frame-based re-pin that follows has nothing left to correct.
function mermaidRepayGrowthAbove(above) {
  if (!above.length) return;
  let gain = 0;
  for (const entry of above) {
    if (!entry.diagram.isConnected) continue;
    gain += entry.diagram.getBoundingClientRect().height - entry.height;
  }
  if (Math.abs(gain) < 0.5) return;
  setReaderScrollTop(app.scrollTop + gain);
}

// Small enough that one slow diagram cannot hold the window.
const MERMAID_BATCH_SIZE = 3;
// Warming is nobody's gesture, so it goes one at a time and rests between them. Three at a time took the window for 118 ms at the median and 293 ms at the worst, sixty-odd times over — which reads as the app stuttering, because it is. One diagram is a third of that, and the rest below is long enough for the window to answer a wheel or a click before the next one starts. It makes the whole warm slower, which costs nothing: the rail says it is working and no reader is waiting on it.
const MERMAID_WARM_BATCH_SIZE = 1;
const MERMAID_WARM_REST_MS = 50;
// Which render pass is the current one. A theme switch mid-draw starts another, and the one it interrupted must stop rather than finish painting the old colors over the new.
let mermaidRenderGeneration = 0;

function drawMermaidBatches(diagrams, generation, warming) {
  return loadMermaid()
    .then(async (mermaid) => {
      // A box is only as wide as mermaid measured its label, so measuring in the fallback face and painting in the theme's takes the last letter off every one of them. Wait for the faces the page has asked for before measuring.
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      if (generation !== mermaidRenderGeneration) return;
      // Re-read every time: the theme in force at this render is what these diagrams must be drawn in, not the one that was in force at the last.
      registerMermaidIcons(mermaid);
      mermaid.initialize(mermaidRuntimeConfig());
      // The rail mirrors the document, so every batch would rebuild it. One rebuild for the pass instead; the reader's own re-pin still runs per batch, which is what holds the reading position as diagrams grow.
      pauseMinimapPreview();
      try {
        const size = warming ? MERMAID_WARM_BATCH_SIZE : MERMAID_BATCH_SIZE;
        for (let at = 0; at < diagrams.length; at += size) {
          if (generation !== mermaidRenderGeneration) return;
          // The moment the reader touches the page a warm pass stops where it is; nothing is kept, because the queue is re-derived from what has no measured height and the settle after their last wheel click starts it again.
          if (warming && readerScrolling) return;
          const batch = diagrams.slice(at, at + size).filter((diagram) => diagram.isConnected);
          if (!batch.length) continue;
          // Measured before mermaid touches them, repaid after the drawings and the inline heights have both landed.
          const above = mermaidBlocksAboveReader(batch);
          // Before mermaid reads them, not after: a box it cannot draw takes the whole batch down from inside its own renderer.
          for (const diagram of batch) {
            const drawable = await mermaidDrawableSource(diagram.__mermaidSource);
            if (drawable != null && drawable !== diagram.textContent) diagram.textContent = drawable;
          }
          if (generation !== mermaidRenderGeneration) return;
          try {
            await mermaid.run({ nodes: batch });
          } catch (error) {
            // Mermaid keeps drawing after one block throws and leaves its error picture in the block it failed on, so only that one is marked and the rest of the batch finishes as usual. A block it never reached has neither the error nor a drawing, and is marked too rather than left spinning.
            console.error(error);
            for (const diagram of batch) {
              if (diagram.querySelector('.error-icon') || !diagram.querySelector('svg')) diagram.dataset.mermaidRender = 'failed';
            }
          }
          for (const diagram of batch) {
            if (diagram.dataset.mermaidRender === 'failed') {
              // It keeps the error it drew, so stop watching — but the spinner has to go, or a refusal spins behind its own message.
              delete diagram.dataset.diagramWait;
              if (mermaidViewObserver) mermaidViewObserver.unobserve(diagram);
              continue;
            }
            if (diagram.__mermaidSource == null) continue;
            if (mermaidRenderCache.size >= MERMAID_CACHE_CAP) mermaidRenderCache.clear();
            // Sheet first, memo second, button third: the cache holds innerHTML, so hoisting after it would remember a sheet the page had already taken away, and a button baked into it would come back on every restore and stack up.
            shareMermaidSheet(diagram);
            mermaidRenderCache.set(mermaidCacheKey(diagram.__mermaidSource), diagram.innerHTML);
            finishMermaidDiagram(diagram);
            addMermaidControls(diagram);
          }
          mermaidRepayGrowthAbove(above);
          // Each batch changed the block layout; drop the cached anchor list, and let whatever else watches the page catch up before the next one.
          readerAnchorBlocks = null;
          // A warm pass waits for the window to paint and then rests; a pass the reader is waiting on yields and goes straight on.
          if (warming) await new Promise((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, MERMAID_WARM_REST_MS)));
          else await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      } finally {
        resumeMinimapPreview();
        // The words the search was pointing at inside these diagrams are gone now.
        mermaidPageTextChanged();
        // Every pass ends by asking whether anything is still unmeasured, so a warm pass that a nearer one interrupted picks itself up rather than stalling until the reader scrolls. It settles: each attempt measures what it draws, so the queue only ever shrinks.
        scheduleMermaidWarmPass();
      }
    })
    .catch((error) => {
      console.error(error);
    });
}

// A drawn diagram gets its corner controls. The drawing itself is dragged to move it, so the source opens from a button here rather than from a press anywhere on the block — see wireSourceEditable, which stands aside for these.
function addMermaidControls(diagram) {
  addMermaidViewControls(diagram);
  addMermaidEditButtons(diagram);
}

function addMermaidEditButtons(diagram) {
  if (currentDocumentFormat !== 'markdown' || !readerEditingAllowed()) return;
  if (!Number.isFinite(Number(diagram.dataset.srcStart)) || !Number.isFinite(Number(diagram.dataset.srcEnd))) return;
  if (diagram.querySelector('.mermaid-tools')) return;
  const tools = document.createElement('div');
  tools.className = 'mermaid-tools';
  tools.appendChild(mermaidToolButton('source', 'Edit the Mermaid text of this diagram', `<span class="lt-icon lt-icon-code-view"></span>`));
  tools.appendChild(mermaidToolButton('sheet', 'Open in the flowchart editor, to draw it', `<span class="lt-icon lt-icon-workflow"></span>`));
  diagram.appendChild(tools);
}

function mermaidToolButton(tool, label, icon) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mermaid-tool';
  button.dataset.mermaidTool = tool;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  return button;
}

// Zoom is not an editing affordance: a locked document gets it too. Each tooltip names the other way of doing the same thing, because the wheel and the drag have nothing on screen to announce them.
const MERMAID_ZOOM_BUTTONS = [
  ['out', 'Zoom out — or Ctrl and the wheel', `<span class="lt-icon lt-icon-zoom-out"></span>`],
  ['fit', 'Whole diagram, back where it started — or double-click it', `<span class="lt-icon lt-icon-fit"></span>`],
  ['in', 'Zoom in — or Ctrl and the wheel. Drag the diagram to move it', `<span class="lt-icon lt-icon-zoom-in"></span>`],
];
// The fourth, on the block in the page only: the overlay it opens carries the three above and its own way out, so a diagram already full screen has nothing to expand into.
const MERMAID_FULL_BUTTON = ['full', 'Open it on the whole window', `<span class="lt-icon lt-icon-expand"></span>`];
// The group the overlay builds too — diagram-view.js asks for the three without the fourth. Its buttons carry no listeners: the click is delegated off `app`, so a group anywhere inside a `pre.mermaid` is answered.
function mermaidZoomGroup(buttons, label) {
  const group = document.createElement('div');
  group.className = 'mermaid-zoom';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  for (const [step, title, icon] of buttons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.mermaidZoom = step;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = icon;
    group.appendChild(button);
  }
  return group;
}
// Its own rounded control rather than a fifth segment of the zoom: keeping a diagram is not a way of looking at one. No listener of its own — the click is delegated off `app`, the way the zoom's is.
function mermaidExportButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mermaid-export';
  const label = 'Save this diagram as a file';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<span class="lt-icon lt-icon-export"></span>`;
  return button;
}

// The top-right row: how the diagram is looked at, and taking a copy of it out. Neither is editing, so nothing here asks the padlock — addMermaidEditButtons above is the one that does.
function addMermaidViewControls(diagram) {
  if (diagram.querySelector('.mermaid-view-controls')) return;
  const row = document.createElement('div');
  row.className = 'mermaid-view-controls';
  row.appendChild(mermaidExportButton());
  row.appendChild(mermaidZoomGroup(MERMAID_ZOOM_BUTTONS.concat([MERMAID_FULL_BUTTON]), 'Diagram view'));
  diagram.appendChild(row);
}

// Export, pressed on a diagram anywhere: the corner of a drawn block, or the full-window view. The text is the block's own — an overlay is a second drawing of a block still in the page, so it exports what that block holds. On Windows nothing opens over the page, because the save window carries the formats; the host is what the menu a Mac gets hangs off, since the page's block sits in the reader, which scrolls and would clip it.
function openMermaidExportMenu(button) {
  const overlay = button.closest('.diagram-overlay');
  const block = overlay ? overlay.__diagramBlock : button.closest('pre.mermaid');
  const source = block ? block.__mermaidSource : null;
  if (!source) return;
  beginDiagramExport(source, button, overlay || appSurface);
}

// ---- the drawing inside its box --------------------------------------------

// The block keeps the height it was laid out at and the drawing moves inside it, so leaning into one diagram never shifts the words around it.
const MERMAID_ZOOM_MIN = 0.5;
const MERMAID_ZOOM_MAX = 8;

// Held on the block, never as a style on the SVG: the render cache stores the SVG's own markup, and a size baked into that would come back zoomed on every restore.
function mermaidView(diagram) {
  return diagram.__mermaidView || { zoom: 1, x: 0, y: 0 };
}

// Panning is bounded by the box, not by the drawing's edges: a diagram that fills its box still has to move, because a box taller than the window is read by dragging it up rather than by scrolling the page away from it. This much stays inside, so it can never be pushed out of sight and lost.
const MERMAID_PAN_KEEP = 48;

// The drawing as it sits on an untouched page, taken the first time one is moved — the last moment it is still what the page laid out. Zoom counts from here, not from the viewBox: a diagram wider than the column is already drawn shrunk to fit, and that is what "life size" has to mean or Fit would not put it back.
function mermaidNatural(diagram, svg) {
  if (!diagram.__mermaidNatural) {
    const drawn = svg.getBoundingClientRect();
    diagram.__mermaidNatural = {
      width: drawn.width,
      height: drawn.height,
      boxHeight: diagram.getBoundingClientRect().height,
      attrWidth: svg.getAttribute('width'),
      attrHeight: svg.getAttribute('height'),
      maxWidth: svg.style.maxWidth,
    };
  }
  return diagram.__mermaidNatural;
}

// The SVG is resized, never scaled: a CSS scale re-lays out the HTML inside mermaid's foreignObject labels against boxes that did not grow with them, and every label loses its last letter. The flowchart sheet sizes its stage the same way, for the same reason.
function setMermaidView(diagram, next) {
  // The block's own drawing, not the icons in the corner buttons.
  const svg = diagram.querySelector(':scope > svg');
  if (!svg) return;
  const natural = mermaidNatural(diagram, svg);
  const zoom = Math.max(MERMAID_ZOOM_MIN, Math.min(MERMAID_ZOOM_MAX, next.zoom));
  const width = natural.width * zoom;
  const height = natural.height * zoom;
  const roomX = Math.max(0, (width + diagram.clientWidth) / 2 - MERMAID_PAN_KEEP);
  const roomY = Math.max(0, (height + natural.boxHeight) / 2 - MERMAID_PAN_KEEP);
  const view = {
    zoom,
    x: Math.max(-roomX, Math.min(roomX, next.x)),
    y: Math.max(-roomY, Math.min(roomY, next.y)),
  };
  diagram.__mermaidView = view;
  if (view.zoom === 1 && view.x === 0 && view.y === 0) {
    resetMermaidView(diagram, svg, natural);
    return;
  }
  // Out of flow, so the block keeps the height the page gave it however big the drawing gets.
  diagram.classList.add('is-moved');
  diagram.style.setProperty('--mermaid-box-height', natural.boxHeight + 'px');
  diagram.style.setProperty('--mermaid-pan-x', view.x + 'px');
  diagram.style.setProperty('--mermaid-pan-y', view.y + 'px');
  svg.setAttribute('width', String(Math.max(1, Math.round(width))));
  svg.setAttribute('height', String(Math.max(1, Math.round(height))));
  svg.style.maxWidth = 'none';
}

// Back to the drawing the page laid out, mermaid's own sizing and all.
function resetMermaidView(diagram, svg, natural) {
  diagram.classList.remove('is-moved');
  diagram.style.removeProperty('--mermaid-box-height');
  diagram.style.removeProperty('--mermaid-pan-x');
  diagram.style.removeProperty('--mermaid-pan-y');
  if (natural.attrWidth == null) svg.removeAttribute('width');
  else svg.setAttribute('width', natural.attrWidth);
  if (natural.attrHeight == null) svg.removeAttribute('height');
  else svg.setAttribute('height', natural.attrHeight);
  svg.style.maxWidth = natural.maxWidth;
}

// Zoom about a point, holding whatever sits under it still — otherwise leaning in on one corner walks the thing you were looking at off the box.
function zoomMermaidAt(diagram, factor, clientX, clientY) {
  const view = mermaidView(diagram);
  const zoom = Math.max(MERMAID_ZOOM_MIN, Math.min(MERMAID_ZOOM_MAX, view.zoom * factor));
  const box = diagram.getBoundingClientRect();
  const atX = clientX - (box.left + box.width / 2);
  const atY = clientY - (box.top + box.height / 2);
  const scale = zoom / view.zoom;
  setMermaidView(diagram, {
    zoom,
    x: atX - (atX - view.x) * scale,
    y: atY - (atY - view.y) * scale,
  });
}

function mermaidCenterZoom(diagram, factor) {
  const box = diagram.getBoundingClientRect();
  zoomMermaidAt(diagram, factor, box.left + box.width / 2, box.top + box.height / 2);
}

// The drawn diagram under a pointer, or nothing — one swapped for its source is a code block being typed in and answers to none of this.
function mermaidDiagramFor(target) {
  if (!target || !target.closest) return null;
  const diagram = target.closest('pre.mermaid[data-processed="true"]');
  if (!diagram || diagram.dataset.editingSource === 'true') return null;
  return diagram;
}

// Delegated, not per-button: a diagram restored from its own rendered HTML (an abandoned source edit does exactly that) brings the markup back without the listeners. The capture pass keeps a press on a control off the block underneath, whose gutter and selection handling would otherwise answer first.
let mermaidPan = null;
if (app) {
  app.addEventListener(
    'pointerdown',
    (event) => {
      const control = event.target && event.target.closest ? event.target.closest('.mermaid-tool, .mermaid-zoom button, .mermaid-export, .diagram-close') : null;
      if (control) event.stopPropagation();
    },
    true,
  );
  // Left or middle button, the two every canvas drags with.
  app.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    const diagram = mermaidDiagramFor(event.target);
    if (!diagram) return;
    if (event.target.closest('.mermaid-tools, .mermaid-view-controls, .mermaid-zoom, .diagram-close, a')) return;
    // Keeps the drag from selecting the labels it passes over. It holds focus where it was too, so a block being edited elsewhere is closed by hand.
    if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
    event.preventDefault();
    mermaidPan = { diagram, pointer: event.pointerId, x: event.clientX, y: event.clientY, from: mermaidView(diagram) };
    leafHoldPointer(diagram, event.pointerId);
    diagram.classList.add('is-panning');
  });
  app.addEventListener('pointermove', (event) => {
    if (!mermaidPan || event.pointerId !== mermaidPan.pointer) return;
    setMermaidView(mermaidPan.diagram, {
      zoom: mermaidPan.from.zoom,
      x: mermaidPan.from.x + (event.clientX - mermaidPan.x),
      y: mermaidPan.from.y + (event.clientY - mermaidPan.y),
    });
  });
  const endMermaidPan = () => {
    if (!mermaidPan) return;
    mermaidPan.diagram.classList.remove('is-panning');
    mermaidPan = null;
  };
  app.addEventListener('pointerup', endMermaidPan);
  app.addEventListener('pointercancel', endMermaidPan);
  // Ctrl or Cmd and the wheel, the way every canvas does it — and what a trackpad pinch arrives as. A plain wheel is left alone so it still scrolls the page.
  app.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const diagram = mermaidDiagramFor(event.target);
      if (!diagram) return;
      event.preventDefault();
      zoomMermaidAt(diagram, event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY);
    },
    { passive: false },
  );
  app.addEventListener(
    'wheel',
    (event) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey || !event.deltaY) return;
      if (mermaidDiagramFor(event.target)) return;
      const lane = event.target && event.target.closest ? event.target.closest('.table-lane') : null;
      const table = lane && lane.querySelector(':scope > table');
      if (!table || table.scrollWidth <= table.clientWidth) return;
      const end = table.scrollWidth - table.clientWidth;
      table.scrollLeft = Math.max(0, Math.min(end, table.scrollLeft + event.deltaY));
      event.preventDefault();
    },
    { passive: false },
  );
  app.addEventListener('click', (event) => {
    if (!event.target || !event.target.closest) return;
    const zoomButton = event.target.closest('.mermaid-zoom button');
    if (zoomButton) {
      event.preventDefault();
      const diagram = zoomButton.closest('pre.mermaid');
      if (!diagram) return;
      const step = zoomButton.dataset.mermaidZoom;
      if (step === 'full') openDiagramOverlay(diagram, zoomButton);
      else if (step === 'fit') setMermaidView(diagram, { zoom: 1, x: 0, y: 0 });
      else mermaidCenterZoom(diagram, step === 'in' ? 1.25 : 1 / 1.25);
      return;
    }
    const exportButton = event.target.closest('.mermaid-export');
    if (exportButton) {
      event.preventDefault();
      openMermaidExportMenu(exportButton);
      return;
    }
    const tool = event.target.closest('.mermaid-tool');
    if (!tool) return;
    event.preventDefault();
    const diagram = tool.closest('pre.mermaid');
    if (!diagram) return;
    if (tool.dataset.mermaidTool === 'source') startBlockSourceEdit(diagram);
    else openMermaidBlockSheet(diagram);
  });
  // Double-click puts it back where it started, so there is a way out of a pan that went too far without reaching for the Fit button.
  app.addEventListener('dblclick', (event) => {
    const diagram = mermaidDiagramFor(event.target);
    if (!diagram || event.target.closest('.mermaid-tools, .mermaid-view-controls, .mermaid-zoom, .diagram-close, a')) return;
    setMermaidView(diagram, { zoom: 1, x: 0, y: 0 });
  });
  // Otherwise the middle button opens the web view's own scroll-anywhere puck over a diagram already being dragged with it.
  app.addEventListener('auxclick', (event) => {
    if (event.button === 1 && mermaidDiagramFor(event.target)) event.preventDefault();
  });
}

// Draw the diagrams again in the theme that just arrived: an SVG holds its colors as literal values, so recoloring one means drawing it again. One that failed before gets another go — this may be a theme it can be drawn in.
function repaintMermaidDiagrams() {
  const diagrams = Array.from(app.querySelectorAll('pre.mermaid:not([data-diagram-stage])'));
  // Every shared sheet in the page paints the theme being left, and the drawings about to be made will write their own.
  forgetMermaidSheets();
  let any = false;
  for (const diagram of diagrams) {
    if (diagram.__mermaidSource == null) continue;
    if (diagram.dataset.editingSource === 'true') continue;
    diagram.textContent = diagram.__mermaidSource;
    delete diagram.dataset.processed;
    delete diagram.dataset.mermaidRender;
    any = true;
  }
  if (any) renderMermaidDiagrams();
  return any;
}

// The backstop for a face that lands after a diagram was drawn anyway. Once per theme — a repaint asks for no new faces, so this cannot chase itself — and only spent on a page that had diagrams to repaint: the app's own faces finish long before a document is open, and burning the one shot there is how every box came to be measured in the fallback and shipped clipped in v0.1.441.
let mermaidFontRepaintDone = false;
function repaintMermaidDiagramsForFonts() {
  if (mermaidFontRepaintDone) return;
  if (repaintMermaidDiagrams()) mermaidFontRepaintDone = true;
}
if (document.fonts && typeof document.fonts.addEventListener === 'function') {
  document.fonts.addEventListener('loadingdone', repaintMermaidDiagramsForFonts);
}

// The theme is announced on the root element, by the picker and by the system's own light/dark switch alike — so watching the attribute catches every way it can change without each of them having to know diagrams exist. A new family brings a new font, so the font repaint is armed again with it.
//
// Only a write that changed the value counts. The daylight mode re-applies the theme every time the window comes to the front, writing the same values back, and a repaint on that put every off-screen diagram back to a box that nothing redrew until it was scrolled to — which is what an export made straight after switching windows printed as empty frames.
if (typeof MutationObserver === 'function') {
  new MutationObserver((records) => {
    const root = document.documentElement;
    if (!records.some((record) => root.getAttribute(record.attributeName) !== record.oldValue)) return;
    mermaidFontRepaintDone = false;
    repaintMermaidDiagrams();
    // The sweep above skips the full-window stage, so it is redrawn by name.
    repaintDiagramOverlay();
  }).observe(document.documentElement, {
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['data-theme', 'data-leaf-theme'],
  });
}
// KaTeX (bundled, loaded lazily) renders the .math elements pulldown-cmark emits for $…$ and $$…$$. The raw TeX is the element's text; KaTeX replaces it in place, falling back to that readable text if the runtime can't load.
function loadKatex() {
  if (window.katex) {
    return Promise.resolve(window.katex);
  }
  if (katexLoadPromise) {
    return katexLoadPromise;
  }
  katexLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = KATEX_SCRIPT_URL;
    // Same anonymous pairing as Mermaid's tag: an unmasked throw names its place.
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.onload = () => {
      if (window.katex) {
        resolve(window.katex);
        return;
      }
      reject(new Error('KaTeX runtime loaded without exposing window.katex'));
    };
    script.onerror = () => reject(new Error('KaTeX runtime failed to load'));
    document.head.appendChild(script);
  });
  return katexLoadPromise;
}
// Typeset-math memo: TeX source (plus display mode) → the finished KaTeX markup. Same reasoning as the Mermaid cache: full re-renders on every editing commit re-typeset every formula; unchanged formulas restore instantly.
const katexRenderCache = new Map();
const KATEX_CACHE_CAP = 1000;
function renderMathElements() {
  const nodes = Array.from(app.querySelectorAll('.math:not([data-math-rendered])'));
  if (!nodes.length) {
    return;
  }
  const pending = [];
  nodes.forEach((node) => {
    const key = (node.classList.contains('math-display') ? 'D\n' : 'I\n') + node.textContent;
    const cached = katexRenderCache.get(key);
    if (cached != null) {
      node.innerHTML = cached;
      node.dataset.mathRendered = 'true';
      return;
    }
    pending.push({ node, key });
  });
  if (!pending.length) {
    return;
  }
  loadKatex()
    .then((katex) => {
      pending.forEach(({ node, key }) => {
        try {
          katex.render(node.textContent, node, {
            displayMode: node.classList.contains('math-display'),
            throwOnError: false,
          });
          if (katexRenderCache.size >= KATEX_CACHE_CAP) katexRenderCache.clear();
          katexRenderCache.set(key, node.innerHTML);
        } catch (error) {
          console.error(error);
        }
        node.dataset.mathRendered = 'true';
      });
    })
    .catch((error) => {
      console.error(error);
    });
}
let wideTableResizeObserver;
// Put each body table in a lane of its own, so it can use the reader's width and so the bands that dissolve a sliced column into the page have a box to be painted in — a mask on the table can only take ink away, never lay the dot screen on. The lane belongs to the reader, not the document, so everything that walks the body's blocks sees through it: `attachMarkdownBlockRanges` stamps the table inside, and `unwrapTableLane` in block-controls.js gives the gutter the table it wraps.
function laneWideTables(root = app) {
  const body = root.querySelector('.document-body');
  if (!body) return;
  for (const table of Array.from(body.children)) {
    if (table.tagName !== 'TABLE' || table.classList.contains('data-table')) continue;
    const lane = document.createElement('div');
    lane.className = 'table-lane';
    table.replaceWith(lane);
    lane.appendChild(table);
  }
  measureWideTables(root);
}

// A carded table has no grid width left in the layout, so every decision takes the cards off first and reads the grid a reader would have seen. Nothing is kept between decisions: the width a table that fits reports is its lane, so a remembered one turns the table into cards the moment the lane narrows under whatever it happened to be measured at, however much room the grid still has.
// The resets are all written before any width is read, so one settled layout answers every lane: over the plan log's sixteen lanes a delivery cost 71ms deciding lane by lane, each class write flushing layout for its own grid read, and costs 10ms read against one flush — from four frames a width change to under one.
function measureWideTables(root = app) {
  if (wideTableResizeObserver) wideTableResizeObserver.disconnect();
  const lanes = Array.from(root.querySelectorAll('.table-lane'));
  const decide = (changed) => {
    const pairs = [];
    for (const lane of changed) {
      const table = lane.querySelector('table');
      if (!table) continue;
      table.classList.remove('is-cards');
      table.classList.add('no-cards');
      pairs.push({ lane, table });
    }
    // The same 2px dead band the minimap keeps, and for the same reason: a lane sitting exactly on the width the grid wants would flip on every fractional resize.
    const cards = pairs.map(({ lane, table }) => table.scrollWidth > lane.clientWidth + 2);
    pairs.forEach(({ table }, at) => table.classList.toggle('is-cards', cards[at]));
  };
  decide(lanes);
  if (typeof ResizeObserver !== 'undefined') {
    wideTableResizeObserver = new ResizeObserver((entries) => decide(entries.map((entry) => entry.target)));
    lanes.forEach((lane) => wideTableResizeObserver.observe(lane));
  }
  // A font arriving late changes what the grid wants, so the answer is taken again once it has.
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => decide(lanes));
  }
}
// Mark a paragraph holding nothing but a picture, so the stylesheet can widen it to the reader's lane the way a table's is. No wrapper, so nothing walking the body learns a new shape. The mark is stamped here because CSS counts elements and never text: `p:has(> img:only-child)` matches a sentence with one picture in it just as it matches a picture alone. One picture and no words of its own is the test, so the opener the whole-window view appends is not counted either.
function laneWidePictures(root = app) {
  const body = root.querySelector('.document-body');
  if (!body) return;
  for (const block of Array.from(body.children)) {
    if (block.tagName !== 'P') continue;
    const pictures = Array.from(block.children).filter((child) => child.tagName === 'IMG');
    // A marked missing picture is our glyph over a transparent pixel, held at its own small size — widening its paragraph would stretch the mark and give a reader a lane with nothing in it.
    const alone =
      pictures.length === 1 && pictures[0].dataset.imageMissing !== 'true' && !(block.textContent || '').trim();
    block.classList.toggle('image-lane', alone);
  }
}
// Mark a link the sanitizer took the address off, so the stylesheet can stop painting it like a live one. On a class rather than on the missing address: an anchor written `<a name="…">` is a place in the page and never had one, and the rail's thumbnail is a clone with the address stripped off every link in it. The clone is taken after this runs, so only the genuinely dead links carry the mark into it.
function markLinksThatGoNowhere(root = app) {
  const body = root.querySelector('.document-body');
  if (!body) return;
  for (const link of body.querySelectorAll('a')) {
    // A place in the page keeps its name or its id through the sanitizer, so words of its own are what tell a link the author wrote from a landing somebody linked to.
    if (link.getAttribute('href') || link.getAttribute('name') || link.getAttribute('id')) continue;
    if (!(link.textContent || '').trim()) continue;
    link.classList.add('link-goes-nowhere');
  }
}
function decorateBlockquoteLines(root = app) {
  root.querySelectorAll('blockquote:not(.markdown-alert) p').forEach((paragraph) => {
    if (paragraph.querySelector('.blockquote-line')) return;
    const children = Array.from(paragraph.childNodes);
    if (!children.some((node) => node.nodeName === 'BR')) return;
    const fragment = document.createDocumentFragment();
    let line = document.createElement('span');
    line.className = 'blockquote-line';
    children.forEach((node) => {
      if (node.nodeName === 'BR') {
        fragment.appendChild(line);
        line = document.createElement('span');
        line.className = 'blockquote-line';
        return;
      }
      line.appendChild(node);
    });
    fragment.appendChild(line);
    paragraph.replaceChildren(fragment);
    paragraph.classList.add('blockquote-lines');
  });
}
// Copy ("document duplicate") and check marks, sized by CSS. The button holds both and the .is-copied class swaps which one shows.
const CODE_COPY_ICON = '<span class="lt-icon code-copy-mark code-copy-copy lt-icon-copy"></span><span class="lt-icon code-copy-mark code-copy-check lt-icon-check"></span>';
// Give every fenced/indented code block (but not Mermaid diagrams) a "copy all" button. Done here in JS, after the sanitized HTML is in the DOM, so the markup the sanitizer sees stays just <pre><code>. The button copies the code verbatim.
function decorateCodeBlocks() {
  app.querySelectorAll('.document-body pre:not(.mermaid)').forEach((pre) => {
    if (pre.querySelector(':scope > .code-copy')) return;
    const code = pre.querySelector('code');
    if (!code) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.innerHTML = CODE_COPY_ICON;
    setCodeCopyLabel(button, 'Copy code');
    button.addEventListener('click', () => copyCodeBlock(button, code.textContent || ''));
    pre.appendChild(button);
  });
}
// The headings an outline is made of, in document order and the title first: everything the document says minus the footnotes and the TEI front matter, neither of which is a section a reader jumps to.
function documentOutlineHeadings(body) {
  if (!body) return [];
  return Array.from(body.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(
    (h) => !h.closest('.footnotes') && !h.closest('.tei-front')
  );
}
// What a heading says, without the footnote markers, which are a number in the middle of a jump list.
function readOutlineHeadingText(h) {
  const clone = h.cloneNode(true);
  clone.querySelectorAll('.footnote-ref').forEach((n) => n.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}
// A generated name for a heading with none: its own place in the document, stepped on past every id the page already carries, so a heading somebody named `section-2` cannot take another heading's target.
function stampOutlineHeadingIds(headings, taken) {
  headings.forEach((h, i) => { if (!h.id) { let at = i + 1; while (taken.has('section-' + at)) at += 1; h.id = 'section-' + at; taken.add(h.id); } });
}
// The document's rows as plain data — `{ level, text, id }`, its main title first and every section under it in document order — and nothing at all for a document that is a title and no more, which gives a reader nowhere within the page to jump. Apart from the drawing because more than one thing draws them; it also stamps a name on any heading with no id, so the anchors exist whoever draws.
function collectDocumentOutlineRows(body) {
  const headings = documentOutlineHeadings(body);
  if (headings.length < 2) return [];
  stampOutlineHeadingIds(headings, new Set(Array.from(body.querySelectorAll('[id]'), (n) => n.id)));
  return headings.map((h) => ({ level: Number(h.tagName.slice(1)) || 1, text: readOutlineHeadingText(h), id: h.id }));
}
// Read the open document's sections and hand them to whatever draws them, which is the library pane. Run before bindDocumentLinks, and on every render — a document with none clears what the last one left.
function publishDocumentOutline() {
  const body = app.querySelector('.document-body');
  setDocumentOutlineRows(body ? collectDocumentOutlineRows(body) : []);
  scheduleLibraryOutline();
}
// The host serves local images over leaf-image://, which arrives as http://leaf-image.local/ where custom protocols are restricted.
const LOCAL_IMAGE_SRC_PREFIXES = ['leaf-image://', 'http://leaf-image.', 'https://leaf-image.'];
// The web view keeps a decoded image against its URL for the life of the process, so a replaced file would show stale until a restart. A per-render token makes each request a distinct URL.
function isLocalImageSrc(src) {
  return LOCAL_IMAGE_SRC_PREFIXES.some((prefix) => src.startsWith(prefix));
}
// The host resolves the path from the URL's segments, so the query is inert to it.
function stampLocalImages(root = app) {
  if (!root) return;
  root.querySelectorAll('img[src]').forEach((img) => {
    // A missing one is showing our glyph, not its file: put its own source back first, so this stamp is the re-fetch that finds the file if it has arrived.
    restoreMissingImage(img);
    // getAttribute, not .src: the property is absolute and hides the prefix.
    const src = img.getAttribute('src') || '';
    if (!isLocalImageSrc(src)) return;
    const base = src.split('?')[0];
    const stamped = `${base}?leaf-epoch=${localImageEpoch}`;
    if (img.getAttribute('src') !== stamped) img.setAttribute('src', stamped);
  });
}
// An image changed on disk: re-fetch rather than re-render, so the reader keeps its scroll position.
window.leafRefreshImages = () => {
  localImageEpoch += 1;
  stampLocalImages();
  // A picture that has arrived at last is back to being a picture, so it gets its lane and its opener the way a render would have given them.
  laneWidePictures();
  bindImageSheet();
  scheduleMinimapPreviewUpdate();
};
// The broken-image mark is an icon class like every other, painted over a transparent pixel: the element has to stay an <img> so a re-fetch can put the real picture back, and an <img> with no source draws the platform's own broken glyph instead of ours. The mask takes its ink from the rule, so a theme change repaints it with no work here.
const MISSING_IMAGE_SIZE = 40;
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
// Its own source is kept, so a re-fetch once the file appears can go back to it. The alt moves to the tooltip: left on, the platform prints it beside our mark.
function markMissingImage(img) {
  if (!(img instanceof HTMLImageElement) || img.dataset.imageMissing === 'true') return;
  img.dataset.imageMissing = 'true';
  img.dataset.imageMissingAlt = img.alt || '';
  img.dataset.imageMissingSrc = img.getAttribute('src') || '';
  if (img.alt && !img.title) img.title = img.alt;
  img.alt = '';
  img.width = MISSING_IMAGE_SIZE;
  img.height = MISSING_IMAGE_SIZE;
  img.classList.add('lt-icon', 'lt-icon-missing-image');
  img.src = TRANSPARENT_PIXEL;
  // The fetch fails after the page is decorated, so the lane and its corner are already on: take both off, because there is nothing behind the mark to open, nothing to write out, and nothing to widen it for.
  const block = img.parentElement;
  if (!block || !block.classList.contains('image-lane')) return;
  block.classList.remove('image-lane');
  const corner = block.querySelector(':scope > .image-lane-corner');
  if (corner) corner.remove();
}
// Point a marked image back at its own source, so the next stamp can try it again.
function restoreMissingImage(img) {
  if (img.dataset.imageMissing !== 'true') return;
  const src = img.dataset.imageMissingSrc || '';
  img.alt = img.dataset.imageMissingAlt || '';
  img.removeAttribute('width');
  img.removeAttribute('height');
  img.classList.remove('lt-icon', 'lt-icon-missing-image');
  delete img.dataset.imageMissing;
  delete img.dataset.imageMissingAlt;
  delete img.dataset.imageMissingSrc;
  if (src) img.setAttribute('src', src);
}
// Capture phase, because `error` does not bubble — one listener covers every image, including the ones the page adds later.
if (app) {
  app.addEventListener('error', (event) => markMissingImage(event.target), true);
}
function setCodeCopyLabel(button, label) {
  button.setAttribute('aria-label', label);
  button.title = label;
}
// Copy via the async clipboard API, falling back to a hidden textarea + execCommand for webview contexts where the async API is blocked.
function copyCodeBlock(button, text) {
  const ok = () => flashCodeCopied(button);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(ok, () => { if (legacyCopy(text)) ok(); });
  } else if (legacyCopy(text)) {
    ok();
  }
}
// The same clipboard pair with nothing to flash — for a right-click item, where the menu has already closed and there is no button left to label. A hoisted declaration on purpose: context-menu.js loads earlier and calls it at event time.
function copyPlainText(text) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {}, () => { legacyCopy(text); });
  } else {
    legacyCopy(text);
  }
}
function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  appSurface.appendChild(area);
  // The old copy reads whatever is selected, so the box has to take the selection off the reader for one call — and every app leaves a copy's highlight exactly where it was, so each range is put back the moment the call is done.
  const selection = window.getSelection();
  const held = [];
  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) held.push(selection.getRangeAt(index).cloneRange());
  }
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    copied = false;
  }
  // Out of whatever is holding it, never out of a parent named here: the box goes on the app surface, so asking the body to remove it throws and takes the restore below with it.
  area.remove();
  if (selection && held.length) {
    selection.removeAllRanges();
    for (const range of held) selection.addRange(range);
  }
  return copied;
}
// Briefly show the check mark and a "Copied" label, then revert.
function flashCodeCopied(button) {
  button.classList.add('is-copied');
  setCodeCopyLabel(button, 'Copied');
  window.clearTimeout(button.__copiedTimer);
  button.__copiedTimer = window.setTimeout(() => {
    button.classList.remove('is-copied');
    setCodeCopyLabel(button, 'Copy code');
  }, 1400);
}
// What the field block at the top of the document asked for, and what of it did not land. Both ride on `data-leaf-` attributes the renderer stamped on the table: the host cannot call into the page, and this is the one channel the sanitizer passes on any tag, so nothing had to be threaded down the render path.
function applyFrontmatterAsks(root) {
  const table = root.querySelector('.frontmatter');
  if (!table) return;
  const body = root.querySelector('.document-body');
  const asked = (table.dataset.leafDocClasses || '').split(/\s+/).filter(Boolean);
  if (body) body.classList.add(...asked);
  // One growl for the whole block -- a refused line and an unrecognized style name arrive as one message, not one per name and not two systems.
  const unread = table.dataset.leafUnread || '';
  if (unread && window.leafShowNotice) window.leafShowNotice(`Some of this note's fields were not read: ${unread}`);
}
