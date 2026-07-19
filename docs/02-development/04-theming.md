# Theming

> leaftext enforces a semantic token contract of ~100 CSS custom properties, validated when the theme CSS is compiled at startup. Learn how themes are defined, compiled, and validated.

leaftext's theme system is built around a semantic token contract — a set of approximately 100 `--leaf-*` CSS custom properties that every theme must define. The contract is not enforced by the Rust compiler; it is checked at startup, the first time the theme CSS is compiled. If a token is missing, that compile step hits an assertion and `panic!`s with an explicit message (so a test run or the first launch surfaces it), rather than silently rendering with broken fallback colors.

## The token contract

`LEAF_SEMANTIC_TOKEN_CONTRACT` in `src/theme.rs` defines the authoritative list of required properties. Every theme source must map a value to each token in this list. The tokens are organized into semantic categories:

### Reader chrome

Core app surface and foreground colors: `--leaf-app-background`, `--leaf-app-foreground`, `--leaf-app-surface`, `--leaf-app-surface-raised`, `--leaf-app-surface-elevated`, `--leaf-app-surface-muted`, `--leaf-app-surface-sunken`, `--leaf-app-surface-inset`, `--leaf-app-surface-card`, `--leaf-app-border`, `--leaf-app-border-strong`, and semantic role tokens for primary, secondary, accent, danger, warning, success, done, link, shadow, and focus states.

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

## Theme families and sources

Themes are organized as **families**, each pairing a light and a dark **source**. The user picks a family (the Theme setting) and an appearance (the Appearance setting: Light, Dark, System, or Daylight); the two combine to select one source. Five families ship, so ten `ThemeSource` structs are defined in `src/theme.rs`, listed in picker order with `fern` first (the default family). Each has an `id`, a `family` id, a `family_name` (the picker label), an `appearance` (`Light`/`Dark`), a CSS `selector`, a `kind`, a flat `tokens` slice mapping every contract property to a value, and an `overrides` slice for per-source token nudges (empty for most sources):

| Source id        | Family (label)      | Appearance | Token strategy                                                                                    |
| ---------------- | ------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `fern-light`     | `fern` (Fern)       | Light      | Default family. Obsidian's light tokens plus `FERN_LIGHT_OVERRIDES` (a fern-green cast).           |
| `fern-dark`      | `fern` (Fern)       | Dark       | Obsidian's dark tokens plus `FERN_DARK_OVERRIDES`.                                                 |
| `github-light`   | `github` (GitHub)   | Light      | Maps `--leaf-*` tokens to GitHub Primer CSS primitives (`var(--bgColor-*)`, `var(--fgColor-*)`).  |
| `github-dark`    | `github` (GitHub)   | Dark       | Same Primer primitives; Primer's dark-mode cascade supplies different resolved values.            |
| `dracula-light`  | `dracula` (Dracula) | Light      | Literal palette — a light "Alucard" interpretation of the Dracula accent hues on a cream ground.  |
| `dracula-dark`   | `dracula` (Dracula) | Dark       | Literal palette — the classic Dracula hex values (`#282a36`, `#f8f8f2`, `#bd93f9`).               |
| `obsidian-light` | `obsidian` (Obsidian) | Light    | Literal palette — Obsidian's default light base ramp with its violet accent.                      |
| `obsidian-dark`  | `obsidian` (Obsidian) | Dark     | Literal palette — Obsidian's default dark base ramp with its violet accent.                       |
| `graey-light`    | `graey` (Græy)      | Light      | Obsidian's light tokens plus `GRAEY_LIGHT_OVERRIDES` (a neutral greyscale).                        |
| `graey-dark`     | `graey` (Græy)      | Dark       | Obsidian's dark tokens plus `GRAEY_DARK_OVERRIDES`.                                                |

Every source activates through the Leaf-owned attributes the theme bootstrap stamps on `:root`: `data-leaf-theme="<family>"` and `data-leaf-appearance="<light|dark>"`. So a source's selector is `:root[data-leaf-theme="github"][data-leaf-appearance="light"]`, and so on.

The two `github` sources share the same `PRIMER_THEME_TOKENS` slice. Because they use CSS `var()` references into the Primer primitive cascade, the same token map produces the correct resolved color in both contexts — the bootstrap also sets Primer's own `data-color-mode`/`data-light-theme` attributes from the resolved appearance, so the primitives resolve. `github-dark` additionally layers `PRIMER_DARK_BORDER_OVERRIDES` through its `overrides` field — `theme_source_token_value()` checks `overrides` before `tokens`, so the dark source shifts its border family (a slate-blue nudge) while sharing the rest of the map.

The Dracula and Obsidian sources use `ThemeSourceKind::Literal`: each maps every `--leaf-*` token directly to a hex (or `rgba()`) value, with no dependency on the Primer primitives. The Fern and Græy families reuse Obsidian's literal token maps and re-tint them through their `overrides` slices, so they inherit Obsidian's full coverage and only restate the tokens they change. `theme_families()` derives the ordered picker list from these sources, so registering a family's light/dark pair adds it to the picker automatically.

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

## `compiled_theme_css()`

`compiled_theme_css()` generates the final CSS block that follows the Primer primitive stylesheets in the cascade. For each `ThemeSource`, it emits:

```css
:root[data-leaf-theme="github"][data-leaf-appearance="light"] {
  --leaf-theme-source: github-light;
  --leaf-app-background: var(--bgColor-default);
  /* ... all contract tokens ... */
}
```

`reading_mode_css()` then assembles the full style block in this order:

