// reader.js
// ---------------------------------------------------------------------------
// The glue: fetch ./README.md (the file sitting next to this page), turn it into HTML with our renderer, put it on the page, set the browser tab title, build the document minimap, and jump to any #anchor that is in the URL.
//
// This file is intentionally short. The interesting work is in the renderer, which is the app's own, fetched as a module (leaftext-core.js) — plus minimap.js (the side-rail overview) and styles.css (what draws the page around the document).
// ---------------------------------------------------------------------------

import { createLeaftext } from './leaftext-core.js';
import { fetchWatched } from './fetches.js';
import { fillPager } from './pager.js';
import { initMinimap } from './minimap.js';
import { buildOutline } from './outline.js';
import { highlightCode, decorateCodeBlocks } from './codeblocks.js';
import { decorateAnchorLinks } from './anchors.js';
import { decorateBlockquoteLines } from './blockquotes.js';
import { installGlossary, installAutoGlossary } from './glossary.js';
import { installLinkTooltip } from './link-tooltip.js';
import { installPictureFallback } from './pictures.js';
import { installSettings } from './settings.js';
import { applySpeedReaderIfEnabled } from './speed-reader.js';

const content = document.getElementById('content');
const statusEl = document.getElementById('status');

// The renderer. On a page the publish baked the document into it arrives after the words are already readable, so a glossary link pressed in that moment says so rather than throwing.
let leaf = null;
const renderDocument = (body, path) => {
  if (!leaf) throw new Error('the reader has not arrived yet');
  const drawn = leaf.render(body, path);
  if (!drawn) throw new Error('the renderer refused ' + path);
  return drawn;
};

// The settings menu (theme + show/hide minimap) pinned to the top-right. The single-README site has no navigation sidebar, so no "Show library" toggle.
installSettings({ hasLibrary: false });

// Glossary links (e.g. GLOSSARY.md#karma) open the term in a bottom sheet over the README rather than navigating. The file is docs/GLOSSARY.md — there is no copy at the site root, so a bare 'GLOSSARY.md' here is a 404 in the sheet.
//
// This single-README page has no router, so it cannot render the whole glossary itself. "Open the full glossary" (and any plain link to the glossary file) goes to the docs viewer's GLOSSARY route — `docs/#/GLOSSARY` — which renders the file with full chrome; the default fetches the raw .md, which the browser shows as unrendered Markdown.
const glossary = installGlossary({
  glossaryUrl: 'docs/GLOSSARY.md',
  render: (text, path) => renderDocument(text, path),
  onNavigate: (href) => {
    const hashAt = href.indexOf('#');
    const path = (hashAt >= 0 ? href.slice(0, hashAt) : href).split('?')[0];
    const anchor = hashAt >= 0 ? href.slice(hashAt + 1) : '';
    if (/(^|[\\/])glossary\.md$/i.test(path)) {
      window.location.assign('docs/#/GLOSSARY' + (anchor ? '#' + anchor : ''));
      return;
    }
    window.location.assign(href);
  },
});
installLinkTooltip(document);
content.addEventListener('click', (event) => {
  glossary.handleClick(event);
});

// Mermaid and KaTeX are vendored under site/vendor/ — no external CDN. Each is a single self-contained UMD file, loaded lazily (via a <script> tag) only when the document actually contains a diagram or math, and only once.
const MERMAID_SRC = 'site/vendor/mermaid.min.js';
const KATEX_SRC = 'site/vendor/katex/katex.min.js';
const HLJS_SRC = 'site/vendor/highlight.min.js';
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
  const nodes = Array.from(content.querySelectorAll('pre.mermaid'));
  if (!nodes.length) return;
  try {
    if (!window.mermaid) await loadScript(MERMAID_SRC);
    // Use our bundled Noto Sans for diagram labels (arrows/shapes are SVG, not fonts, so they're unaffected).
    const subgraphTitleGap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lt-space-8')) || 0;
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
      fontFamily: "'Noto Sans', sans-serif",
      flowchart: { subGraphTitleMargin: { top: subgraphTitleGap, bottom: subgraphTitleGap } },
      themeCSS: '.cluster-label div { white-space: nowrap !important; width: max-content !important; max-width: none !important; }',
      themeVariables: { fontFamily: "'Noto Sans', sans-serif" },
    });
    await window.mermaid.run({ nodes });
  } catch (err) {
    // Leave the fence as readable source text if the runtime can't load.
    console.error('Mermaid failed to render:', err);
  }
}

// The raw TeX lives in each .math element's text (stashed by the renderer); we render it in place. (KaTeX's CSS is linked in index.html.)
async function renderMath() {
  const nodes = Array.from(content.querySelectorAll('.math'));
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
    // Leave the raw TeX text in place if the runtime can't load.
    console.error('KaTeX failed to render:', err);
  }
}

