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

## Theme sources

Three theme sources are defined in `src/theme.rs`. Each is a `ThemeSource` struct with an `id`, a `display_name`, a CSS `selector`, a `kind`, a `selectable` flag, a flat `tokens` slice mapping every contract property to a value, and an `overrides` slice for per-source token nudges (empty for most themes):

| Theme ID       | Selector trigger                                                                                               | Token strategy                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `primer-light` | `[data-color-mode="light"][data-light-theme="light"]` and `[data-color-mode="auto"][data-light-theme="light"]` | Maps `--leaf-*` tokens to GitHub Primer CSS primitive `var(--bgColor-*)`, `var(--fgColor-*)`, etc.                                             |
| `primer-dark`  | `[data-color-mode="dark"][data-dark-theme="dark"]` and `[data-color-mode="auto"][data-light-theme="dark"]`     | Same Primer primitive variables; Primer's dark-mode cascade supplies different resolved values.                                                |
| `dracula`      | `:root[data-leaf-theme-source="dracula"]`                                                                      | Maps every `--leaf-*` token directly to Dracula palette hex values (e.g. `#282a36`, `#f8f8f2`, `#bd93f9`). No dependency on Primer primitives. |

The `primer-light` and `primer-dark` sources share the same `PRIMER_THEME_TOKENS` slice. Because they use CSS `var()` references into the Primer primitive cascade, the same token map produces the correct resolved color in both light and dark contexts. `primer-dark` additionally layers `PRIMER_DARK_BORDER_OVERRIDES` on top through its `overrides` field — `theme_source_token_value()` checks `overrides` before `tokens`, so the dark source shifts its border family (a slate-blue nudge) while sharing the rest of the map.

The `dracula` source uses `ThemeSourceKind::Dracula` and activates through the `data-leaf-theme-source="dracula"` attribute, deliberately isolated from the Primer color-mode selectors.

## Startup contract check

`assert_theme_sources_cover_contract()` in `src/theme.rs` runs at startup (called from `compiled_theme_css()`, which is called from `reading_mode_css()`, which is called from `app_shell_html()`). It performs the following checks for every theme source:

- No duplicate theme source IDs.
- Every source has a non-empty `display_name`.
- Dracula-kind sources use the `data-leaf-theme-source` selector (not the shared Primer color-mode selectors).
- No duplicate token declarations within a single source.
- Every token in `LEAF_SEMANTIC_TOKEN_CONTRACT` is covered by the source.
- At least two sources are `selectable`, so the picker always has a light and a dark option.

Because `reading_mode_css()` is cached in a `OnceLock<String>` and called on the first paint, a missing token causes a `panic!` with a message like:

```text
theme source primer-light missing required token --leaf-syntax-changed-background
```

This surfaces as a test-time or launch-time failure (any run that compiles the theme CSS), never silently producing a broken theme.

## `compiled_theme_css()`

`compiled_theme_css()` generates the final CSS block that follows the Primer primitive stylesheets in the cascade. For each `ThemeSource`, it emits:

```css
[data-color-mode="light"][data-light-theme="light"],
[data-color-mode="auto"][data-light-theme="light"] {
  --leaf-theme-source: primer-light;
  --leaf-app-background: var(--bgColor-default);
  /* ... all ~100 contract tokens ... */
}
```

`reading_mode_css()` then assembles the full style block in this order:

1. Noto font `@font-face` declarations (embedded as `data:` URIs)
2. Primer primitives light CSS (`primer-primitives-11.9.0-light.css`)
3. Primer primitives dark CSS (`primer-primitives-11.9.0-dark.css`)
4. Compiled theme CSS from `compiled_theme_css()`
5. Application layout and document body CSS

The result is cached in a `OnceLock<String>` — computed once per process lifetime.

## Adding a theme

**1. Define a new token map**

In `src/theme.rs`, create a new `const` slice (e.g. `MY_THEME_TOKENS: &[(&str, &str)]`) that maps every property name in `LEAF_SEMANTIC_TOKEN_CONTRACT` to a value. Each entry is `("--leaf-property-name", "value")`.

**2. Register a ThemeSource**

Add a new `ThemeSource` entry to the slice returned by `theme_sources()`:

```rust
ThemeSource {
    id: "my-theme",
    display_name: "My Theme",
    selector: ":root[data-leaf-theme-source=\"my-theme\"]",
    kind: ThemeSourceKind::Dracula, // or a new kind if you add one
    selectable: true,
    tokens: MY_THEME_TOKENS,
    overrides: &[], // per-source token nudges; empty for most themes
}
```

**3. Run the verification suite**

```sh
just verify
```

If any token in `LEAF_SEMANTIC_TOKEN_CONTRACT` is missing from your new source, `assert_theme_sources_cover_contract()` will panic and the test run will fail.

**4. Add the option to the Settings menu**

Add a new `<option>` element to the `#themeMode` `<select>` in the page markup at `src/assets/app-shell.html`, and add translation keys for both `en` and `zh-CN` in `locale_bootstrap_script()` in `src/lib.rs`.

> [!WARNING]
> The startup token check uses exact string matching against the names in `LEAF_SEMANTIC_TOKEN_CONTRACT`. Ensure every token name in your new theme map is spelled exactly as it appears in that list — a single typo (e.g. `--leaf-sytax-keyword` instead of `--leaf-syntax-keyword`) will not match and the assertion will fail at startup with a "missing required token" message.
