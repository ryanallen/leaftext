// docs-nav.js
// ---------------------------------------------------------------------------
// Build the docs navigation from the REAL file/folder tree. Nothing about the page list is written by hand: every folder becomes a group, every document becomes a page, ordering is alphabetical, labels come from the file names. Add or remove a file and the nav follows — no manifest, and nobody to keep one true.
//
// **Which files are documents is the renderer's answer, not this file's.** The caller passes the extension list it read off the module (`leaf_formats`), which is the app's own one table — so an XML, JSON, YAML or email file beside a page becomes a page by that table naming it, and there is never a second list of extensions in site code to fall behind the first.
//
// Static hosting cannot list a directory at runtime — a folder address is answered with the `index.html` that folder holds, which on the docs folder is this very reader — so the file list arrives one of two ways, in order:
//
//   1. The list the served page carries. The publish and the local preview
//      write the documentation folder's own file list into an inert JSON
//      element on the page (`scripts/site-assets.mjs`), so the sidebar is built
//      out of the first response with no request of its own.
//
//   2. GitHub tree API — for a host serving a page nobody baked. `repo` here
//      only says WHICH repo to read; it is not the nav. The nav is whatever
//      documents that repo actually contains on its branch. Unauthenticated it
//      is sixty calls an hour per address, and an empty sidebar past that,
//      which is why a baked page never reaches it.
//
// Both strategies converge on the same shape:
//   { hasIndex: boolean, glossary: string | null, nav: NavNode[] }
//   NavNode = { route, label, path } | { group, items: NavNode[] }
// where `route` is the clean path under the docs folder with ".md" dropped and every other extension kept (how "#/<route>" addresses it) and `path` is the real file to fetch. They match unless a file/folder carries a numeric ordering prefix (see stripOrder), or the file is not Markdown.
// ---------------------------------------------------------------------------

import { fetchWatched } from './fetches.js';

// The extensions this build was told the renderer reads, and the two patterns every check below is made of. Set once per load by the public entry; Markdown alone until then, which is what the fallbacks in the callers already assume.
let documentPattern = /\.md$/i;

function useFormats(formats) {
  if (formats && formats.length) documentPattern = new RegExp(`\\.(${formats.join('|')})$`, 'i');
}

const isDocument = (name) => documentPattern.test(name);
// A route drops `.md` and keeps every other extension: a Markdown page reads as a clean path, and a link to a real `.xml` file stays a working link in a plain Markdown viewer as well as a route here.
const routeName = (name) => name.replace(/\.md$/i, '');

// ---- ordering prefix -------------------------------------------------------
// A leading numeric prefix ("01-", "02_") orders files and folders in the sidebar without ever showing to the reader: it is stripped from the label AND from the route (so URLs and cross-page links stay clean), while the real, prefixed name is kept as the fetch `path`. Zero-pad so "10" sorts after "02". Word prefixes like "book-1-" are intentionally NOT stripped — those exist for sites that want the number visible in the title.
const ORDER_PREFIX = /^\d+[-_]+/;
const stripOrder = (name) => name.replace(ORDER_PREFIX, '');

