<!-- Generated from design/ by `just bundle-design-docs`. Do not edit. -->
# Design system

> Every value in Leaftext's interface comes from a token. 82 of them are colors, which each theme sets for itself; 162 are everything else, one value for the whole app. Nothing is written by hand, and a check fails the build when something is.

Four files under `design/` are the source. Each is plain Markdown, so Leaftext opens them.

| File | Holds | Compiles to |
| --- | --- | --- |
| `design/colors.md` | 82 color names and what each is for — no values, because a color's value belongs to a theme | the token contract in `src/theme.rs` |
| `design/tokens.md` | 162 values that do not change with the theme | `src/assets/tokens.css` |
| `design/icons.md` | 53 icons | `src/assets/icons.css`, one mask class each |
| `design/components.md` | 43 components, and the markup each is drawn with | `src/assets/gallery.html` |

## Colors

Grouped by what they dress. Every one of the 11 theme families gives all 82 a value, in light and in dark, and the app refuses to start if one is missing.

| Group | Colors |
| --- | --- |
| Core | 25 |
| Document | 25 |
| Code | 7 |
| Syntax | 17 |
| Navigation | 6 |
| Minimap | 2 |

See [Theming](04-theming.md) for how a theme is written and how the compiler checks it.

## Values

One value each, whatever theme is on.

| Group | Tokens |
| --- | --- |
| Corners | 8 |
| Elevation | 3 |
| Document type | 27 |
| Interface text | 11 |
| Interface weight | 5 |
| Stroke | 6 |
| Line height | 8 |
| Letter spacing | 6 |
| Opacity | 12 |
| Spacing | 23 |
| Duration | 15 |
| Easing | 4 |
| Layers | 10 |
| Shadows added by the sweep | 7 |
| Grain | 5 |
| Fixed colors | 5 |
| Fixed tints | 4 |
| Inset edges | 3 |

Widths, heights and positional offsets are **not** tokens: they are one component's geometry, used once, and a name for each would buy nothing. Nor is a document's `em` sizing, which follows the text on purpose.

## Icons

53 icons, each a class drawn with `mask-image`. A mask reads only transparency, so the icon takes the color of whatever it sits in — and a drawing used in five places is in the app once. A control with a bolder active state swaps to a second mask rather than thickening a stroke a mask does not have.

## Components

43 components. Each row names its class family, what builds it, and the markup the gallery draws it with — so a component that loses its styling, or gains a class nobody listed, fails the build.

| Component | Class family |
| --- | --- |
| App bar | `.app-bar` |
| Tab strip | `.tab` |
| Overflow menu | `.app-actions` |
| Icon button | `.icon-button` |
| Brand button | `.brand-button` |
| History button | `.history-button` |
| Open button | `.open-button` |
| New-document button | `.new-button` |
| Theme mode button | `.theme-mode-btn` |
| Document button | `.leaf-md-button` |
| Flowchart sheet | `.flow-sheet` |
| Theme sheet | `.theme-sheet` |
| Glossary sheet | `.glossary-sheet` |
| Context menu | `.context-menu` |
| Breadcrumb menu | `.crumb-menu` |
| Library pane | `.library` |
| Search results | `.library-hit` |
| Breadcrumbs | `.library-crumb` |
| Minimap rail | `.document-minimap` |
| Outline | `.document-outline` |
| Pager | `.docs-pager` |
| Block gutter | `.block-insert` |
| Selection toolbar | `.selection` |
| Code view | `.code` |
| Pinned headings | `.code-sticky` |
| Copy button | `.code-copy` |
| Graph | `.reader-graph` |
| Flow canvas | `.flow` |
| Theme card | `.theme-item` |
| Theme setting row | `.setting-theme` |
| Settings rows | `.settings` |
| Link preview | `.link-hover` |
| Document alerts | `.markdown-alert` |
| Bottom sheet | `.leaf-sheet` |
| Sheet scrim | `.lt-backdrop` |
| Spinner | `.lt-spinner` |
| Icon | `.lt-icon` |
| Scroll area | `.leaf-scroll` |
| Toast | `.app-toast` |
| Reader tool bar | `.reader-tool` |
| Window controls | `.window-control` |
| Empty state | `.empty-state` |
| Syntax colors | `.syn` |

## Looking at it

**Settings → Design gallery** writes every color, value, icon and component onto one page and opens it in your browser, painted by the app's own stylesheet in the theme you are using.

## Keeping it

`just verify` runs all of these. Each fails with the file and the line.

| Check | Fails when |
| --- | --- |
| `check-tokens` | a generated token file has drifted from `design/`, a theme sets a color nothing lists, or a component row names a class family nothing styles |
| `check-icons` | `icons.css` has drifted, a row names a file that is not there, or an SVG has no row |
| `check-gallery` | the gallery has drifted, or a component has no sample to draw it with |
| `check-literals` | a color, spacing, text size, weight, stroke, line height, letter spacing, opacity, duration, easing, shadow or layer is written by hand in `reading.css` |
| `check-themes` | the embedded theme bundle has drifted from `themes/` |

To change a value: edit the file under `design/`, run `just bundle-tokens` (or `bundle-icons`, `bundle-gallery`), and never edit a generated file.
