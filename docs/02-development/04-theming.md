# Theming

> leaftext enforces a semantic token contract of ~100 CSS custom properties, validated when the theme CSS is compiled at startup. Palettes are data — a bundled `themes.json` compiled from per-theme files — so adding a theme takes no Rust.

leaftext's theme system is built around a semantic token contract — a set of approximately 100 `--leaf-*` CSS custom properties that every theme must define. The contract is not enforced by the Rust compiler; it is checked at startup, the first time the theme CSS is compiled. If a token is missing, that compile step hits an assertion and `panic!`s with an explicit message (so a test run or the first launch surfaces it), rather than silently rendering with broken fallback colors.

Palettes are **data, not code**: every theme's values live in `src/assets/themes.json`, parsed once at startup — not in Rust `const` tables.

## The token contract

`LEAF_SEMANTIC_TOKEN_CONTRACT` in `src/theme.rs` defines the authoritative list of required properties. Every theme source must map a value to each token in this list. The tokens are organized into semantic categories:

### Core UI

App surface and text colors, named by role (the `app-` prefix was dropped): `--leaf-background`, `--leaf-foreground`, `--leaf-surface`, `--leaf-surface-raised`, `--leaf-surface-elevated`, `--leaf-surface-muted`, `--leaf-surface-sunken`, `--leaf-surface-inset`, `--leaf-surface-card`, `--leaf-border`, `--leaf-border-strong`, `--leaf-muted-foreground`, and the semantic role tokens `--leaf-primary`, `--leaf-secondary`, `--leaf-accent`, `--leaf-danger`, `--leaf-warning`, `--leaf-success`, `--leaf-done`, `--leaf-link`, `--leaf-shadow`, and their `-foreground` partners plus focus/selection states.

### Editor and Markdown elements

Tokens for inline code background/foreground, code block background/foreground/border, blockquote border and foreground, headings, muted foreground, links, tables, thematic breaks, math inline background, and keyboard key styling.

### Alert callout colors

Per-severity accent colors for GitHub-style alert callouts: `--leaf-markdown-alert-note`, `--leaf-markdown-alert-tip`, `--leaf-markdown-alert-important`, `--leaf-markdown-alert-warning`, `--leaf-markdown-alert-caution`, and `--leaf-markdown-alert-done`.

### Syntax highlighting tokens

One token per syntactic role: `--leaf-syntax-background`, `--leaf-syntax-foreground`, `--leaf-syntax-comment`, `--leaf-syntax-keyword`, `--leaf-syntax-string`, `--leaf-syntax-number`, `--leaf-syntax-function`, `--leaf-syntax-variable`, `--leaf-syntax-type`, `--leaf-syntax-operator`, `--leaf-syntax-punctuation`, and per-channel inserted/deleted/changed diff tokens.

### Minimap colors

`--leaf-minimap-background`, `--leaf-minimap-border`, `--leaf-minimap-viewport-border`, `--leaf-minimap-viewport-background`, `--leaf-minimap-heading`, `--leaf-minimap-paragraph`, `--leaf-minimap-blank`, `--leaf-minimap-list`, `--leaf-minimap-blockquote`, `--leaf-minimap-code`.

### Navigation chrome

Button background, foreground, hover, and disabled states for the back/forward/open controls and the recent-files list.

### Radius and shadow scales

Corners and elevation are tokenized too, but as **global scales** in the compiled `:root` block rather than per-theme values: `--leaf-radius-xs/sm/md/lg/xl/2xl/pill/full` for corners, and `--leaf-shadow-sm`/`-popover`/`-sheet`/`-tooltip` for overlays (the per-theme resting shadow is `--leaf-shadow`). Every surface pulls from these, so rounding and elevation swap in one place.

## Theme families and sources

