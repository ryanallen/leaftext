# Markdown and diagrams

> Markdown, tables, links, pictures, math and Mermaid

## Markdown

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| CommonMark syntax | [✅][l-md] | [✅][o-ofm] | ? | — |
| GitHub Flavored Markdown | [✅][l-md] | [✅][o-ofm] | [✅][t-md] | — |
| Six heading levels | [✅][l-headings] | [✅][o-syntax] | [✅][t-md] | — |
| Heading anchor links | [✅][l-headings] | [✅][o-links] | [✅][t-md] | — |
| Bold and italic | [✅][l-text] | [✅][o-syntax] | [✅][t-md] | — |
| Strikethrough text | [✅][l-text] | [✅][o-syntax] | [✅][t-md] | — |
| Inline code spans | [✅][l-text] | [✅][o-syntax] | [✅][t-md] | — |
| Hard line breaks | [✅][l-text] | [✅][o-syntax] | [✅][t-md] | — |
| Nested lists | [✅][l-lists] | [✅][o-syntax] | [✅][t-home] | — |
| Outline-style numbering | [✅][l-lists] | ? | ? | — |
| Nested blockquotes | [✅][l-quotes] | ? | [✅][t-md] | — |
| Hanging-indent quotes | [✅][l-quotes] | ? | ? | — |
| GitHub alert callouts | [✅][l-quotes] | [✅][o-callouts] | [✅][t-md] | — |
| Horizontal rules | [✅][l-rules] | [✅][o-syntax] | [✅][t-md] | — |
| Collapsible sections | [✅][l-collapsible] | ? | ? | — |
| Text in any language | [✅][l-language] | ? | ? | — |
| Footnotes with back-links | [✅][l-footnotes] | ? | ? | — |
| Emoji shortcodes | [✅][l-emoji] | ? | [✅][t-md] | — |
| Issue and PR links | [✅][l-github] | ? | ? | — |
| Cross-repository issue links | [✅][l-github] | ? | ? | — |
| Mentions and team mentions | [✅][l-github] | ? | ? | — |
| Hex strings stay text | [✅][l-github] | ? | ? | — |
| Inserted and highlighted text | [✅][l-inline-html] | ? | ? | — |
| Subscript and superscript | [✅][l-inline-html] | ? | [✅][t-md] | — |
| Keyboard key marks | [✅][l-inline-html] | ? | ? | — |
| Abbreviations with titles | [✅][l-inline-html] | ? | ? | — |
| Definition lists | [✅][l-inline-html] | ? | ? | — |
| Four text alignments | [✅][l-inline-html] | ? | ? | — |
| Author anchors by id | [✅][l-inline-html] | ? | ? | — |
| Line breaks with br | [✅][l-inline-html] | [✅][o-syntax] | [✅][t-md] | — |
| Scripts and iframes stripped | [✅][l-inline-html] | [❌][o-iframes] | [❌][t-html] | — |
| Accents through CJK | [✅][l-language] | ? | ? | — |
| Multi-byte safe editing | [✅][l-language] | ? | ? | — |

## Frontmatter

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Field table on top | [✅][l-frontmatter] | [✅][o-props] | ? | — |
| Six field types | [✅][l-frontmatter] | [✅][o-props] | ? | — |
| Obsidian field types read | [✅][l-frontmatter] | [✅][o-props] | — | — |
| Per-note field types | [✅][l-frontmatter] | [❌][o-props] | ? | — |
| Dates in either order | [✅][l-frontmatter] | ? | ? | — |
| Wide pages from cssclasses | [✅][l-frontmatter] | ? | — | — |
| Quoted items keep commas | [✅][l-frontmatter] | ? | ? | — |
| Broken frontmatter still renders | [✅][l-frontmatter] | ? | ? | — |
| Fields edited in place | [✅][l-frontmatter] | [✅][o-props] | ? | — |

## Code blocks

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Syntax highlighting | [✅][l-code] | [✅][o-syntax] | [✅][t-code] | — |
| Language badge shown | [✅][l-code] | ? | ? | — |
| Copy button | [✅][l-code] | ? | ? | — |
| Sideways scroll, badge pinned | [✅][l-code] | ? | ? | — |
| Twenty-plus languages | [✅][l-code] | [✅][o-syntax] | [✅][t-home] | — |

