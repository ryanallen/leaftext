# Glossary

Every word Leaftext uses for a part of itself, in one file, alphabetically. Wherever one of these terms appears in a page, Leaftext links it for you; clicking the link opens that entry in a [bottom sheet](GLOSSARY.md#bottom-sheet) over the page you are reading, so you never leave the document. You can also link one by hand — `[minimap](GLOSSARY.md#minimap)` from a page in this folder, `[minimap](../GLOSSARY.md#minimap)` from a page one level down.

## Alias

Another name a note answers to, listed in its `aliases` [frontmatter](GLOSSARY.md#frontmatter) field. Every alias works wherever the file's own name works: a [wikilink](GLOSSARY.md#wikilink) resolves to it, the [graph view](GLOSSARY.md#graph-view) draws that edge, [vault search](GLOSSARY.md#vault-search) matches it, and [typing help](GLOSSARY.md#typing-help) offers it. A real file name always beats an alias, and a node on the map keeps its file's name. Thirty-two per note. See [Library](01-features/03-library.md#other-names).

## Alert

A block quote that opens with `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]` or `> [!CAUTION]`. It renders as a colored callout in the theme's own colors. Also called a callout. See [Rendering](01-features/01-rendering.md#blockquotes-and-alerts).

## App bar

The strip along the top of the window: the leaf mark, the [library pane](GLOSSARY.md#library-pane) button, Back and Forward, the [tab](GLOSSARY.md#tab) strip, then the palette that opens the [theme picker](GLOSSARY.md#theme-picker), Open and **+** at the right. There is no Settings button; the [update bell](GLOSSARY.md#update-bell) joins the right-hand group only while there is something to install. On Windows it is also the title bar — drag it to move the window, double-click it to maximize or restore. What it holds is about the app; what the [floating toolbar](GLOSSARY.md#floating-toolbar) holds is about the document.

## Appearance

Whether a [theme family](GLOSSARY.md#theme-family) shows its light or its dark variant. Four choices: System (follow the operating system), Light, Dark, and [Daylight](GLOSSARY.md#daylight).

## Autolink

A bare web address, `www.` name or email address in your text, turned into a working link without you writing the link syntax.

## Back and Forward

Movement through a [tab](GLOSSARY.md#tab)'s own history, like a browser. Each tab keeps its own — files you opened, and jumps you made inside a document.

## Block

One unit of a document: a paragraph, a heading, a list item, a table, a code fence, a quote. Blocks are what the [block gutter](GLOSSARY.md#block-gutter) moves, what [inline editing](GLOSSARY.md#inline-editing) edits one at a time, and what a [scroll anchor](GLOSSARY.md#scroll-anchor) points at.

## Block gutter

The live strip in the page's left margin. Hover it and two controls follow the line you are level with: a **handle** to drag a [block](GLOSSARY.md#block) somewhere else, and a **plus** that opens the [insert row](GLOSSARY.md#insert-row). Markdown and XML only. See [Editing](01-features/07-editing.md#the-block-gutter).

## Blockquote

Text marked with `>`, rendered with a left bar and a hanging indent. Nest them by adding more `>`. An [alert](GLOSSARY.md#alert) is a blockquote with a label.

## Bottom sheet

A panel that slides up over the reading view without taking you off the page — used for [glossary](GLOSSARY.md#glossary) entries and the [theme picker](GLOSSARY.md#theme-picker). Dismiss it with its close button, by clicking outside it, with `Escape`, or by dragging the grab bar at its top downwards.

## Breadcrumb

The folder path across the top of the [library pane](GLOSSARY.md#library-pane) — `Vajrayana › docs › features`. Click any crumb to step back to that level. What does not fit collapses into a `…` menu. The [sync button](GLOSSARY.md#sync-button) appears at its end.

## Byte order mark

A few bytes some editors write at the very start of a file to say how the rest is spelled. Leaftext reads it to pick the [file encoding](GLOSSARY.md#file-encoding), strips it from the text, and writes it back on save — so a file never quietly changes shape.

## Code block

A fenced run of code (```` ``` ````). Tag it with a language for [syntax highlighting](GLOSSARY.md#syntax-highlighting), a language badge, and a Copy button that appears on hover. Clicking into one in the [reading view](GLOSSARY.md#reading-view) hands you the code, never the fences.

## Code view

The document as its raw source — Markdown, XML, JSON, YAML or a raw email — colored, line-numbered and editable. Reach it from the [floating toolbar](GLOSSARY.md#floating-toolbar). It is [Monaco](GLOSSARY.md#monaco) underneath, and it edits every format Leaftext opens. See [Editing](01-features/07-editing.md#code-view).

## Collapsible section

A `<details>` / `<summary>` pair, folded away until you click it. Add `open` to start it expanded.

## CommonMark

The Markdown standard Leaftext parses. [GFM](GLOSSARY.md#gfm) is what it adds on top.

## Data file

A `.json`, `.yaml` or `.yml` file. Leaftext reads it as a page — headed sections, aligned fields, and record tables — by the same shape rules the generic [XML reader](GLOSSARY.md#xml-reader) uses. See [Rendering](01-features/01-rendering.md#data-files-json-and-yaml).

## Daylight

An [appearance](GLOSSARY.md#appearance) that shows the light variant between 09:00 and 18:00 local time and the dark variant otherwise.

## Email file

An `.eml`, `.mht` or `.mhtml` file — what Gmail, Outlook and Apple Mail export. Leaftext opens it as the message it carries: subject, address fields, the body, inline images and a list of attachments. Nothing in it reaches the network. See [Rendering](01-features/01-rendering.md#email-eml).

## Emoji shortcode

A GitHub-style name between colons — `:rocket:` — rendered as the emoji.

## File actions

The right-click menu in the [library pane](GLOSSARY.md#library-pane). On a file: Open, Cut, Copy, Copy path, Rename, Reveal file, Properties, Delete. On a folder or the empty space around it: Open folder, Paste, Reveal folder, Properties. Delete goes to the Recycle Bin or Trash, not away for good.

## File association

The registration that makes a file type carry the leaf icon and offer Leaftext under **Open with**. Installing claims every extension Leaftext reads, but never takes one another app already owns. See [Installation](02-installation.md#file-associations).

## File encoding

How a file spells its characters. Leaftext reads UTF-8, and UTF-16 or UTF-32 by their [byte order mark](GLOSSARY.md#byte-order-mark). **A file is saved back the way it was read.** See [Rendering](01-features/01-rendering.md#file-encodings).

## File tree

The [library pane](GLOSSARY.md#library-pane)'s file list — one folder at a time, with a row that steps back out and a [breadcrumb](GLOSSARY.md#breadcrumb) above it. Each click reads exactly one directory, so nothing below what you opened is ever touched.

## Floating toolbar

The small bar over the foot of the page. It holds the three views — [reading](GLOSSARY.md#reading-view), [code](GLOSSARY.md#code-view) and [graph](GLOSSARY.md#graph-view) — with the one you are in filled in the accent color, plus the [padlock](GLOSSARY.md#padlock), the [speed reader](GLOSSARY.md#speed-reader), the [typing help](GLOSSARY.md#typing-help) wand, [Undo](GLOSSARY.md#undo) and [Save](GLOSSARY.md#save). No document, no bar.

## Flowchart editor

A full-window sheet for drawing a [Mermaid](GLOSSARY.md#mermaid-diagram) flowchart instead of typing it: a canvas on the left, the Mermaid text on the right, each following the other. Open it from the [insert row](GLOSSARY.md#insert-row) or from the flowchart button on a diagram already in the page. Nothing is written until Save. See [Editing](01-features/07-editing.md#the-flowchart-editor).

## Footnote

A `[^name]` reference in the text with its definition collected at the foot of the page, each carrying a link back to where it was cited.

## Format bar

The small bar that appears over words you highlight in an unlocked page: bold, italic, strikethrough, code and link for the words, then text, a bigger or smaller heading, and quote for the whole [block](GLOSSARY.md#block). A button with nowhere to go grays out. See [Editing](01-features/07-editing.md#the-format-bar).

## Frontmatter

A leading `--- … ---` block of metadata at the top of a file. Leaftext renders it as a table above the document. Only the first block counts; a later `---` is a horizontal rule.

## GFM

GitHub Flavored Markdown — the tables, [task lists](GLOSSARY.md#task-list), strikethrough and [autolinks](GLOSSARY.md#autolink) that sit on top of [CommonMark](GLOSSARY.md#commonmark).

## GitHub sync

Pointing a [vault](GLOSSARY.md#vault) at a GitHub repository and pushing to it. Leaftext never holds a token — it runs the `git` already on your machine. [Sync](GLOSSARY.md#sync-button) commits, pulls with a rebase, and pushes. See [Library](01-features/03-library.md#github-sync).

## Glossary

The shared `GLOSSARY.md` this page is one of. Leaftext finds it by walking up from the open document, matches its terms in every format it renders, and links them for you — so one file defines the words for a whole set of documents. See [Navigation](01-features/02-navigation.md#glossary).

## Graph size

How much of your [vault](GLOSSARY.md#vault) the [graph view](GLOSSARY.md#graph-view) draws: **Focus** (the open document and its direct links), Medium, Large, or Everything. A labeled dropdown in the [floating toolbar](GLOSSARY.md#floating-toolbar), there only while the map is up. See [Settings](01-features/05-settings.md#graph-size).

## Graph view

A force-directed map of how your documents link to each other. Each **node** is a document or a [web address](GLOSSARY.md#web-address-node); each **edge** is a link that resolves, with an arrowhead at the document being linked to. Click a node to open it, drag to reposition, scroll to zoom. It needs a document open — not a [vault](GLOSSARY.md#vault). See [Library](01-features/03-library.md#graph).

## Home screen

What you see with no document open: **Choose file**, **New document**, and your [recent files](GLOSSARY.md#recent-files). Closing the last tab returns you here, and so does clicking the [leaf mark](GLOSSARY.md#leaf-mark).

## Image box

What the image button in the [insert row](GLOSSARY.md#insert-row) opens: **Choose file**, or a field for a web address. A picked file is never copied anywhere — the picture stays where you keep it, and the document records where that is.

## Inline editing

Editing the rendered page itself: click into a sentence and type, `Enter` to split a [block](GLOSSARY.md#block), `Backspace` at the start to merge it upward, click a checkbox to tick it. Every change is spliced back into the exact bytes it came from. See [Editing](01-features/07-editing.md#inline-editing-the-reading-view).

## Inline HTML

Raw HTML written in your Markdown. Leaftext keeps a curated set of safe tags — `<kbd>`, `<mark>`, `<sub>`, `<abbr>`, definition lists, `align` and `id` attributes — and strips the rest, keeping the inner text. `<script>`, event handlers and `javascript:` URLs never survive.

## Insert row

The row of block kinds that fans out when you press the plus in the [block gutter](GLOSSARY.md#block-gutter): text, heading, list, quote, code block, table, [image](GLOSSARY.md#image-box), [flowchart](GLOSSARY.md#flowchart-editor), divider. The first four open an empty block rather than writing one — nothing reaches the file until your first keystroke.

## Leaf button

A Leaftext addition to Markdown: wrap a whole link in braces and it renders as a button. `{[Label](url)}` is a ghost button, `{{…}}` an outline one, `{{{…}}}` filled.

## Leaf mark

The leaf at the left of the [app bar](GLOSSARY.md#app-bar). Click it to return to the [home screen](GLOSSARY.md#home-screen). It never folds into the [overflow menu](GLOSSARY.md#overflow-menu).

## Library pane

The pane down the left side: a [vault switcher](GLOSSARY.md#vault-switcher), a [breadcrumb](GLOSSARY.md#breadcrumb), a search box, and the [file tree](GLOSSARY.md#file-tree). Toggle it with the panel button in the [app bar](GLOSSARY.md#app-bar). See [Library](01-features/03-library.md).

## Library sheet

What the [library pane](GLOSSARY.md#library-pane) becomes on a window too narrow to hold both it and a readable page: a full-width sheet over the document, dismissed by picking something. It is a description of the current window, not a saved preference.

## Link hint

The tooltip that names what a link is — glossary term, in-page jump, another document, external site, email — and shows the address it was written with. On a link to another document it also shows how many lines that document is. Mouse only. See [Navigation](01-features/02-navigation.md#link-hints).

## Link menu

The right-click menu on a link in a document you are reading: Open, Open in new page, Copy link, Copy link text, Reveal file, Copy path. The three that need a document in this app to act on are left out on an outside link and on an in-page jump. Ctrl-click (Cmd on macOS) or a middle click is the same as **Open in new page** — the linked document opens as a [tab](GLOSSARY.md#tab) behind the one you are reading, so you keep your place. See [Navigation](01-features/02-navigation.md#opening-a-link-in-a-new-page).

## Live reload

Leaftext noticing a file changed on disk and re-rendering it without losing your place. It watches the folder rather than the file, so atomic-save editors work, and it recognizes its own [saves](GLOSSARY.md#save) so a save never bounces the view. A document with unsaved edits is never clobbered.

## Loading spinner

The spinner shown over the reader while a document or a view is being built. It covers opening a file, Back and Forward, switching tabs, and toggling the [code view](GLOSSARY.md#code-view). A safety timeout lowers it even if a response never arrives.

## Math

TeX between `$…$` for inline math and `$$…$$` for a displayed block, rendered offline.

## Mention

An `@name` in your text, highlighted; inside a Git repository it links to the person or team on GitHub. `#1` and `owner/repo#3` link to issues and pull requests the same way. Bare commit hashes are deliberately not linked.

## Mermaid diagram

A `mermaid` fenced [code block](GLOSSARY.md#code-block), drawn as a diagram by the bundled Mermaid runtime — fully offline, in your [theme's](GLOSSARY.md#theme-family) own colors and body font. Drag the drawing to move it inside its cell, and zoom with `Ctrl` and the wheel or the buttons in its corner. On an unlocked page two more buttons appear: one opens its text to edit, the other the [flowchart editor](GLOSSARY.md#flowchart-editor).

## Minimap

The slim rail down the right edge of the [reading view](GLOSSARY.md#reading-view). It is a real, scaled clone of the page — actual text, not abstract bars — so you can recognize a section by its shape. Click to jump, drag the [viewport indicator](GLOSSARY.md#viewport-indicator) to scroll. See [Minimap](01-features/04-minimap.md).

## Missing-image mark

The single glyph, drawn in the page's own ink, that stands where a picture Leaftext cannot find would be. Its alt text shows on hover, and it looks the same on both platforms. A file that later appears is picked up by the next refresh.

## Monaco

The editor Visual Studio Code is built on, compiled into Leaftext and used for the [code view](GLOSSARY.md#code-view). It brings selection, undo, clipboard, IME and the [typing help](GLOSSARY.md#typing-help) widgets, and it keeps a multi-megabyte file responsive by drawing only the lines on screen.

## New document

A blank page in a new [tab](GLOSSARY.md#tab), started with the **+** in the [app bar](GLOSSARY.md#app-bar) or on the [home screen](GLOSSARY.md#home-screen). It opens with the reading view's [padlock](GLOSSARY.md#padlock) off and the caret ready, is called [*Untitled*](GLOSSARY.md#untitled) until its first [save](GLOSSARY.md#save), and has no file until then.

## Notarization

Apple's paid check that lets macOS vouch for an app. Leaftext is free and not enrolled, so macOS refuses its first launch. Nothing was scanned and nothing was found — let it through once and it opens normally forever after. See [Installation](02-installation.md#mac-blocks-the-first-launch).

## Outline

The collapsed table of contents under a document's title, built from its headings and labeled with the document's line count. Click it to expand; click an entry to jump. It is the document's structure as text, where the [minimap](GLOSSARY.md#minimap) is a picture of it.

## Overflow menu

The chevron menu the [app bar](GLOSSARY.md#app-bar)'s buttons fold into as the [tab](GLOSSARY.md#tab) strip fills — trailing actions first, then Back and Forward, then the window controls. Tabs are never squeezed to make room. The [leaf mark](GLOSSARY.md#leaf-mark) and the [library pane](GLOSSARY.md#library-pane) button never fold.

## Padlock

The lock on the [floating toolbar](GLOSSARY.md#floating-toolbar) that says whether you can type into the view you are in. There are two — one for the [reading view](GLOSSARY.md#reading-view), one for the [code view](GLOSSARY.md#code-view) — and they are independent, so unlocking the page you read does not open the file's own text. Both start locked and both are remembered across restarts; a [new document](GLOSSARY.md#new-document) opens with the reading view's turned off for you. Checkboxes toggle either way.

## Pager

The **Previous / Next** bar at the foot of a document, for reading a folder in order. It appears where folders are connected by `README.md` files, and follows the same depth-first walk the docs site uses. On by default; switch it off in [Settings](01-features/05-settings.md#pager).

## Pinned headings

In the Markdown [code view](GLOSSARY.md#code-view), the headings you are reading under stay at the top edge as you scroll — the trail down to where you are, five rows at most. Each row is the real source line, and clicking it jumps there.

## Random

The last entry in the [theme picker](GLOSSARY.md#theme-picker). Not a palette but a preference: it draws a fresh [theme family](GLOSSARY.md#theme-family) at each launch, every family once before any repeats, and the rotation survives restarts.

## Reading view

The rendered document — the view Leaftext is for. Its two companions on the [floating toolbar](GLOSSARY.md#floating-toolbar) are the [code view](GLOSSARY.md#code-view) and the [graph view](GLOSSARY.md#graph-view).

## Recent files

The last 8 files you opened, listed on the [home screen](GLOSSARY.md#home-screen). Missing files drop off by themselves, and two spellings of one path collapse to a single entry.

## Save

Writing the buffer to your file, always explicitly. A green **Save** button (and `Ctrl+S` / `Cmd+S`) appears the moment the buffer differs from the file, and the [tab](GLOSSARY.md#tab) shows an [unsaved marker](GLOSSARY.md#unsaved-marker). There is no autosave — the one exception is ticking a checkbox, which saves on the spot. A [new document](GLOSSARY.md#new-document) is asked where to go on its first save.

## Scroll anchor

How Leaftext remembers a reading position: the nearest heading above the top edge, the [block](GLOSSARY.md#block) within that section, and a pixel offset. It survives a rerender, so images, diagrams and the [pager](GLOSSARY.md#pager) settling in cannot pull you away from the line you were reading.

## Settings

A plain JSON file on your machine, not a panel: there is nowhere to open. Every control stands where it applies — the palette in the [app bar](GLOSSARY.md#app-bar) for [theme](GLOSSARY.md#theme) and [appearance](GLOSSARY.md#appearance), the [graph view](GLOSSARY.md#graph-view)'s own toolbar for [graph size](GLOSSARY.md#graph-size) — and each one saves the moment you use it. See [Settings](01-features/05-settings.md).

## Single window

One Leaftext, however many times you launch it. Opening a file from Explorer or Finder while it is running adds a [tab](GLOSSARY.md#tab) to the window you already have and brings it to the front.

## Skipped folders

What browsing never descends into: hidden folders, `node_modules`, `target`, `vendor`, `dist`, `build`, `.venv`, `__pycache__`, the system folders at a drive root, and symlinks or Windows reparse points.

## Slug

The anchor id made from a heading — `Bottom Sheet` becomes `#bottom-sheet`. Headings get one automatically, which is what makes the [outline](GLOSSARY.md#outline), in-page links and glossary links land.

## Speed Reader

A way of reading, toggled from the [floating toolbar](GLOSSARY.md#floating-toolbar): the page dims back and bold anchors mark the start of each word, so your eye follows the path down instead of hunting for it. See [Settings](01-features/05-settings.md#speed-reader).

## Sync button

The button that appears at the end of a [vault](GLOSSARY.md#vault)'s [breadcrumb](GLOSSARY.md#breadcrumb) whenever there is work that has not reached GitHub, carrying the count. Absent when there is nothing to send. See [GitHub sync](GLOSSARY.md#github-sync).

## Syntax highlighting

Coloring a [code block](GLOSSARY.md#code-block) — and the whole [code view](GLOSSARY.md#code-view) — in the active [theme's](GLOSSARY.md#theme-family) own colors, so source looks like part of the app rather than a foreign editor dropped into it.

## Tab

One open document, with its own [Back and Forward](GLOSSARY.md#back-and-forward) history, its own scroll position, and its own edit buffer. Drag tabs to reorder them; `Ctrl+W` / `Cmd+W` closes one.

## Task list

A checkbox list — `- [ ]` and `- [x]`. The boxes are live: click one to tick it and it saves on the spot, even with editing locked. A table cell whose whole content is `[ ]` or `[x]` becomes a checkbox too.

## TEI

The XML format 84000 publishes Buddhist canon translations in. Leaftext gives it its own reader — titles, front matter as a collapsed section, nested divisions, verse as quoted stanzas, endnotes as [footnotes](GLOSSARY.md#footnote). See [Rendering](01-features/01-rendering.md#tei-xml-84000-translations).

## Theme family

A palette plus its type — eleven ship: Amaranth, Arabica, Bloodleaf, Fern, Ginger, GitHub, Goldenrod, Halcyon, Nightshade, Pippin and Sage. Each has a light and a dark variant, chosen by [appearance](GLOSSARY.md#appearance). Its font is fetched from Google Fonts the first time you pick it. See [Themes](01-features/06-themes.md).

## Theme picker

The [bottom sheet](GLOSSARY.md#bottom-sheet) the palette button in the [app bar](GLOSSARY.md#app-bar) opens. Every [family](GLOSSARY.md#theme-family) is a card wearing its own colors and type, with the [appearance](GLOSSARY.md#appearance) control at the top and [Random](GLOSSARY.md#random) at the end.

## Token contract

The set of `--lt-*` color and type names every [theme family](GLOSSARY.md#theme-family) must fill. It is checked when the theme CSS is compiled at launch, so a theme missing one fails loudly instead of rendering with broken fallback colors.

## Typing help

Suggestions while you write in the [code view](GLOSSARY.md#code-view), answered from your own notes: `[[` lists them, `[[Note#` lists that note's headings, `](#` lists the open document's anchors, hovering a [wikilink](GLOSSARY.md#wikilink) previews it, and a broken link gets a wavy underline. The wand on the [floating toolbar](GLOSSARY.md#floating-toolbar) turns it off.

## Undo

Stepping back through [inline edits](GLOSSARY.md#inline-editing), one at a time. An **Undo** button sits beside [Save](GLOSSARY.md#save) whenever there is a step to take back. A successful save clears the history, so undo never walks you below saved text.

## Unsaved marker

The dot beside a [tab](GLOSSARY.md#tab)'s name while its buffer differs from the file. It shares the corner with the close button, so a tab never changes size as the pointer crosses it.

## Untitled

What a [new document](GLOSSARY.md#new-document) is called before its first [save](GLOSSARY.md#save) — *Untitled 2* and so on when one is already open. The first save asks where to put it, and the tab takes the real name.

## Update bell

The bell in the [app bar](GLOSSARY.md#app-bar), there only when there is something to install: a spinning ring while the new version downloads, a green dot once a restart would install it. Clicking it opens one button — **Restart to update**. A check that found nothing, could not reach GitHub, or found a release with no installer for your platform says nothing at all, because there is nothing you could do about any of it. See [Installation](02-installation.md#updates).

## Vault

A folder you have told Leaftext to treat as a library root. It is what [search](GLOSSARY.md#vault-search) and [GitHub sync](GLOSSARY.md#github-sync) work over, and what makes the [graph view](GLOSSARY.md#graph-view) bigger. Nothing is written into your folder — a vault is a row in Leaftext's own database. See [Library](01-features/03-library.md#vaults).

## Vault search

Name and content search across the active [vault](GLOSSARY.md#vault). Name matches rank first, content matches by how often the terms appear, with snippets; top 50. There is no index on disk — the text is read once and held in memory, so nothing can go stale against your files. With no vault the box is hidden rather than left to return nothing.

## Vault switcher

The button at the left of the [breadcrumb](GLOSSARY.md#breadcrumb) — a box, or a cloud once the [vault](GLOSSARY.md#vault) syncs. It lists your vaults, offers **New vault…**, and opens each one's settings for renaming, repointing, removing, or connecting it to [GitHub](GLOSSARY.md#github-sync).

## Viewport indicator

The box on the [minimap](GLOSSARY.md#minimap) marking the part of the document you can currently see. Drag it to scroll; the point you grabbed stays under the cursor.

## Web address node

An `http` or `https` link drawn in the [graph view](GLOSSARY.md#graph-view) as a ring with a dot in it, labeled by its domain. Two documents citing one page share a single node. Clicking one opens your browser and leaves the map up.

## Wikilink

A `[[Note name]]` link, matched to a document by its filename or by one of its [aliases](GLOSSARY.md#alias). [Typing help](GLOSSARY.md#typing-help) completes them, previews them on hover, and underlines the ones that answer to nothing. In the [graph view](GLOSSARY.md#graph-view) they resolve across the whole [vault](GLOSSARY.md#vault).

## XML reader

How Leaftext reads any `.xml` file that is not [TEI](GLOSSARY.md#tei): from the shape of the tree rather than a schema. Elements holding elements become sections, elements holding values become aligned fields, repeated sibling records become a table, and tag names are read as words — so a sitemap, a feed or a config file reads as a page instead of tags. See [Rendering](01-features/01-rendering.md#any-xml).