// ---- labels: mechanical, never hand-set ------------------------------------
// A name like "markdown-rendering" or "get_started" becomes "Markdown Rendering" / "Get Started". Pure transformation of the on-disk name, with any ordering prefix dropped first so it never reaches the label.
//
// Exported because `scripts/check-docs.mjs` refuses two neighbors the sidebar would draw with the same words, and the only way to ask that is to ask this. A copy of the rule over there would answer for a sidebar nobody draws.
export function docsNavLabel(name) {
  return stripOrder(name.replace(documentPattern, ''))
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// A folder's landing page, in any format the renderer reads — never required, and a folder without one is a plain heading.
const isReadme = (name) => /^readme\./i.test(name) && isDocument(name);
// A glossary is a bottom-sheet target reached by `GLOSSARY.md#term` links, not a standalone page. Like README, it is never listed as an ordinary nav page (left in, it sorts alphabetically to the very top and leads the sidebar ahead of the Introduction). It is reported beside the nav as `glossary` instead, because the reader that draws these pages runs on sites that keep their glossary here and on sites that keep it above this folder, and the tree is what tells the two apart.
const isGlossary = (name) => /^glossary\./i.test(name) && isDocument(name);
const isPageFile = (name) => !isReadme(name) && !isGlossary(name);

// The reader's own files are not pages it lists. A folder holding the documentation also holds the script and stylesheet that draw it and the index a server answers a bare folder address with, and the renderer reads JavaScript, CSS and HTML — so left alone the sidebar offers its own front end beside the guide, twice under one name. Which files those are is asked of the page already standing rather than written down: the same-folder `src` and stylesheet `href` it loaded, plus the file the address it was served at names. Nothing is fetched, no second extension list exists, and a document of the same name inside a folder below the root stays a page.
function shellOwnedRootFiles() {
  const owned = new Set();
  if (typeof document === 'undefined' || typeof location === 'undefined') return owned;
  const here = new URL('./', location.href);
  const claim = (raw) => {
    if (!raw) return;
    let resolved;
    try {
      resolved = new URL(raw, location.href);
    } catch (e) {
      return;
    }
    if (resolved.origin !== here.origin || !resolved.pathname.startsWith(here.pathname)) return;
    const rest = decodeURIComponent(resolved.pathname.slice(here.pathname.length));
    if (!rest || rest.includes('/')) return; // below the root, so it is a page like any other
    owned.add(rest.toLowerCase());
  };
  document.querySelectorAll('script[src]').forEach((el) => claim(el.getAttribute('src')));
  document.querySelectorAll('link[href]').forEach((el) => {
    if (/\bstylesheet\b/i.test(el.getAttribute('rel') || '')) claim(el.getAttribute('href'));
  });
  // The served page itself, which no element on it names: a folder address is answered by its index.
  const served = new URL(location.href).pathname.split('/').pop();
  owned.add(served ? decodeURIComponent(served).toLowerCase() : 'index.html');
  return owned;
}
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });

// ---- shared builder --------------------------------------------------------
// Turn a flat list of paths relative to the docs folder (e.g. ["installation.md", "features/themes.md"]) into the nested nav tree.
//
// A folder's README.md is that folder's index: the folder heading links to it, so a folder that contains only a README still shows up as a clickable page. The root README is the site landing page and is tracked separately as `hasIndex` (it has no folder heading to attach to). README files are never listed as ordinary pages.
//
// `route` is the CLEAN path (ordering prefixes stripped from every segment) used for "#/<route>" addressing and cross-page links; `path` is the REAL file path (prefixes intact, ".md" included) used to fetch it. They differ only when a file or folder carries an ordering prefix.
//
// NavNode shapes produced here:
//   { route, label, path }               a page (a non-README .md file)
//   { group, items }                     a folder heading with no index README
//   { group, route, path, items }        a folder heading that links to its README
function buildNav(relPaths) {
  const shellOwned = shellOwnedRootFiles();
  const root = { dirs: new Map(), files: [] };

  for (const path of relPaths) {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) continue;
    if (parts.length === 1 && shellOwned.has(parts[0].toLowerCase())) continue;
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] });
      node = node.dirs.get(seg);
    }
    node.files.push(parts[parts.length - 1]);
  }

  const hasIndex = root.files.some(isReadme);
  // The glossary this folder holds, as the real file to fetch, or null when the folder has none.
  const glossary = root.files.find(isGlossary) || null;

  // `rawRel` accumulates the real (prefixed) folder path for fetching; `cleanRel` accumulates the prefix-stripped path used for routes and links.
  const toNodes = (node, rawRel, cleanRel) => {
    const out = [];
    node.files
      .filter(isPageFile)
      .sort(byName)
      .forEach((f) =>
        out.push({
          route: (cleanRel ? cleanRel + '/' : '') + stripOrder(routeName(f)),
          label: docsNavLabel(f),
          path: (rawRel ? rawRel + '/' : '') + f,
        })
      );
    [...node.dirs.keys()].sort(byName).forEach((d) => {
      const childRaw = (rawRel ? rawRel + '/' : '') + d;
      const childClean = (cleanRel ? cleanRel + '/' : '') + stripOrder(d);
      const child = node.dirs.get(d);
      const items = toNodes(child, childRaw, childClean);
      const readme = child.files.find(isReadme);
      // A folder with a README becomes a clickable heading (its index); a folder with no README is a plain heading. A folder with neither a README nor any descendant pages is dropped (nothing to point at).
      if (readme)
        out.push({
          group: docsNavLabel(d),
          route: childClean + '/' + stripOrder(routeName(readme)),
          path: childRaw + '/' + readme,
          items,
        });
      else if (items.length) out.push({ group: docsNavLabel(d), items });
    });
    return out;
  };

  return { hasIndex, glossary, nav: toNodes(root, '', '') };
}