## Tables

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| GFM tables | [✅][l-tables] | [✅][o-adv] | [✅][t-tables] | — |
| Column alignment | [✅][l-tables] | [✅][o-adv] | [✅][t-tables] | — |
| Drag column widths | [✅][l-tables] | ? | ? | — |
| Drag row heights | [✅][l-tables] | ? | ? | — |
| Double-click resets size | [✅][l-tables] | ? | ? | — |
| Nested tables sized alone | [✅][l-tables] | ? | ? | — |
| Striped theme rows | [✅][l-tables] | ? | ? | — |
| Formula cells kept right | [✅][l-tables] | ? | ? | — |
| One-cell tables as cards | [✅][l-tables] | ? | ? | — |
| Table or card switch | [✅][l-tables] | ? | ? | — |
| Checkbox cells | [✅][l-tables] | ? | ? | — |
| Wide tables fill width | [✅][l-tables] | ? | ? | — |
| Faded sideways scroll | [✅][l-tables] | ? | ? | — |
| Ctrl-wheel sideways scroll | [✅][l-tables] | ? | ? | — |
| Narrow tables become cards | [✅][l-tables] | ? | ? | — |
| Small-capital card headings | [✅][l-tables] | ? | ? | — |
| Full-window tables | [✅][l-tables] | ? | ? | — |
| One-cell writes keep padding | [✅][l-edit-table] | ? | ? | — |
| Short rows not padded | [✅][l-edit-table] | ? | ? | — |
| Nested tables edit cells | [✅][l-edit-table] | ? | ? | — |
| Widened tables stay centered | [✅][l-tables] | ? | ? | — |
| Cards on muted lane | [✅][l-tables] | ? | ? | — |
| Plain card labels | [✅][l-tables] | ? | ? | — |
| Unheaded columns unlabeled | [✅][l-tables] | ? | ? | — |
| Modifier wheel scrolls sideways | [✅][l-tables] | ? | ? | — |
| Pinned widths never clip | [✅][l-tables] | ? | ? | — |
| Copy and expand buttons | [✅][l-tables] | ? | ? | — |
| Full-window glossary dimming | [✅][l-tables] | ? | ? | — |
| Sizes reset per document | [✅][l-tables] | ? | ? | — |

## Task lists

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Task checkboxes | [✅][l-tasks] | [✅][o-syntax] | [✅][t-md] | — |
| Task due dates | [✅][l-tasks] | ? | ? | — |
| Colored by due date | [✅][l-tasks] | ? | ? | — |
| Quick date menu | [✅][l-tasks] | ? | ? | — |
| Undo date changes | [✅][l-tasks] | ? | ? | — |
| Typed dates validated | [✅][l-tasks] | ? | ? | — |

## Links

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Inline and reference links | [✅][l-links] | ? | [✅][t-md] | — |
| In-page anchor links | [✅][l-links] | [✅][o-links] | [✅][t-md] | — |
| Bare URL autolinks | [✅][l-links] | [✅][o-ofm] | [✅][t-md] | — |
| Links to any file | [✅][l-links] | ? | [✅][t-files] | — |
| file:// links followed | [✅][l-links] | ? | ? | — |
| Asks before running programs | [✅][l-links] | ? | ? | — |
| Dead schemes shown dotted | [✅][l-links] | ? | ? | — |
| Wiki links drawn | [✅][l-wiki] | [✅][o-links] | ? | — |
| Wiki link display text | [✅][l-wiki] | [✅][o-links] | ? | — |
| Wiki links to headings | [✅][l-wiki] | [✅][o-links] | ? | — |
| Case-insensitive note names | [✅][l-wiki] | ? | ? | — |
| Aliases resolve links | [✅][l-wiki] | [✅][o-aliases] | ? | — |
| Missing note explained | [✅][l-wiki] | ? | ? | — |
| Hover note previews | [✅][l-hints] | [✅][o-preview] | ? | — |

## Buttons, badges and bars

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Buttons from braces | [✅][l-buttons] | ? | ? | — |
| Platform marks on buttons | [✅][l-buttons] | ? | ? | — |
| Buttons wrap apart | [✅][l-buttons] | ? | ? | — |
| Badges from inline code | [✅][l-badges] | ? | ? | — |
| Five badge tones | [✅][l-badges] | ? | ? | — |
| Custom hex badges | [✅][l-badges] | ? | ? | — |
| Four badge marks | [✅][l-badges] | ? | ? | — |
| Aligned status lists | [✅][l-badges] | ? | ? | — |
| Old badge spelling read | [✅][l-badges] | ? | ? | — |
| Plain code elsewhere | [✅][l-badges] | ? | ? | — |
| Badge from format bar | [✅][l-badges] | ? | ? | — |
| Badge from margin plus | [✅][l-badges] | ? | ? | — |
| Bar charts from lists | [✅][l-bars] | ? | ? | — |
| Amounts like 1.5M read | [✅][l-bars] | ? | ? | — |
| Shared scale per list | [✅][l-bars] | ? | ? | — |
| Percent bars drawn | [✅][l-bars] | ? | ? | — |
| Five colors or hex | [✅][l-bars] | ? | ? | — |
| Nested bar lists | [✅][l-bars] | ? | ? | — |
| Plain list elsewhere | [✅][l-bars] | ? | ? | — |
| Bars from margin plus | [✅][l-bars] | ? | ? | — |

