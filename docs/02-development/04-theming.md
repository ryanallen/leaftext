# Theming

> Leaftext enforces a semantic token contract of 82 CSS custom properties, validated when the theme CSS is compiled at startup. Palettes are data — a bundled `themes.md` compiled from per-family Markdown files — so adding a theme takes no Rust.

Leaftext's theme system is built around a semantic token contract — 82 `--lt-*` CSS custom properties, 81 of which every theme must define. The contract is not enforced by the Rust compiler; it is checked at startup, the first time the theme CSS is compiled. If a token is missing, that compile step hits an assertion and `panic!`s with an explicit message (so a test run or the first launch surfaces it), rather than silently rendering with broken fallback colors.

**One property is optional, and it is the only one.** `--lt-hover-tint` is the ink every fill under the pointer is mixed from. A family that names it runs its hovers in that hue; a family that says nothing gets its own `--lt-muted-foreground` **copied in as a value**, not aliased to it, so the compiled block stays a flat list of colors. Which properties may be left out is generated alongside the contract, from the `Default` column of `design/colors.md`, as `LEAF_SEMANTIC_TOKEN_DEFAULTS` in `src/theme.rs`.

**One name per color.** A token is spelled the same way in a theme file, in the compiled CSS, and in every rule that reads it. There is no alias layer over the contract: a rule reads `var(--lt-surface)` itself, never a second name for it.

Palettes are **data, not code**: every theme's values live in Markdown tables (`src/assets/themes.md`), parsed once at startup — not in Rust `const` tables.

## The token contract

`LEAF_SEMANTIC_TOKEN_CONTRACT` in `src/theme.rs` defines the authoritative list of required properties. Every theme source must map a value to each token in this list. The tokens are organized into semantic categories:

### Core UI

App surface and text colors, named by role: `--lt-background`, `--lt-foreground`, `--lt-surface`, `--lt-surface-elevated`, `--lt-surface-muted`, `--lt-surface-sunken`, `--lt-border`, `--lt-border-strong`, `--lt-muted-foreground`, and the semantic role tokens `--lt-primary`, `--lt-accent`, `--lt-danger`, `--lt-warning`, `--lt-success`, `--lt-done`, `--lt-link`, `--lt-link-hover`, plus `--lt-focus-ring` and the two focus-selection colors.

A role has a `-foreground` partner only where something prints on it: `primary`, `accent`, `danger` and `success` have one; `warning`, `done` and `link` do not.

### Editor and Markdown elements

Tokens for inline code background/foreground, code block background/foreground/border and its selection pair, blockquote border and foreground, headings (`--lt-markdown-heading` for `h1`/the base, plus `--lt-markdown-heading-2` through `-6` so deeper levels can be tinted — set them equal to the base to keep one heading color), the document's own background and foreground, links, the rule, badges, tables, thematic breaks, math inline background, and keyboard key styling.

### Alert callout colors

Per-severity accent colors for GitHub-style alert callouts: `--lt-markdown-alert-note`, `--lt-markdown-alert-tip`, `--lt-markdown-alert-important`, `--lt-markdown-alert-warning`, and `--lt-markdown-alert-caution`.

### Syntax highlighting tokens

One token per syntactic role: `--lt-syntax-background`, `--lt-syntax-foreground`, `--lt-syntax-comment`, `--lt-syntax-keyword`, `--lt-syntax-string`, `--lt-syntax-number`, `--lt-syntax-function`, `--lt-syntax-variable`, `--lt-syntax-type`, `--lt-syntax-operator`, `--lt-syntax-punctuation`, and per-channel inserted/deleted/changed diff tokens.