Themes are organized as **families**, each pairing a light and a dark **source**. The user picks a family (the Theme setting) and an appearance (the Appearance setting: Light, Dark, System, or Daylight); the two combine to select one source. Five families ship, so ten sources are defined, **sorted by display name** in the picker (`Dracula`, `Fern`, `GitHub`, `Græy`, `Obsidian`); `fern` is the default family (the bootstrap's fallback). Each source has an `id`, a `family` id, a `family_name` (the picker label), an `appearance` (`Light`/`Dark`), a CSS `selector`, a flat `tokens` map covering every contract property, an `overrides` map for per-source token nudges (empty for most sources), and a `fonts` block:

| Source id        | Family (label)        | Appearance | Token strategy                                                                     |
| ---------------- | --------------------- | ---------- | --------------------------------------------------------------------------------- |
| `dracula-light`  | `dracula` (Dracula)   | Light      | A light "Alucard" interpretation of the Dracula accent hues on a cream ground.    |
| `dracula-dark`   | `dracula` (Dracula)   | Dark       | The classic Dracula hex values (`#282a36`, `#f8f8f2`, `#bd93f9`).                  |
| `fern-light`     | `fern` (Fern)         | Light      | Default family. Obsidian's light tokens plus a fern-green override cast.           |
| `fern-dark`      | `fern` (Fern)         | Dark       | Obsidian's dark tokens plus the fern-green overrides.                              |
| `github-light`   | `github` (GitHub)     | Light      | GitHub's light palette, baked to literal hex (its own system-font stack).         |
| `github-dark`    | `github` (GitHub)     | Dark       | GitHub's dark palette, baked to literal hex.                                       |
| `graey-light`    | `graey` (Græy)        | Light      | Obsidian's light tokens plus a neutral greyscale override.                         |
| `graey-dark`     | `graey` (Græy)        | Dark       | Obsidian's dark tokens plus the greyscale overrides.                              |
| `obsidian-light` | `obsidian` (Obsidian) | Light      | Obsidian's default light base ramp with its violet accent.                        |
| `obsidian-dark`  | `obsidian` (Obsidian) | Dark       | Obsidian's default dark base ramp with its violet accent.                         |

Every source activates through the Leaf-owned attributes the theme bootstrap stamps on `:root`: `data-leaf-theme="<family>"` and `data-leaf-appearance="<light|dark>"`. So a source's selector is `:root[data-leaf-theme="github"][data-leaf-appearance="light"]`, and so on.

**Every theme is a self-contained literal palette** — each source maps every `--leaf-*` token to a hex (or `rgba()`) value. There is no Primer dependency and no separate theme "kind": GitHub was flattened to plain hex like the rest, so all themes share one uniform shape. The Fern and Græy families reuse Obsidian's literal token maps and re-tint them through their `overrides` maps, so they inherit Obsidian's full coverage and only restate the tokens they change (`theme_source_token_value()` checks `overrides` before `tokens`). `theme_families()` derives the ordered picker list from the loaded sources, so registering a family's light/dark pair adds it to the picker automatically.

## Palettes are data (`themes.json`)

`theme_sources()` parses `src/assets/themes.json` — bundled into the binary with `include_str!` — **once** at startup via a `OnceLock`, then leaks the owned strings to `&'static` so every downstream consumer keeps working against `&'static` fields. Each entry deserializes into a `ThemeFile` (`id`, `family`, `family_name`, `appearance`, `selector`, `tokens`, `overrides`, `fonts`).

The editable source of truth is the **`themes/` folder at the repo root**, which is also served on the web at **leaftext.com/themes**:

- `themes/manifest.json` — the roster of family files.
- `themes/<family>.json` — one file per family, an array of its light/dark source objects.

`scripts/bundle-themes.mjs` compiles the folder into `src/assets/themes.json`, emitting the families **sorted by display name** so the picker and gallery stay alphabetical no matter what order they're added. `just bundle-themes` rebuilds the bundle; `just check-themes` (part of `just verify`) fails if `themes.json` has drifted from the folder — the same drift-guard pattern used for the vendored site assets.

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
theme source fern-light missing required token --leaf-syntax-changed-background
```

This surfaces as a test-time or launch-time failure (any run that compiles the theme CSS), never silently producing a broken theme.

## Accessibility gate

Two tests re-derive contrast across **every** theme so an unreadable palette fails `just verify` instead of shipping:

- `theme_compiler_gates_readable_pairs_for_every_source` checks text pairs (foreground on background, code, selection, syntax) at **4.5:1** (WCAG AA for text).
- `theme_compiler_gates_interactive_chrome_contrast` checks icons and controls on filled backgrounds — buttons, nav, badges, and the tab-close hover — at **3:1** (WCAG 1.4.11 for non-text UI).

## `compiled_theme_css()`

`compiled_theme_css()` generates the theme CSS block. For each `ThemeSource`, it emits:

```css
:root[data-leaf-theme="github"][data-leaf-appearance="light"] {
  --leaf-theme-source: github-light;
  --leaf-background: #ffffff;
  /* ... all contract tokens ... */
}
```

Then, per family, it emits a font block (`--heading-font`/`--reading-font`/`--app-font`/`--code-font`) from that family's `fonts`, placed before the locale rule so a CJK reader's reading font still wins.

`reading_mode_css()` assembles the full style block — compiled theme CSS, then the `:root` alias layer (radius/shadow scales and short component names), then the application layout and document body CSS. No Primer primitives and no font faces are embedded — fonts load separately from Google Fonts (see [Theme fonts](#theme-fonts)). The result is cached in a `OnceLock<String>` — computed once per process lifetime.

## Theme fonts

Fonts are **per-theme data**. Each source's `fonts` block carries three CSS font-family stacks (`heading`, `body`, `code`) and a `google` URL:

- The compiler emits each family's stacks as `--heading-font`/`--reading-font`/`--app-font`/`--code-font`.
- `theme_web_font_hrefs_json()` builds the family → `google` URL map (skipping any family whose `google` is empty) and injects it into the theme bootstrap as `FAMILY_FONTS`.
- In `theme_bootstrap_script()`, `applyFamilyFont()` runs on every `apply()` (first paint and each switch): it points a single `<link id="leafThemeFont">` at the active family's URL, or removes it for a family that fetches nothing. Because each stack ends in system fallbacks, text is readable before the web font loads and while offline.

The shipping families load **Noto** (Sans / Serif / Sans Mono); **GitHub** declares an empty `google`, so it uses the OS's native font stack and fetches nothing. The Content-Security-Policy in `src/assets/app-shell.html` allows `https://fonts.googleapis.com` (the stylesheet) under `style-src` and `https://fonts.gstatic.com` (the woff2 files) under `font-src`.

## Adding a theme

A theme is a light/dark pair of sources, authored as data — no Rust. To add one (`myfamily`, "My Family"):

**1. Add the family file**

Create `themes/myfamily.json` — an array of two source objects (light and dark). Copy an existing family file (e.g. `themes/dracula.json`) as a template so the token coverage and shape match. Each source needs `id`, `family`, `family_name`, `appearance`, `selector`, a `tokens` map covering every property in `LEAF_SEMANTIC_TOKEN_CONTRACT`, an `overrides` map (often `[]`), and a `fonts` block (set `google` to a Google Fonts `css2` URL, or `""` for system fonts).

**2. Register it in the manifest**

Add `"myfamily"` to the `themes` array in `themes/manifest.json`.

**3. Bundle and verify**

```sh
just bundle-themes   # compile themes/ -> src/assets/themes.json
just verify          # contract + contrast checks, and check-themes drift guard
```

`assert_theme_sources_cover_contract()` fails the run if any contract token is missing, if the family lacks a light or dark variant, or if a selector doesn't name its family and appearance; the contrast tests fail it if any pair is unreadable.

**4. Nothing to wire up in the UI**

The theme picker builds its buttons from `theme_families()` (`theme_items_html()` in `src/lib.rs` emits one `.theme-item` per family), and the bootstrap's family list is injected from the registry — so a registered family appears in the picker automatically, with no HTML or translation edit.

> [!WARNING]
> The startup token check uses exact string matching against the names in `LEAF_SEMANTIC_TOKEN_CONTRACT`. Spell every token name exactly — a single typo (e.g. `--leaf-sytax-keyword`) will not match and the assertion will fail at startup with a "missing required token" message.

## The Random family preference

The theme picker appends one entry that is not a real family: **Random** (`data-family="random"`, localized via `data-i18n`). `theme_items_html()` in `src/lib.rs` emits it after the family buttons, and it never appears in `theme_families()`, the font map, or the compiled CSS — the `theme_compiler_requires_complete_semantic_sources_and_keeps_ui_controlled` test asserts exactly that.

The bootstrap treats family state as two axes: `familyPreference` (the persisted picker choice, which may be `random`) and the concrete `family` actually applied to `:root`. When the preference is `random`, `drawRandomFamily()` picks a concrete family — a no-repeat cycle over `REAL_FAMILIES` that avoids an immediate repeat across a reset — on first paint and on each re-pick. `window.leafTheme.getFamily()` returns the preference (so the picker keeps Random selected), while the CSS attribute uses the drawn family.

The cycle survives restarts: the used-family "bag" is persisted through the host via the `setThemeRandomBag` IPC command (see [Architecture](01-architecture.md#ipc-bridge)), which writes `theme_random_used` in `settings.json`. The host injects it back as `settings.themeRandomUsed` on the next launch, so `drawRandomFamily()` continues the rotation rather than starting over.

## Appearance modes

The theme bootstrap (`theme_bootstrap_script()` in `src/lib.rs`) resolves the Appearance setting to a concrete light/dark value, exposed via `window.leafTheme`:

- **Light** / **Dark** — a fixed variant.
- **System** — follows the OS `prefers-color-scheme`, updating live on change.
- **Daylight** — light between 09:00 and 18:00 local time, dark otherwise. A rescheduling timer flips it at the next boundary without a restart, and it re-checks on window focus (covering a machine that slept across a boundary).
