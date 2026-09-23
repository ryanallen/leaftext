# Files and formats

> Formats, books, email, Office files, encodings and safety

## Opens

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Markdown files | [✅][l-md] | [✅][o-formats] | [✅][t-files] | [❌][c-conv] |
| HTML pages | [✅][l-html] | [❌][o-formats] | — | [❌][c-faq] |
| XML files | [✅][l-anyxml] | [❌][o-formats] | — | — |
| TEI editions | [✅][l-tei] | [❌][o-formats] | — | — |
| JSON files | [✅][l-data] | [❌][o-formats] | — | — |
| YAML files | [✅][l-data] | [❌][o-formats] | — | — |
| INI config files | [✅][l-ini] | [❌][o-formats] | — | — |
| Plain text files | [✅][l-plain] | [❌][o-formats] | [✅][t-files] | [❌][c-faq] |
| Saved email | [✅][l-eml] | [❌][o-formats] | — | — |
| Web archives | [✅][l-eml] | [❌][o-formats] | — | — |
| **Word documents** | [✅][l-office] | [❌][o-formats] | [❌][t-pandoc] | [❌][c-faq] |
| Excel workbooks | [✅][l-office] | [❌][o-formats] | — | — |
| PowerPoint decks | [✅][l-office] | [❌][o-formats] | — | — |
| OpenDocument files | [✅][l-office] | [❌][o-formats] | [❌][t-pandoc] | [❌][c-faq] |
| **EPUB books** | [✅][l-epub] | [❌][o-formats] | [❌][t-pandoc] | [✅][c-viewer] |
| TypeScript files | [✅][l-source] | [❌][o-formats] | — | — |
| JavaScript files | [✅][l-source] | [❌][o-formats] | — | — |
| JSON with comments | [✅][l-source] | [❌][o-formats] | — | — |
| CSS stylesheets | [✅][l-source] | [❌][o-formats] | — | — |
| Shell scripts | [✅][l-source] | [❌][o-formats] | — | — |
| TOML config files | [✅][l-source] | [❌][o-formats] | — | — |
| Rust source files | [✅][l-source] | [❌][o-formats] | — | — |
| Python source files | [✅][l-source] | [❌][o-formats] | — | — |
| SQL scripts | [✅][l-source] | [❌][o-formats] | — | — |
| Diff files | [✅][l-source] | [❌][o-formats] | — | — |
| Dotenv files | [✅][l-source] | [❌][o-formats] | — | — |
| GraphQL schemas | [✅][l-source] | [❌][o-formats] | — | — |
| Docker build files | [✅][l-source] | [❌][o-formats] | — | — |
| Extensionless text files | [✅][l-rendering] | [❌][o-formats] | ? | — |
| UTF-8, UTF-16, UTF-32 | [✅][l-enc] | ? | ? | ? |
| Keeps its encoding | [✅][l-enc] | ? | ? | — |

## EPUB books

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Book as one page | [✅][l-epub] | — | — | ? |
| Chapters in reading order | [✅][l-epub] | — | — | ? |
| Linked contents page | [✅][l-epub] | — | — | [✅][c-viewer] |
| Chapter headings from contents | [✅][l-epub] | — | — | ? |
| Title and author byline | [✅][l-epub] | — | — | ? |
| Pictures from the book | [✅][l-epub] | — | — | [✅][c-viewer] |
| SVG covers shown | [✅][l-epub] | — | — | ? |
| Publisher styles, your theme | [✅][l-epub] | — | — | ? |
| Small caps and superscripts | [✅][l-epub] | — | — | ? |
| Hidden parts stay hidden | [✅][l-epub] | — | — | ? |
| No network on open | [✅][l-epub] | — | — | ? |
| Web and email links | [✅][l-epub] | — | — | ? |
| Book scripts never run | [✅][l-epub] | — | — | ? |
| Damaged book explained | [✅][l-epub] | — | — | ? |
| Encrypted book named | [✅][l-epub] | — | — | ? |
| Obfuscated fonts read | [✅][l-epub] | — | — | ? |
| Picture-heavy books drawn | [✅][l-epub] | — | — | ? |
| Outline, minimap, find, pager | [✅][l-epub] | — | — | ? |

