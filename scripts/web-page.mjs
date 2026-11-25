// The page a published site is served: the app's own, with the lines a browser host needs written into its head and its own loader at the foot.
//
// Its own file because the **order** is the load-bearing part of it, and the only way to hold an order is to test one. The page's own theme bootstrap resolves the theme for the first paint out of `window.__leafSettings`, so everything that fills that global has to stand above the bootstrap: a restore landing below it is a restore after the paint, and nothing re-applies a theme once the bootstrap has resolved one. The bootstrap also posts its random-theme draw, which the queue stub has to be standing to keep.

// The page's own policy names the desktop's asset scheme and forbids WebAssembly, both of which are wrong for a static site: the assets sit beside the page and the renderer *is* WebAssembly. The font hosts are reachable by fetch as well, because a site's first page fetches its theme's fonts into the cache after the paint rather than applying them (`src/assets/theme-bootstrap.js`).
export const POLICY =
  "default-src 'self'; img-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com";

/** Where a folder export serves the front end from: a folder beside the page. */
export const ASSETS = 'assets/';

// The front end sends its first command while it boots, before a module script can have run. Keeping them is what stops the first paint being lost.
const IPC_QUEUE =
  '<script>window.__leafPending=[];window.__leafIpc={postMessage:(m)=>window.__leafPending.push(m)};</script>';

/** Marks the words a publish drew into the page, so the front end keeps them: its first render of the same document keeps every block that matches (`keptBakedLayout` in `src/assets/shell/render-document.js`). */
export const BAKED = 'baked-page';

// The shell's own numbers for that layout: `DEFAULT_PANE_WIDTH` and `MIN_READER_WIDTH` in `src/assets/shell/library.js`, and the rail column a site's reader is drawn with.
export const FIRST_FRAME_PANE = 240;
export const FIRST_FRAME_READER = 360;
export const FIRST_FRAME_RAIL = 120;

/**
 * The frame the shell's first layout puts round a site's document, written before the first paint so the baked words are painted where they will stay.
 *
 * The shell's own layout is in `app.js`, which a slow phone must not wait for, and every box it moved after the words were painted was a layout shift: 0.976 of the page on a phone, where the pane stood 240 pixels wide beside a 168-pixel column until the script closed it. So this writes what that layout writes for a site — the pane shut under 600 pixels or at 720 and under (`libraryTooNarrow`, `src/assets/shell/library.js`), or at the width the reader kept, and the rail at 720 and over unless they dragged it shut (`src/assets/shell/settings.js`) — off the settings `settings.js` has already filled. The shell writes the same classes and tracks again when it boots; `scripts/check-shell/a-published-site.mjs` holds the two to the same answer.
 */
export const FIRST_FRAME = `(()=>{const s=window.__leafSettings||{},w=innerWidth,d=document,b=d.body,sh=d.getElementById('libraryShell'),app=d.getElementById('app'),bar=d.getElementById('appBar'),lay=app&&app.querySelector('.reader-layout');if(!sh)return;const narrow=w<=720||w<${FIRST_FRAME_PANE}+${FIRST_FRAME_READER},closed=narrow||s.libraryClosed===true,kept=Number.isFinite(s.libraryWidth)&&s.libraryWidth>0?s.libraryWidth:${FIRST_FRAME_PANE},pane=closed?0:kept,rail=!narrow&&s.minimapShut!==true;b.classList.add('is-site','has-reader-toolbar');if(app)app.classList.add('has-document');if(rail){b.classList.add('has-minimap');if(app)app.classList.add('has-minimap')}else if(lay)lay.classList.add('reader-layout-no-minimap');sh.classList.toggle('library-narrow',narrow);sh.classList.toggle('library-closed',closed);const col=rail?${FIRST_FRAME_RAIL}:0;sh.style.setProperty('grid-template-areas','"pane card-a rail-a gutter" ". . . ."');sh.style.setProperty('grid-template-columns',pane+'px minmax(0, 1fr) '+col+'px var(--reader-gutter)');if(bar){bar.classList.toggle('has-rail',!closed);bar.style.setProperty('--library-rail-width',pane+'px');bar.style.setProperty('--reader-minimap-column',col+'px')}const me=d.currentScript;if(me)me.remove()})();`;

