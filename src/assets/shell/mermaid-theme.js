// Every color a diagram is drawn in, and the config built off it. Nothing here draws, caches or watches a diagram — decorate.js does that, and it sits after this because it calls `mermaidRuntimeConfig` while nothing here reaches back.

// A diagram takes the page's colors, over mermaid's own light/dark theme.
//
// mermaid variable → the page token it takes its color from. A variable missing from here keeps mermaid's value; check-shell.mjs holds every name in this table to the ones the stylesheet defines.
const MERMAID_COLOR_MAP = {
  // The page the diagram is drawn on, and the ink on it.
  background: '--lt-markdown-background',
  textColor: '--lt-markdown-foreground',
  titleColor: '--lt-markdown-heading',
  lineColor: '--lt-muted-foreground',
  errorBkgColor: '--lt-danger',

  // Flowcharts. Boxes are surfaces, not brand color: forty brand-colored boxes is a poster.
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

  // Gantt. A bar means something here, so the states are the theme's states: ordinary, active, done, critical, and today.
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

  // Pie. The slices are the categorical scale below; these are the parts around them.
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

// The twelve-color categorical scale (mindmap, timeline, kanban, journey, pie, git graph). Every entry is named, because mermaid re-applies what it is handed *after* its own arithmetic: a `cScale` we set survives, a color that only feeds the scale gets darkened out of reach — which is what v0.1.423 shipped.
//
// 150° a step so that neighbors, which is what a timeline puts side by side, land opposite rather than one notch apart; twelve such steps still visit all twelve hues. Entries share a luminance, not a lightness — a yellow and a blue at one lightness are nowhere near one weight, and one weight is what lets one ink read on all twelve. A mindmap needs that: its labels are HTML and take the page's ink whatever `cScaleLabel` says.
const MERMAID_SCALE_SEED = '--lt-primary';
const MERMAID_SCALE_STEPS = 12;
const MERMAID_SCALE_HUE_STEP = 150;
// Off the page but under the page's ink, and the mirror of that in light mode. Saturated enough that twelve hues stay apart when the primary is nearly gray.
const MERMAID_SCALE_SHAPE = {
  light: { luminance: 0.45, minSaturation: 0.42, maxSaturation: 0.85 },
  dark: { luminance: 0.12, minSaturation: 0.38, maxSaturation: 0.85 },
};

// mermaid variable → the fill its text is printed on, so the ink can be measured against it. A theme's `*-foreground` is the ink for its own buttons and says nothing about a diagram: GitHub's greens are mid tones meant to be read as text, so white on one is 2.3:1.
//
// Naming the wrong fill looks exactly like naming the wrong color. A quadrant point's label sits on the quadrant, not on the point, and measuring it against the point shipped white text on a pale gray panel; `errorBkgColor` above is the same trap, because that red is the bomb a failed diagram draws and the words beside it are on the block.
//
// Gantt bars are set per state below: four colors, one variable, no ink that reads on all of them.
const MERMAID_INK_MAP = {
  taskTextColor: ['--lt-primary'],
  taskTextLightColor: ['--lt-primary'],
  sequenceNumberColor: ['--lt-muted-foreground'],
  errorTextColor: ['--lt-editor-code-background'],
  quadrantPointTextFill: ['--lt-surface-muted', '--lt-surface-sunken'],
};

// Every ink a diagram may print in — all theme colors, so a diagram never prints in one the theme does not contain.
const MERMAID_INK_CANDIDATES = [
  '--lt-markdown-foreground',
  '--lt-markdown-background',
  '--lt-primary-foreground',
  '--lt-accent-foreground',
  '--lt-success-foreground',
  '--lt-danger-foreground',
];

// A bar's state is its color, so each state's text class takes the ink measured against its own bar. Mermaid appends `themeCSS` after its own stylesheet, which is the only way to give one variable four values.
const MERMAID_GANTT_STATE_INKS = [
  ['taskText', '--lt-primary'],
  ['activeText', '--lt-accent'],
  ['doneText', '--lt-success'],
  ['critText', '--lt-danger'],
  ['activeCritText', '--lt-danger'],
  ['doneCritText', '--lt-danger'],
];
const MERMAID_GANTT_SECTIONS = 4;

// The XY chart keeps its colors in a group of its own rather than beside the rest, so it needs its own pass. Its plot palette *is* ours to set: mermaid does no arithmetic on it, unlike the categorical scale.
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

// What a bar or a line is painted with, in order. Six because a chart with more series than that is past the point where color is what tells them apart.
const MERMAID_PLOT_TOKENS = ['--lt-primary', '--lt-accent', '--lt-success', '--lt-warning', '--lt-danger', '--lt-done'];

function themeTokenValue(style, token) {
  return (style.getPropertyValue(token) || '').trim();
}

// Relative luminance, for deciding which of two inks reads on a color. Hex only: a token that is a gradient, a color function or a name is not something to measure, and the caller falls back rather than guess.
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

// The theme ink that reads best on every one of `fills`. The worst fill decides: one ink is only as readable as it is on the poorer surface.
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

// Hue and saturation only: the scale sets its own lightness, so that is the one part of the seed we throw away.
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

// The categorical scale, seeded from the theme's primary. Empty if the seed is not something we can measure, which leaves mermaid's own palette in place rather than guessing at one.
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

// C4 paints its relation lines and labels a hardcoded #444444 — 1.5:1 on a dark page, with no theme variable and no class behind it. Nothing else mermaid draws sets `fill` or `stroke` as an attribute to that value, so the attribute is the only handle.
const MERMAID_C4_RELATION_COLOR = '#444444';

function mermaidC4RelationCss(style) {
  const ink = themeTokenValue(style, '--lt-muted-foreground');
  if (!ink) return '';
  return [
    'text[fill="' + MERMAID_C4_RELATION_COLOR + '"] { fill: ' + ink + ' !important; }',
    'line[stroke="' + MERMAID_C4_RELATION_COLOR + '"] { stroke: ' + ink + ' !important; }',
  ].join('\n');
}

// A group title is measured before its box is laid out. Keeping the label at its natural width stops a wrapped title from being laid under the first node.
function mermaidSubgraphTitleCss() {
  return '.cluster-label div { white-space: nowrap !important; width: max-content !important; max-width: none !important; }';
}

// The per-state gantt label colors, as CSS. Mermaid's own gantt rules carry `!important` on the active and done states, so ours have to as well.
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

// The theme, as mermaid wants it. A token the page has not defined is left out rather than passed empty — mermaid derives from what it is given, and an empty string is not a color.
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

  // The scale, and an ink measured on each entry. The git graph and the journey keep it under their own names and have to be pointed at it — left alone the one labels branch 1 `white` whatever it lands on, the other bands the chart midnight blue and magenta in every theme.
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
    // Mermaid's 0.7 mixes three tenths of the page into every slice, which on a light page is two pale slices nobody can tell apart.
    variables.pieOpacity = '1';
  }

  return variables;
}

