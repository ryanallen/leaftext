// The page a published site is served: the app's own, with the lines a browser host needs written into its head and its own loader at the foot.
//
// Its own file because the **order** is the load-bearing part of it, and the only way to hold an order is to test one. The page's own theme bootstrap resolves the theme for the first paint out of `window.__leafSettings`, so everything that fills that global has to stand above the bootstrap: a restore landing below it is a restore after the paint, and nothing re-applies a theme once the bootstrap has resolved one. The bootstrap also posts its random-theme draw, which the queue stub has to be standing to keep.

// The page's own policy names the desktop's asset scheme and forbids WebAssembly, both of which are wrong for a static site: the assets sit beside the page and the renderer *is* WebAssembly.
export const POLICY =
  "default-src 'self'; img-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'";

/** Where a folder export serves the front end from: a folder beside the page. */
export const ASSETS = 'assets/';

// The front end sends its first command while it boots, before a module script can have run. Keeping them is what stops the first paint being lost.
const IPC_QUEUE =
  '<script>window.__leafPending=[];window.ipc={postMessage:(m)=>window.__leafPending.push(m)};</script>';

/** Marks the words a publish drew into the page, so the front end keeps them until its first document replaces them. */
export const BAKED = 'baked-page';

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
export function sitePage(page, bootScript, { assets = ASSETS, head = '', foot = '', words = '' } = {}) {
  // Every name the page gives a file of its own is `assets/…` in quotes, so one rewrite moves them all. Made on the app's page alone, before anything is written into it, so a line the site or a document brings is never rewritten.
  const own = assets === ASSETS ? page : page.replace(/(["'])assets\//g, `$1${assets}`);
  const withPolicy = own.replace(/content="default-src[^"]*"/, `content="${policyFor(assets)}"`);
  // The page leads with its own theme bootstrap, which is the one script tag carrying no attributes. Anchored on the tag rather than on a line, and refused outright if the page stops leading with it — there would be nothing to inject above.
  const bootstrap = withPolicy.indexOf('<script>');
  if (bootstrap === -1 || withPolicy.indexOf('<script') !== bootstrap) {
    throw new Error("the app's page no longer leads with its own theme bootstrap, so there is nothing to inject above it");
  }
  // One boolean saying this is a published site rather than a window, read by the front end before it draws — the same pattern as the frameless-window flag, and for the same reason — and where its files are, which the loader and the host read.
  const flag = `<script>window.__leafSite=true;window.__leafAssetBase=${JSON.stringify(assets)};</script>`;
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
    shaped = shaped.replace(app, (_, open, close) => `${open}<div class="reader-layout ${BAKED}"><article class="document-body">${words}</article></div>${close}`);
  }
  return shaped;
}
