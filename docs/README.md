# Leaftext documentation

> Everything you can do in Leaftext, one page at a time

Leaftext is a free app for reading and writing your own files, with AI agents working beside you. Start with the quickstart, then open the page for whatever you want to do next.

## Start here

| Page | What it covers |
| --- | --- |
| [Introduction](01-introduction.md) | What Leaftext is and what it can do |
| [Installation](02-installation.md) | Install it on Windows or macOS |
| [Quickstart](03-quickstart.md) | Open a file, read it, edit it and come back to it |
| [Get help](04-help.md) | Where to ask a question |
| [Privacy](07-privacy.md) | What stays on your computer, and what does not |
| [How it compares](05-compare.md) | Leaftext beside Obsidian, Typora and Calibre |
| [Le Morte d'Arthur](08-examples/le-morte-darthur/le-morte-darthur.epub) | A whole book to open and read, with [its glossary](08-examples/le-morte-darthur/GLOSSARY.md) |

## What you can do

| Page | What it covers |
| --- | --- |
| [Your own AI agent](01-features/10-agents.md) | Run Claude Code, Codex or Antigravity beside your files |
| [Rendering](01-features/01-rendering.md) | Every kind of file Leaftext draws as a page |
| [Editing](01-features/07-editing.md) | Write straight into the page, or in its source |
| [Navigation](01-features/02-navigation.md) | Tabs, history, shortcuts and finding your place |
| [Library](01-features/03-library.md) | Your folders, search, filters and the link graph |
| [Minimap](01-features/04-minimap.md) | The whole page drawn small down the side |
| [Relational tables](01-features/08-relational-tables.md) | Turn a Markdown table into cards or a board |
| [Themes](01-features/06-themes.md) | Twenty-four color families, light and dark |
| [Settings](01-features/05-settings.md) | Every preference, updates and where files are kept |
| [Your Grove](01-features/09-progress.md) | A record of your reading that grows as you use the app |

## Every detail

Each page above links to a details page holding its full behavior, every edge case and limit included.

| Page | Details of |
| --- | --- |
| [Agents in detail](09-details/agents.md) | [Your own AI agent](01-features/10-agents.md) |
| [Rendering in detail](09-details/rendering.md) | [Rendering](01-features/01-rendering.md) |
| [Editing in detail](09-details/editing.md) | [Editing](01-features/07-editing.md) |
| [Navigation in detail](09-details/navigation.md) | [Navigation](01-features/02-navigation.md) |
| [Library in detail](09-details/library.md) | [Library](01-features/03-library.md) |
| [Minimap in detail](09-details/minimap.md) | [Minimap](01-features/04-minimap.md) |
| [Relational tables in detail](09-details/relational-tables.md) | [Relational tables](01-features/08-relational-tables.md) |
| [Themes in detail](09-details/themes.md) | [Themes](01-features/06-themes.md) |
| [Settings in detail](09-details/settings.md) | [Settings](01-features/05-settings.md) and [Installation](02-installation.md) |
| [Your Grove in detail](09-details/progress.md) | [Your Grove](01-features/09-progress.md) |

## Shared reference

The [glossary](GLOSSARY.md) names every part of Leaftext. Any of its words on these pages opens its entry in a sheet over the page you are reading.

## How this folder ships

These pages are plain Markdown. leaftext.com draws them with the app itself, so every page on the site is Leaftext's own page.

Every page a visitor reaches from the front page is written to one standard: a tagline, a short lead and short paragraphs.

| File | Role |
| --- | --- |
| `index.html` | Sends an old `#/features/editing` link on to the page it meant |
| `render-docs-check.mjs` | Draws every page here through the app's renderer and fails on an error. It needs `just build-web` first |

A number at the front of a file name orders it in the library pane. An old link without the numbers still lands on the right page.
