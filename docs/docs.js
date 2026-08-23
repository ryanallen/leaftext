// docs.js
// ---------------------------------------------------------------------------
// The /docs reader. Like site/reader.js (fetch a Markdown file, render it, build the minimap) but it serves a whole set of pages chosen by the #/route in the URL and draws a navigation sidebar down the left.
//
// Nothing about the page list lives here. The sidebar, the mobile dropdown, and the prev/next pager are all built from the REAL docs/ file tree at runtime (see ../site/docs-nav.js): every folder is a group, every .md file is a page. Drop a file under docs/ and it appears; remove it and it's gone. No manifest, no list to maintain.
//
// Routing is hash-based so this is a static site that works on GitHub Pages with no server. A route is a doc's path under docs/ without the .md (e.g. "features/themes"); the empty route is the index, which renders docs/README.md (or shows nothing if there is no README). The raw .md files stay viewable on GitHub, and in-page links between them are intercepted and turned into routes.
//
// The renderer is the app's own, fetched as a module (../site/leaftext-core.js); the minimap (minimap.js) is reused verbatim from the root site one level up.
//
// **One file on both published sites, alongside docs.css, and `scripts/check-other-site.mjs` is what holds it there** — a row each in that check's table, compared by what the code says rather than by its bytes. A comment claiming two files agree cannot fail, which is how this one and its stylesheet drifted apart while both headers said they had not.
// ---------------------------------------------------------------------------

import { createLeaftext } from '../site/leaftext-core.js';
import { fetchWatched } from '../site/fetches.js';
import { fillPager } from '../site/pager.js';
import { initMinimap } from '../site/minimap.js';
import { highlightCode, decorateCodeBlocks } from '../site/codeblocks.js';
import { decorateAnchorLinks } from '../site/anchors.js';
import { buildOutline } from '../site/outline.js';
import { decorateBlockquoteLines } from '../site/blockquotes.js';
import { loadDocsNav } from '../site/docs-nav.js';
import { installGlossary, installAutoGlossary } from '../site/glossary.js';
import { installLinkTooltip } from '../site/link-tooltip.js';
import { installSettings } from '../site/settings.js';
import { applySpeedReaderIfEnabled } from '../site/speed-reader.js';

// Site identity is DERIVED at runtime, never hardcoded, which is what lets one file serve both sites — nothing here says "Leaftext":
//   • Brand + subtitle come from the page <title> ("Brand — Subtitle").
//   • The "← back" link is the site root, always one level above /docs.
//   • The repo (only needed for the GitHub tree fallback on Pages) is read from
//     the first github.com/<owner>/<repo> link in the site's root README — real
//     content the site already carries, not a config knob.
//   • Where the glossary lives is read off the documentation tree at boot: a
//     glossary in the tree is a page of this folder, and a folder with none has
//     one above it. See GLOSSARY_URLS.
const SITE_TITLE = (document.title || 'Documentation').trim();
const TITLE_PARTS = SITE_TITLE.split(/\s[—–-]\s/);
const BRAND = (TITLE_PARTS[0] || SITE_TITLE).trim();
const SUBTITLE = (TITLE_PARTS[1] || '').trim();
const SITE_HREF = new URL('../', location.href).href; // site root, one up from /docs
// The folder this reader is serving, as a path in the repository — read off the page's own address rather than written down, so nothing here says "docs" and a reader dropped in any folder serves that one.
const BASE = new URL('./', location.href).pathname.replace(/^\/+|\/+$/g, '');
// Resolved in boot(): REPO from the README, then the GitHub footer link appended.
let REPO = null;
let FOOTER_LINKS = [{ href: SITE_HREF, label: '← ' + location.hostname }];
// The renderer, loaded once in boot(). Every call into it is behind a page that already said the module arrived.
let leaf = null;
// The fallback that puts a picture back on the PNG beside it when the browser cannot decode the WebP. Asked for at boot rather than imported, because the other site running this reader carries no `site/pictures.js` — and a static import of a file the origin does not have takes the whole reader down before it draws a word, where an ask that comes back with nothing costs that site a decoration it has no pictures for. Null until boot() has asked, and null for ever on a site with no copy.
let installPictureFallback = null;

