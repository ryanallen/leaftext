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

// The app's own drawings, handed over once, so `A@{ icon: "leaf:back" }` draws the back arrow the app bar wears. Nothing is fetched: the set is a fragment of this same script, generated from design/icons.md by `just bundle-icons`.
let mermaidIconsRegistered = false;
function registerMermaidIcons(mermaid) {
  if (mermaidIconsRegistered || typeof mermaid.registerIconPacks !== 'function') return;
  mermaidIconsRegistered = true;
  mermaid.registerIconPacks([{ name: LEAF_MERMAID_ICON_PREFIX, icons: LEAF_MERMAID_ICONS }]);
}

// Where both failures land: an icon we have no drawing for, and a picture that will not load. Mermaid's own stand-in is an 80x80 square in a hardcoded #087ebf, the one color a diagram could show that no theme chose.
const MERMAID_FALLBACK_ICON = LEAF_MERMAID_ICON_PREFIX + ':missing-image';

function mermaidHasIcon(name) {
  const at = (name || '').indexOf(':');
  if (at < 0) return false;
  return (
    name.slice(0, at) === LEAF_MERMAID_ICON_PREFIX &&
    Object.prototype.hasOwnProperty.call(LEAF_MERMAID_ICONS.icons, name.slice(at + 1))
  );
}

// Mermaid throws out of its own renderer on a URL it cannot decode, and the catch upstream can only mark the whole batch of three failed — so a bad picture would cost two innocent diagrams their toolbar. Answered once per URL, because a theme switch redraws the page.
const mermaidPictureAnswers = new Map();
function mermaidPictureDraws(url) {
  let answer = mermaidPictureAnswers.get(url);
  if (!answer) {
    answer = new Promise((resolve) => {
      const probe = new Image();
      // Decoded, not just fetched: decoding is the step mermaid does and the step that threw.
      probe.onload = () => (probe.decode ? probe.decode().then(() => resolve(true), () => resolve(false)) : resolve(true));
      probe.onerror = () => resolve(false);
      probe.src = url;
    });
    mermaidPictureAnswers.set(url, answer);
  }
  return answer;
}

// Every key inside a box's `@{ … }`, rewritten where `rewrite` hands back a replacement. Only in there: the same words in a label are the reader's own text. Quotes are tracked because a label may hold the brace and the comma these are made of.
function mermaidRewriteTyped(source, rewrite) {
  let out = '';
  let rest = source;
  for (;;) {
    const open = rest.indexOf('@{');
    if (open < 0) return out + rest;
    out += rest.slice(0, open + 2);
    const body = rest.slice(open + 2);
    let close = -1;
    let quoted = false;
    for (let at = 0; at < body.length; at += 1) {
      const char = body[at];
      if (char === '"') quoted = !quoted;
      else if (char === '}' && !quoted) {
        close = at;
        break;
      }
    }
    if (close < 0) return out + body;
    out += mermaidRewriteTypedBody(body.slice(0, close), rewrite) + '}';
    rest = body.slice(close + 1);
  }
}

const MERMAID_TYPED_KEY_RE = /^(\s*)([A-Za-z_][\w-]*)\s*:\s*([\s\S]*?)(\s*)$/;
function mermaidRewriteTypedBody(body, rewrite) {
  const parts = [];
  let start = 0;
  let quoted = false;
  for (let at = 0; at <= body.length; at += 1) {
    const char = body[at];
    if (char === '"') quoted = !quoted;
    else if ((at === body.length || char === ',') && !quoted) {
      parts.push(body.slice(start, at));
      start = at + 1;
    }
  }
  return parts
    .map((part) => {
      const named = MERMAID_TYPED_KEY_RE.exec(part);
      if (!named) return part;
      const value = named[3].replace(/^"([\s\S]*)"$/, '$1');
      const swap = rewrite(named[2], value);
      // The spacing either side is the reader's, and this text goes on to be drawn.
      return swap == null ? part : named[1] + swap + named[4];
    })
    .join(',');
}