// ---- strategy 1: the file list the page carries -----------------------------
// The publish and the local preview write the documentation folder's own file list into an inert JSON element on the served page, so the sidebar is built out of the first response: no request, and nothing an hourly limit can refuse. Answers null — never throws — for a page nobody baked, which is the one case the API below is still here for.
//
// The list is every file in that folder, not the ones that looked like documents to whatever wrote it: which of them is a page is the renderer's own table to answer, asked here through `isDocument` off `leaf_formats`, so there is never a second extension list to fall behind the first. Somebody else's page could carry anything under this name, so a path that is not a plain relative one is dropped rather than fetched.
const DOCS_PAGES_ELEMENT = 'docs-pages';

function fromEmbedded() {
  if (typeof document === 'undefined') return null;
  const holder = document.getElementById(DOCS_PAGES_ELEMENT);
  const written = holder ? (holder.textContent || '').trim() : '';
  if (!written) return null;
  let listed;
  try {
    listed = JSON.parse(written);
  } catch (e) {
    return null;
  }
  if (!Array.isArray(listed)) return null;
  const paths = listed.filter((path) => typeof path === 'string' && path && !path.startsWith('/') && !/^[a-z]+:/i.test(path) && !path.split('/').includes('..') && isDocument(path));
  if (!paths.length) return null;
  return buildNav(paths);
}

// ---- strategy 2: GitHub tree API ------------------------------------------
// One call returns the repo's whole tree; keep the .md files under the docs base and strip the base prefix so the paths line up with the live routes.
async function fromGitHub(repo) {
  const { owner, repo: name, branch = 'main', base = 'docs' } = repo || {};
  if (!owner || !name) throw new Error('no repo configured for GitHub fallback');

  const api = `https://api.github.com/repos/${owner}/${name}/git/trees/${branch}?recursive=1`;
  const res = await fetchWatched(api, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error('GitHub API ' + res.status);
  const data = await res.json();
  if (!Array.isArray(data.tree)) throw new Error('unexpected GitHub response');

  const prefix = base ? base.replace(/\/+$/, '') + '/' : '';
  const paths = data.tree
    .filter((e) => e.type === 'blob' && e.path.startsWith(prefix) && isDocument(e.path))
    .map((e) => e.path.slice(prefix.length))
    .filter(Boolean);

  if (!paths.length) throw new Error('no documents under ' + (base || 'repo root'));
  return buildNav(paths);
}

// ---- public entry ----------------------------------------------------------
// Resolve the nav, preferring the list the served page carries and falling back to the GitHub tree for a page nobody baked. The result is NOT cached: boot() runs loadDocsNav once per full page load (in-app navigation is hash-based and never re-boots), so there is no per-session network saving worth the risk. A persisted copy only ever caused stale sidebars — a docs tree edited after a visit would keep showing the old shape until the tab was closed. Always rebuild from the tree the page was served with.
export async function loadDocsNav(repo, formats) {
  useFormats(formats);
  return fromEmbedded() || (await fromGitHub(repo));
}