// The document, drawn by the app's own renderer. One place, so the sheet, the auto-linker and the page itself cannot end up drawing three different documents.
function renderDocument(text, path) {
  const drawn = leaf.render(text, path);
  if (!drawn) throw new Error('the renderer refused ' + path);
  return drawn;
}

// Parse the first github.com/<owner>/<repo> out of the site's root README (one level up from /docs). Sub-paths like /releases are fine — only owner/repo are kept. Returns null if there is no README or no GitHub link, in which case the local-directory autoindex still builds the nav (dev) and only the Pages fallback is unavailable.
async function deriveRepo() {
  try {
    const res = await fetchWatched('../README.md', { cache: 'no-cache' });
    if (!res.ok) return null;
    const match = (await res.text()).match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
    if (!match) return null;
    return { owner: match[1], repo: match[2].replace(/\.git$/i, ''), branch: 'main', base: BASE };
  } catch (e) {
    return null;
  }
}

// Filled in once the live tree is loaded.
let NAV = [];
let PAGES = []; // flat list of every page, in sidebar order (for the pager)
let HAS_INDEX = false; // is there a docs/README.md to use as the landing page?
// Clean route -> real file path (with ".md"), for the pages whose on-disk name carries a numeric ordering prefix. Built from the live tree in boot().
let ROUTE_TO_PATH = new Map();

// The file to fetch for a route. Prefers the nav's real path (which honors any ordering prefix on disk); falls back to the route itself when it already names a file the renderer opens, and otherwise to "<route>.md" — so a hand-typed or not-yet-in-nav route (and the GLOSSARY, fetched by literal path) still loads.
function fileForRoute(route) {
  if (route === '') return 'README.md';
  const known = ROUTE_TO_PATH.get(route);
  if (known) return known;
  return leaf && leaf.opens(route) ? route : route + '.md';
}

