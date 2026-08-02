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
// A diagram takes the page's colors, over mermaid's own light/dark theme.
//
// mermaid variable → the page token it takes its color from. A variable missing
// from here keeps mermaid's value; check-shell.mjs holds every name in this table
// to the ones reading.css defines.
const MERMAID_COLOR_MAP = {
  // The page the diagram is drawn on, and the ink on it.
  background: '--lt-markdown-background',
  textColor: '--lt-markdown-foreground',
  titleColor: '--lt-markdown-heading',
  lineColor: '--lt-muted-foreground',
  errorBkgColor: '--lt-danger',

  // Flowcharts. Boxes are surfaces, not brand color: forty brand-colored boxes is
  // a poster.
  mainBkg: '--lt-surface-muted',
  nodeBorder: '--lt-border-strong',
  nodeTextColor: '--lt-markdown-foreground',
  clusterBkg: '--lt-surface-sunken',
  clusterBorder: '--lt-border',
  defaultLinkColor: '--lt-muted-foreground',
  edgeLabelBackground: '--lt-markdown-background',
  labelBackgroundColor: '--lt-markdown-background',
  noteBkgColor: '--lt-surface-muted',
  noteTextColor: '--lt-markdown-foreground',
  noteBorderColor: '--lt-border-strong',

  // Sequence.
  actorBkg: '--lt-surface-muted',
  actorBorder: '--lt-border-strong',
  actorTextColor: '--lt-markdown-foreground',
  actorLineColor: '--lt-border-strong',
  signalColor: '--lt-markdown-foreground',
  signalTextColor: '--lt-markdown-foreground',
  labelBoxBkgColor: '--lt-surface-muted',
  labelBoxBorderColor: '--lt-border-strong',
  loopTextColor: '--lt-markdown-foreground',
  activationBkgColor: '--lt-surface-sunken',
  activationBorderColor: '--lt-border-strong',

  // State and class.
  labelColor: '--lt-markdown-foreground',
  altBackground: '--lt-surface-sunken',
  stateBkg: '--lt-surface-muted',
  stateLabelColor: '--lt-markdown-foreground',
  transitionColor: '--lt-muted-foreground',
  transitionLabelColor: '--lt-markdown-foreground',
  compositeBackground: '--lt-surface-muted',
  compositeBorder: '--lt-border-strong',
  compositeTitleBackground: '--lt-surface-sunken',
  specialStateColor: '--lt-markdown-foreground',
  classText: '--lt-markdown-foreground',

  // Entity relationship: the striped attribute rows.
  attributeBackgroundColorOdd: '--lt-surface-muted',
  attributeBackgroundColorEven: '--lt-surface-sunken',

  // Gantt. A bar means something here, so the states are the theme's states:
  // ordinary, active, done, critical, and today.
  sectionBkgColor: '--lt-surface-muted',
  sectionBkgColor2: '--lt-surface-sunken',
  altSectionBkgColor: '--lt-markdown-background',
  taskBkgColor: '--lt-primary',
  taskBorderColor: '--lt-primary',
  taskTextOutsideColor: '--lt-markdown-foreground',
  activeTaskBkgColor: '--lt-accent',
  activeTaskBorderColor: '--lt-accent',
  doneTaskBkgColor: '--lt-success',
  doneTaskBorderColor: '--lt-success',
  critBkgColor: '--lt-danger',
  critBorderColor: '--lt-danger',
  todayLineColor: '--lt-danger',
  gridColor: '--lt-border',

  // Pie. The slices are the categorical scale below; these are the parts around
  // them.
  pieTitleTextColor: '--lt-markdown-heading',
  pieLegendTextColor: '--lt-markdown-foreground',
  pieStrokeColor: '--lt-markdown-background',
  pieOuterStrokeColor: '--lt-border-strong',

  // Git graph: the branch colors are the categorical scale below, the labels ours.
  commitLabelColor: '--lt-markdown-foreground',
  commitLabelBackground: '--lt-surface-muted',
  tagLabelColor: '--lt-markdown-foreground',
  tagLabelBackground: '--lt-surface-muted',
  tagLabelBorder: '--lt-border-strong',

  // Quadrant.
  quadrant1Fill: '--lt-surface-muted',
  quadrant2Fill: '--lt-surface-sunken',
  quadrant3Fill: '--lt-surface-muted',
  quadrant4Fill: '--lt-surface-sunken',
  quadrant1TextFill: '--lt-markdown-foreground',
  quadrant2TextFill: '--lt-markdown-foreground',
  quadrant3TextFill: '--lt-markdown-foreground',
  quadrant4TextFill: '--lt-markdown-foreground',
  quadrantPointFill: '--lt-primary',
  quadrantXAxisTextFill: '--lt-muted-foreground',
  quadrantYAxisTextFill: '--lt-muted-foreground',
  quadrantTitleFill: '--lt-markdown-heading',
  quadrantInternalBorderStrokeFill: '--lt-border',
  quadrantExternalBorderStrokeFill: '--lt-border-strong',

  // Requirements.
  requirementBackground: '--lt-surface-muted',
  requirementBorderColor: '--lt-border-strong',
  requirementTextColor: '--lt-markdown-foreground',
  relationColor: '--lt-muted-foreground',
  relationLabelBackground: '--lt-markdown-background',
  relationLabelColor: '--lt-markdown-foreground',
};