1. Primer primitives light CSS (`primer-primitives-11.9.0-light.css`)
2. Primer primitives dark CSS (`primer-primitives-11.9.0-dark.css`)
3. Compiled theme CSS from `compiled_theme_css()`
4. Application layout and document body CSS

No font faces are embedded — fonts load separately from Google Fonts (see [Theme fonts](#theme-fonts)). The result is cached in a `OnceLock<String>` — computed once per process lifetime.

## Theme fonts

Fonts are not bundled into the binary. The active theme fetches its font from **Google Fonts** when it activates, and the WebView caches the woff2 on disk so later launches are instant.

- `noto_web_font_href()` in `src/theme.rs` returns the Google Fonts `css2` URL for the default font — Noto Sans, Noto Serif, and Noto Sans Mono, the faces the base `--reading-font`/`--heading-font`/`--code-font` name.
- `system_font_families()` lists families that use the OS's native fonts and fetch nothing — currently just `github`, which mirrors github.com's stack via the `:root[data-leaf-theme="github"]` override in `reading_mode_css()`.
- `theme_web_font_hrefs_json()` builds the family → URL map (every family except the system-font ones gets Noto) and injects it into the theme bootstrap as `FAMILY_FONTS`.
- In `theme_bootstrap_script()`, `applyFamilyFont()` runs on every `apply()` (first paint and each switch): it points a single `<link id="leafThemeFont">` at the active family's URL, or removes it for a system-font family. Because each `--*-font` stack ends in system fallbacks, text is readable before the web font loads and while offline.

The Content-Security-Policy in `src/assets/app-shell.html` therefore allows `https://fonts.googleapis.com` (the stylesheet) under `style-src` and `https://fonts.gstatic.com` (the woff2 files) under `font-src`.

## Adding a theme family

A family is a light/dark pair of sources. To add one (`myfamily`, "My Family"):

**1. Define two token maps**

In `src/theme.rs`, create two `const` slices — one per appearance (e.g. `MYFAMILY_LIGHT_THEME_TOKENS` and `MYFAMILY_DARK_THEME_TOKENS`) — each mapping every property name in `LEAF_SEMANTIC_TOKEN_CONTRACT` to a literal value. Each entry is `("--leaf-property-name", "value")`. Copy an existing literal palette (e.g. `DRACULA_THEME_TOKENS`) as a template so the token order and coverage match.

**2. Register both ThemeSources**

Add two `ThemeSource` entries to the slice returned by `theme_sources()`, one per appearance:

```rust
ThemeSource {
    id: "myfamily-light",
    family: "myfamily",
    family_name: "My Family",
    appearance: Appearance::Light,
    selector: ":root[data-leaf-theme=\"myfamily\"][data-leaf-appearance=\"light\"]",
    kind: ThemeSourceKind::Literal,
    tokens: MYFAMILY_LIGHT_THEME_TOKENS,
    overrides: &[],
},
// ...and the matching Appearance::Dark source with MYFAMILY_DARK_THEME_TOKENS.
```

**3. Run the verification suite**

```sh
just verify
```

`assert_theme_sources_cover_contract()` panics (failing the test run) if any contract token is missing, if the family lacks a light or dark variant, or if a selector doesn't name its family and appearance.

**4. Nothing to wire up in the UI**

The theme picker builds its buttons from `theme_families()` (`theme_items_html()` in `src/lib.rs` emits one `.theme-item` per family, labelled by `family_name`), and the bootstrap's family list is guarded against the sources — so a registered family appears in the picker automatically, with no HTML or translation edit. The `theme_compiler_requires_complete_semantic_sources_and_keeps_ui_controlled` test asserts every family returned by `theme_families()` has a matching picker button.

The new family also fetches the default **Noto** font automatically, since `theme_web_font_hrefs_json()` maps every non-system family to it (see [Theme fonts](#theme-fonts)). To make the family use the OS's native fonts instead — fetching nothing, like GitHub — add its id to `system_font_families()` and give it a `:root[data-leaf-theme="<family>"]` font override in `reading_mode_css()`.

> [!WARNING]
> The startup token check uses exact string matching against the names in `LEAF_SEMANTIC_TOKEN_CONTRACT`. Ensure every token name in your new theme map is spelled exactly as it appears in that list — a single typo (e.g. `--leaf-sytax-keyword` instead of `--leaf-syntax-keyword`) will not match and the assertion will fail at startup with a "missing required token" message.

## Appearance modes

The theme bootstrap (`theme_bootstrap_script()` in `src/lib.rs`) resolves the Appearance setting to a concrete light/dark value, exposed via `window.leafTheme`:

- **Light** / **Dark** — a fixed variant.
- **System** — follows the OS `prefers-color-scheme`, updating live on change.
- **Daylight** — light between 09:00 and 18:00 local time, dark otherwise. A rescheduling timer flips it at the next boundary without a restart, and it re-checks on window focus (covering a machine that slept across a boundary).

## Data-only palettes and the future gallery

Every palette is **data** — a map of contract tokens to values — not author CSS. That keeps a theme fully validatable against the contract and safe to load without injecting third-party CSS into the webview. The palettes currently live as Rust `const` slices, but the shape is deliberately the same one a `[meta]` + `[tokens]` theme file would deserialize into. The intended next step is an external theme loader (a user themes directory parsed at startup through the same contract check) plus a small in-repo registry (`themes/registry.json`) and an in-app browser, so community themes can be contributed by PR without touching Rust. Until then, adding a family means editing `theme.rs` as above.