// Any link the renderer would open is an in-app route. Which extensions those are is the app's own one table, read off the module rather than written out again here — so a JSON, YAML or email file sitting beside a page becomes a page by that table naming it. A route drops `.md` and keeps every other extension, which is what makes a link to a real `.xml` file both a working route and a working link in a plain Markdown viewer.
function isDocumentHref(href) {
  const path = String(href).split(/[?#]/)[0];
  return leaf ? leaf.opens(path) : /\.md$/i.test(path);
}

function collectRoutePaths(nodes, map) {
  for (const node of nodes) {
    if (node.route && node.path) map.set(node.route, node.path);
    if (node.items) collectRoutePaths(node.items, map);
  }
  return map;
}

// The route of the page whose content is currently on screen, set only when a render SUCCEEDS. In-page relative links resolve against this, not the URL hash (currentRoute()): if a fetch 404s the hash changes but the old content stays visible, and resolving its relative links against the broken hash would keep prepending the failed path (the "URL keeps getting longer" bug). Resolving against the displayed route keeps a bad link from compounding.
let displayedRoute = '';

// The glossary bottom sheet, created in boot() once the tree has said where the glossary is. Links pointing at it (e.g. ../GLOSSARY.md#karma) open the entry in a sheet instead of routing.
let glossary = null;
// Where to fetch the glossary from, and the route that opens the whole of it — both read off the documentation tree rather than written down, because the two sites this reader serves keep their glossary in different places. A glossary inside this folder is a page of it, addressed like any other. A folder with none has one above it, which is outside the set this reader routes over, so the addresses to try are the three spellings a site above /docs might use.
let GLOSSARY_URLS = ['GLOSSARY.md'];
let GLOSSARY_ROUTE = 'GLOSSARY';
// Whether a link is at the glossary itself rather than at one of its entries — the "Open the full glossary" link, which is the whole file rather than a term in it.
const isGlossaryFile = (href) => /(^|\/)glossary\.(md|xml)$/i.test(String(href).split(/[?#]/)[0]);

const sidebarEl = document.getElementById('sidebar');
const mobileNavEl = document.getElementById('mobileNav');
const contentEl = document.getElementById('content');
const statusEl = document.getElementById('status');
// The tooltip's line count needs the URL of the file a link points at. Here a relative `.md` link resolves to a route against the page on screen, and the file behind that route is `<route>.md` under this /docs base — not a URL under the current `#/route` hash — so give the counter a resolver that knows that.
installLinkTooltip(document, {
  resolveDocUrl: (link) => {
    const href = (link.getAttribute('href') || '').trim();
    if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
    if (!isDocumentHref(href)) return null;
    const { route } = routeAndAnchorFromHref(href, displayedRoute);
    if (!route) return null;
    try {
      return new URL(fileForRoute(route), location.href).href;
    } catch (error) {
      return null;
    }
  },
});

// Mermaid and KaTeX are vendored under ../site/vendor/ — loaded lazily (once) only when a page actually contains a diagram or math.
const MERMAID_SRC = '../site/vendor/mermaid.min.js';
const KATEX_SRC = '../site/vendor/katex/katex.min.js';
const HLJS_SRC = '../site/vendor/highlight.min.js';
const scriptPromises = new Map();

function loadScript(src) {
  if (!scriptPromises.has(src)) {
    scriptPromises.set(
      src,
      new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = () => resolve();
        el.onerror = () => reject(new Error('Failed to load ' + src));
        document.head.appendChild(el);
      })
    );
  }
  return scriptPromises.get(src);
}

async function renderMermaidDiagrams() {
  const nodes = Array.from(contentEl.querySelectorAll('pre.mermaid'));
  if (!nodes.length) return;
  try {
    if (!window.mermaid) await loadScript(MERMAID_SRC);
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
      fontFamily: "'Noto Sans', sans-serif",
      themeVariables: { fontFamily: "'Noto Sans', sans-serif" },
    });
    await window.mermaid.run({ nodes });
  } catch (err) {
    console.error('Mermaid failed to render:', err);
  }
}

async function renderMath() {
  const nodes = Array.from(contentEl.querySelectorAll('.math'));
  if (!nodes.length) return;
  try {
    if (!window.katex) await loadScript(KATEX_SRC);
    nodes.forEach((el) => {
      window.katex.render(el.textContent, el, {
        displayMode: el.classList.contains('math-block'),
        throwOnError: false,
      });
    });
  } catch (err) {
    console.error('KaTeX failed to render:', err);
  }
}

// ---- nav helpers --------------------------------------------------------

// Every page in sidebar order, regardless of nesting depth. A folder heading that links to its README is itself a page (and comes before its children).
function collectPages(nodes) {
  const pages = [];
  for (const node of nodes) {
    if (node.route) pages.push({ route: node.route, label: node.label || node.group });
    if (node.items) pages.push(...collectPages(node.items));
  }
  return pages;
}

// ---- routing ------------------------------------------------------------

// Parse the URL hash into a route and an optional section anchor. "#/<route>" with an optional "#<anchor>" suffix. The empty route ("#/" or no hash) is the index. An unknown route also falls back to the index.
function parseHash() {
  const hash = location.hash || '';
  if (!hash.startsWith('#/')) return { route: '', anchor: '' };
  const rest = hash.slice(2);
  const at = rest.indexOf('#');
  const rawRoute = at >= 0 ? rest.slice(0, at) : rest;
  const rawAnchor = at >= 0 ? rest.slice(at + 1) : '';
  // A route is whatever path the hash names; it is fetched as "<route>.md" and a missing file surfaces as an error in render(). Routing is deliberately NOT gated on the nav-derived route set: the sidebar can be stale or fail to load (cached, rate-limited) without breaking the ability to open a real doc.
  const route = decodeURIComponent(rawRoute).replace(/\/+$/, '');
  let anchor = rawAnchor;
  try {
    anchor = decodeURIComponent(rawAnchor);
  } catch (e) {
    /* keep raw anchor */
  }
  return { route, anchor };
}

function currentRoute() {
  return parseHash().route;
}

// Resolve a relative ".md" link inside a page against the page it appears on, returning the route and any section anchor (route is null if it escapes the set).
function routeAndAnchorFromHref(href, fromRoute) {
  const dir = fromRoute.includes('/') ? fromRoute.slice(0, fromRoute.lastIndexOf('/') + 1) : '';
  const resolved = new URL(href, 'https://docs.local/' + dir);
  // Links point at the real files on disk, which may carry a numeric ordering prefix ("01-features/02-navigation.md"). Strip the prefix from every segment so the in-app route — and the URL — stays clean ("features/navigation"); fileForRoute() maps it back to the real file to fetch.
  const route = resolved.pathname
    .replace(/^\/+/, '')
    .replace(/\.md$/i, '')
    .split('/')
    .map((seg) => seg.replace(/^\d+[-_]+/, ''))
    .join('/');
  const anchor = resolved.hash ? resolved.hash.slice(1) : '';
  // Any internal ".md" link becomes an in-app route. We do not check it against the nav set — that set can be stale/incomplete; an actually-missing target is reported by render() when the fetch fails.
  return { route, anchor };
}

function scrollToAnchor(id) {
  if (!id) {
    window.scrollTo(0, 0);
    return;
  }
  const el = document.getElementById(id);
  if (el) el.scrollIntoView();
  else window.scrollTo(0, 0);
}

function navigate(route, anchor) {
  const next = '#/' + route + (anchor ? '#' + anchor : '');
  if (location.hash === next) {
    render(route, anchor); // same target — re-render in place
  } else {
    location.hash = next; // triggers hashchange -> render
  }
}

// ---- sidebar ------------------------------------------------------------

// Recursively render nav nodes. Each depth level adds 14px of left padding so nested groups indent without needing a fixed CSS hierarchy.
function renderNavNodes(nodes, depth) {
  return nodes
    .map((node) => {
      const pad = 8 + depth * 14;
      if (node.group === undefined) {
        return (
          `<a class="docs-nav-link" data-route="${node.route}" ` +
          `href="#/${node.route}" style="padding-left:${pad}px">${node.label}</a>`
        );
      }
      // A folder heading links to its README when it has one, otherwise it is a plain (non-clickable) title.
      const title = node.route
        ? `<a class="docs-nav-group-title docs-nav-group-link" data-route="${node.route}" ` +
          `href="#/${node.route}" style="padding-left:${pad}px">${node.group}</a>`
        : `<p class="docs-nav-group-title" style="padding-left:${pad}px">${node.group}</p>`;
      return (
        `<div class="docs-nav-group" data-depth="${depth}">` +
        title +
        renderNavNodes(node.items || [], depth + 1) +
        `</div>`
      );
    })
    .join('');
}

// For the mobile <select>: top-level groups become <optgroup>; deeper groups become a disabled placeholder so the hierarchy stays legible.
function renderMobileOptions(nodes, topLevel) {
  return nodes
    .map((node) => {
      if (node.group === undefined) return `<option value="${node.route}">${node.label}</option>`;
      // A folder heading that links to its README contributes a selectable option for that README alongside the heading itself.
      const self = node.route ? `<option value="${node.route}">${node.group}</option>` : '';
      if (topLevel) {
        return (
          `<optgroup label="${node.group}">` +
          self +
          renderMobileOptions(node.items || [], false) +
          `</optgroup>`
        );
      }
      return (
        `<option disabled>── ${node.group}</option>` +
        self +
        renderMobileOptions(node.items || [], false)
      );
    })
    .join('');
}

function buildSidebar() {
  const brand =
    `<a class="docs-sidebar-brand" href="#/">${BRAND}</a>` +
    `<p class="docs-sidebar-sub">${SUBTITLE}</p>`;

  const footer =
    '<div class="docs-sidebar-footer">' +
    FOOTER_LINKS.map((l) => `<a href="${l.href}">${l.label}</a>`).join('') +
    '</div>';

  sidebarEl.innerHTML = brand + renderNavNodes(NAV, 0) + footer;

  const indexOption = HAS_INDEX ? '<option value="">Overview</option>' : '';
  mobileNavEl.innerHTML = indexOption + renderMobileOptions(NAV, true);
  mobileNavEl.addEventListener('change', () => navigate(mobileNavEl.value));
}

function highlightActive(route) {
  sidebarEl.querySelectorAll('.docs-nav-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.route === route);
  });
  if (mobileNavEl.value !== route) mobileNavEl.value = route;
}