/** The stylesheet parts a baked page's frame is laid out by — the bar, the pane's box, the reading column, the rail's box and the strip at its foot — in the order `READING_CSS_PARTS` in `src/theme.rs` cascades them. Everything else in `app.css` — the drawings, the sheets, the console, the panels a page opens later — arrives without holding the paint. */
export const FIRST_SHEET_PARTS = [
  'src/assets/tokens.css',
  'src/assets/reading/base.css',
  'src/assets/reading/app-bar.css',
  'src/assets/reading/buttons.css',
  'src/assets/reading/library-frame.css',
  'src/assets/reading/library.css',
  'src/assets/reading/reader-toolbar.css',
  'src/assets/reading/reader-page.css',
  'src/assets/reading/document.css',
  'src/assets/reading/minimap.css',
  'src/assets/reading/scrollbars.css',
];

/** Where the composed theme colors end in `app.css`: the tokens part opens with this line. */
const TOKENS_MARK = '/* Generated from design/tokens.md';

/**
 * The one stylesheet a baked page waits for: the compiled theme colors cut off the front of `styles` (the module's `app.css`), then `FIRST_SHEET_PARTS` as `read` hands them over, comments taken out.
 *
 * `app.css` is 147 KB on the wire and held the first paint of every published page: a simulated slow phone was charged 2.55 seconds for it. The frame and the words need a third of it, so that third is what the page waits for, and the whole sheet comes after the paint and changes nothing already laid out.
 */
export function firstSheet(styles, read) {
  const at = styles.indexOf(TOKENS_MARK);
  if (at <= 0) throw new Error("app.css no longer opens with its theme colors ahead of the tokens, so the first sheet has nothing to cut");
  const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n/g, '\n');
  return strip(styles.slice(0, at)) + FIRST_SHEET_PARTS.map((path) => strip(read(path))).join('');
}

/** How many blocks a run holds: `DOCUMENT_RUN_SIZE` in `src/assets/shell/reading-blocks.js`. */
export const RUN_SIZE = 256;

// Elements that never close, so a scan of the renderer's markup does not wait for their end tag.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * The renderer's flat run of blocks, cut into the runs of 256 the page keeps its body in, with the first top-level heading marked as the shell marks it.
 *
 * The page's first render keeps every baked block whose markup matches its own rather than drawing it again, and a block it had to move into a run would be a block painted twice — a moved node is a new largest paint once it lands larger. So the words are written already in their runs. A scan of tags rather than a parser: the renderer's markup is its own, every `<` in its text escaped, and a block is whatever opens at depth 0.
 */
export function inRuns(words) {
  const tags = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g;
  const starts = [];
  let depth = 0;
  let headed = -1;
  for (let tag; (tag = tags.exec(words)); ) {
    if (!tag[2]) continue;
    const name = tag[2].toLowerCase();
    if (tag[1]) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) {
      starts.push(tag.index);
      if (headed === -1 && name === 'h1') headed = tag.index;
    }
    if (!VOID.has(name) && !tag[3]) depth += 1;
  }
  if (!starts.length) return words;
  const marked = (from, to) => {
    const piece = words.slice(from, to);
    return from === headed ? piece.replace(/^<h1\b/i, '<h1 data-lead-heading=""') : piece;
  };
  let out = words.slice(0, starts[0]);
  for (let at = 0; at < starts.length; at += RUN_SIZE) {
    const blocks = starts.slice(at, at + RUN_SIZE);
    const end = at + RUN_SIZE < starts.length ? starts[at + RUN_SIZE] : words.length;
    out += '<div class="document-run">';
    blocks.forEach((from, index) => { out += marked(from, index + 1 < blocks.length ? blocks[index + 1] : end); });
    out += '</div>';
  }
  return out;
}