// What mermaid is actually handed: the block with anything it cannot draw turned into the missing-picture mark. Never the cache key — `__mermaidSource` stays what the reader typed, so both editors still open their own words.
async function mermaidDrawableSource(source) {
  if (!source || source.indexOf('@{') < 0) return source;
  const pictures = [];
  mermaidRewriteTyped(source, (key, value) => {
    if (key === 'img' && value) pictures.push(value);
    return null;
  });
  const dead = new Set();
  if (pictures.length) {
    const draws = await Promise.all(pictures.map(mermaidPictureDraws));
    pictures.forEach((url, at) => {
      if (!draws[at]) dead.add(url);
    });
  }
  return mermaidRewriteTyped(source, (key, value) => {
    if (key === 'icon') return mermaidHasIcon(value) ? null : 'icon: "' + MERMAID_FALLBACK_ICON + '"';
    // The key changes too: an icon box is the one shape the page's own ink can paint our drawing into.
    if (key === 'img' && dead.has(value)) return 'icon: "' + MERMAID_FALLBACK_ICON + '"';
    return null;
  });
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
// Keyed like the picture memo, so a box refilled at the height its drawing had moves nothing above the reader.
const mermaidDrawnHeights = new Map();
// One window either way. Sixty drawn on open stalled the window for three and a half seconds.
const MERMAID_NEAR_SCREENS = 1;
function mermaidViewHeight() {
  return app.clientHeight || window.innerHeight || 800;
}
// For the pass that runs before the observer below has reported anything.
function mermaidIsNearReader(diagram) {
  const rect = diagram.getBoundingClientRect();
  const height = mermaidViewHeight();
  const margin = height * MERMAID_NEAR_SCREENS;
  return rect.bottom >= -margin && rect.top <= height + margin;
}
// Waiting its turn, or too far away to be queued. Only the waiting one spins, so a page of boxes is not fifty-seven spinners.
function markMermaidWait(diagram, near) {
  diagram.dataset.diagramWait = near ? 'near' : 'far';
  const known = mermaidDrawnHeights.get(mermaidCacheKey(diagram.__mermaidSource || diagram.textContent));
  // Cleared when unknown: a theme switch keys the memo afresh, and the old theme's height would hold the box open.
  if (known) diagram.style.minHeight = `${known}px`;
  else diagram.style.removeProperty('min-height');
}
function renderMermaidDiagrams() {
  // A render swaps in a fresh body, so the boxes the watcher held are detached. Identity catches that; re-observing does not.
  const body = app.querySelector('.document-body');
  if (body !== mermaidWatchedBody) {
    forgetMermaidWatch();
    mermaidWatchedBody = body;
  }
  // The full-window stage is a `pre.mermaid` inside `app` too, but it draws itself: an overlay-sized SVG in the memo comes back in the page at that size.
  const candidates = Array.from(app.querySelectorAll('pre.mermaid:not([data-processed="true"]):not([data-mermaid-render="failed"]):not([data-diagram-stage])'));
  if (!candidates.length) {
    return;
  }
  const near = [];
  candidates.forEach((diagram) => {
    // The only copy of the text once the SVG has replaced it, and a theme change needs it back.
    diagram.__mermaidSource = diagram.textContent;
    const isNear = mermaidIsNearReader(diagram);
    markMermaidWait(diagram, isNear);
    if (isNear) near.push(diagram);
  });
  watchMermaidDiagrams(candidates);
  drawMermaidDiagrams(near);
}

// Restore what the memo has, queue the rest. Called with the diagrams near the reader, on open and on every scroll.
function drawMermaidDiagrams(candidates) {
  if (!candidates.length) {
    return;
  }
  const diagrams = [];
  let restored = false;
  candidates.forEach((diagram) => {
    const cached = mermaidRenderCache.get(mermaidCacheKey(diagram.__mermaidSource));
    if (cached) {
      diagram.innerHTML = cached;
      diagram.dataset.processed = 'true';
      finishMermaidDiagram(diagram);
      addMermaidControls(diagram);
      restored = true;
      return;
    }
    diagrams.push(diagram);
  });
  if (restored) {
    mermaidPageTextChanged();
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

// The height it drew to is worth keeping: a box refilled at that height moves nothing on the page.
// A `click A "…"` box is drawn as a real SVG anchor, and mermaid writes only `xlink:href` — which `documentLinkFor` does not match, so the click was the web view's and it navigated the whole app out of the app. Copying the target onto `href` hands the box to the reader's own link handlers.
const MERMAID_XLINK_NS = 'http://www.w3.org/1999/xlink';
function claimMermaidLinks(diagram) {
  for (const link of diagram.querySelectorAll('a')) {
    if (link.hasAttribute('href')) continue;
    const target = link.getAttributeNS(MERMAID_XLINK_NS, 'href');
    if (target) link.setAttribute('href', target);
  }
}

function finishMermaidDiagram(diagram) {
  claimMermaidLinks(diagram);
  delete diagram.dataset.diagramWait;
  diagram.style.removeProperty('min-height');
  if (mermaidViewObserver) mermaidViewObserver.unobserve(diagram);
  if (diagram.__mermaidSource == null) return;
  const height = Math.round(diagram.getBoundingClientRect().height);
  if (!height) return;
  if (mermaidDrawnHeights.size >= MERMAID_CACHE_CAP) mermaidDrawnHeights.clear();
  mermaidDrawnHeights.set(mermaidCacheKey(diagram.__mermaidSource), height);
  watchMermaidForRecycling(diagram);
}

// A drawing off screen still pays for its own stylesheet — sixty of those are 354 KB in sixty id-scoped sheets, which is what makes a settled page scroll badly.
const MERMAID_FAR_SCREENS = 3;
let mermaidRecycleObserver = null;
const mermaidLeavingView = new Set();
function watchMermaidForRecycling(diagram) {
  if (typeof IntersectionObserver === 'undefined') return;
  if (!mermaidRecycleObserver) {
    mermaidRecycleObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) mermaidLeavingView.delete(entry.target);
        else mermaidLeavingView.add(entry.target);
      }
      if (mermaidLeavingView.size) scheduleMermaidPass();
    }, { root: app, rootMargin: `${MERMAID_FAR_SCREENS * 100}% 0px` });
  }
  mermaidRecycleObserver.observe(diagram);
}
// What must keep its drawing however far away it is.
function mermaidMayRecycle(diagram) {
  if (!diagram.isConnected || diagram.dataset.processed !== 'true') return false;
  // Being edited, or held somewhere other than where the page put it: taking one back throws away what the reader did to it.
  if (diagram.dataset.editingSource === 'true') return false;
  if (diagram.classList.contains('is-moved') || diagram.classList.contains('is-panning')) return false;
  const overlay = diagramOverlayElement();
  if (overlay && overlay.__diagramBlock === diagram) return false;
  if (diagram.__mermaidSource == null) return false;
  const key = mermaidCacheKey(diagram.__mermaidSource);
  // Past its cap the memo empties wholesale, so a box refilled after that redraws from scratch — worse on every scroll than the stylesheet it carries. A height nothing measured would move the page.
  return mermaidRenderCache.has(key) && mermaidDrawnHeights.has(key);
}
// Back to a box, at exactly the height the drawing had, so nothing on the page moves.
function recycleMermaidDiagram(diagram) {
  if (!mermaidMayRecycle(diagram)) return false;
  if (mermaidRecycleObserver) mermaidRecycleObserver.unobserve(diagram);
  diagram.textContent = diagram.__mermaidSource;
  delete diagram.dataset.processed;
  markMermaidWait(diagram, false);
  if (mermaidViewObserver) mermaidViewObserver.observe(diagram);
  return true;
}

