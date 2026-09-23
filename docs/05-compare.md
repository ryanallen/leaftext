# How it compares

> Leaftext beside three readers people already know — Obsidian, Typora and Calibre — row by row, with a source for every check and every cross, and the rows Leaftext has not reached yet marked as coming.

Each of these apps is good at something. Obsidian is a notebook of linked Markdown notes with a large plugin library; Typora writes Markdown in the finished page; Calibre manages and reads a whole library of ebooks, looks a word up in a dictionary and remembers where you stopped. Leaftext reads all of those kinds of file in one window, writes in the page, and links a shared [glossary](01-features/02-navigation.md#glossary) through all of them.

## The chart

**✅** the app does this, and the link in the cell is where it says so. **❌** it says it cannot, or it only converts the file into something else first. **?** its own pages do not settle it either way. **—** the row has no counterpart in what the app is for.

Sources read 22 September 2026, 8:04pm.

| | Leaftext | Obsidian | Typora | Calibre |
| --- | --- | --- | --- | --- |
| Your documents stay plain files in a folder you own | [✅](01-introduction.md) | [✅](https://obsidian.md/help/data-storage) | [✅](https://typora.io/) | [✅](https://manual.calibre-ebook.com/gui.html) |
| Edit Markdown in the rendered page | [✅](01-features/07-editing.md) | [✅](https://obsidian.md/help/edit-and-read) | [✅](https://typora.io/) | — |
| Read an EPUB as a book, without converting it | [✅](01-features/01-rendering.md#epub-books) | [❌](https://obsidian.md/help/file-formats) | [❌](https://support.typora.io/Install-and-Use-Pandoc/) | [✅](https://manual.calibre-ebook.com/viewer.html) |
| Read Word, Excel and PowerPoint files without converting them | [✅](01-features/01-rendering.md#office-and-opendocument-files) | [❌](https://obsidian.md/help/file-formats) | [❌](https://support.typora.io/Install-and-Use-Pandoc/) | ? |
| Terms linked automatically from one glossary across documents | [✅](01-features/02-navigation.md#glossary) | ? | ? | ? |
| Search the words of every document in a folder or library | [✅](01-features/03-library.md#search) | [✅](https://obsidian.md/help/plugins/search) | [✅](https://support.typora.io/File-Management/) | [✅](https://manual.calibre-ebook.com/gui.html) |
| A map of how documents link to each other | [✅](01-features/03-library.md#graph) | [✅](https://obsidian.md/help/plugins/graph) | ? | — |
| Mermaid diagrams drawn in the page | [✅](01-features/01-rendering.md#mermaid-diagrams) | [✅](https://obsidian.md/help/advanced-syntax) | [✅](https://support.typora.io/Draw-Diagrams-With-Markdown/) | — |
| Connect outside tool servers through MCP | [❌](#outside-tools-through-mcp) | ? | ? | ? |
| An AI agent on your machine can read and edit the open document | [❌](#your-own-ai-agent-in-the-open-document) | ? | ? | ? |
| A record of what you read and write | [✅](01-features/09-progress.md) | ? | ? | ? |

Obsidian's cross for books and Office files is its own list of the formats it opens, which names neither and points to community plugins for the rest. Typora's is its import, which converts those files into Markdown through Pandoc rather than opening them as themselves.

## Working beside AI

A glossary is where Leaftext and an AI tool meet today. Ask the tool you already use to write a `GLOSSARY.md` beside a book, a manual or a folder of notes — one `##` heading per hard term, a short entry under each — and Leaftext underlines every one of those terms wherever it appears and opens its entry in a sheet over the page, so you read the definition without losing your place. The same file keeps a team's words from drifting: when everybody's notes link one entry, a term means one thing. [How to write one →](01-features/02-navigation.md#author-a-glossary)

## On our roadmap

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
