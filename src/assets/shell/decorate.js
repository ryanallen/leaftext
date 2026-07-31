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
// ---------------------------------------------------------------------------
// A diagram is drawn in the page's own colors — as far as mermaid allows.
//
// Mermaid's own light and dark themes stay the base, and the parts of a diagram
// that mean something structural are overridden from the theme tokens already on
// :root: boxes, borders, labels, arrows, subgraphs, actors, task states. A theme
// file says nothing about diagrams and gets those anyway.
//
// **What is deliberately left alone: the twelve-color categorical scale** that a
// mindmap, timeline, kanban board, journey, pie chart or git graph paints itself
// with. Those cannot be set from here. Mermaid's `base` theme overwrites every
// `cScale` value with `darken(color, 75)` in dark mode and `darken(color, 25)` in
// light — after our override lands — and then labels the result with a single
// default ink. That is what produced near-black boxes carrying near-black text
// in v0.1.423: not a bad choice of color on our side, a color we never got to
// choose. Its light and dark themes ship a hand-picked scale with matching
// labels instead, so those families keep mermaid's palette and stay legible. The
// diagrams almost every document actually holds — flowcharts and sequences — are
// themed, because their colors are ours to set.
// ---------------------------------------------------------------------------

// mermaid variable → the page token it takes its color from. One table: a
// variable missing from here keeps mermaid's own value, which is the point for
// the scale families above and the drift this guards everywhere else.
// `mermaid_theme_map_uses_real_tokens` in check-shell.mjs holds every name in it
// to the ones reading.css defines.
const MERMAID_COLOR_MAP = {
  // The page the diagram is drawn on, and the ink on it.
  background: '--reading-background',
  textColor: '--reading-ink',
  titleColor: '--reading-heading',
  lineColor: '--muted-foreground',
  errorBkgColor: '--danger',
  errorTextColor: '--danger-foreground',

  // Flowcharts. Boxes are surfaces rather than brand color: a page of forty
  // brand-colored boxes is a poster, not a diagram.
  //
  // `labelTextColor` is deliberately absent: mermaid falls back to it for every
  // categorical label it has no color for, so setting it reaches into the scale
  // families and puts one ink on twelve fills it was not measured against.
  mainBkg: '--surface-muted',
  nodeBorder: '--border-strong',
  nodeTextColor: '--reading-ink',
  clusterBkg: '--surface-sunken',
  clusterBorder: '--border',
  defaultLinkColor: '--muted-foreground',
  edgeLabelBackground: '--reading-background',
  labelBackgroundColor: '--reading-background',
  noteBkgColor: '--surface-muted',
  noteTextColor: '--reading-ink',
  noteBorderColor: '--border-strong',

  // Sequence.
  actorBkg: '--surface-muted',
  actorBorder: '--border-strong',
  actorTextColor: '--reading-ink',
  actorLineColor: '--border-strong',
  signalColor: '--reading-ink',
  signalTextColor: '--reading-ink',
  labelBoxBkgColor: '--surface-muted',
  labelBoxBorderColor: '--border-strong',
  loopTextColor: '--reading-ink',
  activationBkgColor: '--surface-sunken',
  activationBorderColor: '--border-strong',

  // State and class.
  labelColor: '--reading-ink',
  altBackground: '--surface-sunken',
  stateBkg: '--surface-muted',
  stateLabelColor: '--reading-ink',
  transitionColor: '--muted-foreground',
  transitionLabelColor: '--reading-ink',
  compositeBackground: '--surface-muted',
  compositeBorder: '--border-strong',
  compositeTitleBackground: '--surface-sunken',
  specialStateColor: '--reading-ink',
  classText: '--reading-ink',

  // Entity relationship: the striped attribute rows.
  attributeBackgroundColorOdd: '--surface-muted',
  attributeBackgroundColorEven: '--surface-sunken',

  // Gantt. A bar means something here, so the states are the theme's states:
  // ordinary, active, done, critical, and today.
  sectionBkgColor: '--surface-muted',
  sectionBkgColor2: '--surface-sunken',
  altSectionBkgColor: '--reading-background',
  taskBkgColor: '--primary',
  taskBorderColor: '--primary',
  taskTextDarkColor: '--reading-ink',
  taskTextOutsideColor: '--reading-ink',
  taskTextClickableColor: '--link',
  activeTaskBkgColor: '--accent',
  activeTaskBorderColor: '--accent',
  doneTaskBkgColor: '--success',
  doneTaskBorderColor: '--success',
  critBkgColor: '--danger',
  critBorderColor: '--danger',
  todayLineColor: '--danger',
  gridColor: '--border',

  // Pie. The slices come from the seeds; these are the parts around them.
  pieTitleTextColor: '--reading-heading',
  pieSectionTextColor: '--reading-ink',
  pieLegendTextColor: '--reading-ink',
  pieStrokeColor: '--reading-background',
  pieOuterStrokeColor: '--border-strong',

  // Git graph: the branch colors are derived, the labels are ours.
  commitLabelColor: '--reading-ink',
  commitLabelBackground: '--surface-muted',
  tagLabelColor: '--reading-ink',
  tagLabelBackground: '--surface-muted',
  tagLabelBorder: '--border-strong',

  // Quadrant.
  quadrant1Fill: '--surface-muted',
  quadrant2Fill: '--surface-sunken',
  quadrant3Fill: '--surface-muted',
  quadrant4Fill: '--surface-sunken',
  quadrant1TextFill: '--reading-ink',
  quadrant2TextFill: '--reading-ink',
  quadrant3TextFill: '--reading-ink',
  quadrant4TextFill: '--reading-ink',
  quadrantPointFill: '--primary',
  quadrantXAxisTextFill: '--muted-foreground',
  quadrantYAxisTextFill: '--muted-foreground',
  quadrantTitleFill: '--reading-heading',
  quadrantInternalBorderStrokeFill: '--border',
  quadrantExternalBorderStrokeFill: '--border-strong',

  // Requirements.
  requirementBackground: '--surface-muted',
  requirementBorderColor: '--border-strong',
  requirementTextColor: '--reading-ink',
  relationColor: '--muted-foreground',
  relationLabelBackground: '--reading-background',
  relationLabelColor: '--reading-ink',
};

