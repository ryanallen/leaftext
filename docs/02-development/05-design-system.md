<!-- Generated from design/ by `just bundle-design-docs`. Do not edit. -->
# Design system

> Every value in Leaftext's interface comes from a token. 81 of them are colors, which each theme sets for itself; 158 are everything else, one value for the whole app. Nothing is written by hand, and a check fails the build when something is.

Four files under `design/` are the source. Each is plain Markdown, so Leaftext opens them.

| File | Holds | Compiles to |
| --- | --- | --- |
| `design/colors.md` | 81 color names and what each is for — no values, because a color's value belongs to a theme | the token contract in `src/theme.rs` |
| `design/tokens.md` | 158 values that do not change with the theme | `src/assets/tokens.css` |
| `design/icons.md` | 56 icons | `src/assets/icons.css`, one mask class each |
| `design/components.md` | 46 components, and the markup each is drawn with | `src/assets/gallery.html` |

## Colors

Grouped by what they dress. Every one of the 11 theme families gives all 81 a value, in light and in dark, and the app refuses to start if one is missing.

| Group | Colors |
| --- | --- |
| Core | 24 |
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
| Strokes, rings and one recess | 6 |
| Grain | 5 |
| Fixed colors | 5 |
| Fixed tints | 4 |
| Inset edges | 3 |

Widths, heights and positional offsets are **not** tokens: they are one component's geometry, used once, and a name for each would buy nothing. Nor is a document's `em` sizing, which follows the text on purpose.

## Icons

56 icons, each a class drawn with `mask-image`. A mask reads only transparency, so the icon takes the color of whatever it sits in — and a drawing used in five places is in the app once. A control with a bolder active state swaps to a second mask rather than thickening a stroke a mask does not have.

## Components

46 components. Each row names its class family, what builds it, and the markup the gallery draws it with — so a component that loses its styling, or gains a class nobody listed, fails the build.

| Component | Class family |
| --- | --- |
| App bar | `.app-bar` |
| Tab strip | `.tab` |
| Overflow menu | `.app-actions` |
| Icon button | `.icon-button` |
| Brand button | `.brand-button` |
| History button | `.history-button` |
| Theme button | `.theme-button` |
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
| Find bar | `.find` |
| Code view | `.code` |
| Pinned headings | `.code-sticky` |
| Copy button | `.code-copy` |
| Graph | `.reader-graph` |
| Flow canvas | `.flow` |
| Theme card | `.theme-item` |
| Update bell | `.update` |
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
| Reader frame | `.reader-shell` |
| Diagram controls | `.mermaid-tool` |
| Syntax colors | `.syn` |

## Looking at it

[**leaftext.com/gallery.html**](https://leaftext.com/gallery.html) draws all of it on one page — every theme, every color, every value, every icon, and every part of the interface — with a switcher for the family and for light or dark.

`just bundle-gallery` builds it from the four files above plus the app's own compiled stylesheet, which it gets by running the binary with `--dump-css`. The theme compiler is Rust, and a second one written in JavaScript would drift from it inside a week.

It is a page in the repo, not a feature in the app: looking at every component is a job for whoever is building Leaftext, so it has no place in a reader's settings menu.

## Keeping it

`just verify` runs all of these. Each fails with the file and the line.

| Check | Fails when |
| --- | --- |
| `check-tokens` | a generated token file has drifted from `design/`, a theme sets a color nothing lists, or a component row names a class family nothing styles |
| `check-icons` | `icons.css` has drifted, a row names a file that is not there, or an SVG has no row |
| `check-gallery` | the gallery has drifted, or a component has no sample to draw it with |
| `check-classes` | a class in `reading.css` is not accounted for — as a component, as something a rendered document brings, or as a state |
| `check-design-docs` | this page has drifted from `design/` |
| `check-verify` | one of these checks is not in `just verify` |
| `check-literals` | a color, spacing, text size, weight, stroke, line height, letter spacing, opacity, duration, easing, shadow or layer is written by hand in `reading.css` |
| `check-themes` | the embedded theme bundle has drifted from `themes/` |

To change a value: edit the file under `design/`, run `just bundle-tokens` (or `bundle-icons`, `bundle-gallery`), and never edit a generated file.
