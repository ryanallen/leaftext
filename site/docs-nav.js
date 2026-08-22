// docs-nav.js
// ---------------------------------------------------------------------------
// Build the docs navigation from the REAL file/folder tree at runtime. Nothing about the page list is written by hand: every folder becomes a group, every document becomes a page, ordering is alphabetical, labels come from the file names. Add or remove a file and the nav follows — no manifest, no build step.
//
// **Which files are documents is the renderer's answer, not this file's.** The caller passes the extension list it read off the module (`leaf_formats`), which is the app's own one table — so an XML, JSON, YAML or email file beside a page becomes a page by that table naming it, and there is never a second list of extensions in site code to fall behind the first.
//
// Static hosting (GitHub Pages) cannot list a directory at runtime, so the tree is discovered two ways, in order:
//
//   1. Directory autoindex — ask the server for the docs folder and parse the
//      HTML file listing it returns (python -m http.server, nginx autoindex,
//      most dev servers). This makes local preview reflect the real filesystem
//      instantly, including files you have not committed yet.
//
//   2. GitHub tree API — Pages returns the app shell instead of a listing, so
//      fall back to the repo's git tree over the API. `repo` here only says
//      WHICH repo to read; it is not the nav. The nav is whatever .md files
//      that repo actually contains on its branch.
//
// Both strategies converge on the same shape:
//   { hasIndex: boolean, nav: NavNode[] }
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
function label(name) {
  return stripOrder(name.replace(documentPattern, ''))
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// A folder's landing page, in any format the renderer reads — never required, and a folder without one is a plain heading.
const isReadme = (name) => /^readme\./i.test(name) && isDocument(name);
// A glossary is a bottom-sheet target reached by `GLOSSARY.md#term` links, not a standalone page. Like README, it is never listed as an ordinary nav page (left in, it sorts alphabetically to the very top and leads the sidebar ahead of the Introduction). The bottom sheet fetches it by path directly, independent of nav.
const isGlossary = (name) => /^glossary\./i.test(name) && isDocument(name);
const isPageFile = (name) => !isReadme(name) && !isGlossary(name);
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
  const root = { dirs: new Map(), files: [] };

  for (const path of relPaths) {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) continue;
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] });
      node = node.dirs.get(seg);
    }
    node.files.push(parts[parts.length - 1]);
  }

  const hasIndex = root.files.some(isReadme);

  // `rawRel` accumulates the real (prefixed) folder path for fetching; `cleanRel` accumulates the prefix-stripped path used for routes and links.
  const toNodes = (node, rawRel, cleanRel) => {
    const out = [];
    node.files
      .filter(isPageFile)
      .sort(byName)
      .forEach((f) =>
        out.push({
          route: (cleanRel ? cleanRel + '/' : '') + stripOrder(routeName(f)),
          label: label(f),
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
          group: label(d),
          route: childClean + '/' + stripOrder(routeName(readme)),
          path: childRaw + '/' + readme,
          items,
        });
      else if (items.length) out.push({ group: label(d), items });
    });
    return out;
  };

  return { hasIndex, nav: toNodes(root, '', '') };
}

// ---- strategy 1: directory autoindex --------------------------------------
// Recursively fetch directory listings and collect every .md path. Throws if the server does not hand back a parseable listing (e.g. it returns the docs app shell, as GitHub Pages does), so the caller can fall back.
async function fromAutoindex() {
  const paths = [];

  const crawl = async (rel) => {
    const url = rel ? rel + '/' : './';
    const res = await fetchWatched(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('no listing at ' + url);
    const html = await res.text();

    // GitHub Pages answers a directory request with the folder's index.html (our reader shell), not a file listing. Detect that and bail.
    if (/id=["']content["']|src=["'][^"']*docs\.js/i.test(html)) {
      throw new Error('directory listing unavailable (served app shell)');
    }

    const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    for (let href of hrefs) {
      href = href.replace(/^\.\//, '');
      if (!href || href.startsWith('?') || href.startsWith('#')) continue;
      if (href.startsWith('/') || /^[a-z]+:/i.test(href)) continue; // absolute / external
      if (href.startsWith('..')) continue; // parent link
      const name = decodeURIComponent(href.replace(/\/$/, ''));
      const childRel = rel ? rel + '/' + name : name;
      if (href.endsWith('/')) {
        await crawl(childRel);
      } else if (isDocument(name)) {
        paths.push(childRel);
      }
    }
  };

  await crawl('');
  if (!paths.length) throw new Error('listing had no documents');
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
// Resolve the nav, preferring a live directory listing, falling back to the GitHub tree. The result is NOT cached: boot() runs loadDocsNav once per full page load (in-app navigation is hash-based and never re-boots), so there is no per-session network saving worth the risk. A persisted copy only ever caused stale sidebars — a docs tree edited after a visit would keep showing the old shape until the tab was closed. Always rebuild from the real tree.
export async function loadDocsNav(repo, formats) {
  useFormats(formats);
  try {
    return await fromAutoindex();
  } catch (e) {
    return await fromGitHub(repo);
  }
}