Two things spend those tokens. Fenced code blocks in the reading view spend them through the `.syn-` selectors in `assets/reading/document-code.css`, which are mirrored by `SYNTAX_STYLE_RULES` in `markdown/code.rs` — a test fails if the two drift. The [code view](../01-features/07-editing.md#code-view) spends the same tokens through a Monaco theme built from them at runtime (`defineLeafMonacoTheme`), rebuilt on every theme and light/dark change, so one palette dresses both. The highlighter gives a run of text **one** element carrying only the classes some listed rule needs, rather than a nested element per scope naming every scope atom, so a class missing from the table is a rule that never gets an element to match. Adding a `.syn-` rule means adding its class set there too. This is also why no `.syn-` selector may put a syntax class to the left of a descendant combinator: with one element per run there is no ancestor syntax element to match, and where an enclosing construct's rule is the more specific one it now wins on specificity rather than losing on depth.

### Minimap colors

`--lt-minimap-viewport-border` and `--lt-minimap-viewport-background`, the two that draw the viewport box over the rail.

The rail itself takes the chrome's own colors, and the thumbnail inside it is a real-text clone of the page rather than a drawn line model — so there are no per-line-kind minimap colors to set.

### Navigation chrome

Button background, foreground, hover, and disabled states for the back/forward/open controls and the recent-files list.

### Radius scale, and no shadow scale

Corners are tokenized as a **global scale** in the stylesheet's own `:root` block rather than per-theme values: `--lt-radius-xs/sm/md/lg/xl/2xl/pill/full`. Every surface pulls from it, so rounding swaps in one place. Elevation has no scale at all: a floating surface throws the same dot lattice the grain is made of, thinning out under a mask — a halftone shadow, said once in the stylesheet and shared by every menu, panel, sheet and tooltip, and by the Previous / Next card at the foot of a page, which throws it only under the pointer. The window itself throws one too: the platform's own smooth shadow is turned off on both systems, the window and the web view are see-through, and the app is held 20px off the window's edge at the sides, 13px above and 10px below so the band has room to fall in. It is zeroed where there is nothing behind the window to cast onto — a maximized Windows window, a Mac in full screen — and in a browser, which has no window of its own. The one smooth blur in `--lt-shadow-*` is `--lt-shadow-raised`, a hair of lift worn by a handful of surfaces that sit above the page at rest — never by a hover, because pointing at a control changes its color, and where it changes anything more the change is the halftone rather than a blur — and the rest of the group are strokes, one recess and two rings rather than shadows.

### Surface grain

Tinted surfaces are not painted as flat fills. A fine dot grid — a 2px lattice of near-transparent dots — is tiled over them, so a surface reads as a dithered cell rather than a wash of color. Like the radius scale, the grain lives in the compiled `:root` block rather than per-theme, as four alpha values, the first three darkening further for dark appearances:

| Token | Where it grains |
|---|---|
| `--app-bar-grain` | App bar, library pane, and the reading card's corners |
| `--library-header-grain` | Heavier, so an inactive tab reads as a darker cell without an outline |
| `--reader-surface-grain` | Lighter, for the reading view's code blocks, outline panel, table headers, and the tinted table rows — body text sits on these |
| `--reader-row-grain` | The *untinted* table rows. Dark appearances only; transparent on light ones |

The grain marks cells within a page, not pages themselves. The [code view](../01-features/07-editing.md#code-view) is a tinted surface that takes none: it fills the page, where a lattice reads as a dithered editor rather than a raised block. The grain picks up again past the page's right border, on the chrome the [minimap](../01-features/04-minimap.md#the-code-views-minimap) rail stands on. A fenced block inside the reading view still takes it.

On a dark appearance both table stripes are grained, so a table reads as a single texture banded light and dark rather than speckled rows alternating with flat ones.

`--reader-row-grain` is the one grain that **lifts** rather than darkens, because the untinted row is the darkest surface in the app and darkening it has nowhere to go: a black dot shifts `#0d1117` by about 10 levels but `#2a2d3d` by about 32, so the texture lands faint on one family and heavy on another. A white dot at a low alpha moves every dark family by a steady ~15.

Light appearances zero it. There those rows are the near-white ones, where a dot dark enough to see reads as a gray screen-door mesh laid across the whole table. The token is zeroed rather than the rule dropped, so there is still one selector to reason about against the frontmatter opt-out below.

Only the ink is a token. Each rule that grains a surface writes the circles out in its own `background-image`, rather than pulling a finished gradient from a shared one. A custom property holding a gradient has its own `var()` substituted where that property is declared, and descendants inherit the finished string — so a lattice image declared once in `:root` ignores every `--lt-grain-dot` set further down, and every token in the table above is inert. That is not a style choice; a shared image variable silently paints all four of them in the first one's ink.

The reading and code views borrow the lattice for a different job. The page slides under the app bar at the top and stops at the card's hairline at the bottom, and a line of text cut mid-stroke at either edge reads as a fault, so each edge carries a band that dissolves the last 36px back to the page. Same circle, same lattice, but drawn in the page's own color instead of a grain token and laid over a wash of that color — both at full strength across the cut and gone by the far side. The band stops short of the scrollbar's gutter: the browser draws that inside the scroller, where an overlay on the card cannot sit beneath it. In the code view it stops at the page's right border instead, because past that border is the [minimap](../01-features/04-minimap.md#the-code-views-minimap) rail — chrome, not page, and a wash of the page's color across the top and bottom of it would put the page back under the map.

A document's first line therefore has to open below the band, or it starts out half dissolved. `--reader-content-top-gap` is where it opens, measured from the reader's own top edge so the app bar's height is inside the number. The reading view reaches it by parking its scroll origin there; the [code view](../01-features/07-editing.md#code-view) hands the remainder to the editor as its own top padding, inside the editor's scroll height so no line can ever sit in the wash. One token, so the two views open at the same height and both clear the band.

Every grained surface tiles from the app rather than from its own box (`background-attachment: fixed`, anchored to the one contained element everything in the page sits inside), so they all share one lattice — including both table stripes, so the dots run straight down the page across a stripe instead of breaking at each row edge. Box-anchored grids fall out of phase wherever two surfaces meet and the seam between them reads as a hairline.

> [!NOTE]
> The frontmatter table is the one table that carries no chrome, and its opt-out ties with the row rules on specificity — it wins only by coming later in the stylesheet. A row rule added after it would put a speckled stripe through it.

## Theme families and sources

Themes are organized as **families**, each pairing a light and a dark **source**. The user picks a family (the Theme setting) and an appearance (the Appearance setting: Light, Dark, System, or Daylight); the two combine to select one source. Eleven families ship, so twenty-two sources are defined, **sorted by display name** in the picker (`Amaranth`, `Arabica`, `Bloodleaf`, `Fern`, `Ginger`, `GitHub`, `Goldenrod`, `Halcyon`, `Nightshade`, `Pippin`, `Sage`); `fern` is the default family (the bootstrap's fallback). Each source has an `id`, a `family` id, a `family_name` (the picker label), an `appearance` (`Light`/`Dark`), a CSS `selector`, a flat `tokens` map covering every contract property, an `overrides` map for per-source token nudges (empty for most sources), and a `fonts` block:

| Source id        | Family (label)        | Appearance | Token strategy                                                                     |
| ---------------- | --------------------- | ---------- | --------------------------------------------------------------------------------- |
| `amaranth-light`   | `amaranth` (Amaranth)     | Light      | Clean light base ramp with a violet accent (the renamed Obsidian palette).         |
| `amaranth-dark`    | `amaranth` (Amaranth)     | Dark       | Dark base ramp with a violet accent (the renamed Obsidian palette).                |
| `arabica-light`    | `arabica` (Arabica)       | Light      | Creamy latte neutrals with an AnuPpuccin mauve accent and colored headings.         |
| `arabica-dark`     | `arabica` (Arabica)       | Dark       | Dark-roast espresso neutrals with an AnuPpuccin mauve accent and colored headings.  |
| `bloodleaf-light`   | `bloodleaf` (Bloodleaf)     | Light      | A pure-white ground with a runner-red accent and a sky-blue second hue.             |
| `bloodleaf-dark`    | `bloodleaf` (Bloodleaf)     | Dark       | Cool blue-black night neutrals with the same red accent, brightened.                |
| `fern-light`       | `fern` (Fern)             | Light      | Default family. Amaranth's light tokens plus a fern-green override cast.            |
| `fern-dark`        | `fern` (Fern)             | Dark       | Amaranth's dark tokens plus the fern-green overrides.                               |
| `ginger-light`     | `ginger` (Ginger)         | Light      | Warm cream neutrals with a ginger-orange accent (a warm Shiba Inu palette).          |
| `ginger-dark`      | `ginger` (Ginger)         | Dark       | Cool slate neutrals with a ginger-orange accent.                                    |
| `github-light`     | `github` (GitHub)         | Light      | GitHub's light palette, baked to literal hex (its own system-font stack).          |
| `github-dark`      | `github` (GitHub)         | Dark       | GitHub's dark palette, baked to literal hex.                                        |
| `goldenrod-light`  | `goldenrod` (Goldenrod)   | Light      | Honey-on-white neutrals with a golden accent and a black-and-gold heading cast.     |
| `goldenrod-dark`   | `goldenrod` (Goldenrod)   | Dark       | Near-black neutrals with a vivid golden-yellow accent.                              |
| `halcyon-light`    | `halcyon` (Halcyon)       | Light      | A clean white base with one blue accent (`#086ddd`) and Things-style level headings. |
| `halcyon-dark`     | `halcyon` (Halcyon)       | Dark       | A cool blue-gray ramp (`#1c2127`) with a bright blue accent (`#4c9dff`).            |
| `nightshade-light` | `nightshade` (Nightshade) | Light      | A light "Alucard" interpretation of the Dracula accent hues on a cream ground.     |
| `nightshade-dark`  | `nightshade` (Nightshade) | Dark       | The classic Dracula hex values (`#282a36`, `#f8f8f2`, `#bd93f9`).                   |
| `pippin-light`     | `pippin` (Pippin)         | Light      | Crisp neutral grays with a macOS system-blue accent (a Cupertino palette).           |
| `pippin-dark`      | `pippin` (Pippin)         | Dark       | macOS-style dark grays with a bright system-blue accent.                            |
| `sage-light`       | `sage` (Sage)             | Light      | Amaranth's light tokens on neutral gray with a muted-blue (Minimal-style) accent.  |
| `sage-dark`        | `sage` (Sage)             | Dark       | Amaranth's dark tokens on neutral gray with a muted-blue accent.                    |

Every source activates through the Leaf-owned attributes the theme bootstrap stamps on `:root`: `data-leaf-theme="<family>"` and `data-leaf-appearance="<light|dark>"`. So a source's selector is `:root[data-leaf-theme="github"][data-leaf-appearance="light"]`, and so on.

**Every theme is a self-contained literal palette** — each source maps every `--lt-*` token to a hex (or `rgba()`) value. There is no Primer dependency and no separate theme "kind": GitHub was flattened to plain hex like the rest, so all themes share one uniform shape. The Fern and Sage families reuse Amaranth's literal token maps and re-tint them through their `overrides` maps, so they inherit Amaranth's full coverage and only restate the tokens they change (`theme_source_token_value()` checks `overrides` before `tokens`). `theme_families()` derives the ordered picker list from the loaded sources, so registering a family's light/dark pair adds it to the picker automatically.

## Palettes are data (`themes.md`)

`theme_sources()` parses `src/assets/themes.md` — bundled into the binary with `include_str!` — **once** at startup via a `OnceLock`, then leaks the owned strings to `&'static` so every downstream consumer keeps working against `&'static` fields. `parse_theme_markdown()` walks the Markdown headings and tables into one `ThemeFile` per source (`id`, `family`, `family_name`, `appearance`, `selector`, `tokens`, `overrides`, `fonts`); `id` and `selector` are derived from the family id and appearance, so the files never restate them.

The editable source of truth is the **`themes/` folder at the repo root**. Being Markdown, each file renders as clean color tables right where it lives — start with the [**themes gallery**](https://github.com/ryanallen/leaftext/blob/main/themes/README.md), a self-updating index with a light-vs-dark palette table for every family, then open any family file directly: [Amaranth](https://github.com/ryanallen/leaftext/blob/main/themes/amaranth.md), [Arabica](https://github.com/ryanallen/leaftext/blob/main/themes/arabica.md), [Bloodleaf](https://github.com/ryanallen/leaftext/blob/main/themes/bloodleaf.md), [Fern](https://github.com/ryanallen/leaftext/blob/main/themes/fern.md), [Ginger](https://github.com/ryanallen/leaftext/blob/main/themes/ginger.md), [GitHub](https://github.com/ryanallen/leaftext/blob/main/themes/github.md), [Goldenrod](https://github.com/ryanallen/leaftext/blob/main/themes/goldenrod.md), [Halcyon](https://github.com/ryanallen/leaftext/blob/main/themes/halcyon.md), [Nightshade](https://github.com/ryanallen/leaftext/blob/main/themes/nightshade.md), [Pippin](https://github.com/ryanallen/leaftext/blob/main/themes/pippin.md), [Sage](https://github.com/ryanallen/leaftext/blob/main/themes/sage.md). There is one file per family — `themes/<family>.md` — laid out as:

- `# Display Name` — the family's picker label (`Sage`, `GitHub`, …).
- `**Family ID:** \`<family>\`` — the family id used in `data-leaf-theme` and in the `<family>.md` filename (the bundler checks they match).
- An optional preview image — a standalone `![Display Name](../imgs/themes/<family>.png)` line in the header, above the `**Family ID:**` line. The Rust parser ignores it (only headings and tables carry data), while the bundler lifts it into the family's gallery entry and fails the run if the path does not resolve. Shipping families point at `imgs/themes/<family>.png`, one screenshot of the reference document split across the light and dark variants.
- `**Pack:** \`<pack>\`` — the [icon pack](#icon-packs) the family wears. One of `leaftext`, `feather`, `lucide`, `tabler`, `remix`, `phosphor` or `heroicons`; a family file without the line wears `leaftext`.
- `## Fonts` — a `Role | Stack` table with `Heading`, `Body`, `Code`, and `Google` rows.
- `## Light` and `## Dark` — a `Token | Value` table covering every required contract property (all but `hover-tint`, which may be left out), each optionally followed by a `### Overrides` table for per-source token nudges. **Token names drop the `--lt-` prefix** (re-added at parse time) and values are wrapped in backticks (`` `#282a36` ``).

There is no manifest — the bundler globs `themes/*.md`. `scripts/bundle-themes.mjs` produces two outputs: it concatenates the family files into `src/assets/themes.md` (the embedded bundle) and regenerates [`themes/README.md`](https://github.com/ryanallen/leaftext/blob/main/themes/README.md) (the gallery above), both ordered **by display name** so the picker and gallery stay alphabetical no matter what order they're added. `just bundle-themes` rebuilds them; `just check-themes` (part of `just verify`) fails if either has drifted from the folder — the same drift-guard pattern used for the vendored site assets.

## Icon packs

A family carries a set of drawings as well as a palette. Every icon class in `src/assets/icons.css` reads `var(--lt-icon-<name>)` rather than carrying its own drawing, and the generated stylesheet declares all sixty-three at `:root`. A pack is one block of those same properties redeclared under the family selectors that name it, so switching family swaps the drawings with the colors and no class is touched.

Seven packs ship. `leaftext` is the app's own mixed set — the drawings that were here before packs existed — and it is both a family's permanent choice and the fallback every other pack falls back to: an icon a pack has no drawing for keeps the `:root` value, so a control is never blank.

A family names its pack on a `**Pack:**` line beside its `**Family ID:**`, and `ThemeSource.pack` is that value at runtime; a file naming none wears `leaftext`. `just bundle-icons` writes each pack block's byte range into `src/theme.rs` as `LEAF_ICON_PACK_RANGES` beside the sheet itself, which is what lets `exported_page_css()` hand a written-out page one block instead of six.

| Pack | Drawings |
|---|---|
| `leaftext` | The app's own set, composed here |
| `feather` | [Feather](https://feathericons.com), stroked |
| `lucide` | [Lucide](https://lucide.dev), stroked |
| `tabler` | [Tabler](https://tabler.io/icons), stroked |
| `remix` | [Remix Icon](https://remixicon.com), filled |
| `phosphor` | [Phosphor](https://phosphoricons.com), filled |
| `heroicons` | [Heroicons](https://heroicons.com), stroked |

An outside pack's drawings are copied into `src/assets/icon-packs/<pack>/`, one `.svg` per icon name in `design/icons.md`, with the pack's license notice beside them under `src/assets/`. Nothing is fetched at runtime. `design/icons.md` holds the pack table and, on every icon row, one decision per outside pack — that pack's own drawing, a filled variant of its own path, a named borrow from another pack, or `leaftext`. `just bundle-icons` compiles all of it; `just check-icons` and `just check-icon-audit` fail on drift.

Diagrams are deliberately outside this: `mermaid-icons.js` takes no pack drawing, so a document draws the same for every reader.

## Startup contract check

`assert_theme_sources_cover_contract()` in `src/theme.rs` runs at startup (called from `compiled_theme_css()`, which is called from `reading_mode_css()`, which is called from `app_shell_html()`). It performs the following checks for every theme source:

- No duplicate theme source IDs.
- Every source has a non-empty `family_name`.
- Every source's selector names both its `family` and its `appearance`.
- No duplicate token declarations within a single source.
- Every token in `LEAF_SEMANTIC_TOKEN_CONTRACT` is covered by the source.
- At least two families exist, and every family defines both a light and a dark variant, so the Appearance control always has both to resolve.

Because `reading_mode_css()` is cached in a `OnceLock<String>` and called on the first paint, a missing token causes a `panic!` with a message like:

```text
theme source fern-light missing required token --lt-syntax-changed-background
```

This surfaces as a test-time or launch-time failure (any run that compiles the theme CSS), never silently producing a broken theme.

## Accessibility gate

Three tests re-derive contrast across **every** theme so an unreadable palette fails `just verify` instead of shipping (the third covers diagrams):

- `theme_compiler_gates_readable_pairs_for_every_source` checks text pairs (foreground on background, code, selection, syntax) at **4.5:1** (WCAG AA for text).
- `theme_compiler_gates_interactive_chrome_contrast` checks icons and controls on filled backgrounds — buttons, nav, badges, and the tab-close hover — at **3:1** (WCAG 1.4.11 for non-text UI).
- `theme_compiler_gates_diagram_colors_for_every_source` re-derives **every pair a Mermaid diagram makes** out of our tokens: label text on the page, on box and subgraph surfaces, and on quadrant panels at **4.5:1**; arrows and outlines as graphics at **3:1**; and each fill we set — Gantt's four bar states, the sequence number, the error box, the quadrant panels — required to have one theme ink that reads on it at **4.5:1**, worst case across the group. See [Diagram colors](#diagram-colors).

## `compiled_theme_css()`

`compiled_theme_css()` generates the theme CSS block. For each `ThemeSource`, it emits:

```css
:root[data-leaf-theme="github"][data-leaf-appearance="light"] {
  --lt-theme-source: github-light;
  --lt-background: #ffffff;
  /* ... all contract tokens ... */
}
```

Then, per family, it emits a font block (`--heading-font`/`--reading-font`/`--app-font`/`--code-font`) from that family's `fonts`.

`reading_mode_css()` assembles the full style block: the compiled theme CSS above, then the stylesheet itself, as the ordered parts `READING_CSS_PARTS` names under `src/assets/reading/` and concatenates with nothing between them — its own `:root` block (the radius scale, the type scale, the layout metrics and the grain inks — everything that is one value for the whole app rather than per theme), then the application layout and document body CSS. The theme blocks have to come first so every `var(--lt-*)` in the stylesheet resolves. The stylesheet is an asset rather than a Rust literal so it stays editable as CSS. No Primer primitives and no font faces are embedded — fonts load separately from Google Fonts (see [Theme fonts](#theme-fonts)). The result is cached in a `OnceLock<String>` — computed once per process lifetime. Both it and `exported_page_css()` are one call on `compose_reading_css()`, which takes the icon sheet as an argument: the window gets every pack, because a reader changes theme there, and a page written out gets the same sheet with the five [packs](#icon-packs) its pinned theme can never wear cut out.

## Theme fonts

Fonts are **per-theme data**. Each source's `fonts` block carries three CSS font-family stacks (`heading`, `body`, `code`) and a `google` URL:

- The compiler emits each family's stacks as `--heading-font`/`--reading-font`/`--app-font`/`--code-font`.
- `theme_web_font_hrefs_json()` builds the family → `google` URL map (skipping any family whose `google` is empty) and injects it into the theme bootstrap as `FAMILY_FONTS`.
- In `theme_bootstrap_script()`, `applyFamilyFont()` runs on every `apply()` (first paint and each switch): it points a single `<link id="leafThemeFont">` at the active family's URL, or removes it for a family that fetches nothing. Because each stack ends in system fallbacks, text is readable before the web font loads and while offline.

Each family declares its own faces — Fern loads **Noto** (Sans / Serif / Sans Mono), Nightshade **Fraunces + Inter + Fira Code**, Halcyon **IBM Plex Sans/Mono**, Amaranth the **Source** family, Sage **Inter + JetBrains Mono**, Arabica **Rubik + JetBrains Mono**, Goldenrod **Space Grotesk + Space Mono**, Ginger **Nunito + Inconsolata**, Pippin **DM Sans + DM Mono**, Bloodleaf **Archivo + Roboto Mono**; **GitHub** declares an empty `google`, so it uses the OS's native font stack and fetches nothing. The Content-Security-Policy in `src/assets/app-shell.html` allows `https://fonts.googleapis.com` (the stylesheet) under `style-src` and `https://fonts.gstatic.com` (the woff2 files) under `font-src`.

## Diagram colors

Mermaid's own light and dark theme is the base, and the colors that carry structure are overridden from the tokens on `:root`, read at render time in `src/assets/shell/mermaid-theme.js`. So a theme file contains **no diagram tokens at all** and still themes flowcharts, sequences, state and class diagrams, ER diagrams, Gantt charts, quadrants and requirement diagrams. That is deliberate: a per-family diagram palette would be roughly forty values × 22 sources of hand-copied color, and every copy is a place for the copies to drift.

A handful of tables do the work:

- `MERMAID_COLOR_MAP` — Mermaid variable → the page token it takes its color from. Flowchart boxes, subgraph surfaces, sequence actors, Gantt states, pie strokes, quadrant fills, requirement boxes, and the arrows and labels shared by all of them.
- `MERMAID_INK_MAP` — Mermaid variable → the fills its text is printed on. See below.
- `MERMAID_INK_CANDIDATES` — every ink a diagram may print in: the page's two, plus the inks the theme picked for its colored surfaces. All theme colors, so a diagram never prints in one the theme does not contain.
- `MERMAID_GANTT_STATE_INKS` — the one case a variable cannot express, emitted as CSS. See below.
- `MERMAID_XYCHART_COLOR_MAP` plus `MERMAID_PLOT_TOKENS` — the XY chart keeps its colors in a group of its own, and its plot palette is the theme's primary, accent, success, warning, danger and done, in that order.
- `MERMAID_SCALE_SEED` plus `MERMAID_SCALE_SHAPE` — the categorical scale. See below.

**The categorical scale is named entry by entry.** The twelve colors a mindmap, timeline, kanban board, journey, pie chart or git graph cycles through are `cScale0-11`, and `mermaidCategoricalScale()` builds all twelve from the theme's primary: its hue stepped 150° at a time — coprime with twelve, so all twelve hues are visited while neighbors, which is what a timeline puts side by side, land opposite each other. `cScaleLabel0-11` is measured against each.

Naming every entry is what makes it stick. Mermaid's `calculate()` applies the variables it is handed, runs its own arithmetic, then **applies them again** — so a `cScale` we set survives, while a color that merely *feeds* the scale gets darkened by 75 (dark) or 25 (light) out of our reach. That was v0.1.423: not a bad color on our side, a color we never got to choose. It also means never using the `base` theme, which recomputes the scale from `primaryColor` for anything we leave unnamed.

**Every entry is one luminance, not one lightness.** `colorAtLuminance()` binary-searches the lightness that hits a target relative luminance per hue, because a yellow and a blue at the same HSL lightness are nowhere near the same weight. Equal weight means one ink reads on all twelve — which is load-bearing, not tidiness: a mindmap draws its labels as HTML, so they inherit the page's ink whatever `cScaleLabel` says.

Two diagram types keep the scale somewhere else and have to be pointed at it: the git graph (`git0-7`, whose `gitBranchLabel1` is otherwise hardcoded `white`) and the journey (`fillType0-7`, otherwise midnight blue and magenta in every theme). Pie slices also drop Mermaid's 0.7 `pieOpacity`, which on a light page turns two distinct colors into two pale ones nobody can tell apart.

**Ink is measured, not assumed.** For text printed *inside* a colored fill, `readableInk()` computes the WCAG contrast of every ink the theme owns — the page's two, plus each `*-foreground` — and takes the best. Where one variable serves several fills, the *worst* of them decides. A theme's `*-foreground` is the right ink for its own buttons and says nothing about a diagram: GitHub's greens and blues are meant to be read as text on a page, so they are mid tones, and white on them comes out at 2.3:1. Measuring fixes that for every family without touching a palette.

**What the text sits on is the whole question**, and getting it wrong looks exactly like getting the color wrong. A quadrant point's label is drawn on the quadrant, not on the point; measuring it against the point shipped white text on a pale gray panel. A sequence number sits on the signal line. So `MERMAID_INK_MAP` maps a variable to *the fills its text lands on*, and the gate re-derives the same pairs.

**A Gantt bar is where variables run out.** Mermaid keeps one label color for four differently colored bars — ordinary, active, done, critical — and no single ink clears 4.5:1 on all four (2.67:1 at best in Goldenrod light). Mermaid appends `themeCSS` *after* its own stylesheet, so `mermaidGanttStateCss()` emits one rule per state (`.taskText0-3`, `.activeText0-3`, `.doneText0-3`, `.critText0-3`, and the two crit-done variants), each with the ink measured against that state's own bar. Those rules carry `!important` because Mermaid's own do: without it the active and done bars silently kept Mermaid's ink.

`themeCSS` carries one other rule. C4 paints its relation lines and their labels a hardcoded `#444444` — the one part of that diagram's palette that is not a C4 color, and 1.5:1 on a dark page. There is no variable and no class behind it, so `mermaidC4RelationCss()` matches the presentation attribute; nothing else Mermaid draws sets `fill` or `stroke` as an attribute to that value.

Two consequences worth remembering:

- **The memo key carries the family.** `mermaidCacheKey()` keys the rendered-SVG cache on family *and* appearance, because two themes of the same appearance draw the same diagram in different colors.
- **A theme switch redraws.** An SVG holds its colors as literal values, so `repaintMermaidDiagrams()` puts the Mermaid text back and renders again. A `MutationObserver` on the root element's `data-theme`/`data-leaf-theme` is what triggers it, so the picker and the system's own light/dark switch both work without either knowing diagrams exist.

`just check-shell` holds every token name in those tables to the ones the app stylesheet defines — a name that does not exist reads as an empty string, Mermaid falls back to its own palette, and the diagram quietly stops matching the page.

## Adding a theme

A theme is a light/dark pair of sources, authored as data — no Rust. To add one (`myfamily`, "My Family"):

**1. Add the family file**

Create `themes/myfamily.md`. Copy an existing family file (e.g. `themes/amaranth.md`) as a template so the token coverage and shape match, then edit:

- the `# My Family` heading and the `**Family ID:** \`myfamily\`` line (it must match the filename);
- optionally a preview screenshot — a standalone `![My Family](../imgs/themes/myfamily.png)` line between the heading and the `**Family ID:**` line. `bundle-themes` picks up the first such image in the header, copies it into the gallery entry in `themes/README.md`, and fails if the path does not resolve (relative to `themes/`);
- the `**Pack:**` line naming the [icon pack](#icon-packs) the family wears, or leave it out to wear `leaftext`;
- the `## Fonts` table (set the `Google` row to a Google Fonts `css2` URL, or leave it blank for system fonts);
- the `## Light` and `## Dark` `Token | Value` tables — every property in `LEAF_SEMANTIC_TOKEN_CONTRACT` (minus the `--lt-` prefix) that is not in `LEAF_SEMANTIC_TOKEN_DEFAULTS`, with an optional `### Overrides` table for tokens you nudge off the base. Add `hover-tint` only if you want the hovers in a hue of their own.

**2. Bundle and verify**

```sh
just bundle-themes   # compile themes/ -> src/assets/themes.md
just verify          # contract + contrast checks, and check-themes drift guard
```

The folder is globbed, so there is no manifest to update. `assert_theme_sources_cover_contract()` fails the run if any contract token is missing, if the family lacks a light or dark variant, or if a selector doesn't name its family and appearance; the contrast tests fail it if any pair is unreadable.

**4. Nothing to wire up in the UI**

The theme picker builds its buttons from `theme_families()` (`theme_items_html()` in `src/lib.rs` emits one `.theme-item` per family), and the bootstrap's family list is injected from the registry — so a registered family appears in the picker automatically, with no HTML edit.

> [!WARNING]
> The startup token check uses exact string matching against the names in `LEAF_SEMANTIC_TOKEN_CONTRACT`. Spell every token name exactly — a single typo (e.g. `--lt-sytax-keyword`) will not match and the assertion will fail at startup with a "missing required token" message.

## The Random family preference

The theme picker appends one entry that is not a real family: **Random** (`data-family="random"`). `theme_items_html()` in `src/lib.rs` emits it after the family buttons, and it never appears in `theme_families()`, the font map, or the compiled CSS — the `theme_compiler_requires_complete_semantic_sources_and_keeps_ui_controlled` test asserts exactly that.

The bootstrap treats family state as two axes: `familyPreference` (the persisted picker choice, which may be `random`) and the concrete `family` actually applied to `:root`. When the preference is `random`, `drawRandomFamily()` picks a concrete family — a no-repeat cycle over `REAL_FAMILIES` that avoids an immediate repeat across a reset — on first paint and on each re-pick. `window.leafTheme.getFamily()` returns the preference (so the picker keeps Random selected), while the CSS attribute uses the drawn family.

The cycle survives restarts: the used-family "bag" is persisted through the host via the `setThemeRandomBag` IPC command (see [Architecture](01-architecture.md#ipc-bridge)), which writes `theme_random_used` in `settings.json`. The host injects it back as `settings.themeRandomUsed` on the next launch, so `drawRandomFamily()` continues the rotation rather than starting over.

## Appearance modes

The theme bootstrap (`theme_bootstrap_script()` in `src/lib.rs`) resolves the Appearance setting to a concrete light/dark value, exposed via `window.leafTheme`:

- **Light** / **Dark** — a fixed variant.
- **System** — follows the OS `prefers-color-scheme`, updating live on change.
- **Daylight** — light between 09:00 and 18:00 local time, dark otherwise. A rescheduling timer flips it at the next boundary without a restart, and it re-checks on window focus (covering a machine that slept across a boundary).
