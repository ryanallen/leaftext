function loadMermaid() {
  if (window.mermaid) {
    return Promise.resolve(window.mermaid);
  }
  if (mermaidLoadPromise) {
    return mermaidLoadPromise;
  }
  mermaidLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MERMAID_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.mermaid) {
        resolve(window.mermaid);
        return;
      }
      reject(new Error('Mermaid runtime loaded without exposing window.mermaid'));
    };
    script.onerror = () => reject(new Error('Mermaid runtime failed to load'));
    document.head.appendChild(script);
  });
  return mermaidLoadPromise;
}
// Rendered-diagram memo: diagram source (+ theme) → finished SVG. Editing
// re-renders the whole document per commit, resetting diagrams to raw text;
// unchanged ones restore from here instantly, so only new/edited ones re-render.
const mermaidRenderCache = new Map();
const MERMAID_CACHE_CAP = 200;
function mermaidCacheKey(source) {
  return (document.documentElement.dataset.theme === 'dark' ? 'dark\n' : 'light\n') + source;
}
function renderMermaidDiagrams() {
  const candidates = Array.from(app.querySelectorAll('pre.mermaid:not([data-processed="true"]):not([data-mermaid-render="failed"])'));
  if (!candidates.length) {
    return;
  }
  const diagrams = [];
  let restored = false;
  candidates.forEach((diagram) => {
    const source = diagram.textContent;
    const cached = mermaidRenderCache.get(mermaidCacheKey(source));
    if (cached) {
      diagram.innerHTML = cached;
      diagram.dataset.processed = 'true';
      restored = true;
      return;
    }
    diagram.__mermaidSource = source;
    diagrams.push(diagram);
  });
  if (restored) {
    readerAnchorBlocks = null;
  }
  if (!diagrams.length) {
    return;
  }
  loadMermaid()
    .then((mermaid) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
        fontFamily: "'Noto Sans', sans-serif",
        themeVariables: { fontFamily: "'Noto Sans', sans-serif" },
      });
      return mermaid.run({ nodes: diagrams });
    })
    .then(() => {
      diagrams.forEach((diagram) => {
        if (diagram.dataset.mermaidRender === 'failed' || diagram.__mermaidSource == null) return;
        if (mermaidRenderCache.size >= MERMAID_CACHE_CAP) mermaidRenderCache.clear();
        mermaidRenderCache.set(mermaidCacheKey(diagram.__mermaidSource), diagram.innerHTML);
      });
      // Diagrams changed the block layout; drop the cached anchor list.
      readerAnchorBlocks = null;
    })
    .catch((error) => {
      console.error(error);
      diagrams.forEach((diagram) => {
        diagram.dataset.mermaidRender = 'failed';
      });
    });
}
// KaTeX (bundled, loaded lazily) renders the .math elements pulldown-cmark emits
// for $…$ and $$…$$. The raw TeX is the element's text; KaTeX replaces it in
// place, falling back to that readable text if the runtime can't load.
function loadKatex() {
  if (window.katex) {
    return Promise.resolve(window.katex);
  }
  if (katexLoadPromise) {
    return katexLoadPromise;
  }
  katexLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = KATEX_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.katex) {
        resolve(window.katex);
        return;
      }
      reject(new Error('KaTeX runtime loaded without exposing window.katex'));
    };
    script.onerror = () => reject(new Error('KaTeX runtime failed to load'));
    document.head.appendChild(script);
  });
  return katexLoadPromise;
}
// Typeset-math memo: TeX source (plus display mode) → the finished KaTeX
// markup. Same reasoning as the Mermaid cache: full re-renders on every editing
// commit re-typeset every formula; unchanged formulas restore instantly.
const katexRenderCache = new Map();
const KATEX_CACHE_CAP = 1000;
function renderMathElements() {
  const nodes = Array.from(app.querySelectorAll('.math:not([data-math-rendered])'));
  if (!nodes.length) {
    return;
  }
  const pending = [];
  nodes.forEach((node) => {
    const key = (node.classList.contains('math-display') ? 'D\n' : 'I\n') + node.textContent;
    const cached = katexRenderCache.get(key);
    if (cached != null) {
      node.innerHTML = cached;
      node.dataset.mathRendered = 'true';
      return;
    }
    pending.push({ node, key });
  });
  if (!pending.length) {
    return;
  }
  loadKatex()
    .then((katex) => {
      pending.forEach(({ node, key }) => {
        try {
          katex.render(node.textContent, node, {
            displayMode: node.classList.contains('math-display'),
            throwOnError: false,
          });
          if (katexRenderCache.size >= KATEX_CACHE_CAP) katexRenderCache.clear();
          katexRenderCache.set(key, node.innerHTML);
        } catch (error) {
          console.error(error);
        }
        node.dataset.mathRendered = 'true';
      });
    })
    .catch((error) => {
      console.error(error);
    });
}
function decorateBlockquoteLines(root = app) {
  root.querySelectorAll('blockquote:not(.markdown-alert) p').forEach((paragraph) => {
    if (paragraph.querySelector('.blockquote-line')) return;
    const children = Array.from(paragraph.childNodes);
    if (!children.some((node) => node.nodeName === 'BR')) return;
    const fragment = document.createDocumentFragment();
    let line = document.createElement('span');
    line.className = 'blockquote-line';
    children.forEach((node) => {
      if (node.nodeName === 'BR') {
        fragment.appendChild(line);
        line = document.createElement('span');
        line.className = 'blockquote-line';
        return;
      }
      line.appendChild(node);
    });
    fragment.appendChild(line);
    paragraph.replaceChildren(fragment);
    paragraph.classList.add('blockquote-lines');
  });
}
// Copy ("document duplicate") and check marks, sized by CSS. The button holds
// both and the .is-copied class swaps which one shows.
const CODE_COPY_ICON = '<svg class="code-copy-mark code-copy-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75"/></svg><svg class="code-copy-mark code-copy-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>';
// Give every fenced/indented code block (but not Mermaid diagrams) a "copy all"
// button. Done here in JS, after the sanitized HTML is in the DOM, so the markup
// the sanitizer sees stays just <pre><code>. The button copies the code verbatim.
function decorateCodeBlocks() {
  app.querySelectorAll('.document-body pre:not(.mermaid)').forEach((pre) => {
    if (pre.querySelector(':scope > .code-copy')) return;
    const code = pre.querySelector('code');
    if (!code) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.innerHTML = CODE_COPY_ICON;
    setCodeCopyLabel(button, 'actions.copyCode');
    button.addEventListener('click', () => copyCodeBlock(button, code.textContent || ''));
    pre.appendChild(button);
  });
}
// Built once and cloned per block — far cheaper than building it from scratch
// tens of thousands of times on a big document.
const anchorLinkTemplate = (() => {
  const link = document.createElement('a');
  link.className = 'heading-anchor';
  // The number lives in an inner span so the anchor inherits the block's font
  // metrics while the glyph stays a fixed small size — see the .heading-anchor CSS.
  const num = document.createElement('span');
  num.className = 'heading-anchor-num';
  link.appendChild(num);
  return link;
})();
// `pre:not(.mermaid)` excludes diagrams: a gutter link inserted as the pre's
// first child would corrupt the source Mermaid reads from innerHTML.
const ANCHOR_LINK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre:not(.mermaid), table, details, figure, div[id], a[id]';
function uniqueAnchorBlockId(seen, base) {
  let candidate = base;
  let suffix = 1;
  while (!candidate || seen.has(candidate)) {
    candidate = base + '-' + suffix;
    suffix += 1;
  }
  seen.add(candidate);
  return candidate;
}
// A list item that is purely a link (or links) is a table-of-contents /
// navigation entry, not body content, so it takes no number.
function isNavOutlineItem(el) {
  if (el.tagName !== 'LI') return false;
  const text = (el.textContent || '').replace(/\\s+/g, '');
  if (!text) return false;
  let linkText = '';
  el.querySelectorAll('a').forEach((a) => { linkText += a.textContent || ''; });
  return text === linkText.replace(/\\s+/g, '');
}
// Give `target` the address `locus`. If it already has an id, keep it and add a
// hidden alias carrying the locus (so #<locus> still lands); otherwise the locus
// becomes the id. Recorded on dataset.locus for the gutter permalink.
function assignLocus(target, locus, seen) {
  if (target.id) {
    seen.add(target.id);
    const alias = document.createElement('span');
    alias.className = 'locus-alias';
    alias.id = uniqueAnchorBlockId(seen, locus);
    alias.setAttribute('aria-hidden', 'true');
    target.insertBefore(alias, target.firstChild);
    target.dataset.locus = alias.id;
  } else {
    target.id = uniqueAnchorBlockId(seen, locus);
    target.dataset.locus = target.id;
  }
}
// Number the document so each block has a short citable address: a flat running
// count down the page, no reset at headings. A heading keeps its slug id (so the
// TOC and #slug links resolve) and carries its number through a hidden alias.
// Link-only outline items are skipped. Deterministic, so ids survive a re-render.
function ensureAnchorLinkTargets(body) {
  const seen = new Set(Array.from(body.querySelectorAll('[id]')).map((element) => element.id).filter(Boolean));
  let line = 0;
  body.querySelectorAll(ANCHOR_LINK_SELECTOR).forEach((target) => {
    if (target.classList.contains('footnote-definition')) return;
    // The generated outline is navigation, not body content — no locus number.
    if (target.closest('.document-outline')) return;
    if (isNavOutlineItem(target)) return;
    line += 1;
    assignLocus(target, '' + line, seen);
  });
  return line;
}
// Build a collapsed "Outline" from the headings and insert it under the title
// (mirrors site/outline.js). A DOM pass over the <h1>–<h6>, nesting entries as a
// bulleted list in a closed <details>. Run before the anchor pass (so its
// link-only entries skip block-numbering) and before bindDocumentLinks.
function buildDocumentOutline() {
  const body = app.querySelector('.document-body');
  if (!body) return;
  const existing = body.querySelector(':scope > .document-outline');
  if (existing) existing.remove();
  const headings = Array.from(body.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(
    (h) => !h.closest('.document-outline') && !h.closest('.footnotes') && !h.closest('.tei-front')
  );
  if (headings.length < 2) return;
  const title = headings[0];
  const rest = headings.slice(1);
  rest.forEach((h, i) => { if (!h.id) h.id = 'section-' + (i + 1); });
  const details = document.createElement('details');
  details.className = 'document-outline';
  const summary = document.createElement('summary');
  summary.className = 'document-outline-summary';
  const summaryLabel = document.createElement('span');
  summaryLabel.dataset.i18n = 'outline.title';
  summaryLabel.textContent = window.leafLocale.t('outline.title');
  summary.appendChild(summaryLabel);
  // Filled in by decorateAnchorLinks once numbering knows the line count — a
  // separate span so renderStaticText's [data-i18n] sweep never wipes it.
  const summaryCount = document.createElement('span');
  summaryCount.className = 'document-outline-count';
  summary.appendChild(summaryCount);
  details.appendChild(summary);
  // The entry list can be enormous (one <li> per heading), so build it only when
  // the outline first opens. bindDocumentLinks is delegated, so entry jumps wire
  // up with no rebinding.
  details.addEventListener('toggle', () => {
    if (details.open) populateDocumentOutline(details, rest);
  });
  title.insertAdjacentElement('afterend', details);
}
function populateDocumentOutline(details, rest) {
  if (details.dataset.outlinePopulated === 'true') return;
  details.dataset.outlinePopulated = 'true';
  const readHeadingText = (h) => {
    const clone = h.cloneNode(true);
    clone.querySelectorAll('.heading-anchor, .anchor-link, .locus-alias, .footnote-ref').forEach((n) => n.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const rootList = document.createElement('ul');
  const stack = [{ level: 0, list: rootList }];
  rest.forEach((h) => {
    const level = Number(h.tagName.slice(1)) || 1;
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    let container = parent.list;
    if (parent.level !== 0) {
      const lastLi = parent.list.lastElementChild;
      let sub = lastLi ? lastLi.querySelector(':scope > ul') : null;
      if (!sub) { sub = document.createElement('ul'); (lastLi || parent.list).appendChild(sub); }
      container = sub;
    }
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'document-outline-link';
    link.href = '#' + encodeURIComponent(h.id);
    link.textContent = readHeadingText(h) || h.id;
    li.appendChild(link);
    container.appendChild(li);
    stack.push({ level, list: container });
  });
  details.appendChild(rootList);
}
// The host serves local images over leaf-image://, which arrives as
// http://leaf-image.local/ where custom protocols are restricted.
const LOCAL_IMAGE_SRC_PREFIXES = ['leaf-image://', 'http://leaf-image.', 'https://leaf-image.'];
// The web view keeps a decoded image against its URL for the life of the process,
// so a replaced file would show stale until a restart. A per-render token makes
// each request a distinct URL.
let localImageEpoch = 0;
function isLocalImageSrc(src) {
  return LOCAL_IMAGE_SRC_PREFIXES.some((prefix) => src.startsWith(prefix));
}
// The host resolves the path from the URL's segments, so the query is inert to it.
function stampLocalImages(root = app) {
  if (!root) return;
  root.querySelectorAll('img[src]').forEach((img) => {
    // getAttribute, not .src: the property is absolute and hides the prefix.
    const src = img.getAttribute('src') || '';
    if (!isLocalImageSrc(src)) return;
    const base = src.split('?')[0];
    const stamped = `${base}?leaf-epoch=${localImageEpoch}`;
    if (img.getAttribute('src') !== stamped) img.setAttribute('src', stamped);
  });
}
// An image changed on disk: re-fetch rather than re-render, so the reader keeps
// its scroll position.
window.leafRefreshImages = () => {
  localImageEpoch += 1;
  stampLocalImages();
  scheduleMinimapPreviewUpdate();
};
// Give every anchor-addressable block a gutter permalink button, GitHub style.
// A real anchor link to the target id, so bindDocumentLinks wires it into
// fragment navigation like a TOC link. Clicking also copies the #locus (without
// blocking the jump) — the only way to read the locus on touch.
function decorateAnchorLinks() {
  const body = app.querySelector('.document-body');
  if (!body) return;
  const lineTotal = ensureAnchorLinkTargets(body);
  // The numbering pass's final count is the line total; stamp it into the outline
  // summary ("Outline (1234 lines)").
  const outlineCount = body.querySelector('.document-outline-count');
  if (outlineCount) {
    outlineCount.textContent = window.leafLocale.t('outline.lineCount', { count: lineTotal });
  }
  const label = window.leafLocale.t('actions.anchorLink');
  body.querySelectorAll(ANCHOR_LINK_SELECTOR).forEach((target) => {
    const locus = target.dataset.locus;
    if (!locus) return;
    if (target.classList.contains('footnote-definition')) return;
    if (target.closest('.document-outline')) return;
    if (target.querySelector(':scope > .heading-anchor')) return;
    // A blockquote is one citable unit and carries the button; skip it on blocks
    // nested inside a blockquote (a second gutter carve would drag the quote text
    // off the column). They keep their id, so #locus links still resolve.
    if (target.tagName !== 'BLOCKQUOTE' && target.closest('blockquote')) return;
    const link = anchorLinkTemplate.cloneNode(true);
    link.href = '#' + encodeURIComponent(locus);
    link.setAttribute('aria-label', label);
    link.title = label;
    // The digits live in the inner span (see anchorLinkTemplate); clicks copy the
    // deep link via the delegated body listener.
    link.firstChild.textContent = locus;
    target.classList.add('has-anchor-link');
    target.insertBefore(link, target.firstChild);
  });
  // No JS positioning: the button lives in each block's own gutter (see the
  // .has-anchor-link CSS), and clicks are handled by the delegated body listener.
}
function setCodeCopyLabel(button, key) {
  const label = window.leafLocale.t(key);
  button.setAttribute('aria-label', label);
  button.title = label;
}
// Copy via the async clipboard API, falling back to a hidden textarea +
// execCommand for webview contexts where the async API is blocked.
function copyCodeBlock(button, text) {
  const ok = () => flashCodeCopied(button);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(ok, () => { if (legacyCopy(text)) ok(); });
  } else if (legacyCopy(text)) {
    ok();
  }
}
function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    copied = false;
  }
  document.body.removeChild(area);
  return copied;
}
// Copy arbitrary text, preferring the async clipboard API and falling back to the
// hidden-textarea path for webview contexts where it is blocked. Used by the
// gutter permalink so a tapped locus number can be pasted out.
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => { legacyCopy(text); });
    return;
  }
  legacyCopy(text);
}
// Briefly show the check mark and a "Copied" label, then revert.
function flashCodeCopied(button) {
  button.classList.add('is-copied');
  setCodeCopyLabel(button, 'actions.copiedCode');
  window.clearTimeout(button.__copiedTimer);
  button.__copiedTimer = window.setTimeout(() => {
    button.classList.remove('is-copied');
    setCodeCopyLabel(button, 'actions.copyCode');
  }, 1400);
}