// The twelve-color categorical scale (mindmap, timeline, kanban, journey, pie,
// git graph). Every entry is named, because mermaid re-applies what it is handed
// *after* its own arithmetic: a `cScale` we set survives, a color that only feeds
// the scale gets darkened out of reach — which is what v0.1.423 shipped.
//
// 150° a step so that neighbors, which is what a timeline puts side by side, land
// opposite rather than one notch apart; twelve such steps still visit all twelve
// hues. Entries share a luminance, not a lightness — a yellow and a blue at one
// lightness are nowhere near one weight, and one weight is what lets one ink read
// on all twelve. A mindmap needs that: its labels are HTML and take the page's
// ink whatever `cScaleLabel` says.
const MERMAID_SCALE_SEED = '--lt-primary';
const MERMAID_SCALE_STEPS = 12;
const MERMAID_SCALE_HUE_STEP = 150;
// Off the page but under the page's ink, and the mirror of that in light mode.
// Saturated enough that twelve hues stay apart when the primary is nearly gray.
const MERMAID_SCALE_SHAPE = {
  light: { luminance: 0.45, minSaturation: 0.42, maxSaturation: 0.85 },
  dark: { luminance: 0.12, minSaturation: 0.38, maxSaturation: 0.85 },
};

// mermaid variable → the fill its text is printed on, so the ink can be measured
// against it. A theme's `*-foreground` is the ink for its own buttons and says
// nothing about a diagram: GitHub's greens are mid tones meant to be read as
// text, so white on one is 2.3:1.
//
// Naming the wrong fill looks exactly like naming the wrong color — a quadrant
// point's label sits on the quadrant, not on the point, and measuring it against
// the point shipped white text on a pale gray panel. Gantt bars are set per state
// below: four colors, one variable, no ink that reads on all of them.
const MERMAID_INK_MAP = {
  taskTextColor: ['--lt-primary'],
  taskTextLightColor: ['--lt-primary'],
  sequenceNumberColor: ['--lt-muted-foreground'],
  errorTextColor: ['--lt-danger'],
  quadrantPointTextFill: ['--lt-surface-muted', '--lt-surface-sunken'],
};

// Every ink a diagram may print in — all theme colors, so a diagram never prints
// in one the theme does not contain.
const MERMAID_INK_CANDIDATES = [
  '--lt-markdown-foreground',
  '--lt-markdown-background',
  '--lt-primary-foreground',
  '--lt-accent-foreground',
  '--lt-success-foreground',
  '--lt-danger-foreground',
];

// A bar's state is its color, so each state's text class takes the ink measured
// against its own bar. Mermaid appends `themeCSS` after its own stylesheet, which
// is the only way to give one variable four values.
const MERMAID_GANTT_STATE_INKS = [
  ['taskText', '--lt-primary'],
  ['activeText', '--lt-accent'],
  ['doneText', '--lt-success'],
  ['critText', '--lt-danger'],
  ['activeCritText', '--lt-danger'],
  ['doneCritText', '--lt-danger'],
];
const MERMAID_GANTT_SECTIONS = 4;