// Drawing swaps a diagram's source out for its labels, so Ctrl+F re-walks and re-lands on the drawn label where the source was.
function mermaidPageTextChanged() {
  readerAnchorBlocks = null;
  refreshFind();
}

// One window of margin either way, so a diagram is drawn before it is scrolled to rather than after.
let mermaidViewObserver = null;
let mermaidWatchedBody = null;
const mermaidWaitingNearby = new Set();
let mermaidDrainTimer = 0;
function watchMermaidDiagrams(candidates) {
  if (typeof IntersectionObserver === 'undefined') {
    // No watcher: nothing will ever report a diagram as near, so draw them all.
    drawMermaidDiagrams(candidates);
    return;
  }
  if (!mermaidViewObserver) {
    mermaidViewObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const diagram = entry.target;
        if (diagram.dataset.processed === 'true' || diagram.dataset.mermaidRender === 'failed') {
          mermaidViewObserver.unobserve(diagram);
          continue;
        }
        markMermaidWait(diagram, entry.isIntersecting);
        if (entry.isIntersecting) mermaidWaitingNearby.add(diagram);
        else mermaidWaitingNearby.delete(diagram);
      }
      if (mermaidWaitingNearby.size) scheduleMermaidPass();
    }, { root: app, rootMargin: `${MERMAID_NEAR_SCREENS * 100}% 0px` });
  }
  for (const diagram of candidates) mermaidViewObserver.observe(diagram);
}
// Wait for the gesture to stop: a diagram growing above the reader mid-scroll shifts the page under their thumb, and the re-pin that would undo that stands aside while they scroll.
function scheduleMermaidPass() {
  if (mermaidDrainTimer) return;
  mermaidDrainTimer = window.setTimeout(() => {
    mermaidDrainTimer = 0;
    if (readerScrolling) {
      scheduleMermaidPass();
      return;
    }
    // Boxes back first: a recycled box holds its drawing's height, so only the drawings can move anything.
    for (const diagram of mermaidLeavingView) recycleMermaidDiagram(diagram);
    mermaidLeavingView.clear();
    const queue = Array.from(mermaidWaitingNearby).filter((diagram) => diagram.isConnected
      && diagram.dataset.processed !== 'true'
      && diagram.dataset.mermaidRender !== 'failed');
    mermaidWaitingNearby.clear();
    drawMermaidDiagrams(queue);
  }, READER_SCROLL_SETTLE_MS);
}
// A render replaces the document, so every box the old one was watching is gone.
function forgetMermaidWatch() {
  if (mermaidViewObserver) {
    mermaidViewObserver.disconnect();
    mermaidViewObserver = null;
  }
  if (mermaidRecycleObserver) {
    mermaidRecycleObserver.disconnect();
    mermaidRecycleObserver = null;
  }
  mermaidWaitingNearby.clear();
  mermaidLeavingView.clear();
  if (mermaidDrainTimer) {
    window.clearTimeout(mermaidDrainTimer);
    mermaidDrainTimer = 0;
  }
}

