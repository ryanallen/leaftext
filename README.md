<div align="center">

# Leaf Text

> A desktop reader for Markdown and TEI XML. Open a file. Read it.

![Leaf Text — Readable XML and Markdown](imgs/leaftext.png)

<a href="https://github.com/ryanallen/leaftext/releases"><img alt="Download" src="https://img.shields.io/badge/download-latest-0ea5e9?style=flat&labelColor=4b5563"></a>
<a href="https://github.com/ryanallen/leaftext/releases"><img alt="macOS" src="https://img.shields.io/badge/macOS-Universal-silver?style=flat&labelColor=4b5563"></a>
<a href="https://github.com/ryanallen/leaftext/releases"><img alt="Windows" src="https://img.shields.io/badge/Windows-x64-0078d4?style=flat&labelColor=4b5563"></a>
<a href="https://github.com/ryanallen/leaftext/releases"><img alt="Linux" src="https://img.shields.io/badge/Linux-available-f59e0b?style=flat&labelColor=4b5563"></a>

**[Read the docs →](docs/)** · **[View the project on GitHub →](https://github.com/ryanallen/leaftext)**

</div>

---

**Leaf Text** opens your Markdown and TEI XML files to read, edit, and understand: a clean rendered view you can type straight into, and a [graph](docs/01-features/03-library.md#graph) that shows how your documents relate. Everything runs locally, on your own machine, with no account and no cloud.

## Features

### Read Markdown and TEI XML

![The Leaf Text reading view rendering a Markdown document](imgs/feature-rendering.png)

Open a `.md` file and Leaf Text renders it exactly as GitHub would — CommonMark and GitHub Flavored Markdown with the extras people actually use: [syntax-highlighted code](docs/01-features/01-rendering.md#code), [Mermaid diagrams](docs/01-features/01-rendering.md#mermaid-diagrams), [math](docs/01-features/01-rendering.md#math), [GitHub alerts](docs/01-features/01-rendering.md#blockquotes-and-alerts), [footnotes](docs/01-features/01-rendering.md#footnotes), [emoji](docs/01-features/01-rendering.md#emoji), task lists, and [local images](docs/01-features/01-rendering.md#images). It also opens [84000-style TEI XML](docs/01-features/01-rendering.md#tei-xml-84000-translations) — the Buddhist-canon translation format — through a parallel renderer into the same clean reading view. **[Rendering →](docs/01-features/01-rendering.md)**

### Edit in place, save on your terms

![Inline editing in the rendered page, with the green Save button](imgs/feature-editing.png)

Reading-first, but editable. Click into a sentence in the rendered page and type, or toggle a checkbox — the change is written back to the source at exactly that spot. Prefer raw text? Drop to the [code view](docs/01-features/07-editing.md#code-view) for the file's actual Markdown or XML, with editor-style colouring of every delimiter. There's no autosave: nothing touches your file until you press **Save**. **[Editing →](docs/01-features/07-editing.md)**

### Find every file

![The library pane with the document graph view](imgs/feature-library.png)

A left-side pane backed by a local SQLite index of every Markdown file you own — search it, or browse by Project, Tree, or All files. A [graph view](docs/01-features/03-library.md#graph) maps how your documents link to one another, so you can see the shape of your notes instead of just a list. **[Library →](docs/01-features/03-library.md)**

### Stay oriented with the minimap

![The minimap rail showing a scaled clone of the document](imgs/feature-minimap.png)

A shrunken clone of the page in a side rail — real, tiny text, not abstract bars — with a live viewport indicator. Recognize where you are from the shape of the text itself, click any section to jump, or drag the indicator to scroll. **[Minimap →](docs/01-features/04-minimap.md)**

### Navigate like a browser

![Tabs and Back/Forward history in the app bar](imgs/feature-navigation.png)

[Tabs](docs/01-features/02-navigation.md#tabs), Back/Forward [history](docs/01-features/02-navigation.md#history), in-document jumps, and scroll restoration after reloads. Save a file in your editor and Leaf Text [live-reloads](docs/01-features/02-navigation.md#reload) it, keeping your place. **[Navigation →](docs/01-features/02-navigation.md)**

### Make it yours

![The same document across leaftext themes](imgs/feature-themes.png)

Five theme families — [Fern, GitHub, Dracula, Obsidian, and Græy](docs/01-features/06-themes.md#families) — each with light and dark variants plus System and Daylight appearance, applied through a semantic token contract so the reader, code, alerts, and minimap always stay visually consistent. Fonts load from Google Fonts on demand — nothing is bundled. **[Themes →](docs/01-features/06-themes.md)**

### Settings that stick

![The Leaf Text settings panel](imgs/feature-settings.png)

Theme, speed reader, minimap, pager, indexing, library layout, window size, and interface language (English or Simplified Chinese) — stored locally and durable across restarts. **[Settings →](docs/01-features/05-settings.md)**

## Documentation

New here? Start with the **[Quickstart](docs/03-quickstart.md)**, or browse the **[full documentation](docs/01-introduction.md)**.

The pages are plain Markdown under [`docs/`](docs/) — edit them there.

## Installation

Full setup notes — including troubleshooting — live in the [Installation guide](docs/02-installation.md).

### macOS

Download the universal DMG from [Releases](https://github.com/ryanallen/leaftext/releases). Mount it and drag **Leaf Text** onto the **Applications** shortcut.

**First launch — "not verified" warning**

macOS quarantines apps downloaded from the internet. If you see a prompt saying Leaf Text can't be opened because it's from an unidentified developer, run this in Terminal after dragging the app to Applications:

```sh
xattr -cr /Applications/leaftext.app
```

Then open the app normally.

### Windows

Download the 64-bit MSI from [Releases](https://github.com/ryanallen/leaftext/releases). Default install path:

```text
C:\Program Files\leaftext\bin\leaftext.exe
```

WebView2 browser data is stored in the current user's profile — not beside the executable — so it stays writable even under `Program Files`:

```text
%LOCALAPPDATA%\ryanallen\leaftext\data\webview2
```

To find the installed executable path: right-click the Start Menu shortcut → **More** → **Open file location** → right-click the Leaf Text shortcut → **Properties** → **Target**.

### Linux

Linux builds are on the [Releases](https://github.com/ryanallen/leaftext/releases) page.

---

## Development

See [Building](docs/02-development/02-building.md), [Architecture](docs/02-development/01-architecture.md), and [Releasing](docs/02-development/03-releasing.md) for the full developer docs.

Run the full verification suite before handing work back:

```sh
just verify
```

Other [`Justfile`](Justfile) tasks:

| Task | Command |
|:--|:--|
| Cut a release | `just release <version>` |

`just release` commits the version bump, tags, and pushes — CI builds the Windows MSI, macOS DMG, and Linux artifacts.