// ---- pager (prev / next) ------------------------------------------------

// The strip is the renderer's own, drawn waiting at the foot of every document it renders because the reader it was built for does know a document's neighbors. Here the sidebar's order is what knows them, so this is where the promise is kept — and a document with no neighbors either side loses the strip rather than keeping a skeleton nobody will fill.
function buildPager(route) {
  // The index sits before the first page; pages chain in sidebar order.
  const idx = route === '' ? -1 : PAGES.findIndex((p) => p.route === route);
  const prev = idx > 0 ? PAGES[idx - 1] : null;
  const next = route === '' ? PAGES[0] || null : idx >= 0 && idx < PAGES.length - 1 ? PAGES[idx + 1] : null;
  // The page this button opens, for the hover card. Stamped here because nothing else knows it — the tooltip sees a `#/route`.
  const entry = (page) => (page ? { href: '#/' + page.route, label: page.label } : null);
  fillPager(contentEl, entry(prev), entry(next));
}

// ---- in-page link handling ----------------------------------------------
// Clicks inside the rendered doc: a relative ".md" link becomes a route change; an "#anchor" link scrolls in place; everything else behaves normally.
contentEl.addEventListener('click', (event) => {
  // A glossary link opens the term in a bottom sheet rather than routing away.
  if (glossary && glossary.handleClick(event)) return;

  const link = event.target.closest('a');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href) return;

  // A route, not a place in this page. The Previous/Next strip is drawn by the renderer at the foot of the document, so its buttons are inside the content element now and the in-page-anchor branch below would swallow them: it would look for an element with the id "/introduction", find none, and cancel the click. Left alone, the address changes and the hashchange listener renders.
  if (href.startsWith('#/')) return;

  if (href.startsWith('#')) {
    event.preventDefault();
    let id = href.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch (e) {
      /* keep raw id */
    }
    const target = document.getElementById(id) || document.getElementById(href.slice(1));
    if (target) {
      target.scrollIntoView();
      history.replaceState(null, '', '#/' + displayedRoute + '#' + id);
    }
    return;
  }

  if (isDocumentHref(href) && !/^[a-z]+:\/\//i.test(href)) {
    const { route, anchor } = routeAndAnchorFromHref(href, displayedRoute);
    if (route) {
      event.preventDefault();
      navigate(route, anchor);
    }
  }
});

