# How it compares

> Every Leaftext feature beside three readers people already know — Obsidian, Typora and Calibre — with a source for every check and every cross, and the rows Leaftext has not reached yet marked as coming.

Each of these apps is good at something. Obsidian is a notebook of linked Markdown notes with a large plugin library; Typora writes Markdown in the finished page; Calibre manages and reads a whole library of ebooks, looks a word up in a dictionary and remembers where you stopped. Leaftext reads all of those kinds of file in one window, writes in the page, and links a shared [glossary](01-features/02-navigation.md#glossary) through all of them.

## The chart

**✅** the app does this, and the link in the cell is where it says so. **❌** it does not do this: it says it cannot, it only converts the file into something else first, or it is not the kind of app that would. A mark linking to [how the marks were checked](05-compare.md#how-the-marks-were-checked) was read off the app itself rather than off its pages. **?** neither its own pages nor the app settle it either way.

Sources read 23 September 2026, 7:42am. The apps themselves checked 23 September 2026, 10:14am.

1. [Files and formats](06-comparison-chart/01-files-and-formats.md)
2. [Markdown and diagrams](06-comparison-chart/02-markdown-and-diagrams.md)
3. [Reading and moving around](06-comparison-chart/03-reading-and-moving-around.md)
4. [Writing and editing](06-comparison-chart/04-writing-and-editing.md)
5. [Library, search and sync](06-comparison-chart/05-library-search-and-sync.md)
6. [Look and feel](06-comparison-chart/06-look-and-feel.md)
7. [Progress](06-comparison-chart/07-progress.md)
8. [Install, updates and privacy](06-comparison-chart/08-install-updates-and-privacy.md)
9. [Export and the published site](06-comparison-chart/09-export-and-the-published-site.md)
10. [Coming](06-comparison-chart/10-coming.md)

Obsidian's cross for books and Office files is its own list of the formats it opens, which names neither and points to community plugins for the rest. Typora's is its import, which converts those files into Markdown through Pandoc rather than opening them as themselves. Calibre's is its list of conversion inputs, which converts a Word file into an ebook rather than opening it.

## How the marks were checked

Where an app's own pages say nothing about a row, the mark comes from the app itself, installed on Windows. A check means that copy did it; a cross means it has no command, setting or behavior that does.

### Obsidian

Obsidian 1.13.7, opened on an empty vault of test notes with every core plugin switched on. Its commands, hotkeys and settings were listed, notes in each text encoding were opened and saved, and its find bar, reading view and editor were tried on them. What it draws was read out of its own interface text and stylesheet.

### Typora

Typora 1.14.10, read through its menus, preferences and messages, the editor code it installs, the help pages it ships beside itself, and what it registers with Windows.

### Calibre

calibre 9.15, read through its E-book viewer, what it registers with Windows, and the viewer's own published source.

## Working beside AI

A glossary is where Leaftext and an AI tool meet today. Ask the tool you already use to write a `GLOSSARY.md` beside a book, a manual or a folder of notes — one `##` heading per hard term, a short entry under each — and Leaftext underlines every one of those terms wherever it appears and opens its entry in a sheet over the page, so you read the definition without losing your place. The same file keeps a team's words from drifting: when everybody's notes link one entry, a term means one thing. [How to write one →](01-features/02-navigation.md#author-a-glossary)

## On our roadmap

Every row in [Coming](06-comparison-chart/10-coming.md) is planned, or built and not yet switched on. Three of them change how Leaftext works beside AI.

### Outside tools through MCP

Leaftext will start the tool servers you list, for an assistant working inside the app.

### Your own AI agent in the open document

An AI agent on your machine will be able to read, edit, tick and save the document you have open, through MCP.

### Define a word in a book with one press

Highlight a word in a book and have its meaning, in the sense this book uses it, written into the book's glossary.

## Next

- [Meet Leaftext](01-introduction.md) for everything it does.
- [Rendering](01-features/01-rendering.md) for every format it reads.
- [Install it](02-installation.md) and open your own files.