## Figures and cards

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Titled framed figures | [✅][l-figures] | ? | ? | — |
| Figures edited in place | [✅][l-figures] | ? | ? | — |
| Figures from margin plus | [✅][l-figures] | ? | ? | — |
| Plain figure elsewhere | [✅][l-figures] | ? | ? | — |
| Cards side by side | [✅][l-cards] | ? | ? | — |
| Compact card rows | [✅][l-cards] | ? | ? | — |
| Cards stack when narrow | [✅][l-cards] | ? | ? | — |
| Figure cards drawn | [✅][l-cards] | ? | ? | — |
| Color swatch cards | [✅][l-cards] | ? | ? | — |
| Cards from margin plus | [✅][l-cards] | ? | ? | — |

## Pictures

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Relative and absolute paths | [✅][l-images] | ? | [✅][t-images] | — |
| Nine picture formats | [✅][l-images] | [❌][o-formats] | ? | — |
| Space held while loading | [✅][l-images] | ? | ? | — |
| Missing picture mark | [✅][l-images] | ? | ? | — |
| Live picture refresh | [✅][l-images] | ? | ? | — |
| Wide pictures fit | [✅][l-images] | ? | ? | — |
| Small pictures unscaled | [✅][l-images] | ? | ? | — |
| Full-window picture view | [✅][l-images] | ? | ? | [✅][c-viewer] |
| Picture export, five formats | [✅][l-images] | ? | ? | — |
| Export reuses copies | [✅][l-images] | ? | ? | — |
| Pictures never overwritten | [✅][l-images] | ? | ? | — |
| Export note opens file | [✅][l-images] | ? | ? | — |
| Picture right-click menu | [✅][l-images] | ? | ? | ? |
| Picture on dimmed ground | [✅][l-images] | ? | ? | ? |
| Fitted, never cropped | [✅][l-images] | ? | ? | ? |
| Close mark near corner | [✅][l-images] | ? | ? | ? |
| Escape or click closes | [✅][l-images] | ? | ? | ? |
| Always the live file | [✅][l-images] | ? | ? | — |

## Math

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Inline math | [✅][l-math] | [✅][o-adv] | [✅][t-md] | — |
| Display math blocks | [✅][l-math] | [✅][o-adv] | [✅][t-md] | — |

## Mermaid diagrams

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| **Mermaid diagrams** | [✅][l-mermaid] | [✅][o-adv] | [✅][t-diagrams] | — |
| Broken diagrams explained | [✅][l-mermaid] | ? | ? | — |
| Suggested diagram fixes | [✅][l-mermaid] | ? | ? | — |
| Nearby diagrams first | [✅][l-mermaid] | ? | ? | — |
| Place kept while drawing | [✅][l-mermaid] | ? | ? | — |
| Background diagram drawing | [✅][l-mermaid] | ? | ? | — |
| Find in undrawn diagrams | [✅][l-mermaid] | ? | ? | — |
| Theme-colored diagrams | [✅][l-mermaid] | ? | ? | — |
| Redrawn on theme change | [✅][l-mermaid] | ? | ? | — |
| Side-by-side bar series | [✅][l-mermaid] | ? | ? | — |
| Group titles unwrapped | [✅][l-mermaid] | ? | ? | — |
| Drag to pan | [✅][l-mermaid] | ? | ? | — |
| Ctrl-wheel and pinch zoom | [✅][l-mermaid] | ? | ? | — |
| Diagram zoom buttons | [✅][l-mermaid] | ? | ? | — |
| Fit and reset | [✅][l-mermaid] | ? | ? | — |
| Full-window diagrams | [✅][l-mermaid] | ? | ? | — |
| Diagram export, five formats | [✅][l-mermaid] | ? | ? | — |
| Swap to Mermaid text | [✅][l-mermaid] | ? | ? | — |
| Open in flowchart editor | [✅][l-mermaid] | ? | ? | — |
| Boxes as links | [✅][l-mermaid] | [✅][o-adv] | ? | — |
| App icons in boxes | [✅][l-mermaid] | ? | ? | — |
| Pictures in boxes | [✅][l-mermaid] | ? | ? | — |
| Diagram config lines | [✅][l-mermaid] | ? | ? | — |
| Failures stay separate | [✅][l-mermaid] | ? | ? | — |
| Stuck diagrams marked | [✅][l-mermaid] | ? | ? | — |
| Full view opens fitted | [✅][l-mermaid] | ? | ? | — |
| Focus returns afterward | [✅][l-mermaid] | ? | ? | — |
| Drawn heights remembered | [✅][l-mermaid] | ? | ? | — |
| Offscreen diagrams released | [✅][l-mermaid] | ? | ? | — |
| Clickable boxes when locked | [✅][l-mermaid] | ? | ? | — |
| Box icons never fetched | [✅][l-mermaid] | ? | ? | — |
| Bad box pictures marked | [✅][l-mermaid] | ? | ? | — |
| Box pictures from folder | [✅][l-mermaid] | ? | ? | — |
| Diagram PDF own page | [✅][l-mermaid] | ? | ? | — |
| JPEG up to 65,535 | [✅][l-mermaid] | ? | ? | — |
| WebP limit points PNG | [✅][l-mermaid] | ? | ? | — |
| Export from full view | [✅][l-mermaid] | ? | ? | — |
| Group titles get room | [✅][l-mermaid] | ? | ? | — |
| Broken source shown | [✅][l-mermaid] | ? | ? | — |
| Failures named by line | [✅][l-mermaid] | ? | ? | — |

