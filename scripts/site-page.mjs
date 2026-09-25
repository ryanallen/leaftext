// A published site served in place: the app's own page, written beside documents that stay at the addresses they are published at.
//
// A folder export copies its documents under `source/` and carries the front end beside the page. A site cannot do either — every `.md` address its sitemap promised a crawler has to keep answering, and a site with no build of its own fetches the front end from another site — so this writes the two files that make a folder of documents into the app and copies nothing: the page, and the listing it reads.
//
// Both published sites are written by this one function: leaftext.com by the public repository's deploy, through `site-assets.mjs --bake`, and Emptyguru on this machine, through `export-web.mjs --in-place`. That is what keeps them one front end rather than two.

import { readFile, readdir } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { sitePage } from './web-page.mjs';

/** The file at the top of a site holding its own lines: the head it keeps — description, cards, structured data, alternates — and the `noscript` block a reader with no script is handed. Everything else on the page is the app's. */
export const SITE_FRAGMENT = 'site-page.html';

/** The fragment's two halves: what goes in the page's head, and the `noscript` block that goes in its body. */
export function splitFragment(text) {
  const head = /<head>([\s\S]*?)<\/head>/i.exec(text);
  const foot = /<noscript>[\s\S]*?<\/noscript>/i.exec(text);
  return { head: head ? head[1].trim() : '', foot: foot ? foot[0] : '' };
}

/** Every document under a folder, deepest last, relative to `base`. What counts as a document is the module's own format table, asked rather than written out — a second list is how a site starts leaving out a format the app reads. */
export async function findDocuments(dir, opens, base = dir, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await findDocuments(path, opens, base, found);
      continue;
    }
    if (!opens.test(entry.name)) continue;
    const relativePath = relative(base, path).split(sep).join('/');
    found.push({ path: relativePath, depth: relativePath.split('/').length });
  }
  return found;
}

/** The documents a site publishes, in the order the pane and the Previous/Next strip walk them, each with the other names a `[[wiki]]` link may call it by. `paths` names what the site holds — a file or a folder under `folder` — so the scripts, feeds and indexes beside the documents are never listed as pages. With none named, the whole folder. */
export async function listDocuments(leaf, folder, paths = []) {
  const opens = new RegExp(`\\.(${leaf.formats().join('|')})$`, 'i');
  let found = [];
  if (!paths.length) found = await findDocuments(folder, opens);
  for (const named of paths) {
    const clean = named.replace(/\\/g, '/').replace(/^\.\/|\/+$/g, '');
    const at = join(folder, clean.split('/').join(sep));
    let isFolder = false;
    try {
      isFolder = (await readdir(at, { withFileTypes: true })) && true;
    } catch {
      isFolder = false;
    }
    if (isFolder) await findDocuments(at, opens, folder, found);
    else if (opens.test(clean)) found.push({ path: clean, depth: clean.split('/').length });
  }
  const documents = found.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  for (const entry of documents) {
    const label = basename(entry.path).replace(/\.[^.]*$/, '');
    const bytes = await readFile(join(folder, entry.path.split('/').join(sep)));
    const aliases = leaf.aliases(bytes.toString('utf8'), label);
    if (aliases.length) entry.aliases = aliases;
    entry.links = leaf.graphLinks(bytes, entry.path);
  }
  return documents;
}

/** The element a documentation address keeps its folder's file list in, which is what sends an old `#/route` link on to its page. */
const DOCS_LIST = /(<script\b[^>]*\bid="docs-pages"[^>]*>)([\s\S]*?)(<\/script>)/;

/** Whether a page carries that element at all. */
export const carriesDocsList = (page) => DOCS_LIST.test(page);

/** A documentation address with `paths` written into its list, over whatever it held. A JSON script element ends at the first `</script`, so the three characters that could close it early or open a tag are written as escapes the parser reads back as themselves. */
export function writeDocsList(page, paths) {
  const written = JSON.stringify(paths).replace(/[<>&]/g, (c) => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' })[c]);
  return page.replace(DOCS_LIST, (_, open, __, close) => open + written + close);
}

/** Every file a folder holds, relative to it and in one order. */
export async function filesUnder(dir, rel = '', found = []) {
  for (const entry of await readdir(join(dir, rel.split('/').join(sep)), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await filesUnder(dir, path, found);
    else found.push(path);
  }
  return found.sort();
}

/** The document a site opens on: the README at its top, else the index there, else the first it lists. The host falls back to the same rule for a folder export with no listing of its own to say. */
export function landingOf(documents) {
  const top = documents.map((entry) => entry.path).filter((path) => !path.includes('/'));
  return top.find((path) => /^readme\./i.test(path)) || top.find((path) => /^index\./i.test(path)) || (documents[0] && documents[0].path) || '';
}

/**
 * The page and the listing that make `folder` into the app, served where its documents already are.
 *
 * `assets` is where the front end is fetched from. `fragment` is the site's own lines. The landing document is drawn into the page, so the first response carries its words for a crawler and for a reader whose module has not arrived yet; the host's first render draws the same document over it. `layout`, where a site has one, is what the landing's drawn words pass through before they are written in.
 */
export async function inPlaceSite(leaf, folder, paths, { name, assets, fragment = '', imageSizes = '', layout = null }) {
  const documents = await listDocuments(leaf, folder, paths);
  const landing = landingOf(documents);
  // Drawn with no image base, because in place a picture's address as written already resolves.
  leaf.setImageBase('');
  const drawn = landing ? (leaf.renderBytes(await readFile(join(folder, landing.split('/').join(sep))), landing) || {}).html || '' : '';
  const words = layout && drawn ? layout(drawn) : drawn;
  const { head, foot } = splitFragment(fragment);
  const page = sitePage(leaf.page(), leaf.boot(), { assets, head, foot, words });
  const listing = { name, documentBase: '', landing, documents: documents.map(({ depth, ...entry }) => entry) };
  if (imageSizes) listing.imageSizes = imageSizes;
  return { page, listing };
}