// How far a diagram is from the middle of the window, for the order within a batch.
function mermaidReaderDistance(diagram) {
  const rect = diagram.getBoundingClientRect();
  const middle = mermaidViewHeight() / 2;
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
      registerMermaidIcons(mermaid);
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
          // Before mermaid reads them, not after: a box it cannot draw takes the whole batch down from inside its own renderer.
          for (const diagram of batch) {
            const drawable = await mermaidDrawableSource(diagram.__mermaidSource);
            if (drawable != null && drawable !== diagram.textContent) diagram.textContent = drawable;
          }
          if (generation !== mermaidRenderGeneration) return;
          try {
            await mermaid.run({ nodes: batch });
          } catch (error) {
            // Mermaid keeps drawing after one block throws and leaves its error picture in the block it failed on, so only that one is marked and the rest of the batch finishes as usual. A block it never reached has neither the error nor a drawing, and is marked too rather than left spinning.
            console.error(error);
            for (const diagram of batch) {
              if (diagram.querySelector('.error-icon') || !diagram.querySelector('svg')) diagram.dataset.mermaidRender = 'failed';
            }
          }
          for (const diagram of batch) {
            if (diagram.dataset.mermaidRender === 'failed') {
              // It keeps the error it drew, so stop watching — but the spinner has to go, or a refusal spins behind its own message.
              delete diagram.dataset.diagramWait;
              if (mermaidViewObserver) mermaidViewObserver.unobserve(diagram);
              continue;
            }
            if (diagram.__mermaidSource == null) continue;
            if (mermaidRenderCache.size >= MERMAID_CACHE_CAP) mermaidRenderCache.clear();
            // Memo first, button second: the cache holds innerHTML, and a button
            // baked into it would come back on every restore and stack up.
            mermaidRenderCache.set(mermaidCacheKey(diagram.__mermaidSource), diagram.innerHTML);
            finishMermaidDiagram(diagram);
            addMermaidControls(diagram);
          }
          // Each batch changed the block layout; drop the cached anchor list, and
          // let whatever else watches the page catch up before the next one.
          readerAnchorBlocks = null;
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      } finally {
        resumeMinimapPreview();
        // The words the search was pointing at inside these diagrams are gone now.
        mermaidPageTextChanged();
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
// The fourth, on the block in the page only: the overlay it opens carries the
// three above and its own way out, so a diagram already full screen has nothing
// to expand into.
const MERMAID_FULL_BUTTON = ['full', 'Open it on the whole window', `<span class="lt-icon lt-icon-expand"></span>`];
// The group the overlay builds too — diagram-view.js asks for the three without
// the fourth. Its buttons carry no listeners: the click is delegated off `app`,
// so a group anywhere inside a `pre.mermaid` is answered.
function mermaidZoomGroup(buttons, label) {
  const group = document.createElement('div');
  group.className = 'mermaid-zoom';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  for (const [step, title, icon] of buttons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.mermaidZoom = step;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = icon;
    group.appendChild(button);
  }
  return group;
}
function addMermaidZoomControls(diagram) {
  if (diagram.querySelector('.mermaid-zoom')) return;
  diagram.appendChild(mermaidZoomGroup(MERMAID_ZOOM_BUTTONS.concat([MERMAID_FULL_BUTTON]), 'Diagram view'));
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
      const control = event.target && event.target.closest ? event.target.closest('.mermaid-tool, .mermaid-zoom button, .diagram-close') : null;
      if (control) event.stopPropagation();
    },
    true,
  );
  // Left or middle button, the two every canvas drags with.
  app.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    const diagram = mermaidDiagramFor(event.target);
    if (!diagram) return;
    if (event.target.closest('.mermaid-tools, .mermaid-zoom, .diagram-close, a')) return;
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
      if (step === 'full') openDiagramOverlay(diagram, zoomButton);
      else if (step === 'fit') setMermaidView(diagram, { zoom: 1, x: 0, y: 0 });
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
    if (!diagram || event.target.closest('.mermaid-tools, .mermaid-zoom, .diagram-close, a')) return;
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
  const diagrams = Array.from(app.querySelectorAll('pre.mermaid:not([data-diagram-stage])'));
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
    // The sweep above skips the full-window stage, so it is redrawn by name.
    repaintDiagramOverlay();
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
// Put each body table in a lane of its own, so it can use the reader's width and
// so the bands that dissolve a sliced column into the page have a box to be painted
// in — a mask on the table can only take ink away, never lay the dot screen on. The
// lane belongs to the reader, not the document, so everything that walks the body's
// blocks sees through it: `attachMarkdownBlockRanges` stamps the table inside, and
// `unwrapTableLane` in block-controls.js gives the gutter the table it wraps.
function laneWideTables(root = app) {
  const body = root.querySelector('.document-body');
  if (!body) return;
  for (const table of Array.from(body.children)) {
    if (table.tagName !== 'TABLE' || table.classList.contains('data-table')) continue;
    const lane = document.createElement('div');
    lane.className = 'table-lane';
    table.replaceWith(lane);
    lane.appendChild(table);
  }
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
// The same clipboard pair with nothing to flash — for a right-click item, where the
// menu has already closed and there is no button left to label. A hoisted
// declaration on purpose: context-menu.js loads earlier and calls it at event time.
function copyPlainText(text) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {}, () => { legacyCopy(text); });
  } else {
    legacyCopy(text);
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