// The XY chart keeps its colors in a group of its own rather than beside the
// rest, so it needs its own pass. Its plot palette *is* ours to set: mermaid does
// no arithmetic on it, unlike the categorical scale.
const MERMAID_XYCHART_COLOR_MAP = {
  backgroundColor: '--lt-markdown-background',
  titleColor: '--lt-markdown-heading',
  xAxisLabelColor: '--lt-markdown-foreground',
  xAxisTitleColor: '--lt-markdown-foreground',
  xAxisTickColor: '--lt-border-strong',
  xAxisLineColor: '--lt-border-strong',
  yAxisLabelColor: '--lt-markdown-foreground',
  yAxisTitleColor: '--lt-markdown-foreground',
  yAxisTickColor: '--lt-border-strong',
  yAxisLineColor: '--lt-border-strong',
};

// What a bar or a line is painted with, in order. Six because a chart with more
// series than that is past the point where color is what tells them apart.
const MERMAID_PLOT_TOKENS = ['--lt-primary', '--lt-accent', '--lt-success', '--lt-warning', '--lt-danger', '--lt-done'];

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

// The theme ink that reads best on every one of `fills`. The worst fill decides:
// one ink is only as readable as it is on the poorer surface.
function inkOn(style, fills) {
  if (!fills.length) return '';
  let best = '';
  let bestRatio = 0;
  for (const token of MERMAID_INK_CANDIDATES) {
    const ink = themeTokenValue(style, token);
    if (!ink) continue;
    let worst = Infinity;
    for (const fill of fills) {
      const ratio = colorContrast(fill, ink);
      if (ratio == null) {
        worst = 0;
        break;
      }
      worst = Math.min(worst, ratio);
    }
    if (worst > bestRatio) {
      best = ink;
      bestRatio = worst;
    }
  }
  return best;
}

// The same, given tokens rather than colors.
function readableInk(style, fillTokens) {
  return inkOn(style, fillTokens.map((token) => themeTokenValue(style, token)).filter(Boolean));
}

