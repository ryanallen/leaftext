// docs-nav.js
// ---------------------------------------------------------------------------
// Build the docs navigation from the REAL file/folder tree at runtime. Nothing
// about the page list is written by hand: every folder becomes a group, every
// .md file becomes a page, ordering is alphabetical, labels come from the file
// names. Add or remove a file and the nav follows — no manifest, no build step.
//
// Static hosting (GitHub Pages) cannot list a directory at runtime, so the tree
// is discovered two ways, in order:
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
//   NavNode = { route, label } | { group, items: NavNode[] }
// where `route` is the file path under the docs folder without ".md", which is
// also how it is fetched and how "#/<route>" addresses it.
// ---------------------------------------------------------------------------

// ---- labels: mechanical, never hand-set ------------------------------------
// A name like "markdown-rendering" or "get_started" becomes "Markdown
// Rendering" / "Get Started". Pure transformation of the on-disk name.
function label(name) {
  return name
    .replace(/\.md$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const isReadme = (name) => name.toLowerCase() === 'readme.md';
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });

// ---- shared builder --------------------------------------------------------
// Turn a flat list of paths relative to the docs folder (e.g.
// ["installation.md", "features/themes.md"]) into the nested nav tree.
//
// A folder's README.md is that folder's index: the folder heading links to it,
// so a folder that contains only a README still shows up as a clickable page.
// The root README is the site landing page and is tracked separately as
// `hasIndex` (it has no folder heading to attach to). README files are never
// listed as ordinary pages.
//
// NavNode shapes produced here:
//   { route, label }                     a page (a non-README .md file)
//   { group, items }                     a folder heading with no index README
//   { group, route, items }              a folder heading that links to its README
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

  const toNodes = (node, rel) => {
    const out = [];
    node.files
      .filter((f) => !isReadme(f))
      .sort(byName)
      .forEach((f) =>
        out.push({ route: (rel ? rel + '/' : '') + f.replace(/\.md$/i, ''), label: label(f) })
      );
    [...node.dirs.keys()].sort(byName).forEach((d) => {
      const childRel = (rel ? rel + '/' : '') + d;
      const child = node.dirs.get(d);
      const items = toNodes(child, childRel);
      const readme = child.files.find(isReadme);
      // A folder with a README becomes a clickable heading (its index); a folder
      // with no README is a plain heading. A folder with neither a README nor any
      // descendant pages is dropped (nothing to point at).
      if (readme) out.push({ group: label(d), route: childRel + '/' + readme.replace(/\.md$/i, ''), items });
      else if (items.length) out.push({ group: label(d), items });
    });
    return out;
  };

  return { hasIndex, nav: toNodes(root, '') };
}

// ---- strategy 1: directory autoindex --------------------------------------
// Recursively fetch directory listings and collect every .md path. Throws if
// the server does not hand back a parseable listing (e.g. it returns the docs
// app shell, as GitHub Pages does), so the caller can fall back.
async function fromAutoindex() {
  const paths = [];

  const crawl = async (rel) => {
    const url = rel ? rel + '/' : './';
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('no listing at ' + url);
    const html = await res.text();

    // GitHub Pages answers a directory request with the folder's index.html
    // (our reader shell), not a file listing. Detect that and bail.
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
      } else if (/\.md$/i.test(name)) {
        paths.push(childRel);
      }
    }
  };

  await crawl('');
  if (!paths.length) throw new Error('listing had no markdown');
  return buildNav(paths);
}

// ---- strategy 2: GitHub tree API ------------------------------------------
// One call returns the repo's whole tree; keep the .md files under the docs
// base and strip the base prefix so the paths line up with the live routes.
async function fromGitHub(repo) {
  const { owner, repo: name, branch = 'main', base = 'docs' } = repo || {};
  if (!owner || !name) throw new Error('no repo configured for GitHub fallback');

  const api = `https://api.github.com/repos/${owner}/${name}/git/trees/${branch}?recursive=1`;
  const res = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error('GitHub API ' + res.status);
  const data = await res.json();
  if (!Array.isArray(data.tree)) throw new Error('unexpected GitHub response');

  const prefix = base ? base.replace(/\/+$/, '') + '/' : '';
  const paths = data.tree
    .filter((e) => e.type === 'blob' && e.path.startsWith(prefix) && /\.md$/i.test(e.path))
    .map((e) => e.path.slice(prefix.length))
    .filter(Boolean);

  if (!paths.length) throw new Error('no markdown under ' + (base || 'repo root'));
  return buildNav(paths);
}

// ---- public entry ----------------------------------------------------------
// Resolve the nav, preferring a live directory listing, falling back to the
// GitHub tree. The result is NOT cached: boot() runs loadDocsNav once per full
// page load (in-app navigation is hash-based and never re-boots), so there is
// no per-session network saving worth the risk. A persisted copy only ever
// caused stale sidebars — a docs tree edited after a visit would keep showing
// the old shape until the tab was closed. Always rebuild from the real tree.
export async function loadDocsNav(repo) {
  try {
    return await fromAutoindex();
  } catch (e) {
    return await fromGitHub(repo);
  }
}
