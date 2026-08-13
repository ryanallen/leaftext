<!-- Generated from design/ by `just bundle-design-docs`. Do not edit. -->
# Design system

> Every value in Leaftext's interface comes from a token. 82 of them are colors, which each theme sets for itself; 155 are everything else, one value for the whole app. Nothing is written by hand, and a check fails the build when something is.

Four files under `design/` are the source. Each is plain Markdown, so Leaftext opens them.

| File | Holds | Compiles to |
| --- | --- | --- |
| `design/colors.md` | 82 color names and what each is for — no values, because a color's value belongs to a theme | the token contract in `src/theme.rs` |
| `design/tokens.md` | 155 values that do not change with the theme | `src/assets/tokens.css` |
| `design/icons.md` | 60 icons | `src/assets/icons.css`, one mask class each |
| `design/components.md` | 64 components, and the markup each is drawn with | `src/assets/gallery.html` |

## Colors

Grouped by what they dress. Every one of the 11 theme families gives 81 of them a value, in light and in dark, and the app refuses to start if one is missing. The last is optional: leave it out and the compiler copies the value of the color named beside it, so a family only says what it wants to differ.

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
| Document type | 27 |
| Interface text | 11 |
| Interface weight | 5 |
| Stroke | 6 |
| Line height | 8 |
| Letter spacing | 6 |
| Opacity | 12 |
| Spacing | 13 |
| Duration | 16 |
| Easing | 8 |
| Layers | 10 |
| Strokes, rings and one recess | 6 |
| Grain | 6 |
| Fixed colors | 5 |
| Fixed tints | 4 |
| The hover wash | 1 |
| Inset edges | 3 |

Widths, heights and positional offsets are **not** tokens: they are one component's geometry, used once, and a name for each would buy nothing. Nor is a document's `em` sizing, which follows the text on purpose.

## Icons

60 icons, each a class drawn with `mask-image`. A mask reads only transparency, so the icon takes the color of whatever it sits in — and a drawing used in five places is in the app once. A control with a bolder active state swaps to a second mask rather than thickening a stroke a mask does not have. Each row also names the pack its drawing came from, so a pack with no license notice in the app is refused, and its line weight names the box the drawing must be in.

## Components

64 components. Each row names its class family, what builds it, and the markup the gallery draws it with — so a component that loses its styling, or gains a class nobody listed, fails the build.

| Component | Class family |
| --- | --- |
| App surface | `.app-surface` |
| App bar | `.app-bar` |
| Tab strip | `.tab` |
| Tab favorite heart | `.tab-favorite` |
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
| Library search | `.library-search-clear` |
| Search results | `.library-hit` |
| File type badge | `.file-type-badge` |
| Filter completion | `.filter-menu` |
| Understood filter | `.library-search-note` |
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
| Confirmation | `.confirm-dialog` |
| Spinner | `.lt-spinner` |
| Icon | `.lt-icon` |
| Scroll area | `.leaf-scroll` |
| Table lane | `.table-lane` |
| Toast | `.app-toast` |
| First-run bubble | `.hint-bubble` |
| Vault introduction | `.library-intro` |
| Reader tool bar | `.reader-tool` |
| Window controls | `.window-control` |
| Empty state | `.empty-state` |
| Start screen vault switcher | `.home-vault-switch` |
| Home list row | `.home-row` |
| Home lists | `.home-list` |
| Show all | `.home-showall` |
| Home list sheet | `.home-sheet` |
| Reader frame | `.reader-shell` |
| Diagram controls | `.mermaid-tool` |
| Full-window diagram | `.diagram` |
| Full-window table | `.table-sheet` |
| Editable fields | `.frontmatter-input` |
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
| `check-icons` | `icons.css` has drifted, a row names a file that is not there, an SVG has no row, a row names no pack or one with no license notice, a drawing is in a box its weight was not set for, or two rows compile to the same mask |
| `check-gallery` | the gallery has drifted, or a component has no sample to draw it with |
| `check-classes` | a class in `reading.css` is not accounted for — as a component, as something a rendered document brings, or as a state |
| `check-design-docs` | this page has drifted from `design/` |
| `check-verify` | one of these checks is not in `just verify` |
| `check-literals` | a color, spacing, text size, weight, stroke, line height, letter spacing, opacity, duration, easing, shadow or layer is written by hand in `reading.css` |
| `check-themes` | the embedded theme bundle has drifted from `themes/` |

To change a value: edit the file under `design/`, run `just bundle-tokens` (or `bundle-icons`, `bundle-gallery`), and never edit a generated file.