function colorChannels(color) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return null;
  const digits = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
  const value = parseInt(digits, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// Hue and saturation only: the scale sets its own lightness, so that is the one
// part of the seed we throw away.
function colorHueSaturation(channels) {
  const [r, g, b] = channels.map((byte) => byte / 255);
  const high = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const span = high - low;
  const lightness = (high + low) / 2;
  if (!span) return [0, 0];
  const saturation = span / (1 - Math.abs(2 * lightness - 1));
  let hue;
  if (high === r) hue = ((g - b) / span) % 6;
  else if (high === g) hue = (b - r) / span + 2;
  else hue = (r - g) / span + 4;
  return [((hue * 60) + 360) % 360, Math.min(1, saturation)];
}

function hslColor(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = ((hue % 360) + 360) % 360 / 60;
  const second = chroma * (1 - Math.abs((section % 2) - 1));
  const base = [
    [chroma, second, 0], [second, chroma, 0], [0, chroma, second],
    [0, second, chroma], [second, 0, chroma], [chroma, 0, second],
  ][Math.floor(section) % 6];
  const offset = lightness - chroma / 2;
  return '#' + base
    .map((part) => Math.round((part + offset) * 255).toString(16).padStart(2, '0'))
    .join('');
}

// One hue at one weight. Luminance rises with lightness, so halving converges.
function colorAtLuminance(hue, saturation, luminance) {
  let low = 0;
  let high = 1;
  let color = hslColor(hue, saturation, 0.5);
  for (let pass = 0; pass < 12; pass += 1) {
    const middle = (low + high) / 2;
    color = hslColor(hue, saturation, middle);
    if (colorLuminance(color) < luminance) low = middle;
    else high = middle;
  }
  return color;
}

// The categorical scale, seeded from the theme's primary. Empty if the seed is
// not something we can measure, which leaves mermaid's own palette in place
// rather than guessing at one.
function mermaidCategoricalScale(style, darkMode) {
  const seed = colorChannels(themeTokenValue(style, MERMAID_SCALE_SEED));
  if (!seed) return [];
  const shape = darkMode ? MERMAID_SCALE_SHAPE.dark : MERMAID_SCALE_SHAPE.light;
  const [hue, saturation] = colorHueSaturation(seed);
  const spread = Math.min(shape.maxSaturation, Math.max(shape.minSaturation, saturation));
  const scale = [];
  for (let step = 0; step < MERMAID_SCALE_STEPS; step += 1) {
    scale.push(colorAtLuminance(hue + step * MERMAID_SCALE_HUE_STEP, spread, shape.luminance));
  }
  return scale;
}

// C4 paints its relation lines and labels a hardcoded #444444 — 1.5:1 on a dark
// page, with no theme variable and no class behind it. Nothing else mermaid draws
// sets `fill` or `stroke` as an attribute to that value, so the attribute is the
// only handle.
const MERMAID_C4_RELATION_COLOR = '#444444';

function mermaidC4RelationCss(style) {
  const ink = themeTokenValue(style, '--lt-muted-foreground');
  if (!ink) return '';
  return [
    'text[fill="' + MERMAID_C4_RELATION_COLOR + '"] { fill: ' + ink + ' !important; }',
    'line[stroke="' + MERMAID_C4_RELATION_COLOR + '"] { stroke: ' + ink + ' !important; }',
  ].join('\n');
}

// The per-state gantt label colors, as CSS. Mermaid's own gantt rules carry
// `!important` on the active and done states, so ours have to as well.
function mermaidGanttStateCss(style) {
  const rules = [];
  for (const [selector, fillToken] of MERMAID_GANTT_STATE_INKS) {
    const ink = readableInk(style, [fillToken]);
    if (!ink) continue;
    const selectors = [];
    for (let section = 0; section < MERMAID_GANTT_SECTIONS; section += 1) {
      selectors.push('.' + selector + section);
    }
    rules.push(selectors.join(', ') + ' { fill: ' + ink + ' !important; }');
  }
  return rules.join('\n');
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
  for (const [name, fillTokens] of Object.entries(MERMAID_INK_MAP)) {
    const value = readableInk(style, fillTokens);
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

  // The scale, and an ink measured on each entry. The git graph and the journey
  // keep it under their own names and have to be pointed at it — left alone the
  // one labels branch 1 `white` whatever it lands on, the other bands the chart
  // midnight blue and magenta in every theme.
  const scale = mermaidCategoricalScale(style, variables.darkMode);
  scale.forEach((color, index) => {
    variables['cScale' + index] = color;
    variables['cScaleLabel' + index] = inkOn(style, [color]);
    if (index < 8) {
      variables['git' + index] = color;
      variables['gitBranchLabel' + index] = inkOn(style, [color]);
      variables['fillType' + index] = color;
    }
  });
  if (scale.length) {
    // One variable for all twelve slices, so it is measured against all twelve.
    variables.pieSectionTextColor = inkOn(style, scale);
    // Mermaid's 0.7 mixes three tenths of the page into every slice, which on a
    // light page is two pale slices nobody can tell apart.
    variables.pieOpacity = '1';
  }

  return variables;
}

// The body font of the theme in force, so diagram labels are set in the same
// face as the words around them.
function mermaidFontFamily() {
  const style = window.getComputedStyle(document.documentElement);
  return themeTokenValue(style, '--reading-font') || "'Noto Sans', sans-serif";
}

// `htmlLabels` off puts a label in an SVG `<text>` rather than a
// `<foreignObject>`, which an SVG loaded as an image drops outright. The page
// keeps the foreign object; anything bound for a picture asks for text. Stated
// on every call because `mermaid.initialize` merges: a config quiet about it
// leaves the last answer in place for the next diagram drawn.
function mermaidRuntimeConfig(options) {
  const htmlLabels = !options || options.htmlLabels !== false;
  const style = window.getComputedStyle(document.documentElement);
  const fontFamily = (options && options.fontFamily) || mermaidFontFamily();
  const themeVariables = mermaidThemeVariables();
  themeVariables.fontFamily = fontFamily;
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels,
    flowchart: { htmlLabels },
    // Appended after mermaid's own stylesheet, so it settles what a variable
    // cannot: one ink per gantt state, and C4's one hardcoded color.
    themeCSS: [mermaidGanttStateCss(style), mermaidC4RelationCss(style)]
      .filter(Boolean)
      .join('\n'),
    // Mermaid's own light and dark palettes underneath, never `base`: `base`
    // recomputes the categorical scale and darkens every entry it derives.
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
// appearance draw the same diagram in different colors, and a key that cannot
// tell them apart hands back the previous theme's picture.
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
      addMermaidControls(diagram);
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
  // Nearest the reader first, a few at a time. Sixty diagrams in one batch froze
  // the window for five seconds, nothing painted until the last was done.
  diagrams.sort((a, b) => mermaidReaderDistance(a) - mermaidReaderDistance(b));
  mermaidRenderGeneration += 1;
  drawMermaidBatches(diagrams, mermaidRenderGeneration);
}

// How far a diagram is from the middle of the window. Everything still gets
// drawn; only the order changes.
function mermaidReaderDistance(diagram) {
  const rect = diagram.getBoundingClientRect();
  const middle = (window.innerHeight || 800) / 2;
  return Math.abs(rect.top + rect.height / 2 - middle);
}

// Small enough that one slow diagram cannot hold the window.
const MERMAID_BATCH_SIZE = 3;
// Which render pass is the current one. A theme switch mid-draw starts another,
// and the one it interrupted must stop rather than finish painting the old colors
// over the new.
let mermaidRenderGeneration = 0;

function drawMermaidBatches(diagrams, generation) {
  loadMermaid()
    .then(async (mermaid) => {
      // A box is only as wide as mermaid measured its label, so measuring in the
      // fallback face and painting in the theme's takes the last letter off every
      // one of them. Wait for the faces the page has asked for before measuring.
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      if (generation !== mermaidRenderGeneration) return;
      // Re-read every time: the theme in force at this render is what these
      // diagrams must be drawn in, not the one that was in force at the last.
      mermaid.initialize(mermaidRuntimeConfig());
      // The rail mirrors the document, so every batch would rebuild it. One
      // rebuild for the pass instead; the reader's own re-pin still runs per
      // batch, which is what holds the reading position as diagrams grow.
      pauseMinimapPreview();
      try {
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
            // Memo first, button second: the cache holds innerHTML, and a button
            // baked into it would come back on every restore and stack up.
            mermaidRenderCache.set(mermaidCacheKey(diagram.__mermaidSource), diagram.innerHTML);
            addMermaidControls(diagram);
          }
          // Each batch changed the block layout; drop the cached anchor list, and
          // let whatever else watches the page catch up before the next one.
          readerAnchorBlocks = null;
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      } finally {
        resumeMinimapPreview();
      }
    })
    .catch((error) => {
      console.error(error);
    });
}

// A drawn diagram gets its corner controls. The drawing itself is dragged to
// move it, so the source opens from a button here rather than from a press
// anywhere on the block — see wireSourceEditable, which stands aside for these.
function addMermaidControls(diagram) {
  addMermaidZoomControls(diagram);
  addMermaidEditButtons(diagram);
}

function addMermaidEditButtons(diagram) {
  if (currentDocumentFormat !== 'markdown' || !readerEditingAllowed()) return;
  if (!Number.isFinite(Number(diagram.dataset.srcStart)) || !Number.isFinite(Number(diagram.dataset.srcEnd))) return;
  if (diagram.querySelector('.mermaid-tools')) return;
  const tools = document.createElement('div');
  tools.className = 'mermaid-tools';
  tools.appendChild(mermaidToolButton('source', 'Edit the Mermaid text of this diagram', `<span class="lt-icon lt-icon-code-view"></span>`));
  tools.appendChild(mermaidToolButton('sheet', 'Open in the flowchart editor, to draw it', `<span class="lt-icon lt-icon-workflow"></span>`));
  diagram.appendChild(tools);
}

function mermaidToolButton(tool, label, icon) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mermaid-tool';
  button.dataset.mermaidTool = tool;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  return button;
}

