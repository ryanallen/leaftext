// The last thing the page runs: install the host, then open a document.
//
// Everything above this line is the app's own — its page, its script, its stylesheet. This only answers, and it answers out of files sitting beside the page: there is no server behind any of it.

import { landingPath, sayMissing, startLeaftext } from './host.js';
import { fetchWatched } from './fetches.js';
import { loadRenderer } from './renderer.js';

/** One file, as a response the host can read, or an error naming it.
 *
 * Every fetch here goes through this, under the deadline every published page waits with: a stalled connection neither answers nor fails, and a page waiting on one would wait for ever. A static host answers 404 for a file that was not published, and a browser refuses the request outright for a folder opened off a disk; both are the same fact, and neither may kill this module quietly — a boot that throws leaves the reader at the empty start screen, reading it as a site with nothing in it.
 */
async function fetched(path) {
  let response;
  try {
    response = await fetchWatched(window.__leafSiteRoot ? new URL(path, new URL(window.__leafSiteRoot, location.origin)).href : path);
  } catch (error) {
    throw Object.assign(new Error(String((error && error.message) || error)), { file: path });
  }
  if (!response.ok) throw Object.assign(new Error(`the server answered ${response.status}`), { file: path });
  return {
    ok: true,
    status: response.status,
    headers: response.headers,
    arrayBuffer: async () => {
      const bytes = await response.bytes();
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    // Made only when a picture is saved out of the page, from the bytes already read.
    blob: async () => new Blob([await response.bytes()], { type: response.headers.get('content-type') || '' }),
    text: () => response.text(),
    json: () => response.json(),
  };
}

/** The landing's layout, its chart and its motion — the website's own modules, published beside this one — fetched only for a site whose listing names a front page. */
async function frontPageModules() {
  const [layout, chart, motion] = await Promise.all([import('./front-page-layout.js'), import('./compare-chart.js'), import('./front-page.js')]);
  return { layoutFrontPage: layout.layoutFrontPage, holdLaidOutIds: layout.holdLaidOutIds, paragraphPlace: layout.paragraphPlace, fillCompareSeam: chart.fillCompareSeam, installFrontMotion: motion.installFrontMotion };
}

/**
 * What the host needs to lay the landing out: the path, the layout and the motion. The chart was drawn once, at the publish, into the page this was served; it is lifted out here, before the host draws anything over it, and seamed into the README the module draws — so no chart page is fetched and none is drawn again.
 *
 * A page nobody baked has no chart to lift, and a module that does not arrive has no layout to hand; either way the landing is drawn plain and the console says why.
 */
async function frontPageFor(path) {
  const drawn = document.querySelector('.baked-page .compare-chart');
  if (!drawn) {
    console.warn(`${path} is drawn plain: the page carries no comparison chart to lay it out with`);
    return null;
  }
  const chart = drawn.outerHTML;
  let modules;
  try {
    modules = await frontPageModules();
  } catch (error) {
    console.warn(`${path} is drawn plain: the front page's modules did not arrive — ${(error && error.message) || error}`);
    return null;
  }
  // A typed heading is drawn again under an id spelled from its new words, so the ids the layout reads are held from one layout to the next.
  let held = null;
  const layout = (html) => {
    const steady = modules.holdLaidOutIds(html, held);
    held = steady.ids;
    return modules.layoutFrontPage(modules.fillCompareSeam(steady.html, chart));
  };
  return { path, layout, motion: modules.installFrontMotion, paragraphPlace: modules.paragraphPlace };
}

/**
 * The layouts a listing may name for a document other than its front page, each its modules and the data beside its document, fetched the first time that document is drawn.
 *
 * The shelf is the Arthurian books laid out as a bookshelf over `shelf.md`, the list it is drawn from, with its spines' dates and reaches in `shelf-data.json` beside it.
 */
const SITE_LAYOUTS = {
  shelf: (path, at) => async () => {
    const [layout, moves, data] = await Promise.all([
      import('./shelf-layout.js'),
      import('./shelf.js'),
      fetched(at(path.replace(/\.md$/, '-data.json'))).then((answer) => answer.json()),
    ]);
    return { layout: (html) => layout.layoutShelf(html, data), motion: (root) => moves.installShelf(root, data), rootClass: layout.SHELF_LAYOUT_CLASS };
  },
};

try {
  // The listing carries the site's own name beside its documents: the pane draws it as the trail's first word, where the desktop draws the vault it is standing in. It also says where the documents are: under `source/` for a folder export, or at their own addresses for a site served in place, where every `.md` a crawler was promised has to keep answering.
  const listing = await (await fetched('documents.json')).json();
  const base = typeof listing.documentBase === 'string' ? listing.documentBase : 'source';
  const at = (path) => (base ? `${base}/${path}` : path);
  let imageSizes = {};
  try {
    imageSizes = await (await fetched(listing.imageSizes || 'image-sizes.json')).json();
  } catch {}
  const documents = listing.documents || [];
  // Only leaftext.com's listing names one; every other site draws its landing as the app draws any document.
  const frontPage = typeof listing.frontPage === 'string' && listing.frontPage ? await frontPageFor(listing.frontPage) : null;
  // A name no layout answers to is drawn plain, as an older listing's would be.
  const layouts = Object.entries(listing.layouts && typeof listing.layouts === 'object' ? listing.layouts : {})
    .filter(([path, kind]) => typeof path === 'string' && Object.hasOwn(SITE_LAYOUTS, kind))
    .map(([path, kind]) => ({ path, load: SITE_LAYOUTS[kind](path, at) }));
  const leaf = await startLeaftext({
    documents,
    name: listing.name || '',
    imageSizes,
    frontPage,
    layouts,
    loadRenderer,
    fetch: fetched,
    // Documents keep their bytes; the host decodes only a glossary it reads for terms.
    read: async (path) => new Uint8Array(await (await fetched(at(path))).arrayBuffer()),
  });

  // Where the documents are served from, which is where their pictures are too. A folder export's page sits at the top of the site and every document under `source/`, so a picture beside a document is only reachable through that folder joined with the document's own — without this the page asks the top of the site for it and gets the broken-picture mark. A site served in place tells it nothing, because there the address as written already resolves.
  leaf.core.setImageBase(base);

  leaf.showFolder('');

  // The document the address names, or the site's own front page — the one its listing names, else the host's own rule. The host owns the address from here — it writes an entry per document opened and reads one back when the reader walks, so watching it here as well would be two things answering one Back.
  await leaf.openAddress(listing.landing || landingPath(documents));
} catch (error) {
  sayMissing(error && error.file, error && error.message);
}