// mermaid variable → `[the fill its text sits on, the ink the theme picked for
// that color]`. These are the labels printed *inside* something colored — a gantt
// bar, a pie slice, a plotted point — and the ink is measured rather than
// assumed, because it is the one place a token alone gets it wrong.
//
// GitHub's palette is why. Its blues and greens are meant to be read as text on
// a page, so they are mid tones; white on them comes out at 2.3:1, and the theme
// is not wrong — the assumption that a brand color takes its own foreground on
// top is. Measuring three candidates (the theme's own choice, the page's ink, the
// page itself) clears 4.5:1 on every color in all eleven families, and will on
// the next family too, which is the point of measuring instead of listing.
const MERMAID_INK_MAP = {
  primaryTextColor: ['--primary', '--primary-foreground'],
  secondaryTextColor: ['--accent', '--accent-foreground'],
  tertiaryTextColor: ['--success', '--success-foreground'],
  taskTextColor: ['--primary', '--primary-foreground'],
  taskTextLightColor: ['--primary', '--primary-foreground'],
  sequenceNumberColor: ['--primary', '--primary-foreground'],
  quadrantPointTextFill: ['--primary', '--primary-foreground'],
};

// The XY chart keeps its colors in a group of its own rather than beside the
// rest, so it needs its own pass. Its plot palette *is* ours to set: mermaid does
// no arithmetic on it, unlike the categorical scale.
const MERMAID_XYCHART_COLOR_MAP = {
  backgroundColor: '--reading-background',
  titleColor: '--reading-heading',
  xAxisLabelColor: '--reading-ink',
  xAxisTitleColor: '--reading-ink',
  xAxisTickColor: '--border-strong',
  xAxisLineColor: '--border-strong',
  yAxisLabelColor: '--reading-ink',
  yAxisTitleColor: '--reading-ink',
  yAxisTickColor: '--border-strong',
  yAxisLineColor: '--border-strong',
};