// Zoom is not an editing affordance: a locked document gets it too. Each tooltip
// names the other way of doing the same thing, because the wheel and the drag
// have nothing on screen to announce them.
const MERMAID_ZOOM_BUTTONS = [
  ['out', 'Zoom out — or Ctrl and the wheel', `<span class="lt-icon lt-icon-zoom-out"></span>`],
  ['fit', 'Whole diagram, back where it started — or double-click it', `<span class="lt-icon lt-icon-fit"></span>`],
  ['in', 'Zoom in — or Ctrl and the wheel. Drag the diagram to move it', `<span class="lt-icon lt-icon-zoom-in"></span>`],
];
function addMermaidZoomControls(diagram) {
  if (diagram.querySelector('.mermaid-zoom')) return;
  const group = document.createElement('div');
  group.className = 'mermaid-zoom';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Zoom');
  for (const [step, label, icon] of MERMAID_ZOOM_BUTTONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.mermaidZoom = step;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    group.appendChild(button);
  }
  diagram.appendChild(group);
}

// ---- the drawing inside its box --------------------------------------------

// The block keeps the height it was laid out at and the drawing moves inside it,
// so leaning into one diagram never shifts the words around it.
const MERMAID_ZOOM_MIN = 0.5;
const MERMAID_ZOOM_MAX = 8;