function showStatus(message) {
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.hidden = false;
  }
}

// Jump to the heading/element named in the URL (e.g. .../#features). We do this ourselves because the content is added after the page loads, so the browser's own jump may have happened too early.
function scrollToHash() {
  if (!location.hash) return;
  const raw = location.hash.slice(1);
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch (e) {
    id = raw;
  }
  const target = document.getElementById(id) || document.getElementById(raw);
  if (target) target.scrollIntoView();
}

/**
 * Fetch the document to display: the README beside this page, in whichever
 * format the renderer reads. The list is the app's own one table, so a folder
 * whose landing page is TEI, JSON or YAML serves it here with nothing to add.
 * Returns { body, path }.
 *
 * The file's own bytes, not a decode of them: a README that is a Word file is a
 * zip, and one written in UTF-16 loses its words the same way. The renderer
 * decodes it exactly as the window decodes a file off the disk.
 */
async function fetchDocument() {
  for (const ext of leaf.formats) {
    const path = './README.' + ext;
    const res = await fetchWatched(path, { cache: 'no-cache' });
    if (res.ok) return { body: await res.bytes(), path };
  }
  throw new Error('no README this reader can open beside this page');
}

/** Everything a drawn document needs on the page, whether the publish baked it in or this script fetched and rendered it. */
function decorate() {
  // The pictures the publish baked into this page started loading before this module did, so the sweep is what catches the ones an old browser already failed on.
  installPictureFallback(content);
  // One README, so there is nothing either side of it: the renderer's waiting strip is a promise this page cannot keep, and it comes out.
  fillPager(content, null, null);
  decorateBlockquoteLines(content);
  // A collapsed outline (table of contents) built from the document's headings, tucked just under the title. Built before the anchor pass so its link-only entries stay out of the block-numbering scheme.
  buildOutline(content, { label: 'Outline' });
  if (statusEl) statusEl.hidden = true;

  // The document's own title, off the heading it drew. The publish does not know a reader's tab, and this is the same answer the renderer gives.
  const heading = content.querySelector('h1');
  if (heading) document.title = heading.textContent.trim().slice(0, 80);

  // Render Mermaid diagrams and math (async; the minimap's resize observer picks up height changes), build the minimap, then jump to any #anchor. Run over every format: a document with no diagram and no fence in it costs each of these one query that finds nothing.
  renderMermaidDiagrams();
  renderMath();
  highlightCode(content, HLJS_SRC);
  decorateCodeBlocks(content);
  decorateAnchorLinks(content);
  // Clear any stale processed flag before anchoring the freshly rendered document (the settings boot may have run against this element while it was still empty), the same as the docs viewer does on every render.
  delete content.dataset.speedReaderProcessed;
  applySpeedReaderIfEnabled(content);
  initMinimap(content);
  scrollToHash();
}

/** The glossary's own pass, which needs the renderer: every word the glossary defines becomes a link to its entry. The glossary is a published doc page, so it is under docs/, not beside this one. */
function linkGlossaryTerms() {
  installAutoGlossary({
    contentEl: content,
    render: renderDocument,
    glossaryUrl: 'docs/GLOSSARY.md',
  });
}

async function main() {
  // The publish writes the README's words straight into this page, so a cold visit reads the document out of the first response. The renderer then arrives as a decoration rather than as the thing the page is waiting on — and a connection that never delivers it costs the glossary links, not the document. A page served without them, which is any local checkout, fetches the document and draws it here.
  if (content.childNodes.length) {
    decorate();
    createLeaftext()
      .then((loaded) => {
        leaf = loaded;
        linkGlossaryTerms();
      })
      .catch((err) => {
        console.error('The reader could not be loaded, so the glossary links are not drawn:', err);
      });
    return;
  }
  try {
    leaf = await createLeaftext();
  } catch (err) {
    showStatus(
      'The reader could not be loaded (' +
        err.message +
        '), so this page cannot be drawn. The full text is in README.md beside it.'
    );
    return;
  }
  try {
    const { body, path } = await fetchDocument();

    const drawn = renderDocument(body, path);
    content.innerHTML = drawn.html;
    decorate();
    // Auto-link glossary terms after the page is displayed.
    linkGlossaryTerms();
  } catch (err) {
    showStatus(
      'Could not load the document (' +
        err.message +
        '). This page must be served over http, not opened from a file path. ' +
        'For example, in this folder run:  python -m http.server  then open the printed address.'
    );
  }
}

// Note: we deliberately do NOT re-scroll on every `hashchange`. The browser already scrolls to the anchor when you click an in-page link, and on back/forward it restores your previous scroll position. A hashchange handler would override that restoration and snap you back to the heading instead of where you had scrolled to.

main();