// ---- per-page head metadata ---------------------------------------------
// The reader is a single page that swaps content by route, so the metadata in
// <head> has to be updated by hand on every navigation. We keep canonical, the
// Markdown alternate, the description, and the JSON-LD in sync with the page on screen. Origin is read from location (never hardcoded) so this stays shared across sites through the site/ junction.

// Create-or-update a single <link>/<meta> element matched by `selector`.
function upsertHead(selector, tag, attrs) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement(tag);
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// Build a BreadcrumbList from the route's path, labeling each level from the nav (PAGES) when known, otherwise from the readable folder name.
function breadcrumbItems(route, heading) {
  const home = new URL('./', location.href).href;
  const items = [{ name: BRAND, item: home }];
  if (!route) return items;
  const segs = route.split('/');
  let acc = '';
  segs.forEach((seg, i) => {
    acc = acc ? acc + '/' + seg : seg;
    const known = PAGES.find((p) => p.route === acc);
    const last = i === segs.length - 1;
    const name = last && heading ? heading : known ? known.label : seg.replace(/-/g, ' ');
    items.push({ name, item: '#/' + acc });
  });
  return items;
}

function setHeadMetadata(route, heading) {
  const file = fileForRoute(route);
  const canonical = new URL(location.hash || '#/', location.href).href;

  upsertHead('link[rel="canonical"]', 'link', { rel: 'canonical', href: canonical });
  upsertHead('link[rel="alternate"][type="text/markdown"]', 'link', {
    rel: 'alternate',
    type: 'text/markdown',
    href: file,
  });

  const firstPara = contentEl.querySelector('p');
  const desc = firstPara ? firstPara.textContent.trim().replace(/\s+/g, ' ').slice(0, 160) : '';
  if (desc) {
    upsertHead('meta[name="description"]', 'meta', { name: 'description', content: desc });
    upsertHead('meta[property="og:description"]', 'meta', { property: 'og:description', content: desc });
  }
  upsertHead('meta[property="og:title"]', 'meta', { property: 'og:title', content: document.title });
  upsertHead('meta[property="og:url"]', 'meta', { property: 'og:url', content: canonical });

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: heading || BRAND,
        inLanguage: 'en',
        url: canonical,
        isPartOf: { '@type': 'WebSite', name: BRAND, url: new URL('../', location.href).href },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: breadcrumbItems(route, heading).map((b, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: b.name,
          item: new URL(b.item, location.href).href,
        })),
      },
    ],
  };
  let script = document.getElementById('ld-json-route');
  if (!script) {
    script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'ld-json-route';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(ld);
}