// Held on the block, never as a style on the SVG: the render cache stores the
// SVG's own markup, and a size baked into that would come back zoomed on every
// restore.
function mermaidView(diagram) {
  return diagram.__mermaidView || { zoom: 1, x: 0, y: 0 };
}

// Panning is bounded by the box, not by the drawing's edges: a diagram that fills
// its box still has to move, because a box taller than the window is read by
// dragging it up rather than by scrolling the page away from it. This much stays
// inside, so it can never be pushed out of sight and lost.
const MERMAID_PAN_KEEP = 48;

// The drawing as it sits on an untouched page, taken the first time one is moved
// — the last moment it is still what the page laid out. Zoom counts from here,
// not from the viewBox: a diagram wider than the column is already drawn shrunk
// to fit, and that is what "life size" has to mean or Fit would not put it back.
function mermaidNatural(diagram, svg) {
  if (!diagram.__mermaidNatural) {
    const drawn = svg.getBoundingClientRect();
    diagram.__mermaidNatural = {
      width: drawn.width,
      height: drawn.height,
      boxHeight: diagram.getBoundingClientRect().height,
      attrWidth: svg.getAttribute('width'),
      attrHeight: svg.getAttribute('height'),
      maxWidth: svg.style.maxWidth,
    };
  }
  return diagram.__mermaidNatural;
}

// The SVG is resized, never scaled: a CSS scale re-lays out the HTML inside
// mermaid's foreignObject labels against boxes that did not grow with them, and
// every label loses its last letter. The flowchart sheet sizes its stage the
// same way, for the same reason.
function setMermaidView(diagram, next) {
  // The block's own drawing, not the icons in the corner buttons.
  const svg = diagram.querySelector(':scope > svg');
  if (!svg) return;
  const natural = mermaidNatural(diagram, svg);
  const zoom = Math.max(MERMAID_ZOOM_MIN, Math.min(MERMAID_ZOOM_MAX, next.zoom));
  const width = natural.width * zoom;
  const height = natural.height * zoom;
  const roomX = Math.max(0, (width + diagram.clientWidth) / 2 - MERMAID_PAN_KEEP);
  const roomY = Math.max(0, (height + natural.boxHeight) / 2 - MERMAID_PAN_KEEP);
  const view = {
    zoom,
    x: Math.max(-roomX, Math.min(roomX, next.x)),
    y: Math.max(-roomY, Math.min(roomY, next.y)),
  };
  diagram.__mermaidView = view;
  if (view.zoom === 1 && view.x === 0 && view.y === 0) {
    resetMermaidView(diagram, svg, natural);
    return;
  }
  // Out of flow, so the block keeps the height the page gave it however big the
  // drawing gets.
  diagram.classList.add('is-moved');
  diagram.style.setProperty('--mermaid-box-height', natural.boxHeight + 'px');
  diagram.style.setProperty('--mermaid-pan-x', view.x + 'px');
  diagram.style.setProperty('--mermaid-pan-y', view.y + 'px');
  svg.setAttribute('width', String(Math.max(1, Math.round(width))));
  svg.setAttribute('height', String(Math.max(1, Math.round(height))));
  svg.style.maxWidth = 'none';
}

// Back to the drawing the page laid out, mermaid's own sizing and all.
function resetMermaidView(diagram, svg, natural) {
  diagram.classList.remove('is-moved');
  diagram.style.removeProperty('--mermaid-box-height');
  diagram.style.removeProperty('--mermaid-pan-x');
  diagram.style.removeProperty('--mermaid-pan-y');
  if (natural.attrWidth == null) svg.removeAttribute('width');
  else svg.setAttribute('width', natural.attrWidth);
  if (natural.attrHeight == null) svg.removeAttribute('height');
  else svg.setAttribute('height', natural.attrHeight);
  svg.style.maxWidth = natural.maxWidth;
}