## Book details

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| NCX and nav headings | [✅][l-epub] | — | — | ? |
| Publisher classes mapped | [✅][l-epub] | — | — | ? |
| Inline styles mapped | [✅][l-epub] | — | — | ? |
| Byline skips drop cap | [✅][l-epub] | — | — | ? |
| Empty chapters skipped | [✅][l-epub] | — | — | ? |
| SVG covers kept | [✅][l-epub] | — | — | ? |
| Comic pages drawn once | [✅][l-epub] | — | — | ? |
| Books open on cover | [✅][l-epub] | — | — | ? |
| First page at top | [✅][l-epub] | — | — | ? |
| Every chapter outlined | [✅][l-epub] | — | — | [✅][c-viewer] |
| Word counts in cards | [✅][l-hints] | ? | — | — |
| Slide lists and tables | [✅][l-office] | — | — | — |
| Removed bullets drawn plain | [✅][l-office] | — | — | — |
| OpenDocument list openings | [✅][l-office] | — | — | — |
| Cards only when cramped | [✅][l-tables] | ? | ? | — |
| Labels on bars | [✅][l-bars] | — | — | — |

## Plain text

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Kept exactly as typed | [✅][l-plain] | — | ? | ? |
| Copy button | [✅][l-plain] | — | ? | — |
| Offered, never default | [✅][l-plain] | — | ? | — |

## INI files

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Sections as headings | [✅][l-ini] | — | — | — |
| Keys as labels | [✅][l-ini] | — | — | — |
| Clickable link values | [✅][l-ini] | — | — | — |
| Comments shown in source | [✅][l-ini] | — | — | — |
| First equals sign splits | [✅][l-ini] | — | — | — |
| Title key heads page | [✅][l-ini] | — | — | — |
| Repeated keys in order | [✅][l-ini] | — | — | — |
| Keys keep their spelling | [✅][l-ini] | — | — | — |
| Edit keys in place | [✅][l-ini] | — | — | — |
| Saved as written | [✅][l-ini] | — | — | — |

## Source files

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| File name heading | [✅][l-source] | — | — | — |
| Theme syntax colors | [✅][l-source] | — | — | — |
| Language badge shown | [✅][l-source] | — | — | — |
| Copy button | [✅][l-source] | — | — | — |
| Kept out of search | [✅][l-source] | — | — | — |

## XML

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Any XML document | [✅][l-anyxml] | — | — | — |
| TEI found by content | [✅][l-tei] | — | — | — |
| Plists, XHTML, DocBook | [✅][l-anyxml] | — | — | — |
| Parse errors located | [✅][l-anyxml] | — | — | — |
| Fields as labels | [✅][l-anyxml] | — | — | — |
| Records as tables | [✅][l-anyxml] | — | — | — |
| Elements as sections | [✅][l-anyxml] | — | — | — |
| Tag names as words | [✅][l-anyxml] | — | — | — |
| URLs become links | [✅][l-anyxml] | — | — | — |
| Sitemaps as tables | [✅][l-anyxml] | — | — | — |
| RSS and Atom feeds | [✅][l-anyxml] | — | — | — |
| Maven POM files | [✅][l-anyxml] | — | — | — |
| File name as title | [✅][l-anyxml] | — | — | — |
| Comments fold open | [✅][l-anyxml] | — | — | — |
| Comments editable in place | [✅][l-anyxml] | — | — | — |

## TEI

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Main and long titles | [✅][l-tei] | — | — | — |
| Sanskrit titles italicized | [✅][l-tei] | — | — | — |
| Front matter folded | [✅][l-tei] | — | — | — |
| Divisions as headings | [✅][l-tei] | — | — | — |
| Verse stanzas quoted | [✅][l-tei] | — | — | — |
| Endnotes as footnotes | [✅][l-tei] | — | — | — |
| Cross-references linked | [✅][l-tei] | — | — | — |

## JSON and YAML

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Data as a page | [✅][l-data] | — | — | — |
| Keys as labels | [✅][l-data] | — | — | — |
| Record lists as tables | [✅][l-data] | — | — | — |
| Nested keys as sections | [✅][l-data] | — | — | — |
| Keys read as words | [✅][l-data] | — | — | — |
| Title key heads page | [✅][l-data] | — | — | — |
| Keys in file order | [✅][l-data] | — | — | — |
| Numbers kept as written | [✅][l-data] | — | — | — |
| JSON comments allowed | [✅][l-data] | — | — | — |
| YAML anchors and aliases | [✅][l-data] | — | — | — |
| YAML merge keys | [✅][l-data] | — | — | — |
| Multi-document YAML table | [✅][l-data] | — | — | — |
| Alias bombs refused | [✅][l-data] | — | — | — |
| Parse errors name line | [✅][l-data] | — | — | — |
| Deep nesting refused | [✅][l-data] | — | — | — |
| Edit JSON values | [✅][l-data] | — | — | — |
| Edit YAML values | [✅][l-data] | — | — | — |

