<div align="center">

# Leaf Text

> A desktop reader for Markdown. Open a file. Read it.

![Leaf Text — Markdown, made to read](imgs/leaftext.png)

<a href="https://github.com/ryanallen/leaftext/releases"><img alt="Download" src="https://img.shields.io/badge/download-latest-0ea5e9?style=flat&labelColor=4b5563"></a>
<a href="https://github.com/ryanallen/leaftext/releases"><img alt="macOS" src="https://img.shields.io/badge/macOS-Universal-silver?style=flat&labelColor=4b5563"></a>
<a href="https://github.com/ryanallen/leaftext/releases"><img alt="Windows" src="https://img.shields.io/badge/Windows-x64-0078d4?style=flat&labelColor=4b5563"></a>
<a href="https://github.com/ryanallen/leaftext/releases"><img alt="Linux" src="https://img.shields.io/badge/Linux-available-f59e0b?style=flat&labelColor=4b5563"></a>

**[Read the docs →](docs/)** · **[View the project on GitHub →](https://github.com/ryanallen/leaftext)**

</div>

---

A leaf is a page. **Leaf Text** opens a Markdown file and [renders it for reading](docs/features/markdown-rendering.md) — [code](docs/features/markdown-rendering.md#code), [diagrams](docs/features/markdown-rendering.md#mermaid-diagrams), [math](docs/features/markdown-rendering.md#math), [emoji](docs/features/markdown-rendering.md#emoji), just as GitHub would, all on your own machine.

A [minimap](docs/features/minimap.md) for long pages, [tabs](docs/features/navigation.md#tabs) with [history](docs/features/navigation.md#history), [live reload on save](docs/features/navigation.md#reload), and a searchable [library](docs/features/library.md) of every Markdown file you own. [Light, dark, and Dracula](docs/features/themes.md).

No editor, no clutter — just the rendered page.

## Documentation

New here? Start with the **[Quickstart](docs/quickstart.md)**, or browse the **[full documentation](docs/introduction.md)**.

The pages are plain Markdown under [`docs/`](docs/) — edit them there.

## Installation

Full setup notes — including troubleshooting — live in the [Installation guide](docs/installation.md).

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

See [Building](docs/development/building.md), [Architecture](docs/development/architecture.md), and [Releasing](docs/development/releasing.md) for the full developer docs.

Run the full verification suite before handing work back:

```sh
just verify
```

Other [`Justfile`](Justfile) tasks:

| Task | Command |
|:--|:--|
| Cut a release | `just release <version>` |

`just release` commits the version bump, tags, and pushes — CI builds the Windows MSI, macOS DMG, and Linux artifacts.
