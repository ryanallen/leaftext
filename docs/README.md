# leaftext documentation

> Everything in `docs/` — what each page covers, how the pages fit together, and how the folder becomes [leaftext.com/docs](https://leaftext.com/docs).

leaftext is a desktop reader for Markdown and TEI XML: open a local file, get a clean rendered view, and keep your place with tabs, history, a minimap, and a searchable library. These docs cover the whole app, from installing a release build to the startup-validated theme contract.

## Map

```mermaid
flowchart LR
    A[Introduction] --> B[Installation]
    B --> C[Quickstart]
    C --> D[Features]
    D --> E[Rendering]
    D --> F[Navigation]
    D --> G[Library]
    D --> H[Minimap]
    D --> I[Themes]
    D --> J[Settings]
    D --> P[Editing]
    C --> K[Development]
    K --> L[Architecture]
    K --> M[Building]
    K --> N[Theming]
    K --> O[Releasing]
```

## Start here

| Page | What it covers |
| --- | --- |
| [Introduction](01-introduction.md) | What leaftext is, the feature overview, and where to go for each task |
| [Installation](02-installation.md) | Prebuilt downloads for macOS (`.dmg`), Windows (`.msi`), and Linux (`.tar.gz`), plus data paths and first-launch notes |
| [Quickstart](03-quickstart.md) | The smallest useful path through the app: open a file, read, jump, and reopen — with the core shortcuts |

## Features

How the app behaves, page by page:

| Page | What it covers |
| --- | --- |
| [Rendering](01-features/01-rendering.md) | The full supported syntax with live examples: CommonMark, GFM, syntax highlighting, Mermaid, math, alerts, footnotes, emoji, block permalinks, local images, and TEI XML (84000 translations) |
| [Navigation](01-features/02-navigation.md) | Tabs, Back/Forward history, the outline, scroll anchors, live reload, recent files, link hints, the pager, and the single-window rule |
| [Library](01-features/03-library.md) | The left-side pane backed by a local SQLite index: Project, Tree, and All files views, filename and content search, and file actions |
| [Minimap](01-features/04-minimap.md) | The scaled real-text document clone in the side rail: how it renders, when it rebuilds, responsive widths, and the on/off toggle |
| [Themes](01-features/06-themes.md) | The four theme modes — System, Light, Dark, Dracula — and how they apply through the semantic token contract |
| [Settings](01-features/05-settings.md) | Every preference, its default, and the JSON files on disk that store them |
| [Editing](01-features/07-editing.md) | Inline editing in the rendered page (blocks, checkboxes, undo), the raw-source code view, and the explicit Save flow |

## Development

For anyone building, extending, or releasing leaftext:

| Page | What it covers |
| --- | --- |
| [Architecture](02-development/01-architecture.md) | The Rust binary end to end: tao windowing, wry WebView, the Markdown pipeline, the TEI XML renderer, the IPC bridge, the background indexer, and every source file's role |
| [Building](02-development/02-building.md) | Toolchain prerequisites, platform WebView dependencies, and the `just verify` suite |
| [Theming](02-development/04-theming.md) | The startup-validated contract of ~100 `--leaf-*` CSS custom properties, the theme sources, and how the CSS is compiled and validated |
| [Releasing](02-development/03-releasing.md) | `just release <version>`: the version bump, the tag push, and the CI builds it triggers on all three platforms |

## Shared reference

- [Glossary](GLOSSARY.md) — one shared glossary for all pages. Linking a term like `[minimap](GLOSSARY.md#minimap)` opens the entry in a bottom sheet over the current page instead of navigating away.

## How this folder ships

These pages are plain Markdown, but the folder is also a deployable site:

| File | Role |
| --- | --- |
| `index.html` | The docs shell at leaftext.com/docs — loads the shared site styles and applies the saved theme before first paint |
| `docs.js` | Fills the sidebar navigation and renders the page chosen by the URL route |
| `docs.css` | Docs-only chrome: the sidebar and the page pager |
| `render-docs-check.mjs` | Headless smoke test — renders every `.md` file here with the site renderer and fails loudly on errors or empty output |

Before shipping doc changes, run the check from the repo root:

```sh
node docs/render-docs-check.mjs
```

> [!TIP]
> Every page here is readable two ways: rendered on the website, or opened directly in leaftext itself — the app these docs describe.