[l-md]: ../01-features/01-rendering.md#markdown
[l-headings]: ../01-features/01-rendering.md#headings
[l-text]: ../01-features/01-rendering.md#text-formatting
[l-lists]: ../01-features/01-rendering.md#lists
[l-quotes]: ../01-features/01-rendering.md#blockquotes-and-alerts
[l-rules]: ../01-features/01-rendering.md#horizontal-rules
[l-collapsible]: ../01-features/01-rendering.md#collapsible-sections
[l-language]: ../01-features/01-rendering.md#text-in-any-language
[l-footnotes]: ../01-features/01-rendering.md#footnotes
[l-emoji]: ../01-features/01-rendering.md#emoji
[l-github]: ../01-features/01-rendering.md#github-references
[l-inline-html]: ../01-features/01-rendering.md#inline-html
[l-frontmatter]: ../01-features/01-rendering.md#frontmatter
[l-code]: ../01-features/01-rendering.md#code
[l-tables]: ../01-features/01-rendering.md#tables
[l-edit-table]: ../01-features/07-editing.md#editing-a-table
[l-tasks]: ../01-features/01-rendering.md#task-lists
[l-links]: ../01-features/01-rendering.md#links-and-autolinks
[l-wiki]: ../01-features/01-rendering.md#wiki-links
[l-hints]: ../01-features/02-navigation.md#link-hints
[l-buttons]: ../01-features/01-rendering.md#buttons-leaf-extension
[l-badges]: ../01-features/01-rendering.md#badges-leaf-extension
[l-bars]: ../01-features/01-rendering.md#bars-leaf-extension
[l-figures]: ../01-features/01-rendering.md#framed-figures-leaf-extension
[l-cards]: ../01-features/01-rendering.md#cards-across-the-page-leaf-extension
[l-images]: ../01-features/01-rendering.md#images
[l-math]: ../01-features/01-rendering.md#math
[l-mermaid]: ../01-features/01-rendering.md#mermaid-diagrams
[o-ofm]: https://obsidian.md/help/obsidian-flavored-markdown
[o-syntax]: https://obsidian.md/help/syntax
[o-adv]: https://obsidian.md/help/advanced-syntax
[o-links]: https://obsidian.md/help/links
[o-aliases]: https://obsidian.md/help/aliases
[o-preview]: https://obsidian.md/help/plugins/page-preview
[o-callouts]: https://obsidian.md/help/callouts
[o-props]: https://obsidian.md/help/properties
[o-iframes]: https://obsidian.md/help/embed-web-pages
[o-formats]: https://obsidian.md/help/file-formats
[t-home]: https://typora.io/
[t-md]: https://support.typora.io/Markdown-Reference/
[t-html]: https://support.typora.io/HTML/
[t-code]: https://support.typora.io/Code-Fences/
[t-tables]: https://support.typora.io/Table-Editing/
[t-files]: https://support.typora.io/File-Management/
[t-images]: https://support.typora.io/Images/
[t-diagrams]: https://support.typora.io/Draw-Diagrams-With-Markdown/
[c-viewer]: https://manual.calibre-ebook.com/viewer.html
