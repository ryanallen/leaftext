# Meet leaftext

> A desktop reader for Markdown and TEI XML files: fast to open, easy to scan, and reading-first — and when a file needs a fix, [edit it right on the page](01-features/07-editing.md).

leaftext is a desktop app for reading local Markdown and [TEI XML](01-features/01-rendering.md#tei-xml-84000-translations) on macOS, Windows, and Linux. Open a file, get a clean rendered view, and keep your place with [tabs](01-features/02-navigation.md#tabs), [history](01-features/02-navigation.md#history), a [minimap](01-features/04-minimap.md), and a searchable [library](01-features/03-library.md). When a document needs a change, [edit it inline in the rendered page](01-features/07-editing.md#inline-editing-the-reading-view) — or drop to the raw source in the [code view](01-features/07-editing.md#code-view) — and [save](01-features/07-editing.md#save) without leaving the app.

New to the terms? Words like [minimap](GLOSSARY.md#minimap) and [frontmatter](GLOSSARY.md#frontmatter) link into the [glossary](GLOSSARY.md#glossary) — clicking one opens its entry in a [bottom sheet](GLOSSARY.md#bottom-sheet) over this page instead of taking you away from it.

## Overview

| You want to... | Start here |
| --- | --- |
| Install the app | [Installation](02-installation.md) |
| Open your first file | [Quickstart](03-quickstart.md) |
| Check rendering support | [Rendering](01-features/01-rendering.md) |
| Change the look | [Themes](01-features/06-themes.md) |
| Learn the app model | [Navigation](01-features/02-navigation.md) |

## Features

- Read Markdown and [TEI XML](01-features/01-rendering.md#tei-xml-84000-translations) without opening an editor.
- [Render](01-features/01-rendering.md) CommonMark, GFM, [Mermaid](01-features/01-rendering.md#mermaid-diagrams), [math](01-features/01-rendering.md#math), [alerts](01-features/01-rendering.md#blockquotes-and-alerts), [footnotes](01-features/01-rendering.md#footnotes), [emoji](01-features/01-rendering.md#emoji), and local images.
- Keep multiple documents open in [tabs](01-features/02-navigation.md#tabs).
- Jump to any section from the [outline](01-features/02-navigation.md#outline) — a collapsed table of contents at the top of each document.
- Move [back and forward](01-features/02-navigation.md#history) through documents and in-page jumps.
- Browse indexed Markdown files in the [library pane](01-features/03-library.md), or see how they connect in the [graph view](01-features/03-library.md#graph).
- [Reload](01-features/02-navigation.md#reload) the current file when it changes on disk.
- [Edit inline in the reading view](01-features/07-editing.md#inline-editing-the-reading-view): click into a sentence and type, split and merge blocks with `Enter` and `Backspace`, toggle task checkboxes, and [undo](01-features/07-editing.md#undo) step by step.
- Toggle any document to its raw source in the [code view](01-features/07-editing.md#code-view) — highlighted, line-numbered, editable — and [save](01-features/07-editing.md#save) explicitly.
- Enable [Speed Reader](01-features/05-settings.md#speed-reader) to dim prose text, quiet links, and add bold lead anchors so the reading path pops against the background.

## Layout

```mermaid
flowchart LR
    A[Open Markdown or TEI XML file] --> B[Rendered reading view]
    B --> C[Minimap]
    B --> D[Tabs]
    B --> E[Back / Forward history]
    B --> F[Library pane]
```

## Example

~~~md
# Release Notes

> [!TIP]
> Drag this file into leaftext.

- [x] Ship docs refresh
- [ ] Review screenshots

```ts
console.log("Hello from leaftext");
```
~~~

That file opens as a formatted document, not as source code in an editor.

## Next

- [Quickstart](03-quickstart.md) shows the actual reading flow.
- [Rendering](01-features/01-rendering.md) shows what Markdown syntax and TEI XML structure the app renders.
- [Library](01-features/03-library.md) explains search, indexing, and the side pane.
