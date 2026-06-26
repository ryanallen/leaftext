// reader.js
// ---------------------------------------------------------------------------
// The glue: fetch ./README.md (the file sitting next to this page), turn it
// into HTML with our renderer, put it on the page, set the browser tab title,
// build the document minimap, and jump to any #anchor that is in the URL.
//
// This file is intentionally short. The interesting work is in markdown.js
// (rendering), minimap.js (the side-rail overview), and styles.css (the look).
// ---------------------------------------------------------------------------

import { renderMarkdown } from './markdown.js';
import { initMinimap } from './minimap.js';
import { highlightCode, decorateCodeBlocks } from './codeblocks.js';
import { decorateAnchorLinks } from './anchors.js';
import { decorateBlockquoteLines } from './blockquotes.js';
import { installGlossary } from './glossary.js';
import { installLinkTooltip } from './link-tooltip.js';
import { installSettings } from './settings.js';
import { applySpeedReaderIfEnabled } from './speed-reader.js';

const content = document.getElementById('content');
const statusEl = document.getElementById('status');

// The settings menu (theme + show/hide minimap) pinned to the top-right. The
// single-README site has no navigation sidebar, so no "Show library" toggle.
installSettings({ hasLibrary: false });

// Glossary links (e.g. GLOSSARY.md#karma) open the term in a bottom sheet over
// the README rather than navigating. The glossary is fetched next to this page.
//
// This single-README page has no router, so it cannot render the whole glossary
// itself. "Open the full glossary" (and any plain link to the glossary file)
// goes to the docs viewer's GLOSSARY route — `docs/#/GLOSSARY` — which renders
// the file with full chrome. Without this, the default fetched the raw .md and
// the browser showed unrendered Markdown.
const glossary = installGlossary({
  glossaryUrl: 'GLOSSARY.md',
  renderMarkdown,
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

// Mermaid and KaTeX are vendored under site/vendor/ — no external CDN. Each is a
// single self-contained UMD file, loaded lazily (via a <script> tag) only when
// the document actually contains a diagram or math, and only once.
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
    // Use our bundled Noto Sans for diagram labels (arrows/shapes are SVG, not
    // fonts, so they're unaffected).
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
      fontFamily: "'Noto Sans', sans-serif",
      themeVariables: { fontFamily: "'Noto Sans', sans-serif" },
    });
    await window.mermaid.run({ nodes });
  } catch (err) {
    // Leave the fence as readable source text if the runtime can't load.
    console.error('Mermaid failed to render:', err);
  }
}

// The raw TeX lives in each .math element's text (stashed by markdown.js); we
// render it in place. (KaTeX's CSS is linked in index.html.)
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

// Jump to the heading/element named in the URL (e.g. .../#features). We do this
// ourselves because the content is added after the page loads, so the browser's
// own jump may have happened too early.
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

async function main() {
  try {
    const res = await fetch('./README.md', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching README.md');
    const markdown = await res.text();

    content.innerHTML = renderMarkdown(markdown);
    decorateBlockquoteLines(content);
    if (statusEl) statusEl.hidden = true;

    // Use the first heading as the tab title, if there is one.
    const firstHeading = content.querySelector('h1, h2, h3');
    if (firstHeading) {
      const title = firstHeading.textContent.trim();
      if (title) document.title = title.slice(0, 80);
    }

    // Render Mermaid diagrams and math (async; the minimap's resize observer
    // picks up height changes), build the minimap, then jump to any #anchor.
    renderMermaidDiagrams();
    renderMath();
    highlightCode(content, HLJS_SRC);
    decorateCodeBlocks(content);
    decorateAnchorLinks(content);
    // Clear any stale processed flag before anchoring the freshly rendered
    // document (the settings boot may have run against this element while it was
    // still empty), the same as the docs viewer does on every render.
    delete content.dataset.speedReaderProcessed;
    applySpeedReaderIfEnabled(content);
    initMinimap(content);
    scrollToHash();
  } catch (err) {
    showStatus(
      'Could not load README.md (' +
        err.message +
        '). This page must be served over http, not opened from a file path. ' +
        'For example, in this folder run:  python -m http.server  then open the printed address.'
    );
  }
}

// Note: we deliberately do NOT re-scroll on every `hashchange`. The browser
// already scrolls to the anchor when you click an in-page link, and on
// back/forward it restores your previous scroll position. A hashchange handler
// would override that restoration and snap you back to the heading instead of
// where you had scrolled to.

main();