## HTML pages

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Page's own CSS | [✅][l-html] | — | — | — |
| Own dark theme kept | [✅][l-html] | — | — | — |
| Tab uses page title | [✅][l-html] | — | — | — |
| No scripts or forms | [✅][l-html] | — | — | — |
| Network addresses blocked | [✅][l-html] | — | — | — |
| Own folder only | [✅][l-html] | — | — | — |
| Find and outline inside | [✅][l-html] | — | — | — |
| Select and follow links | [✅][l-html] | — | — | — |
| Exports whole page | [✅][l-html] | — | — | — |
| Mermaid inside HTML | [✅][l-html] | — | — | — |
| Scroll kept across tabs | [✅][l-html] | — | — | — |
| Source edits redraw live | [✅][l-html] | — | — | — |
| Hidden panels stay hidden | [✅][l-html] | — | — | — |
| Saved pages keep theme | [✅][l-html] | — | — | — |
| Sprite icons drawn | [✅][l-html] | — | — | — |

## Email

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Subject as heading | [✅][l-eml] | — | — | — |
| Addresses as mail links | [✅][l-eml] | — | — | — |
| HTML body sanitized | [✅][l-eml] | — | — | — |
| Plain body with links | [✅][l-eml] | — | — | — |
| Inline images shown | [✅][l-eml] | — | — | — |
| Attachments with sizes | [✅][l-eml] | — | — | — |
| Routing headers hidden | [✅][l-eml] | — | — | — |
| No network reached | [✅][l-eml] | — | — | — |
| Mail forms dropped | [✅][l-eml] | — | — | — |
| Any legacy charset | [✅][l-eml] | — | — | — |
| Edit mail in place | [✅][l-eml] | — | — | — |
| Exact editable ranges | [✅][l-eml] | — | — | — |
| Controls dropped whole | [✅][l-eml] | — | — | — |
| Images from cid parts | [✅][l-eml] | — | — | — |
| Readable attachment sizes | [✅][l-eml] | — | — | — |
| Line endings kept | [✅][l-eml] | — | — | — |
| Eight-bit legacy bodies | [✅][l-eml] | — | — | — |

## Office files

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Word headings and paragraphs | [✅][l-office] | — | — | — |
| Eight bullet levels | [✅][l-office] | — | — | — |
| Word tables drawn | [✅][l-office] | — | — | — |
| Every sheet as table | [✅][l-office] | — | — | — |
| Every slide drawn | [✅][l-office] | — | — | — |
| Master slide bullets | [✅][l-office] | — | — | — |
| Untitled slides titled | [✅][l-office] | — | — | — |
| Macros never run | [✅][l-office] | — | — | — |
| Oversized parts refused | [✅][l-office] | — | — | — |
| Only words written back | [✅][l-office] | — | — | — |
| Styles and comments kept | [✅][l-office] | — | — | — |
| Type on first sheet | [✅][l-office] | — | — | — |
| Accent bar marks typing | [✅][l-office] | — | — | — |
| Type in Word paragraphs | [✅][l-office] | — | — | — |
| Type in spreadsheet cells | [✅][l-office] | — | — | — |
| Part XML in source | [✅][l-office] | — | — | — |
| No sign-in needed | [✅][l-office] | — | — | — |
| One zip reader | [✅][l-office] | — | — | — |
| Every zip member kind | [✅][l-office] | — | — | — |
| Unpacked only when read | [✅][l-office] | — | — | — |
| Oversized members refused | [✅][l-office] | — | — | — |
| Untouched parts copied exactly | [✅][l-office] | — | — | — |
| Word numbering read | [✅][l-office] | — | — | — |
| Removed bullets drawn plain | [✅][l-office] | — | — | — |
| Repeated cells capped | [✅][l-office] | — | — | — |
| Layout and master bullets | [✅][l-office] | — | — | — |
| Picture bullets drawn | [✅][l-office] | — | — | — |
| Titles from placeholders | [✅][l-office] | — | — | — |
| Excel shared strings | [✅][l-office] | — | — | — |
| Cells saved inline | [✅][l-office] | — | — | — |