// The body font of the theme in force, so diagram labels are set in the same face as the words around them.
function mermaidFontFamily() {
  const style = window.getComputedStyle(document.documentElement);
  return themeTokenValue(style, '--reading-font') || "'Noto Sans', sans-serif";
}

// `htmlLabels` off puts a label in an SVG `<text>` rather than a `<foreignObject>`, which an SVG loaded as an image drops outright. The page keeps the foreign object; anything bound for a picture asks for text. Stated on every call because `mermaid.initialize` merges: a config quiet about it leaves the last answer in place for the next diagram drawn.
function mermaidRuntimeConfig(options) {
  const htmlLabels = !options || options.htmlLabels !== false;
  const style = window.getComputedStyle(document.documentElement);
  const fontFamily = (options && options.fontFamily) || mermaidFontFamily();
  const subgraphTitleGap = parseFloat(themeTokenValue(style, '--lt-space-8')) || 0;
  const themeVariables = mermaidThemeVariables();
  themeVariables.fontFamily = fontFamily;
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels,
    flowchart: { htmlLabels, subGraphTitleMargin: { top: subgraphTitleGap, bottom: subgraphTitleGap } },
    // Appended after mermaid's own stylesheet, so it settles what a variable cannot: one ink per gantt state, and C4's one hardcoded color.
    themeCSS: [mermaidGanttStateCss(style), mermaidC4RelationCss(style), mermaidSubgraphTitleCss()]
      .filter(Boolean)
      .join('\n'),
    // Mermaid's own light and dark palettes underneath, never `base`: `base` recomputes the categorical scale and darkens every entry it derives.
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
    fontFamily,
    themeVariables,
  };
}
