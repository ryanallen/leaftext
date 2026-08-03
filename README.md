# Refine your mind.

**Your thoughts, secure and free.** Leaftext is a free desktop app for reading and writing your own documents. Everything stays on your device, in plain files you own.

![The Leaftext window with a Markdown document open: the library pane at left, the rendered page in the middle with its outline collapsed under the title, and the minimap rail down the right edge](imgs/leaftext.png)

<a href="https://github.com/ryanallen/leaftext/releases/latest"><img alt="Download" src="https://img.shields.io/badge/download-latest-0ea5e9?style=flat&labelColor=4b5563"></a>
<a href="https://github.com/ryanallen/leaftext/releases/latest"><img alt="macOS" src="https://img.shields.io/badge/macOS-Universal-silver?style=flat&labelColor=4b5563"></a>
<a href="https://github.com/ryanallen/leaftext/releases/latest"><img alt="Windows" src="https://img.shields.io/badge/Windows-x64-0078d4?style=flat&labelColor=4b5563"></a>

**[Download it →](https://github.com/ryanallen/leaftext/releases/latest)** · **[How to install it →](docs/02-installation.md#install)** · **[Mac won't open it? →](docs/02-installation.md#mac-blocks-the-first-launch)**

> **Read this if you're on a Mac.** macOS refuses the first launch of any app Apple hasn't been paid to vouch for, and Leaftext is free, so it hasn't. Nothing was scanned and nothing was found. Let it through once — **System Settings → Privacy & Security → Open Anyway** — and it opens normally from then on. [The four clicks, spelled out →](docs/02-installation.md#mac-blocks-the-first-launch)

**[Get started →](docs/03-quickstart.md)** · **[Read the docs →](docs/)** · **[View the project on GitHub →](https://github.com/ryanallen/leaftext)**

---

Your notes deserve better than a text editor. Open a file in Leaftext and it becomes a page you actually want to read — quiet, well set, and easy to move through. Click into a sentence and you can write. Nothing saves until you say so.

There's no account and no sign-up. Your files never leave your computer, and they stay [Markdown](docs/01-features/01-rendering.md), [XML](docs/01-features/01-rendering.md#xml), [JSON, and YAML](docs/01-features/01-rendering.md#data-files-json-and-yaml) — and even [saved emails](docs/01-features/01-rendering.md#email-eml) — formats every other app can read, so you're never locked in.

Free, on macOS and Windows.

## Find it fast

| If you want to… | Go to |
| --- | --- |
| See what it looks like | [Read your files](#read-your-files) |
| Write in the page, not in an editor | [Write where you read](#write-where-you-read) |
| Search your notes and see how they link | [Keep a library](#keep-a-library) |
| Keep your place across long documents | [Move around](#move-around) |
| Change the look | [Make it yours](#make-it-yours) |
| Know what leaves your machine | [Your thoughts stay yours](#your-thoughts-stay-yours) |
| Install it | [Install it](#install-it) |
| Learn the whole app | [Learn it](#learn-it) |
| Build it from source | [Development](#development) |

## Read your files

### Markdown, rendered the way GitHub renders it

![Leaftext reading view rendering a Markdown document](imgs/rendering-2x.png)

Open a `.md` file and it renders the way you'd expect, with the extras people actually use: [highlighted code](docs/01-features/01-rendering.md#code), [math](docs/01-features/01-rendering.md#math), [callouts](docs/01-features/01-rendering.md#blockquotes-and-alerts), [footnotes](docs/01-features/01-rendering.md#footnotes), [emoji](docs/01-features/01-rendering.md#emoji), [task lists](docs/01-features/01-rendering.md#task-lists), [tables](docs/01-features/01-rendering.md#tables), [collapsible sections](docs/01-features/01-rendering.md#collapsible-sections), [frontmatter](docs/01-features/01-rendering.md#frontmatter), and [your own images](docs/01-features/01-rendering.md#images). **[Rendering →](docs/01-features/01-rendering.md)**

### Diagrams that take your theme's colors

![A Mermaid flowchart and a pie chart rendered inside a document, drawn in the current theme's colors and body font rather than Mermaid's defaults](imgs/mermaid.png)

Write a `mermaid` code fence and get a diagram — flowchart, sequence, gantt, mindmap, pie — drawn offline in your theme's own colors and font. Switch theme and every diagram on the page is redrawn to match. Drag one to move it, `Ctrl` and the wheel to zoom, without the page around it shifting. **[Diagrams →](docs/01-features/01-rendering.md#mermaid-diagrams)**

### XML, sitemaps, feeds, and Buddhist canon

![An XML sitemap opened in Leaftext, rendered as a table of URL records with columns for URL, last modified and priority, instead of raw tags](imgs/xml.png)

[Any XML](docs/01-features/01-rendering.md#any-xml) reads as sections, fields, and tables instead of tags — a sitemap, a feed, a `pom.xml`. And [84000-style TEI](docs/01-features/01-rendering.md#tei-xml-84000-translations), the format the Buddhist canon is translated into, gets a reader that understands its conventions: titles, front matter, nested divisions, verse, endnotes. **[XML →](docs/01-features/01-rendering.md#xml)**

### JSON and YAML as pages

![A GitHub Actions workflow YAML file opened in Leaftext, rendered as headed sections and aligned label/value fields rather than indented punctuation](imgs/data.png)

A lock file, a CI workflow, or a Kubernetes manifest as headed sections, aligned fields, and record tables instead of punctuation — read by the same shape rules as XML, so the same field is named the same way in both. **[JSON and YAML →](docs/01-features/01-rendering.md#data-files-json-and-yaml)**

### Saved email

![An .eml file opened in Leaftext, showing the subject as the page heading, From/To/Date as a field list, and the message body with an inline image](imgs/email.png)

An `.eml` from Gmail, Outlook, or Apple Mail opens as the message it carries: headers, body, inline images, attachments — instead of a wall of base64. Nothing in the message reaches the network. **[Email →](docs/01-features/01-rendering.md#email-eml)**

### Read faster when you need to

![Speed Reader dimming prose and adding bold lead anchors](imgs/speedreader.png)

Turn on Speed Reader and the page dims back while bold anchors mark the start of each word. Your eye follows the path down instead of hunting for it. **[Speed Reader →](docs/01-features/05-settings.md#speed-reader)**

## Write where you read

### Click into a sentence and type

![Inline editing in the rendered page, with save and undo button](imgs/editing.png)

Split a paragraph with `Enter`, join it back with `Backspace` — the change lands in your file at exactly that spot, and [undo](docs/01-features/07-editing.md#undo) walks back step by step. Text edits never autosave: nothing touches your file until you press **Save**. Ticking a checkbox is the one exception — that saves on the spot, and works even with editing locked. **[Editing →](docs/01-features/07-editing.md)**

### A format bar where the words are

![A few highlighted words in a paragraph with the format bar floating above them, showing bold, italic, strikethrough, code, link, and the heading and quote buttons](imgs/format-bar.png)

Highlight words and a small bar appears over them: bold, italic, strikethrough, code, link — then text, a bigger or smaller heading, and quote for the whole block. A button with nowhere to go grays out. **[The format bar →](docs/01-features/07-editing.md#the-format-bar)**

### Reach into the margin to move a block

![One paragraph lifted out of a document mid-drag, floating over the page while its neighbors slide together to close the gap it left](imgs/block-gutter.png)

Take the handle and a block lifts off the page; drop it where its neighbors have opened a gap. Press the plus on an empty line and [a row of block kinds](docs/01-features/07-editing.md#adding-a-block) fans out — text, heading, list, quote, code, table, image, flowchart, divider. **[The block gutter →](docs/01-features/07-editing.md#the-block-gutter)**

### Draw a flowchart instead of typing one

![The flowchart editor open as a full-window sheet: a diagram on the canvas at left, and the matching Mermaid text in the pane at right](imgs/flowchart-editor.png)

A canvas beside the Mermaid text, each following the other. Double-click to add a box and name it, pick from [forty-seven shapes](docs/01-features/07-editing.md#what-it-can-draw) grouped by what they are for, drag a handle onto another box to connect them, and group boxes together. Every other kind of diagram opens the same sheet as a live preview. Open it on any diagram already in a page, and [export](docs/01-features/07-editing.md#export) the finished thing as its own Markdown file or picture. **[The flowchart editor →](docs/01-features/07-editing.md#the-flowchart-editor)**

### Or work in the raw source

![Editing in code view, with save and undo button](imgs/code-view.png)

Drop into [code view](docs/01-features/07-editing.md#code-view) for the file's actual source — Markdown, XML, JSON, YAML, or a raw email — with line numbers, a minimap, and the headings you're under [pinned to the top edge](docs/01-features/07-editing.md#pinned-headings). Markdown, XML and YAML come colored in your theme's own syntax colors. **[Code view →](docs/01-features/07-editing.md#code-view)**

### Typing help drawn from your own notes

![The code view with a completion popup open after typing two square brackets, listing note names from the vault, and a wavy underline beneath a broken link further down](imgs/typing-help.png)

Type `[[` and your notes are listed. Type `#` for a heading. Hover a wikilink for a preview, and a link that answers to nothing gets a wavy underline. It knows only what you pointed it at. **[Typing help →](docs/01-features/07-editing.md#typing-help)**

## Keep a library

### Point it at a folder and it becomes a vault

![The library pane open beside a document, showing the vault switcher, the folder breadcrumb, the search box, and a file list of one folder](imgs/library.png)

A side pane that browses one folder at a time, with a breadcrumb that always says where you are. Name a folder a **vault** and it becomes the thing search and syncing work over. Nothing is crawled, and nothing is written into your folder. **[Library →](docs/01-features/03-library.md)**

### Search everything you've written

![Search results in the library pane: a filename match at the top, then content matches each with a snippet showing the search terms in context](imgs/search.png)

Name matches first, then content matches ranked by how often the terms appear, each with a snippet. There's no index on disk — the text is read once and held in memory, so nothing can go stale against your files, and nothing is uploaded to search it. **[Search →](docs/01-features/03-library.md#search)**

### See how your ideas connect

![The graph view filling the page: document nodes joined by arrowed lines, the open document highlighted larger in the accent color, names floating beneath the nodes](imgs/graph.png)

The [graph view](docs/01-features/03-library.md#graph) maps the links between your documents, so you can see the shape of what you've written instead of scrolling a list. Notes you'd forgotten turn out to be next door to the one you're reading. Web addresses are nodes too, so two notes citing one page share it. **[Graph →](docs/01-features/03-library.md#graph)**

### Push a vault to GitHub

![A vault's settings panel showing the connected GitHub repository, and the sync button at the end of the breadcrumb carrying a count of changes waiting to be pushed](imgs/github-sync.png)

A vault can be a git repository that pushes to GitHub. Leaftext never holds a token — it runs the `git` already on your machine. A sync button appears on the breadcrumb whenever there's work that hasn't reached GitHub. **[GitHub sync →](docs/01-features/03-library.md#github-sync)**

## Move around

### Never lose your place

![Tabs and Back/Forward history in the app bar](imgs/navigation.png)

It moves like a browser: [tabs](docs/01-features/02-navigation.md#tabs), Back and Forward through your [history](docs/01-features/02-navigation.md#history), and an [outline](docs/01-features/02-navigation.md#outline) at the top of every document. Change a file in another app and Leaftext [picks it up](docs/01-features/02-navigation.md#reload) without losing your spot. **[Navigation →](docs/01-features/02-navigation.md)**

### Take in the whole page at once

![The minimap rail showing a scaled clone of the document](imgs/minimap.png)

A tiny version of your document runs down the side — real text, not abstract bars — with a marker showing where you are. You'll recognize a section by its shape. Click to jump, or drag to scroll. **[Minimap →](docs/01-features/04-minimap.md)**

### Read a folder in order

![The Previous / Next pager bar at the foot of a document, each button naming the document it leads to](imgs/pager.png)

Where folders are joined by `README.md` files, a **Previous / Next** bar appears at the bottom of each page, so a folder of notes reads like a book. **[Pager →](docs/01-features/02-navigation.md#pager)**

### Define a word once for a whole set of notes

![A glossary term underlined in a paragraph, with its entry open in a bottom sheet sliding up over the page, the document still visible behind it](imgs/glossary-sheet.png)

Write one `GLOSSARY.md` and every mention of a defined term, across every document, links to it — and clicking one opens a sheet over the page instead of taking you away from it. **[Glossary →](docs/01-features/02-navigation.md#glossary)**

## Make it yours

### Eleven themes, light and dark

![Amaranth theme](imgs/themes/themes.png)

[Amaranth, Arabica, Bloodleaf, Fern, Ginger, GitHub, Goldenrod, Halcyon, Nightshade, Pippin, and Sage](docs/01-features/06-themes.md#families) — each in light and dark, plus System and Daylight if you'd rather the app follow the time of day. Everything moves together: text, code, callouts, diagrams, minimap. Each theme's font is fetched from Google Fonts the first time you choose it. **[Themes →](docs/01-features/06-themes.md)**

### Settings you can read, where you need them

There's no settings panel to hunt through. Every control stands where it applies: the palette in the app bar for [theme and appearance](docs/01-features/06-themes.md#choose), the [graph](docs/01-features/03-library.md#graph)'s own toolbar for how big a map to draw. It's all a plain JSON file on your machine, not an account. **[Settings →](docs/01-features/05-settings.md)**

## Your thoughts stay yours

No account. No cloud. No telemetry. Nothing you open, write, or search leaves your machine on its own.

### What reaches the network

Three things, and none of them carries a word you wrote:

- **The release check** — it asks GitHub whether a newer version exists.
- **The update download** — when one does, it fetches that installer.
- **A theme's font** — from Google Fonts, the first time you pick that theme.

The one exception is the one you ask for: [GitHub sync](docs/01-features/03-library.md#github-sync) pushes a vault to your own repository, using the `git` already on your machine. Nothing syncs unless you set it up and press the button.

### Your files stay your files

Your [settings](docs/01-features/05-settings.md) are a JSON file on your machine, and your documents are the files you already had. Delete Leaftext tomorrow and every word you wrote is still sitting in the folder you put it in, readable by anything.

Leaftext also keeps a plain text [journal](docs/01-features/05-settings.md#journal) of what it did, so a bug report has something to attach. It records file paths and errors — never a word you wrote — it stops at about a megabyte, and it goes nowhere unless you send it.

### How an update lands

An installer downloads in the background, is checked for the length the release advertised, and is re-hashed before it is ever run. Then the **next launch installs it, before any window opens** — the one moment Windows lets an app replace itself — or press **Restart to update** if you would rather not wait. Each version is installed automatically once; after that it waits for a click. **[Updates →](docs/01-features/05-settings.md#updates)**

## Install it

Leaftext is free. **[Download the latest release](https://github.com/ryanallen/leaftext/releases/latest)**, then follow your platform below — or the fuller walkthrough in the **[Installation guide](docs/02-installation.md#install)**.

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

![The Windows protected your PC dialog with More info already expanded: the MSI file name beside App, Unknown publisher beside Publisher, and Run anyway next to Don’t run at the foot](imgs/install-windows.png)

Grab the 64-bit MSI and run it. If a full-screen **Windows protected your PC** box appears, click **More info** → **Run anyway** — the installer isn't signed with a paid certificate. It installs just for you, with no admin prompt. Here by default, though **Change...** puts it anywhere you like and updates keep it there:

```text
%LOCALAPPDATA%\Programs\leaftext\bin\leaftext.exe
```

Your app data lives alongside it:

```text
%LOCALAPPDATA%\ryanallen\leaftext\data
```

Launch it from the Start Menu, or tap the Windows key and type **Leaftext**. One Start Menu entry, no desktop shortcut.

> **Upgrading from v0.1.364 or earlier?** Uninstall the old version first, from **Settings → Apps**. Those installed machine-wide into `C:\Program Files`, and a per-user package can't remove one, so you'd end up with two copies.

### Opening files with it

Installing registers Leaftext for every extension it reads — `.md`, `.markdown`, `.mdown`, `.xml`, `.json`, `.yaml`, `.yml`, `.eml`, `.mht`, `.mhtml` — so those files carry the leaf icon. An extension another app already owns keeps its app until you say otherwise. **[File associations →](docs/02-installation.md#file-associations)**

## Learn it

New here? The **[Quickstart](docs/03-quickstart.md)** gets you reading in a couple of minutes. Then browse the **[full documentation](docs/01-introduction.md)**.

| Page | What it covers |
| --- | --- |
| [Quickstart](docs/03-quickstart.md) | Open a file, read it, move around, come back to it |
| [Installation](docs/02-installation.md) | Both platforms, the first-launch warnings, file associations, updates |
| [Rendering](docs/01-features/01-rendering.md) | Every syntax and format it reads, with live examples |
| [Navigation](docs/01-features/02-navigation.md) | Tabs, history, outline, pager, glossary, link hints, live reload |
| [Library](docs/01-features/03-library.md) | Vaults, the file tree, search, the graph, GitHub sync, file actions |
| [Minimap](docs/01-features/04-minimap.md) | The side rail, in both the reading view and the code view |
| [Settings](docs/01-features/05-settings.md) | Every preference, its default, and where it is stored |
| [Themes](docs/01-features/06-themes.md) | The eleven families, appearance, fonts, diagram colors |
| [Editing](docs/01-features/07-editing.md) | Inline editing, the block gutter, the flowchart editor, code view, save |
| [Glossary](docs/GLOSSARY.md) | Every word Leaftext uses for a part of itself |

The pages are plain Markdown under [`docs/`](docs/) — the same format the app reads, so you can open them in Leaftext itself.

---

## Development

See [Building](docs/02-development/02-building.md), [Architecture](docs/02-development/01-architecture.md), [Theming](docs/02-development/04-theming.md), [Design system](docs/02-development/05-design-system.md), and [Releasing](docs/02-development/03-releasing.md) for the full developer docs.

Every theme is drawn on one page at **[leaftext.com/gallery.html](https://leaftext.com/gallery.html)** — all 81 colors, every icon and every part of the interface, in light and dark.

Run the full verification suite before handing work back:

```sh
just verify
```

Other [`Justfile`](Justfile) tasks:

| Task | Command |
|:--|:--|
| Cut a release | `just release <version>` |

`just release` commits the version bump, tags, and pushes — CI builds the Windows MSI and the macOS DMG.