// ---- render one page ----------------------------------------------------

async function render(route, anchor) {
  lastRoute = route;

  // The index route renders docs/README.md if there is one, otherwise nothing.
  if (route === '' && !HAS_INDEX) {
    contentEl.innerHTML = '';
    statusEl.hidden = true;
    displayedRoute = '';
    document.title = SITE_TITLE;
    document.querySelectorAll('.document-minimap').forEach((el) => el.remove());
    highlightActive('');
    buildPager('');
    window.scrollTo(0, 0);
    return;
  }

  const file = fileForRoute(route);
  try {
    // The page already drawn stands until the next one arrives: the status line says nothing while a route is on its way, and the fetch under it now always ends.
    statusEl.hidden = true;
    const res = await fetchWatched(file, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + file);
    const source = await res.text();

    // The path, not just the text: the renderer's one format table is what decides whether this is Markdown, TEI, data or a message, and nothing here chooses.
    const drawn = renderDocument(source, file);
    contentEl.innerHTML = drawn.html;
    // A quoted passage broken by <br> is verse, and the hanging indent that makes a long wrapped prose quote hang would step every line after the first to the right. Each hard-break line gets a span of its own so only a true wrap hangs.
    decorateBlockquoteLines(contentEl);
    // Every route is drawn into this same article, so the listener goes on once and only the sweep runs again.
    if (installPictureFallback) installPictureFallback(contentEl);
    // An in-page outline (table of contents) from this page's headings, tucked just under the title — distinct from the left nav sidebar, which lists pages, not the sections within a page. Built before the anchor pass so its link-only entries stay out of the block-numbering scheme.
    buildOutline(contentEl, { label: 'Outline' });
    statusEl.hidden = true;
    displayedRoute = route;

    const firstHeading = contentEl.querySelector('h1, h2, h3');
    const heading = drawn.title || (firstHeading ? firstHeading.textContent.trim() : '');
    document.title = (heading ? heading.slice(0, 70) + ' — ' : '') + BRAND;
    setHeadMetadata(route, heading);

    highlightActive(route);
    buildPager(route);

    // Rebuild the minimap from scratch (initMinimap appends a fresh rail).
    document.querySelectorAll('.document-minimap').forEach((el) => el.remove());

    renderMermaidDiagrams();
    renderMath();
    highlightCode(contentEl, HLJS_SRC);
    decorateCodeBlocks(contentEl);
    decorateAnchorLinks(contentEl);
    delete contentEl.dataset.speedReaderProcessed;
    applySpeedReaderIfEnabled(contentEl);
    initMinimap(contentEl);

    scrollToAnchor(anchor);

    // Every word the glossary defines becomes a link to its entry, after paint so the page is readable first. A hand-written GLOSSARY.md#slug link is inside an
    // <a> already, which this skips, so the two never fight. Not on the glossary
    // itself, wherever it lives: every heading would link to the entry it already is.
    if (route.toLowerCase() !== GLOSSARY_ROUTE.toLowerCase()) {
      installAutoGlossary({
        contentEl,
        render: renderDocument,
        glossaryUrl: GLOSSARY_URLS,
      });
    }
  } catch (err) {
    statusEl.hidden = false;
    statusEl.textContent =
      'Could not load this page (' +
      err.message +
      '). The docs must be served over http, not opened from a file path. ' +
      'For example, from the repo root run:  python -m http.server  then open the printed address at /docs/.';
  }
}

