# Refine your mind.

Read, understand and edit the files other readers leave closed.

**Your thoughts, secure and free.** Leaftext is a free desktop app for reading and writing your own documents. Everything stays on your device, in plain files you own. Have an AI tool write a glossary for a hard book or a team's notes, and every term in it is linked as you read.

![The Leaftext window with a Markdown document open: the library pane at left holding the document's headings, the rendered page in the middle, and the minimap rail down the right edge](imgs/leaftext.png)

{{{icon:windows[Download for Windows](https://github.com/ryanallen/leaftext/releases/latest/download/leaftext-windows-x86_64.exe)}}} {{{icon:apple[Download for macOS](https://github.com/ryanallen/leaftext/releases/latest/download/leaftext-macos-universal.dmg)}}}

Free · Windows 10+ and macOS Universal · **[Installation help](docs/02-installation.md#install)**

> **Read this if you're on a Mac.** macOS refuses the first launch of any app Apple hasn't been paid to vouch for, and Leaftext is free, so it hasn't. Nothing was scanned and nothing was found. Let it through once — **System Settings → Privacy & Security → Open Anyway** — and it opens normally from then on. [The four clicks, spelled out →](docs/02-installation.md#mac-blocks-the-first-launch)

**[Get started →](docs/03-quickstart.md)** · **[Read the docs →](docs/)** · **[This site on GitHub →](https://github.com/ryanallen/leaftext)**

## How Leaftext compares

Every feature, checked against Obsidian, Typora and Calibre. **[The whole chart, with its sources →](docs/05-compare.md)**

---

Your notes deserve better than a text editor. Open a file in Leaftext and it becomes a page you actually want to read — quiet, well set, and easy to move through. Click into a sentence and you can write. Nothing saves until you say so.

There's no account and no sign-up. Your files never leave your computer, and they stay [Markdown](docs/01-features/01-rendering.md), [source files](docs/01-features/01-rendering.md#source-files), [HTML](docs/01-features/01-rendering.md#html-files), [XML](docs/01-features/01-rendering.md#xml), [JSON, and YAML](docs/01-features/01-rendering.md#data-files-json-and-yaml), [plain text](docs/01-features/01-rendering.md#plain-text-files) and [config files](docs/01-features/01-rendering.md#ini-files) — and even [saved emails](docs/01-features/01-rendering.md#email-eml), [Word, Excel, PowerPoint and OpenDocument files](docs/01-features/01-rendering.md#office-and-opendocument-files) and [EPUB books](docs/01-features/01-rendering.md#epub-books) — formats every other app can read, so you're never locked in.

Free, on macOS and Windows.

## Find it fast

| If you want to… | Go to |
| --- | --- |
| See it beside Obsidian, Typora and Calibre | [How Leaftext compares](#how-leaftext-compares) |
| See what it looks like | [Read your files](#read-your-files) |
| Open a Word, Excel or PowerPoint file | [Word, Excel and PowerPoint files](#word-excel-and-powerpoint-files) |
| Write in the page, not in an editor | [Write where you read](#write-where-you-read) |
| Search your notes and see how they link | [Keep a library](#keep-a-library) |
| Work beside AI | [Built to work beside AI](#built-to-work-beside-ai) |
| Find a word in the document you are reading | [Search everything you've written](#search-everything-youve-written) |
| Keep your place across long documents | [Move around](#move-around) |
| Change the look | [Make it yours](#make-it-yours) |
| Know what leaves your machine | [Your thoughts stay yours](#your-thoughts-stay-yours) |
| Install it | [Install it](#install-it) |
| Learn the whole app | [Learn it](#learn-it) |
| Build it from source | [Development](#development) |

## Read your files

Markdown, web pages, data, email, Word, Excel, PowerPoint and EPUB books each open as a page you want to read.

### Markdown, rendered the way GitHub renders it

![Leaftext reading view rendering a Markdown document](imgs/rendering-2x.png)

Open a `.md` file and it renders the way you'd expect, with the extras people actually use: [highlighted code](docs/01-features/01-rendering.md#code), [math](docs/01-features/01-rendering.md#math), [callouts](docs/01-features/01-rendering.md#blockquotes-and-alerts), [footnotes](docs/01-features/01-rendering.md#footnotes), [emoji](docs/01-features/01-rendering.md#emoji), [task lists](docs/01-features/01-rendering.md#task-lists), [tables](docs/01-features/01-rendering.md#tables), [collapsible sections](docs/01-features/01-rendering.md#collapsible-sections), [frontmatter](docs/01-features/01-rendering.md#frontmatter), [wiki links](docs/01-features/01-rendering.md#wiki-links) to your other notes, and [your own images](docs/01-features/01-rendering.md#images). **[Rendering →](docs/01-features/01-rendering.md)**

### Diagrams that take your theme's colors

![A Mermaid flowchart and a pie chart rendered inside a document, drawn in the current theme's colors and reading face rather than Mermaid's defaults](imgs/mermaid.png)

Write a `mermaid` code fence and get a diagram — flowchart, sequence, gantt, mindmap, pie — drawn offline in your theme's own colors and font. Switch theme and the diagrams on the page are redrawn to match. A page of sixty opens as fast as a page of three: only the ones near what you are reading are drawn, and the rest fill in as you scroll to them. Drag one to move it, `Ctrl` and the wheel to zoom, without the page around it shifting. **[Diagrams →](docs/01-features/01-rendering.md#mermaid-diagrams)**

### XML, sitemaps, feeds, and TEI

![An XML sitemap opened in Leaftext, rendered as a table of URL records with columns for URL, last modified and priority, instead of raw tags](imgs/xml.png)

[Any XML](docs/01-features/01-rendering.md#any-xml) reads as sections, fields, and tables instead of tags — a sitemap, a feed, a `pom.xml`. And [TEI](docs/01-features/01-rendering.md#tei-xml), the markup scholarly editions and archives are written in, gets a reader that understands its conventions: titles, front matter, nested divisions, verse, endnotes. **[XML →](docs/01-features/01-rendering.md#xml)**

### JSON and YAML as pages

![A GitHub Actions workflow YAML file opened in Leaftext, rendered as headed sections and aligned label/value fields rather than indented punctuation](imgs/data.png)

A lock file, a CI workflow, or a Kubernetes manifest as headed sections, aligned fields, and record tables instead of punctuation — read by the same shape rules as XML, so the same field is named the same way in both. **[JSON and YAML →](docs/01-features/01-rendering.md#data-files-json-and-yaml)**

### Saved email

![An .eml file opened in Leaftext, showing the subject as the page heading, From/To/Date as a field list, and the message body with an inline image](imgs/email.png)

An `.eml` from Gmail, Outlook, or Apple Mail opens as the message it carries: headers, body, inline images, attachments — instead of a wall of base64. Nothing in the message reaches the network. **[Email →](docs/01-features/01-rendering.md#email-eml)**

### HTML as the page it is

A saved report, exported note, or hand-written `.html` page opens as the page its own CSS draws — its colors, its type, its layout, its sticky headers — with nothing to press and nothing to turn off. It runs no script and reaches no network address; what it may read is the folder it sits in. Find, the outline, the minimap and the right-click menu all still work on it, and the source view keeps the original file for editing. **[HTML →](docs/01-features/01-rendering.md#html-files)**

### Plain text, exactly as you typed it

A `.txt` opens as one block with every space and every line break kept, so an ASCII banner stays lined up and an indented list stays indented. Nothing is reflowed and nothing is guessed at. **[Plain text →](docs/01-features/01-rendering.md#plain-text-files)**

### Config files as a page

An `.ini` opens as sections with their keys and values under each, every value ready to be typed into and written straight back. Each key is drawn the way it was written, because `font_size` is a name somebody chose. **[INI →](docs/01-features/01-rendering.md#ini-files)**

### Word, Excel and PowerPoint files

![A Word file open in Leaftext: the title Quarterly report, a What happened heading, a paragraph with a tracked change under it, a bulleted point, a numbered point, and a two-column table, with the minimap at the right and the Previous and Next cards under the document](imgs/office-documents.png)

A `.docx`, `.docm`, `.xlsx`, `.xlsm`, `.pptx`, `.pptm`, `.odt`, `.ods` or `.odp` opens as the document it is — headings, paragraphs, lists and tables, a sheet as a table of records, a deck as one entry per slide. Type into a paragraph or a cell, save, and everything Leaftext never read — your styles, themes, comments, tracked changes, charts and macros — is byte for byte what it was. A macro is read past and never run; Leaftext has no way to run one. No network, no account, no sign-in. **[Word, Excel, PowerPoint and OpenDocument →](docs/01-features/01-rendering.md#office-and-opendocument-files)**

### An EPUB book reads as one document

An `.epub` is a zip of chapters, and Leaftext draws the whole of it as one page in the order the book's own package says to read it: the cover where the book puts it, the book's own contents page with every link landing on the chapter it names, and the pictures out of the book itself. Nothing is fetched from the network, so opening a book somebody sent you makes no request at all. A book is read-only — nothing writes back into one. **[EPUB books →](docs/01-features/01-rendering.md#epub-books)**

### Read faster when you need to

![Speed Reader dimming prose and adding bold lead anchors](imgs/speedreader.png)

Turn on Speed Reader and the page dims back while bold anchors mark the start of each word. Your eye follows the path down instead of hunting for it. **[Speed Reader →](docs/01-features/05-settings.md#speed-reader)**

## Write where you read

Click into the rendered page and type. The change lands in your file, and nothing saves until you say so.

### Click into a sentence and type

![Inline editing in the rendered page, with save and undo button](imgs/editing.png)

Split a paragraph with `Enter`, join it back with `Backspace` — the change lands in your file at exactly that spot, and [undo](docs/01-features/07-editing.md#undo) walks back step by step, with Redo beside it for a press too many. Text edits never autosave: nothing touches your file until you press **Save**. Ticking a checkbox is the one exception — that saves on the spot, and works even with editing locked. **[Editing →](docs/01-features/07-editing.md)**

### A format bar where the words are

![A highlighted heading with the format bar floating above it, showing bold, italic, strikethrough, code and link, the heading and quote buttons, and copy, highlight and annotate at the end](imgs/format-bar.png)

Highlight words and a small bar appears over them: bold, italic, strikethrough, code, link, badge — then text, a bigger or smaller heading, and quote for the whole block — and copy, highlight and annotate at the end. A button with nowhere to go grays out. The last three are offered on a locked document too, so a passage can be marked up or annotated without unlocking the file. **[The format bar →](docs/01-features/07-editing.md#the-format-bar)**

### Reach into the margin to move a block

![One paragraph lifted out of a document mid-drag, floating over the page while its neighbors slide together to close the gap it left](imgs/block-gutter.png)

Take the handle and a block lifts off the page; drop it where its neighbors have opened a gap. Press the plus on an empty line and [a row of block kinds](docs/01-features/07-editing.md#adding-a-block) fans out — text, heading, list, quote, code, table, image, flowchart, divider, framed figure, badge and bars. **[The block gutter →](docs/01-features/07-editing.md#the-block-gutter)**

### Restructure a table without typing a pipe

![A reading list table in the page, with a grip standing above the Author column and another beside the Arctic Dreams row, and the right-click menu open over a cell offering Add row above, Add row below, Delete row, the three column actions, the three alignments, both sorts and the five totals](imgs/table-controls.png)

Point at a table and a grip appears beside the row and above the column: take either and drag it to reorder. Right-click a cell to add a row or a column, delete one, align a column left, center or right, or sort by it — numbers and dates by value, everything else as text. `Tab` and `Enter` walk the cells, and `Tab` at the last one writes the next row. The corner copies the whole table as CSV. **[Editing a table →](docs/01-features/07-editing.md#editing-a-table)**

### A table that adds itself up

Right-click the cell a total belongs in and ask for the sum, average, count, smallest or largest of the rows above it. The number goes into the file with a [formula line](docs/GLOSSARY.md#formula-line) under the table saying what that cell is, and Leaftext keeps it right as the rows under it change — one press of undo takes an edit and its totals back together. **[A table that adds itself up →](docs/01-features/07-editing.md#a-table-that-adds-itself-up)**

### Read a table as cards, a board or a list

![The same records drawn as a board in three columns headed FINISHED, READING and REFERENCE, each card led by its id with its fields listed under it, and Board marked in the quiet bar above](imgs/relational-board.png)

Point at a table with a header row and a few body rows and a quiet bar appears above it: **Table**, **Cards**, **Board**, **List**, **Sort**, **Filter** and **Describe**. Leaftext works out what each column holds — numbers, dates, checkboxes, short repeated values, pictures, links into another table — and a cell's link can pull in the row it points at. Nothing is written: the file stays an ordinary Markdown table, and reopening it restores the table as you wrote it. **[Relational tables →](docs/01-features/08-relational-tables.md)**

### Draw a flowchart instead of typing one

![The flowchart editor open as a full-window sheet: a diagram on the canvas at left, and the matching Mermaid text in the pane at right](imgs/flowchart-editor.png)

A canvas beside the Mermaid text, each following the other. Double-click to add a box and name it, pick from [forty-seven shapes](docs/01-features/07-editing.md#what-it-can-draw) grouped by what they are for, drag a handle onto another box to connect them or back onto the box it came from for a step that loops on itself, and group boxes together. A box can also carry a link, one of the app's own icons, or a picture. Every other kind of diagram opens the same sheet as a live preview. Open it on any diagram already in a page, and [export](docs/01-features/01-rendering.md#mermaid-diagrams) any diagram as its own Markdown file, picture or PDF from the button in its corner. **[The flowchart editor →](docs/01-features/07-editing.md#the-flowchart-editor)**

### Or work in the raw source

![A Markdown file as raw source in the code view, line numbers down the left and the editor’s minimap rail at the right](imgs/code-view.png)

Drop into [code view](docs/01-features/07-editing.md#code-view) for the file's actual source — Markdown, HTML, XML, JSON, YAML, a raw email, or the XML of the part a Word, Excel, PowerPoint or OpenDocument file is anchored to; a book is the one thing with no single source to show, and says so — with line numbers, a minimap, and the headings you're under [pinned to the top edge](docs/01-features/07-editing.md#pinned-headings). Markdown, HTML, XML, YAML, JSON and the XML inside an Office file come colored in your theme's own syntax colors; email is plain text. A color written in the source carries a small square of itself in the line beside it. **[Code view →](docs/01-features/07-editing.md#code-view)**

### Typing help drawn from your own notes

![The code view with a completion popup open after typing two square brackets, listing note names from the vault, and a wavy underline beneath a broken link higher up the file](imgs/typing-help.png)

Type `[[` and your notes are listed, by file name and by any [other name](docs/01-features/03-library.md#other-names) they answer to. Type `#` for a heading. Hover a wikilink for a preview, and a link that answers to nothing gets a wavy underline. It knows only what you pointed it at. **[Typing help →](docs/01-features/07-editing.md#typing-help)**

## Keep a library

Point it at a folder, then search everything in it and see how every note links to the next.

### Point it at a folder and it becomes a vault

![The library pane open beside a document, showing the vault switcher, the folder breadcrumb, and a file list showing three folders first and then the files beside them](imgs/library.png)

A side pane that browses one folder at a time, with a breadcrumb that always says where you are. Name a folder a **vault** and it becomes the thing search and syncing work over; the same switcher over the start screen takes you back from Library. Nothing is crawled, and nothing is written into your folder. **[Library →](docs/01-features/03-library.md#vaults)**

The button that changes where the list is rooted is a caret and a mark, which says nothing on its own — so the first time you open the pane, one small bubble points at it and then never appears again. **[The first-launch bubble →](docs/01-features/03-library.md#the-bubble-on-your-first-launch)**

Until you have a vault the start screen offers to add your notes folder, and the pane says once what one buys you. Both go for good the moment there is one. **[Your first vault →](docs/01-features/03-library.md#your-first-vault)**

Put a date on a checkbox and the start screen keeps a box of everything in the vault still open, nearest due first, over Recent and Favorites. Press a row and you land on that checkbox. **[Scheduled tasks →](docs/01-features/03-library.md#scheduled-tasks)**

Open the calendar at the foot of the library and a month of the vault shows which days its documents were changed, made or dated. Pick a day and the pane lists them. **[Calendar →](docs/01-features/03-library.md#calendar)**

### Search everything you've written

![All-files search results under the find bar: a filename match at the top, then content matches with highlighted terms, while the pane keeps showing the open document's outline behind them](imgs/search.png)

Name matches first — the whole name beats the start of it, which beats a word inside it — then content matches ranked for the document's size, so a long file cannot win by being long. Up to three rows per file, one per place the word is, and clicking one lands on that line. There's no index on disk: the text is read once and held in memory, so nothing can go stale against your files, and nothing is uploaded to search it. A folder a machine filled — build output, a package cache — is left out of that read, and the line above the results says when one was. **[Search →](docs/01-features/03-library.md#search)**

`Ctrl+F` opens one bar over the page or its source: **This file** searches the document you are reading, and **All files** searches the active vault. Match case, whole word, expressions, and replace behind the padlock belong to the file scope. **[Find in this document →](docs/01-features/02-navigation.md#find-in-this-document)**

### See how your ideas connect

![The graph view filling the page: document nodes joined by arrowed lines, the open document highlighted larger in the accent color, names floating beneath the nodes](imgs/graph.png)

The [graph view](docs/01-features/03-library.md#graph) maps the links between your documents, so you can see the shape of what you've written instead of scrolling a list. Notes you'd forgotten turn out to be next door to the one you're reading. Web addresses are nodes too, so two notes citing one page share it. **[Graph →](docs/01-features/03-library.md#graph)**

### Push a vault to GitHub

![A vault's settings panel showing the connected GitHub repository, and the sync button at the end of the breadcrumb carrying a count of changes waiting to be pushed](imgs/github-sync.png)

A vault can be a git repository that pushes to GitHub. Leaftext never holds a token — it runs the `git` already on your machine. A sync button appears on the breadcrumb whenever there's work that hasn't reached GitHub, and one vault can turn on automatic sync, which sends once your changes stop. **[GitHub sync →](docs/01-features/03-library.md#github-sync)**

## Built to work beside AI

### Have an AI tool make the hard words readable

![A glossary term underlined in a paragraph, with its entry open in a bottom sheet sliding up over the page, the document still visible behind it](imgs/glossary-sheet.png)

Ask the AI tool you already use to write a `GLOSSARY.md` beside a book, a manual or a folder of notes — a heading for each hard term and a short entry under it. Leaftext underlines every one of those terms wherever it appears, in a book's chapters, a Word file or your own notes, and opens its entry in a sheet over the page, so you learn the word without losing your place. **[Write a glossary →](docs/01-features/02-navigation.md#author-a-glossary)**

### One set of words for a whole team

The same file keeps a team's words from drifting. When everybody's notes link one entry, a term means one thing, and whoever reads it — a person or the AI tool that wrote it — reads the same definition.

### Coming next

Leaftext does not yet let an AI agent on your machine work in the document you have open, start outside tool servers through MCP, or define a word in a book with one press. All three are on the roadmap, and [the chart that sets Leaftext beside Obsidian, Typora and Calibre](#how-leaftext-compares) marks them as coming, with a source for every other check and cross. **[Its sources →](docs/05-compare.md)**

## Move around

### Never lose your place

![Tabs and Back/Forward history in the app bar](imgs/navigation.png)

It moves like a browser: [tabs](docs/01-features/02-navigation.md#tabs), Back and Forward through your [history](docs/01-features/02-navigation.md#history), an [outline](docs/01-features/02-navigation.md#outline) of the open document in the pane beside it, and Ctrl-click on a link to [open it behind](docs/01-features/02-navigation.md#opening-a-link-in-a-new-page) the page you are reading. Two of them can stand [side by side](docs/01-features/02-navigation.md#two-documents-side-by-side), each column scrolling on its own with its own rail, and one document can stand beside itself as its source and its page. Change a file in another app and Leaftext [picks it up](docs/01-features/02-navigation.md#reload) without losing your spot. **[Navigation →](docs/01-features/02-navigation.md)**

### Take in the whole page at once

![The minimap rail showing a scaled clone of the document](imgs/minimap.png)

A tiny version of your document runs down the side — real text, not abstract bars — with a marker showing where you are. You'll recognize a section by its shape. Click to jump, or drag to scroll. **[Minimap →](docs/01-features/04-minimap.md)**

### Read a folder in order

![The Previous / Next pager bar at the foot of a document, each button naming the document it leads to](imgs/pager.png)

Where folders are joined by `README.md` files, a **Previous / Next** bar appears at the bottom of each page, so a folder of notes reads like a book. Point at a button and it fills with the same fine dot texture the page's code blocks wear, with a tooltip naming the document it opens. **[Pager →](docs/01-features/02-navigation.md#pager)**

### Define a word once for a whole set of notes

![A glossary term underlined in a paragraph, with its entry open in a bottom sheet sliding up over the page, the document still visible behind it](imgs/glossary-sheet.png)

Write one `GLOSSARY.md` and every mention of a defined term, across every document, links to it — resting on one draws its entry in the hover card, and clicking one opens a sheet over the page instead of taking you away from it. **[Glossary →](docs/01-features/02-navigation.md#glossary)**

## Make it yours

### Fifteen themes, six more to earn, light and dark

![Amaranth theme](imgs/themes/themes.png)

[Amaranth, Arabica, Bloodleaf, Camellia, Eucalyptus, Fern, Foxglove, Ginger, GitHub, Goldenrod, Halcyon, Ivy, Nightshade, Pippin, and Sage](docs/01-features/06-themes.md#families) ship free, and six one-color modes — Birch, Laurel, Lavender, Saffron, Sumac and Woad — are earned with seeds in [the Grove](docs/01-features/09-progress.md), each in light and dark, plus System and Daylight if you'd rather the app follow the time of day. Everything moves together: text, code, callouts, diagrams, minimap, and the [icons](docs/01-features/06-themes.md#icons) — seven icon sets, and each theme wears one. Each theme's font is fetched from Google Fonts the first time you choose it. **[Themes →](docs/01-features/06-themes.md)**

### Settings you can read, where you need them

There's no settings panel to hunt through. Every control stands where it applies: the palette at the foot of the library pane for [theme and appearance](docs/01-features/06-themes.md#choose), the [graph](docs/01-features/03-library.md#graph)'s own toolbar for how big a map to draw. It's all a plain JSON file on your machine, not an account. **[Settings →](docs/01-features/05-settings.md)**

## Your thoughts stay yours

No account. No cloud. No telemetry. Nothing you open, write, or search leaves your machine on its own.

### What reaches the network

Three things, and none of them carries a word you wrote:

- **The release check** — it asks GitHub whether a newer version exists.
- **The update download** — when one does, it fetches that installer.
- **A theme's font** — from Google Fonts, the first time you pick that theme.

The one exception is the one you set up: [GitHub sync](docs/01-features/03-library.md#github-sync) pushes a vault to your own repository, using the `git` already on your machine. It starts on a press unless you turn on automatic sync for that vault.

### Your files stay your files

Your [settings](docs/01-features/05-settings.md) are a JSON file on your machine, and your documents are the files you already had. Delete Leaftext tomorrow and every word you wrote is still sitting in the folder you put it in, readable by anything.

Leaftext also keeps a plain text [journal](docs/01-features/05-settings.md#journal) of what it did, so a bug report has something to attach. It records file paths and errors — never a word you wrote — it stops at about a megabyte, and it goes nowhere unless you send it. Beside it sits an empty marker file saying a run is under way, which the close takes away — so a launch that still finds one says the run before it ended without closing. It holds nothing at all.

### How an update lands

An installer downloads in the background, is checked for the length the release advertised, and is re-hashed before it is ever run. Then the **next launch installs it, before any window opens** — the one moment Windows lets an app replace itself — or press **Restart to update** if you would rather not wait. Each version is installed automatically once; after that it waits for a click. An install that does not take relaunches the build you already had, so the next launch tells you which version failed, why, and which one you are still on. **[Updates →](docs/01-features/05-settings.md#updates)**

## Install it

Leaftext is free. **[Download for Windows](https://github.com/ryanallen/leaftext/releases/latest/download/leaftext-windows-x86_64.exe)** or **[for macOS](https://github.com/ryanallen/leaftext/releases/latest/download/leaftext-macos-universal.dmg)**, and the **[Installation guide](docs/02-installation.md#install)** walks through both, the Mac's first launch included.

### macOS

![The mounted Leaftext disk image in the Finder: the leaf app icon on the left with an arrow pointing to the Applications folder shortcut on the right](imgs/install-mac.png)

1. Download the file ending in **`-macos-universal.dmg`**. One file covers Apple Silicon and Intel.
2. Open it. Drag the leaf app onto the **Applications** folder beside it.
3. Eject the disk image, then open **Leaftext** from Applications.

#### First launch — macOS will refuse it

![The macOS System Settings Privacy & Security pane scrolled to the Security section, where a line names Leaftext as blocked with an Open Anyway button beside it](imgs/install-mac-open-anyway.png)

Expected. Apple charges a yearly fee to notarize an app; Leaftext is free and isn't enrolled, so macOS blocks anything unnotarized on sight. Nothing was scanned and nothing was found. Let it through once:

1. Double-click **Leaftext**, then click **Done** on the refusal.
2. Open **System Settings** → **Privacy & Security**.
3. Scroll to the bottom. Click **Open Anyway** on the line naming Leaftext.
4. Confirm with Touch ID or your password, then click **Open**.

Every launch after that is an ordinary double-click. On macOS 12 and earlier it's shorter: right-click the app → **Open** → **Open**. If the **Open Anyway** button never appears, open Terminal and run `xattr -cr /Applications/leaftext.app` instead. **[More detail →](docs/02-installation.md#mac-blocks-the-first-launch)**

### Windows

![The Windows protected your PC dialog with More info already expanded: leaftext beside App, Unknown publisher beside Publisher, and Run anyway next to Don’t run at the foot](imgs/install-windows.png)

Grab the 64-bit installer and run it. If a full-screen **Windows protected your PC** box appears, click **More info** → **Run anyway** — the installer isn't signed with a paid certificate. It installs just for you, with no admin prompt. Here by default, though **Change...** puts it anywhere you like and updates keep it there:

```text
%LOCALAPPDATA%\Programs\leaftext\bin\leaftext.exe
```

Your app data lives alongside it:

```text
%LOCALAPPDATA%\ryanallen\leaftext\data
```

**Leaftext opens itself when the install finishes.** After that, launch it from the Start Menu, or tap the Windows key and type **Leaftext**. One Start Menu entry, no desktop shortcut.

> **Upgrading from v0.1.364 or earlier?** Uninstall the old version first, from **Settings → Apps**. Those installed machine-wide into `C:\Program Files`, and a per-user package can't remove one, so you'd end up with two copies.

### Opening files with it

Installing registers Leaftext for every extension it reads, including `.txt`, `.ini`, `.docx`, `.docm`, `.xlsx`, `.xlsm`, `.pptx`, `.pptm`, `.odt`, `.ods`, `.odp`, `.epub`, and source-file extensions such as `.rs`, `.py`, `.toml`, `.jsonc`, and `.gql`, so Leaftext is available from Open with. Source files, HTML, plain text, `.ini` and Word, Excel, PowerPoint and OpenDocument files stay with their current app unless you choose Leaftext. **[File associations →](docs/02-installation.md#file-associations)**

## Learn it

New here? The **[Quickstart](docs/03-quickstart.md)** gets you reading in a couple of minutes. Then browse the **[full documentation](docs/01-introduction.md)**.

| Page | What it covers |
| --- | --- |
| [Quickstart](docs/03-quickstart.md) | Open a file, read it, move around, come back to it |
| [Installation](docs/02-installation.md) | Both platforms, the first-launch warnings, file associations, updates |
| [Rendering](docs/01-features/01-rendering.md) | Every syntax and format it reads, with live examples |
| [Navigation](docs/01-features/02-navigation.md) | Tabs, two documents side by side, history, outline, pager, glossary, link hints and the link menu, live reload |
| [Library](docs/01-features/03-library.md) | Vaults, the file tree, search, the graph, GitHub sync, file actions |
| [Minimap](docs/01-features/04-minimap.md) | The side rail, in both the reading view and the code view |
| [Settings](docs/01-features/05-settings.md) | Every preference, its default, and where it is stored |
| [Themes](docs/01-features/06-themes.md) | The fifteen families and the six earned ones, appearance, fonts, diagram colors |
| [Editing](docs/01-features/07-editing.md) | Inline editing, the block gutter, the flowchart editor, code view, save |
| [Relational tables](docs/01-features/08-relational-tables.md) | RDB views, relations, sorting, filtering and optional table descriptions |
| [Your Grove](docs/01-features/09-progress.md) | The reading record at the library's foot, and the switch that turns it off |
| [Get help](docs/04-help.md) | Where to ask a question, what to say when you ask, and what these pages already answer |
| [Glossary](docs/GLOSSARY.md) | Every word Leaftext uses for a part of itself |

The pages are plain Markdown under [`docs/`](docs/) — the same format the app reads, so you can open them in Leaftext itself.

**Stuck on something these pages don't answer?** Ask on **[Discussions](https://github.com/ryanallen/leaftext/discussions/categories/get-help)** — the project's own public page, readable and searchable without an account, so the answer is there for whoever hits the same thing next. Inside the app it is **Get help** on the version line at the foot of the start screen. **[What to say when you ask →](docs/04-help.md)**

---

## Development

Leaftext's source is not public. What is published is this site: every theme drawn on one page at **[leaftext.com/gallery.html](https://leaftext.com/gallery.html)** — all 83 colors, every icon and every part of the interface, in light and dark — the [documentation](docs/README.md), the [glossary](docs/GLOSSARY.md), the [themes](themes/README.md) the app reads, and the crawler files below.

### Every written file this site publishes

Each of these links onward to the rest of its own set, so nothing published here is reachable only by knowing it is there.

| Where | What is in it |
|:--|:--|
| [Documentation](docs/README.md) | Every page published at [leaftext.com/docs](https://leaftext.com/docs), listed above |
| [Glossary](docs/GLOSSARY.md) | Every word Leaftext uses for a part of itself |
| [Themes](themes/README.md) | The fifteen free families and the six earned ones, one Markdown file each, with the colors they set and the icon set they wear |
| Crawler files | [`robots.txt`](robots.txt), [`sitemap.xml`](sitemap.xml), [`sitemap-md.txt`](sitemap-md.txt), [`llms.txt`](llms.txt), [`llms-full.txt`](llms-full.txt) — generated from this file and `docs/` |