// Zoom about a point, holding whatever sits under it still — otherwise leaning
// in on one corner walks the thing you were looking at off the box.
function zoomMermaidAt(diagram, factor, clientX, clientY) {
  const view = mermaidView(diagram);
  const zoom = Math.max(MERMAID_ZOOM_MIN, Math.min(MERMAID_ZOOM_MAX, view.zoom * factor));
  const box = diagram.getBoundingClientRect();
  const atX = clientX - (box.left + box.width / 2);
  const atY = clientY - (box.top + box.height / 2);
  const scale = zoom / view.zoom;
  setMermaidView(diagram, {
    zoom,
    x: atX - (atX - view.x) * scale,
    y: atY - (atY - view.y) * scale,
  });
}

function mermaidCenterZoom(diagram, factor) {
  const box = diagram.getBoundingClientRect();
  zoomMermaidAt(diagram, factor, box.left + box.width / 2, box.top + box.height / 2);
}

// The drawn diagram under a pointer, or nothing — one swapped for its source is
// a code block being typed in and answers to none of this.
function mermaidDiagramFor(target) {
  if (!target || !target.closest) return null;
  const diagram = target.closest('pre.mermaid[data-processed="true"]');
  if (!diagram || diagram.dataset.editingSource === 'true') return null;
  return diagram;
}

// Delegated, not per-button: a diagram restored from its own rendered HTML (an
// abandoned source edit does exactly that) brings the markup back without the
// listeners. The capture pass keeps a press on a control off the block
// underneath, whose gutter and selection handling would otherwise answer first.
let mermaidPan = null;
if (app) {
  app.addEventListener(
    'pointerdown',
    (event) => {
      const control = event.target && event.target.closest ? event.target.closest('.mermaid-tool, .mermaid-zoom button') : null;
      if (control) event.stopPropagation();
    },
    true,
  );
  // Left or middle button, the two every canvas drags with.
  app.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    const diagram = mermaidDiagramFor(event.target);
    if (!diagram) return;
    if (event.target.closest('.mermaid-tools, .mermaid-zoom, a')) return;
    // Keeps the drag from selecting the labels it passes over. It holds focus
    // where it was too, so a block being edited elsewhere is closed by hand.
    if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
    event.preventDefault();
    mermaidPan = { diagram, pointer: event.pointerId, x: event.clientX, y: event.clientY, from: mermaidView(diagram) };
    leafHoldPointer(diagram, event.pointerId);
    diagram.classList.add('is-panning');
  });
  app.addEventListener('pointermove', (event) => {
    if (!mermaidPan || event.pointerId !== mermaidPan.pointer) return;
    setMermaidView(mermaidPan.diagram, {
      zoom: mermaidPan.from.zoom,
      x: mermaidPan.from.x + (event.clientX - mermaidPan.x),
      y: mermaidPan.from.y + (event.clientY - mermaidPan.y),
    });
  });
  const endMermaidPan = () => {
    if (!mermaidPan) return;
    mermaidPan.diagram.classList.remove('is-panning');
    mermaidPan = null;
  };
  app.addEventListener('pointerup', endMermaidPan);
  app.addEventListener('pointercancel', endMermaidPan);
  // Ctrl or Cmd and the wheel, the way every canvas does it — and what a trackpad
  // pinch arrives as. A plain wheel is left alone so it still scrolls the page.
  app.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const diagram = mermaidDiagramFor(event.target);
      if (!diagram) return;
      event.preventDefault();
      zoomMermaidAt(diagram, event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY);
    },
    { passive: false },
  );
  app.addEventListener('click', (event) => {
    if (!event.target || !event.target.closest) return;
    const zoomButton = event.target.closest('.mermaid-zoom button');
    if (zoomButton) {
      event.preventDefault();
      const diagram = zoomButton.closest('pre.mermaid');
      if (!diagram) return;
      const step = zoomButton.dataset.mermaidZoom;
      if (step === 'fit') setMermaidView(diagram, { zoom: 1, x: 0, y: 0 });
      else mermaidCenterZoom(diagram, step === 'in' ? 1.25 : 1 / 1.25);
      return;
    }
    const tool = event.target.closest('.mermaid-tool');
    if (!tool) return;
    event.preventDefault();
    const diagram = tool.closest('pre.mermaid');
    if (!diagram) return;
    if (tool.dataset.mermaidTool === 'source') startBlockSourceEdit(diagram);
    else openMermaidBlockSheet(diagram);
  });
  // Double-click puts it back where it started, so there is a way out of a pan
  // that went too far without reaching for the Fit button.
  app.addEventListener('dblclick', (event) => {
    const diagram = mermaidDiagramFor(event.target);
    if (!diagram || event.target.closest('.mermaid-tools, .mermaid-zoom, a')) return;
    setMermaidView(diagram, { zoom: 1, x: 0, y: 0 });
  });
  // Otherwise the middle button opens the web view's own scroll-anywhere puck
  // over a diagram already being dragged with it.
  app.addEventListener('auxclick', (event) => {
    if (event.button === 1 && mermaidDiagramFor(event.target)) event.preventDefault();
  });
}