## Encodings

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Byte order marks | [✅][l-enc] | ? | ? | — |
| Both byte orders | [✅][l-enc] | ? | ? | — |
| Mark kept on save | [✅][l-enc] | ? | ? | — |
| Windows-1252 fallback | [✅][l-enc] | ? | ? | — |
| Binary files refused | [✅][l-enc] | ? | ? | — |
| Unknown extensions named | [✅][l-enc] | ? | ? | — |
| Invisible marks handled | [✅][l-enc] | ? | ? | — |
| Four-byte marks first | [✅][l-enc] | ? | ? | — |
| Zero byte means binary | [✅][l-enc] | ? | ? | — |
| Extensionless files tested | [✅][l-rendering] | ? | ? | — |
| Unsavable characters named | [✅][l-enc] | ? | ? | — |
| Unreadable file explained | [✅][l-enc] | ? | ? | — |

## Safety

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| YAML bomb refused early | [✅][l-data] | ? | ? | — |
| Zip bombs refused | [✅][l-office] | — | — | ? |
| Columns past XFD refused | [✅][l-office] | — | — | — |
| Rows capped at 16,384 | [✅][l-office] | — | — | — |
| Encrypted books named | [✅][l-epub] | — | — | ? |
| Book paths contained | [✅][l-epub] | — | — | ? |
| Books size-capped | [✅][l-epub] | — | — | ? |
| Fallback chains bounded | [✅][l-rendering] | ? | ? | ? |
| Saved-page SVG icons | [✅][l-html] | — | — | — |

## How formats are read

| Feature | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| XHTML read as page | [✅][l-html] | — | — | — |
| Leaf extensions parsed | [✅][l-summary] | — | — | — |
| Bare addresses linked | [✅][l-autolinks] | [✅][o-ofm] | [✅][t-md] | — |
| Footnotes numbered by use | [✅][l-footnotes] | ? | ? | — |
| Picture sizes from headers | [✅][l-images] | ? | ? | — |
| False sizes ignored | [✅][l-images] | ? | ? | — |
| Alt text on hover | [✅][l-images] | ? | ? | — |
| Drive paths in links | [✅][l-autolinks] | ? | ? | — |
| Frontmatter problems said once | [✅][l-frontmatter] | ? | ? | — |
| Unknown cssclasses named | [✅][l-frontmatter] | ? | — | — |
| Colors stamped after sanitizing | [✅][l-badges] | — | — | — |
| Only note- classes | [✅][l-inline-html] | ? | ? | — |
| Pages keep theme attributes | [✅][l-html] | — | — | — |
| Wiki link length capped | [✅][l-wiki] | ? | — | — |

[l-rendering]: ../01-features/01-rendering.md
[l-summary]: ../01-features/01-rendering.md#summary
[l-md]: ../01-features/01-rendering.md#markdown
[l-html]: ../01-features/01-rendering.md#html-files
[l-anyxml]: ../01-features/01-rendering.md#any-xml
[l-tei]: ../01-features/01-rendering.md#tei-xml
[l-data]: ../01-features/01-rendering.md#data-files-json-and-yaml
[l-ini]: ../01-features/01-rendering.md#ini-files
[l-plain]: ../01-features/01-rendering.md#plain-text-files
[l-eml]: ../01-features/01-rendering.md#email-eml
[l-office]: ../01-features/01-rendering.md#office-and-opendocument-files
[l-epub]: ../01-features/01-rendering.md#epub-books
[l-source]: ../01-features/01-rendering.md#source-files
[l-enc]: ../01-features/01-rendering.md#file-encodings
[l-tables]: ../01-features/01-rendering.md#tables
[l-bars]: ../01-features/01-rendering.md#bars-leaf-extension
[l-badges]: ../01-features/01-rendering.md#badges-leaf-extension
[l-autolinks]: ../01-features/01-rendering.md#links-and-autolinks
[l-footnotes]: ../01-features/01-rendering.md#footnotes
[l-images]: ../01-features/01-rendering.md#images
[l-frontmatter]: ../01-features/01-rendering.md#frontmatter
[l-inline-html]: ../01-features/01-rendering.md#inline-html
[l-wiki]: ../01-features/01-rendering.md#wiki-links
[l-hints]: ../01-features/02-navigation.md#link-hints
[o-formats]: https://obsidian.md/help/file-formats
[o-ofm]: https://obsidian.md/help/obsidian-flavored-markdown
[t-files]: https://support.typora.io/File-Management/
[t-pandoc]: https://support.typora.io/Install-and-Use-Pandoc/
[t-md]: https://support.typora.io/Markdown-Reference/
[c-viewer]: https://manual.calibre-ebook.com/viewer.html
[c-faq]: https://manual.calibre-ebook.com/faq.html
[c-conv]: https://manual.calibre-ebook.com/conversion.html