// ---- boot ---------------------------------------------------------------

let lastRoute = null;

(async function boot() {
  // The renderer first: everything below it draws a document, and a page that could not reach the module has to say so rather than sit on a document that never arrives. This site serves its own; another site naming this one gets the same sentence when this one is unreachable.
  try {
    leaf = await createLeaftext();
  } catch (err) {
    statusEl.hidden = false;
    statusEl.textContent =
      'The reader could not be loaded (' + err.message + '), so these pages cannot be drawn. ' +
      'Every page here is a plain file you can read as it stands — the full list is at ../sitemap-md.txt.';
    return;
  }

  // The picture fallback, asked for rather than imported: this site has one and the other site running this reader does not, and a page drawn without the decoration beats a page not drawn at all.
  try {
    ({ installPictureFallback } = await import('../site/pictures.js'));
  } catch (err) {
    installPictureFallback = null;
  }

  // Derive the repo from the README before building the nav, and add the GitHub footer link once it is known.
  REPO = await deriveRepo();
  if (REPO) {
    FOOTER_LINKS = FOOTER_LINKS.concat([
      { href: `https://github.com/${REPO.owner}/${REPO.repo}`, label: 'GitHub repository' },
    ]);
  }
  try {
    const tree = await loadDocsNav(REPO, leaf.formats);
    NAV = tree.nav;
    HAS_INDEX = tree.hasIndex;
    // The tree names this folder's own glossary, or nothing. Nothing means the site keeps one above /docs, which is outside the set this reader routes over — so the addresses to try are the three spellings such a site might use, and the route that opens the whole of it climbs out of the folder.
    GLOSSARY_URLS = tree.glossary ? [tree.glossary] : ['../GLOSSARY.md', '../GLOSSARY.xml', '../glossary.xml'];
    GLOSSARY_ROUTE = tree.glossary ? tree.glossary.replace(/\.md$/i, '') : '../GLOSSARY';
  } catch (err) {
    statusEl.hidden = false;
    statusEl.textContent = 'Could not load the documentation index (' + err.message + ').';
    return;
  }

  PAGES = collectPages(NAV);
  ROUTE_TO_PATH = collectRoutePaths(NAV, new Map());

  // A non-glossary link followed from inside the sheet (or "Open the full glossary") routes through the docs router; an external link opens normally.
  glossary = installGlossary({
    glossaryUrl: GLOSSARY_URLS,
    render: renderDocument,
    onNavigate: (href) => {
      if (/^[a-z]+:\/\//i.test(href)) {
        window.open(href, '_blank', 'noopener');
        return;
      }
      // "Open the full glossary" names the file itself. Route to it directly rather than resolving it: a glossary above /docs cannot survive the URL API, which collapses the `../` away, and the route that fetches it is the one the tree already gave us.
      if (isGlossaryFile(href)) {
        navigate(GLOSSARY_ROUTE, '');
        return;
      }
      // Other links inside the sheet are authored relative to the glossary file, so resolve them from the glossary's own route.
      const { route, anchor } = routeAndAnchorFromHref(href, GLOSSARY_ROUTE);
      navigate(route, anchor);
    },
  });

  buildSidebar();

  // Settings menu (theme + show/hide minimap + show/hide the nav sidebar). The docs reader has a sidebar, so it offers the "Show library" toggle.
  installSettings({ hasLibrary: true });

  window.addEventListener('hashchange', () => {
    const { route, anchor } = parseHash();
    if (route === lastRoute) {
      scrollToAnchor(anchor);
    } else {
      render(route, anchor);
    }
  });

  const initial = parseHash();
  render(initial.route, initial.anchor);
})();