// What a bar or a line is painted with, in order. Six because a chart with more
// series than that is past the point where color is what tells them apart.
const MERMAID_PLOT_TOKENS = ['--primary', '--accent', '--success', '--warning', '--danger', '--done'];

function themeTokenValue(style, token) {
  return (style.getPropertyValue(token) || '').trim();
}

// Relative luminance, for deciding which of two inks reads on a color. Hex only:
// a token that is a gradient, a color function or a name is not something to
// measure, and the caller falls back rather than guess.
function colorLuminance(color) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return null;
  const digits = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
  const value = parseInt(digits, 16);
  const channel = (byte) => {
    const part = byte / 255;
    return part <= 0.03928 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

function colorContrast(a, b) {
  const first = colorLuminance(a);
  const second = colorLuminance(b);
  if (first == null || second == null) return null;
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function readableInk(style, fill, ownInkToken) {
  let best = '';
  let bestRatio = 0;
  for (const token of [ownInkToken, '--reading-ink', '--reading-background']) {
    const ink = token ? themeTokenValue(style, token) : '';
    const ratio = ink ? colorContrast(fill, ink) : null;
    if (ratio != null && ratio > bestRatio) {
      best = ink;
      bestRatio = ratio;
    }
  }
  return best;
}

// The theme, as mermaid wants it. A token the page has not defined is left out
// rather than passed empty — mermaid derives from what it is given, and an empty
// string is not a color.
function mermaidThemeVariables() {
  const style = window.getComputedStyle(document.documentElement);
  const variables = { darkMode: document.documentElement.dataset.theme === 'dark' };
  for (const [name, token] of Object.entries(MERMAID_COLOR_MAP)) {
    const value = themeTokenValue(style, token);
    if (value) variables[name] = value;
  }
  for (const [name, [fillToken, ownInkToken]] of Object.entries(MERMAID_INK_MAP)) {
    const value = readableInk(style, themeTokenValue(style, fillToken), ownInkToken);
    if (value) variables[name] = value;
  }
  const xyChart = {};
  for (const [name, token] of Object.entries(MERMAID_XYCHART_COLOR_MAP)) {
    const value = themeTokenValue(style, token);
    if (value) xyChart[name] = value;
  }
  const plot = MERMAID_PLOT_TOKENS.map((token) => themeTokenValue(style, token)).filter(Boolean);
  if (plot.length) xyChart.plotColorPalette = plot.join(', ');
  if (Object.keys(xyChart).length) variables.xyChart = xyChart;

  return variables;
}

// The body font of the theme in force, so diagram labels are set in the same
// face as the words around them.
function mermaidFontFamily() {
  const style = window.getComputedStyle(document.documentElement);
  return themeTokenValue(style, '--reading-font') || "'Noto Sans', sans-serif";
}

function mermaidRuntimeConfig() {
  const fontFamily = mermaidFontFamily();
  const themeVariables = mermaidThemeVariables();
  themeVariables.fontFamily = fontFamily;
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    // Mermaid's own light and dark palettes underneath, not `base`: they ship a
    // hand-picked categorical scale with inks to match, and `base` computes that
    // scale itself out of our reach. See the header.
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
    fontFamily,
    themeVariables,
  };
}

// Rendered-diagram memo: diagram source (+ theme) → finished SVG. Editing
// re-renders the whole document per commit, resetting diagrams to raw text;
// unchanged ones restore from here instantly, so only new/edited ones re-render.
const mermaidRenderCache = new Map();
const MERMAID_CACHE_CAP = 200;
// Keyed on the family as well as light or dark: two themes of the same
// appearance draw the same diagram in different colors, and a key that could not
// tell them apart handed back the previous theme's picture.
function mermaidCacheKey(source) {
  const root = document.documentElement.dataset;
  return (root.themeFamily || '') + '\n' + (root.theme || '') + '\n' + source;
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
    // Held on every diagram, drawn or restored: it is the only copy of the text
    // once the SVG has replaced it, and a theme change needs it back.
    diagram.__mermaidSource = source;
    const cached = mermaidRenderCache.get(mermaidCacheKey(source));
    if (cached) {
      diagram.innerHTML = cached;
      diagram.dataset.processed = 'true';
      restored = true;
      return;
    }
    diagrams.push(diagram);
  });
  if (restored) {
    readerAnchorBlocks = null;
  }
  if (!diagrams.length) {
    return;
  }
  // Nearest the reader first, and a few at a time. A diagram costs the better
  // part of a tenth of a second to draw, so a page holding sixty of them spent
  // five seconds frozen before this: one batch, one thread, nothing painted until
  // the last one was done. Ordering by distance puts the diagrams being looked at
  // on screen straight away, and yielding between batches keeps scrolling alive
  // while the rest arrive.
  diagrams.sort((a, b) => mermaidReaderDistance(a) - mermaidReaderDistance(b));
  mermaidRenderGeneration += 1;
  drawMermaidBatches(diagrams, mermaidRenderGeneration);
}