// Draw the diagrams again in the theme that just arrived: an SVG holds its colors
// as literal values, so recoloring one means drawing it again. One that failed
// before gets another go — this may be a theme it can be drawn in.
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
  return any;
}

// The backstop for a face that lands after a diagram was drawn anyway. Once per
// theme — a repaint asks for no new faces, so this cannot chase itself — and
// only spent on a page that had diagrams to repaint: the app's own faces finish
// long before a document is open, and burning the one shot there is how every
// box came to be measured in the fallback and shipped clipped in v0.1.441.
let mermaidFontRepaintDone = false;
function repaintMermaidDiagramsForFonts() {
  if (mermaidFontRepaintDone) return;
  if (repaintMermaidDiagrams()) mermaidFontRepaintDone = true;
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
    repaintMissingImages();
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
const CODE_COPY_ICON = '<span class="lt-icon code-copy-mark code-copy-copy lt-icon-copy"></span><span class="lt-icon code-copy-mark code-copy-check lt-icon-check"></span>';
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
// is all anyone reads, so numbering 50,000 blocks to reach it buys nothing.
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
    // A missing one is showing our glyph, not its file: put its own source back
    // first, so this stamp is the re-fetch that finds the file if it has arrived.
    restoreMissingImage(img);
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
// The broken-image mark is an icon class like every other, painted over a
// transparent pixel: the element has to stay an <img> so a re-fetch can put the
// real picture back, and an <img> with no source draws the platform's own broken
// glyph instead of ours. The mask takes its ink from the rule, so a theme change
// repaints it with no work here.
const MISSING_IMAGE_SIZE = 40;
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
// Its own source is kept, so a re-fetch once the file appears can go back to it.
// The alt moves to the tooltip: left on, the platform prints it beside our mark.
function markMissingImage(img) {
  if (!(img instanceof HTMLImageElement) || img.dataset.imageMissing === 'true') return;
  img.dataset.imageMissing = 'true';
  img.dataset.imageMissingAlt = img.alt || '';
  img.dataset.imageMissingSrc = img.getAttribute('src') || '';
  if (img.alt && !img.title) img.title = img.alt;
  img.alt = '';
  img.width = MISSING_IMAGE_SIZE;
  img.height = MISSING_IMAGE_SIZE;
  img.classList.add('lt-icon', 'lt-icon-missing-image');
  img.src = TRANSPARENT_PIXEL;
}
// Point a marked image back at its own source, so the next stamp can try it again.
function restoreMissingImage(img) {
  if (img.dataset.imageMissing !== 'true') return;
  const src = img.dataset.imageMissingSrc || '';
  img.alt = img.dataset.imageMissingAlt || '';
  img.removeAttribute('width');
  img.removeAttribute('height');
  img.classList.remove('lt-icon', 'lt-icon-missing-image');
  delete img.dataset.imageMissing;
  delete img.dataset.imageMissingAlt;
  delete img.dataset.imageMissingSrc;
  if (src) img.setAttribute('src', src);
}
// The glyph carries the ink it was painted with, so a new theme is a new glyph.
function repaintMissingImages() {
  if (!app) return;
  const source = missingImageSource();
  app.querySelectorAll('img[data-image-missing="true"]').forEach((img) => {
    img.src = source;
  });
}
// Capture phase, because `error` does not bubble — one listener covers every
// image, including the ones the page adds later.
if (app) {
  app.addEventListener('error', (event) => markMissingImage(event.target), true);
}
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
