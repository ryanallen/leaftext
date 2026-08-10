// The page a published site is served: the app's own, with the lines a browser host needs written into its head and its own loader at the foot.
//
// Its own file because the **order** is the load-bearing part of it, and the only way to hold an order is to test one. The page's own theme bootstrap resolves the theme for the first paint out of `window.__leafSettings`, so everything that fills that global has to stand above the bootstrap: a restore landing below it is a restore after the paint, and nothing re-applies a theme once the bootstrap has resolved one. The bootstrap also posts its random-theme draw, which the queue stub has to be standing to keep.

// The page's own policy names the desktop's asset scheme and forbids WebAssembly, both of which are wrong for a static site: the assets sit beside the page and the renderer *is* WebAssembly.
export const POLICY =
  "default-src 'self'; img-src 'self' https: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'";

// The front end sends its first command while it boots, before a module script can have run. Keeping them is what stops the first paint being lost.
const IPC_QUEUE =
  '<script>window.__leafPending=[];window.ipc={postMessage:(m)=>window.__leafPending.push(m)};</script>';

// One boolean saying this is a published site rather than a window, read by the front end before it draws — the same pattern as the frameless-window flag, and for the same reason.
const SITE_FLAG = '<script>window.__leafSite=true;</script>';

// What the reader kept, merged over those defaults. A classic script, so it blocks and runs before the bootstrap paints.
const KEPT_SETTINGS = '<script src="assets/settings.js"></script>';

/** The app's page, shaped into the one a static host serves. `bootScript` is the host's own boot lines — the settings global among them, which is why where it lands matters. */
export function sitePage(page, bootScript) {
  const withPolicy = page.replace(/content="default-src[^"]*"/, `content="${POLICY}"`);
  // The page leads with its own theme bootstrap, which is the one script tag carrying no attributes. Anchored on the tag rather than on a line, and refused outright if the page stops leading with it — there would be nothing to inject above.
  const bootstrap = withPolicy.indexOf('<script>');
  if (bootstrap === -1 || withPolicy.indexOf('<script') !== bootstrap) {
    throw new Error("the app's page no longer leads with its own theme bootstrap, so there is nothing to inject above it");
  }
  const head = `${IPC_QUEUE}<script>${bootScript}</script>${SITE_FLAG}${KEPT_SETTINGS}`;
  return `${withPolicy.slice(0, bootstrap)}${head}${withPolicy.slice(bootstrap)}`.replace(
    '</body>',
    '<script type="module" src="assets/boot.js"></script></body>'
  );
}