/** The policy with one more origin allowed to serve scripts, styles, fonts and the renderer — the one the front end is fetched from, where that is not the page's own. */
export function policyFor(assets) {
  let origin = '';
  try {
    if (/^https?:\/\//i.test(assets)) origin = new URL(assets).origin;
  } catch {
    origin = '';
  }
  if (!origin) return POLICY;
  return POLICY.replace(/(script-src|style-src|font-src|connect-src) 'self'/g, `$1 'self' ${origin}`);
}

/**
 * The app's page, shaped into the one a static host serves. `bootScript` is the host's own boot lines — the settings global among them, which is why where it lands matters.
 *
 * `assets` is where the front end is served from: beside the page for a folder export, or another site's address for a site that carries none of its own. `head` is the site's own lines — its description, its cards, its alternates — `foot` is its `noscript` block, and `words` is the landing document already drawn, so the first response carries it.
 */
export function sitePage(page, bootScript, { assets = ASSETS, head = '', foot = '', words = '', siteRoot = '' } = {}) {
  // Every name the page gives a file of its own is `assets/…` in quotes, so one rewrite moves them all. Made on the app's page alone, before anything is written into it, so a line the site or a document brings is never rewritten.
  const own = assets === ASSETS ? page : page.replace(/(["'])assets\//g, `$1${assets}`);
  // A theme's web font asked with `display=swap` arrives after the words are painted and moves every line under the first: 0.125 of a desktop window in one shift. A page served to a stranger keeps the face it painted with, so the shift never happens; the window keeps swap, where the font is fetched once and kept.
  const withPolicy = own.replace(/content="default-src[^"]*"/, `content="${policyFor(assets)}"`).replace(/(fonts\.googleapis\.com\/css2\?[^"'`\s]*?)display=swap/g, '$1display=optional');
  // The page leads with its own theme bootstrap, which is the one script tag carrying no attributes. Anchored on the tag rather than on a line, and refused outright if the page stops leading with it — there would be nothing to inject above.
  const bootstrap = withPolicy.indexOf('<script>');
  if (bootstrap === -1 || withPolicy.indexOf('<script') !== bootstrap) {
    throw new Error("the app's page no longer leads with its own theme bootstrap, so there is nothing to inject above it");
  }
  // One boolean saying this is a published site rather than a window, read by the front end before it draws — the same pattern as the frameless-window flag, and for the same reason — and where its files are, which the loader and the host read.
  const flag = `<script>window.__leafSite=true;window.__leafAssetBase=${JSON.stringify(assets)};${siteRoot ? `window.__leafSiteRoot=${JSON.stringify(siteRoot)};` : ''}</script>`;
  // What the reader kept, merged over those defaults. A classic script, so it blocks and runs before the bootstrap paints.
  const kept = `<script src="${assets}settings.js"></script>`;
  const injected = `${IPC_QUEUE}<script>${bootScript}</script>${flag}${kept}`;
  let shaped = `${withPolicy.slice(0, bootstrap)}${injected}${withPolicy.slice(bootstrap)}`.replace(
    '</body>',
    `${foot}<script type="module" src="${assets}boot.js"></script></body>`
  );
  if (head) {
    // A site naming itself names the page too: the app's own title is the word a window wears, and the first title in a head is the one a browser and a crawler read.
    if (/<title>/i.test(head)) shaped = shaped.replace(/<title>[\s\S]*?<\/title>/i, '');
    shaped = shaped.replace('</head>', `${head}</head>`);
  }
  if (words) {
    const app = /(<main id="app"[^>]*>)(<\/main>)/;
    if (!app.test(shaped)) throw new Error("the app's page has no empty main element to draw the landing document into");
    // Words that already arrive as an article go in as they are, rather than inside a second one. The renderer's own article is the body the page will render, so its blocks go in their runs; a laid-out landing is a layout's markup, whose blocks the shell never cuts into runs, and stays as it came.
    const plain = /^(\s*<article class="document-body">)([\s\S]*)(<\/article>\s*)$/.exec(words);
    const laidOut = !plain && /^\s*<article\b/.test(words);
    const article = plain ? `${plain[1]}${inRuns(plain[2])}${plain[3]}` : laidOut ? words : `<article class="document-body">${inRuns(words)}</article>`;
    // A laid-out landing (leaftext.com's front page) is framed, styled and started by its own layout and its own stylesheet, so it keeps the page as it was; the reading frame, the scripts after the paint and the first sheet are for a document drawn as the reader draws it.
    shaped = shaped.replace(app, (_, open, close) => `${open}<div class="reader-layout ${BAKED}">${laidOut ? '' : `<script>${FIRST_FRAME}</script>`}${article}</div>${close}`);
    // Run again as the shell opens, ahead of the pane and the main element: a page painted while it is still being parsed paints the pane at its default width before the parser reaches the words.
    if (!laidOut) shaped = shaped.replace('<div id="libraryShell" class="library-shell">', (open) => `${open}<script>${FIRST_FRAME}</script>`);
    // The launch card stands over every layer until the module has drawn a document, so over baked words it hides the one thing a slow phone already has to show.
    shaped = shaped.replace(/<div id="startupCard" class="startup-card"(?![^>]*\shidden)/, '$& hidden');
    if (!laidOut) {
      const sheets = firstSheetFirst(shaped, assets);
      shaped = afterFirstPaint(sheets.shaped, assets, sheets.later);
    }
  }
  return shaped;
}

/**
 * The page's stylesheets as a baked page links them: `first.css` holding the paint, and `app.css` and the math sheet handed to the loader, which adds them when it starts the scripts, each kept as a `noscript` link for a browser that runs no script.
 *
 * Not preloaded: a simulated slow phone is charged for every request begun before its largest paint, and the 153 KB whole sheet asked for in the head held the live page's paint at 2.7 to 2.8 seconds where the words were otherwise on screen at 1.8.
 */
function firstSheetFirst(shaped, assets) {
  const quoted = assets.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sheet = new RegExp(`<link rel="stylesheet" href="${quoted}app\\.css"([^>]*)>`).exec(shaped);
  if (!sheet) return { shaped, later: [] };
  const later = [];
  const kept = (href, attributes) => {
    later.push({ href, cors: /\bcrossorigin\b/.test(attributes) });
    return `<noscript><link rel="stylesheet" href="${href}"${attributes}></noscript>`;
  };
  const math = new RegExp(`<link rel="stylesheet" href="${quoted}katex/katex\\.min\\.css"([^>]*)>`).exec(shaped);
  let out = shaped;
  if (math) out = out.replace(math[0], kept(`${assets}katex/katex.min.css`, math[1]));
  out = out.replace(sheet[0], `<link rel="stylesheet" href="${assets}first.css"${sheet[1]}>${kept(`${assets}app.css`, sheet[1])}`);
  return { shaped: out, later };
}

/**
 * The app's script and the host's loader, taken off the page's foot and added once the words have been painted.
 *
 * A slow phone is charged for every request begun before its largest paint, and the 615 KB script fetched for a `defer` tag begins as the page's first bytes are read: with every app script gone the words were the largest paint at 2.0–2.7 seconds on a simulated slow phone, and with that one tag back it was 6.1. So both are added from a few inline lines two frames after the document is parsed, the loader once the script has run, which is the order the `defer` tag and the module gave them.
 */
function afterFirstPaint(shaped, assets, sheets = []) {
  const script = new RegExp(`<script src="${assets.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}app\\.js"([^>]*)></script>`);
  const tag = script.exec(shaped);
  const loader = `<script type="module" src="${assets}boot.js"></script>`;
  if (!tag || !shaped.includes(loader)) return shaped;
  const crossorigin = /\bcrossorigin(?:="([^"]*)")?/.exec(tag[1]);
  // Started by the browser's own word that the words are painted — a largest-paint entry on a block of the baked words, once the whole page has been parsed — because a frame is no such word: a page holding its paint for a font runs its frames before anything is on screen, and a page painted as it is parsed reports the bar's own label first. A browser that keeps no such entry (Safari) starts once the page has loaded and two frames have passed, and nothing waits past four seconds, so a tab opened behind another, which reports no paint at all, still boots.
  const load = `<script>(()=>{let started=false;const go=()=>{if(started)return;started=true;window.__leafPainted=true;for(const one of ${JSON.stringify(sheets)}){const sheet=document.createElement('link');sheet.rel='stylesheet';sheet.href=one.href;if(one.cors)sheet.crossOrigin='anonymous';document.head.appendChild(sheet)}const app=document.createElement('script');app.src=${JSON.stringify(`${assets}app.js`)};${crossorigin ? `app.crossOrigin=${JSON.stringify(crossorigin[1] || 'anonymous')};` : ''}app.onload=()=>{const boot=document.createElement('script');boot.type='module';boot.src=${JSON.stringify(`${assets}boot.js`)};document.body.appendChild(boot)};document.body.appendChild(app)};const twoFrames=()=>requestAnimationFrame(()=>requestAnimationFrame(go));const P=window.PerformanceObserver;if(P&&P.supportedEntryTypes&&P.supportedEntryTypes.includes('largest-contentful-paint')){let parsed=false,painted=false;const ready=()=>{if(parsed&&painted)setTimeout(go,0)};const seen=new P((list,watch)=>{if(list.getEntries().some((e)=>e.element&&e.element.closest&&e.element.closest('.baked-page'))){watch.disconnect();painted=true;ready()}});seen.observe({type:'largest-contentful-paint',buffered:true});const whole=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{parsed=true;ready()}));if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',whole);else whole()}else addEventListener('load',twoFrames);setTimeout(go,4000)})();</script>`;
  return shaped.replace(tag[0], '').replace(loader, load);
}
