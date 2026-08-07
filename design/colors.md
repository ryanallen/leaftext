# Colors

> The 82 color names a theme is drawn from. This file is the list; the values live in `themes/`, one file per family.

A color is **themed**: 11 families each give it a value in light and in dark, so this file names them and says what each is for and never holds a value. Everything that is one value for the whole app — radii, the type scale, shadows — is in [tokens.md](tokens.md) instead.

`just bundle-tokens` compiles this into `LEAF_SEMANTIC_TOKEN_CONTRACT` in `src/theme.rs`, and `just check-tokens` fails when the two drift. The names here are written bare; the compiler adds the `--lt-` prefix, exactly as the theme files do.

**`Default` empty means the row is required.** 81 of the 82 are, and a family that misses one is refused at startup. A filled cell names another row here whose value the compiler copies when a family says nothing, so the row is one a family may set and usually does not — the copied value is written into the family's compiled block as its own hex, never as a pointer.

**A row here is the only way a color exists.** `theme.rs` emits a custom property for any row it finds in a theme file, so a key no longer listed here would become dead CSS in every theme — `check-tokens` fails on that instead. Adding a color means adding a row here *and* a row in all 11 theme files; the startup check refuses a family that misses one.

## Core

The window, its chrome, and the roles a control can take.

| Token | Default | What it is for |
| --- | --- | --- |
| background |  | The window behind everything. |
| foreground |  | Text on that window. |
| surface |  | Every piece of app chrome: the app bar, the library pane, its bands, the search field. One shade, so no two of them meet at a tone seam. |
| surface-elevated |  | A control sitting on the chrome — a settings row's field, a button's rest state. |
| surface-muted |  | A tinted panel inside the reading view: the outline, a diagram's cell, a table head. |
| surface-sunken |  | A recess inside a panel: a subgraph's fill, an alternating band. |
| border |  | Every hairline in the app that is not asking to be noticed. |
| border-strong |  | The hairline that is: a focused field, a divider that has to carry weight. |
| muted-foreground |  | Secondary text, icons at rest, anything that must read as quieter than the body. |
| hover-tint | muted-foreground | The ink every hover fill is mixed from, so a row under the pointer lightens on a dark family and darkens on a light one. Set it to run hovers in a hue of your own; leave it out and the quiet-text color is copied in. |
| primary |  | The action color: a filled button, the active tab's mark, the accent the app is recognized by. |
| primary-foreground |  | What prints on `primary`. |
| accent |  | A second highlight for state that is not an action — a matched search hit, a selected row. |
| accent-foreground |  | What prints on `accent`. |
| danger |  | Destructive and failed: a delete, an error line, a broken link. |
| danger-foreground |  | What prints on `danger`. |
| warning |  | Something needs attention but nothing has failed. |
| success |  | Done and healthy. |
| success-foreground |  | What prints on `success`. |
| done |  | Finished and no longer active — a closed issue, a completed bar. |
| link |  | A link at rest, in the interface as well as in a document. |
| link-hover |  | The same link under the pointer. |
| focus-ring |  | The ring around whatever has keyboard focus. |
| focus-selection-background |  | Selected text's fill. |
| focus-selection-foreground |  | Selected text itself. |

## Document

The rendered page: its paper, its ink, and the parts of Markdown that carry their own color.

| Token | Default | What it is for |
| --- | --- | --- |
| markdown-background |  | The page the document is printed on. |
| markdown-foreground |  | Body text. |
| markdown-heading |  | `h1`, and the base every other level is measured against. |
| markdown-heading-2 |  | `h2`. Set it equal to the base to keep one heading color. |
| markdown-heading-3 |  | `h3`. |
| markdown-heading-4 |  | `h4`. |
| markdown-heading-5 |  | `h5`. |
| markdown-heading-6 |  | `h6`. |
| markdown-rule |  | The line under a heading. |
| markdown-link |  | A link in a document. |
| markdown-blockquote-border |  | The bar down the left of a quote. |
| markdown-blockquote-foreground |  | The quote's own text, quieter than the body around it. |
| markdown-alert-note |  | The `> [!NOTE]` callout's accent. |
| markdown-alert-tip |  | `> [!TIP]`. |
| markdown-alert-important |  | `> [!IMPORTANT]`. |
| markdown-alert-warning |  | `> [!WARNING]`. |
| markdown-alert-caution |  | `> [!CAUTION]`. |
| markdown-badge-background |  | A shields.io-style badge's fill, and the button forms a document can ask for. |
| markdown-badge-foreground |  | What prints on it. |
| markdown-table-border |  | A table cell's hairline. |
| markdown-table-header-background |  | The header row's fill. |
| markdown-thematic-break |  | A `---` rule. |
| markdown-math-inline-background |  | The tint behind inline math, so a formula reads as set apart from the sentence. |
| markdown-keyboard-background |  | A `<kbd>` key's face. |
| markdown-keyboard-border |  | Its edge. |

## Code

Inline code and fenced blocks, in the reading view and in the code view alike.

| Token | Default | What it is for |
| --- | --- | --- |
| editor-inline-code-background |  | The tint behind `` `code` `` in a sentence. |
| editor-inline-code-foreground |  | That code's own ink. |
| editor-code-background |  | A fenced block's surface. |
| editor-code-foreground |  | Its default ink, for anything the highlighter did not claim. |
| editor-code-border |  | Its edge. |
| editor-code-selection-background |  | Selected text inside a block or the editor. |
| editor-code-selection-foreground |  | That text itself. |

## Syntax

One color per syntactic role. The reading view spends them through the `.syn-` rules; the code view builds a Monaco theme from the same list, so one palette dresses both.

| Token | Default | What it is for |
| --- | --- | --- |
| syntax-background |  | The highlighter's own surface, where it differs from the block's. |
| syntax-foreground |  | Text with no more specific role. |
| syntax-comment |  | Comments. |
| syntax-keyword |  | Keywords. |
| syntax-string |  | String literals. |
| syntax-number |  | Numbers, and the other literals that read as values. |
| syntax-function |  | A called or defined name. |
| syntax-variable |  | A bound name. |
| syntax-type |  | A type, class or trait name. |
| syntax-operator |  | Operators. |
| syntax-punctuation |  | Brackets, commas, the structure around the words. |
| syntax-inserted |  | An added line's text in a diff. |
| syntax-inserted-background |  | Its fill. |
| syntax-deleted |  | A removed line's text. |
| syntax-deleted-background |  | Its fill. |
| syntax-changed |  | A changed line's text. |
| syntax-changed-background |  | Its fill. |

## Navigation

The controls that move between documents, and the recent-files list.

| Token | Default | What it is for |
| --- | --- | --- |
| navigation-button-hover-background |  | A chrome button under the pointer — including the tab's close cross, which reuses it. |
| navigation-button-disabled-background |  | The same button with nowhere to go. |
| navigation-button-disabled-foreground |  | Its glyph, dimmed to match. |
| navigation-recent-border |  | The line above the recent-files list on the home screen. |
| navigation-recent-item-foreground |  | A recent file's name. |
| navigation-recent-item-hover-foreground |  | The same name under the pointer. |

## Minimap

The rail beside the page. The thumbnail in it is a real-text clone of the document, so there are no per-line-kind colors — only the box that shows where you are.

| Token | Default | What it is for |
| --- | --- | --- |
| minimap-viewport-border |  | The viewport box's edge. |
| minimap-viewport-background |  | Its fill, faint enough to read the page through. |