// How far a diagram is from the middle of the window, for deciding what to draw
// first. Off-page elements sort last rather than being skipped: everything gets
// drawn, the order is only what changes.
function mermaidReaderDistance(diagram) {
  const rect = diagram.getBoundingClientRect();
  const middle = (window.innerHeight || 800) / 2;
  return Math.abs(rect.top + rect.height / 2 - middle);
}

// How many diagrams share one turn of the event loop. Small enough that a slow
// one cannot hold the window, big enough not to pay for a yield per diagram.
const MERMAID_BATCH_SIZE = 3;
// Which render pass is the current one. A theme switch mid-draw starts another,
// and the one it interrupted must stop rather than finish painting the old colors
// over the new.
let mermaidRenderGeneration = 0;

function drawMermaidBatches(diagrams, generation) {
  loadMermaid()
    .then(async (mermaid) => {
      // Re-read every time: the theme in force at this render is what these
      // diagrams must be drawn in, not the one that was in force at the last.
      mermaid.initialize(mermaidRuntimeConfig());
      for (let at = 0; at < diagrams.length; at += MERMAID_BATCH_SIZE) {
        if (generation !== mermaidRenderGeneration) return;
        const batch = diagrams.slice(at, at + MERMAID_BATCH_SIZE).filter((diagram) => diagram.isConnected);
        if (!batch.length) continue;
        try {
          await mermaid.run({ nodes: batch });
        } catch (error) {
          // One bad diagram must not cost the rest of the page: mermaid has
          // already drawn its own error into the offender, so mark this batch and
          // carry on with the next.
          console.error(error);
          for (const diagram of batch) diagram.dataset.mermaidRender = 'failed';
        }
        for (const diagram of batch) {
          if (diagram.dataset.mermaidRender === 'failed' || diagram.__mermaidSource == null) continue;
          if (mermaidRenderCache.size >= MERMAID_CACHE_CAP) mermaidRenderCache.clear();
          mermaidRenderCache.set(mermaidCacheKey(diagram.__mermaidSource), diagram.innerHTML);
        }
        // Each batch changed the block layout; drop the cached anchor list, and
        // let whatever else watches the page catch up before the next one.
        readerAnchorBlocks = null;
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    })
    .catch((error) => {
      console.error(error);
    });
}

// Draw the diagrams again in the theme that just arrived. A theme change repaints
// the page by swapping tokens, but an SVG already drawn holds the old colors as
// literal values, so the only way to recolor one is to draw it again from the
// text it came from. A diagram that failed before is given another go: this may
// be a theme it can be drawn in.
function repaintMermaidDiagrams() {
  const diagrams = Array.from(app.querySelectorAll('pre.mermaid'));
  let any = false;
  for (const diagram of diagrams) {
    if (diagram.__mermaidSource == null) continue;
    if (diagram.dataset.editingSource === 'true') continue;
    diagram.textContent = diagram.__mermaidSource;
    delete diagram.dataset.processed;
    delete diagram.dataset.mermaidRender;
    any = true;
  }
  if (any) renderMermaidDiagrams();
}

// Mermaid measures a label to size the box it draws around it, so a diagram drawn
// before the theme's web font has arrived is measured in the fallback face and
// then clipped when the real one lands — which is what cut "Sequence" down to
// "Sequenc" on a mindmap. The font loader is what knows when that happened.
//
// Once per theme: a repaint asks for no new faces, so this cannot chase itself.
let mermaidFontRepaintDone = false;
function repaintMermaidDiagramsForFonts() {
  if (mermaidFontRepaintDone) return;
  mermaidFontRepaintDone = true;
  repaintMermaidDiagrams();
}
if (document.fonts && typeof document.fonts.addEventListener === 'function') {
  document.fonts.addEventListener('loadingdone', repaintMermaidDiagramsForFonts);
}

// The theme is announced on the root element, by the picker and by the system's
// own light/dark switch alike — so watching the attribute catches every way it
// can change without each of them having to know diagrams exist. A new family
// brings a new font, so the font repaint is armed again with it.
if (typeof MutationObserver === 'function') {
  new MutationObserver(() => {
    mermaidFontRepaintDone = false;
    repaintMermaidDiagrams();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-leaf-theme'],
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
    setCodeCopyLabel(button, 'Copy code');
    button.addEventListener('click', () => copyCodeBlock(button, code.textContent || ''));
    pre.appendChild(button);
  });
}
// The body blocks the outline counts as "lines". `pre:not(.mermaid)` excludes
// diagrams, which are one figure however many lines of source drew them.
const DOCUMENT_LINE_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre:not(.mermaid), table, details, figure, div[id], a[id]';
// A list item that is purely a link (or links) is a table-of-contents /
// navigation entry, not body content, so it doesn't count.
function isNavOutlineItem(el) {
  if (el.tagName !== 'LI') return false;
  const text = (el.textContent || '').replace(/\s+/g, '');
  if (!text) return false;
  let linkText = '';
  el.querySelectorAll('a').forEach((a) => { linkText += a.textContent || ''; });
  return text === linkText.replace(/\s+/g, '');
}
// How long the document is, in body blocks. Counted rather than stamped — the total
// is all anyone reads, so numbering 50,000 blocks to reach it bought nothing.
function documentLineCount(body) {
  let lines = 0;
  body.querySelectorAll(DOCUMENT_LINE_SELECTOR).forEach((target) => {
    if (target.classList.contains('footnote-definition')) return;
    // The generated outline is navigation, not body content.
    if (target.closest('.document-outline')) return;
    if (isNavOutlineItem(target)) return;
    lines += 1;
  });
  return lines;
}
// Build a collapsed "Outline" from the headings and insert it under the title
// (mirrors site/outline.js). A DOM pass over the <h1>–<h6>, nesting entries as a
// bulleted list in a closed <details>. Run before bindDocumentLinks.
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
  summaryLabel.textContent = 'Outline';
  summary.appendChild(summaryLabel);
  // Counted before the outline is inserted, so the outline never counts itself.
  const summaryCount = document.createElement('span');
  summaryCount.className = 'document-outline-count';
  summaryCount.textContent = `(${formatCount(documentLineCount(body))} lines)`;
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
    clone.querySelectorAll('.footnote-ref').forEach((n) => n.remove());
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
function setCodeCopyLabel(button, label) {
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
// Briefly show the check mark and a "Copied" label, then revert.
function flashCodeCopied(button) {
  button.classList.add('is-copied');
  setCodeCopyLabel(button, 'Copied');
  window.clearTimeout(button.__copiedTimer);
  button.__copiedTimer = window.setTimeout(() => {
    button.classList.remove('is-copied');
    setCodeCopyLabel(button, 'Copy code');
  }, 1400);
}
