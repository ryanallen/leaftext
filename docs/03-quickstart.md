# Quickstart

> Open your first file and get comfortable with [tabs](01-features/02-navigation.md#tabs), [history](01-features/02-navigation.md#history), the [minimap](01-features/04-minimap.md), and the [library](01-features/03-library.md) — a few minutes, start to finish.

There's nothing to set up. No account, no folder to designate, no plugins to choose. Point Leaftext at a file you already have and start reading. This page walks the shortest useful path: open a file, read it, move around, edit a line, and come back to it later.

> [!NOTE]
> Not installed yet? [Install it first](02-installation.md#install) — three steps per platform. On a Mac, macOS refuses the first launch until you [let it through once](02-installation.md#mac-blocks-the-first-launch).

## The five minutes

1. Press `Ctrl+O` on Windows or `Cmd+O` on macOS.
2. Pick any `.md`, `.xml`, `.json`, `.yaml`, or `.eml` file.
3. Scroll the document, and use the [minimap](#jump) on the right to jump.
4. Open another file to create a [new tab](#a-second-tab).
5. Click into a sentence and [type](#4-edit-a-line).

```mermaid
flowchart LR
    A[Launch Leaftext] --> B[Open a .md, .xml, .json, .yaml, or .eml file]
    B --> C[Read in main pane]
    C --> D[Jump with minimap]
    C --> E[Open another file]
    E --> F[New tab]
    F --> G[Back / Forward keeps history per tab]
```

## 1. Open a file

![The Leaftext home screen with no document open: the Choose file, New document and Add your notes folder buttons with a line under them about what a folder buys, and the recent files list with your favorites beside it beneath that](../imgs/home.png)

| Method | How |
| --- | --- |
| Keyboard | `Ctrl+O` / `Cmd+O` |
| Drag and drop | Drop a `.md`, `.xml`, `.json`, `.yaml`, or `.eml` file onto the window |
| Recent files | Click a file on the no-file home screen |
| Command line / Open with | Launch Leaftext with a file path, or double-click an [associated file](02-installation.md#file-associations) |
| Start a blank one | The **+** in the app bar, or **New document** on the home screen — see [Editing](01-features/07-editing.md#new-document) |
| Point it at a folder | **Add your notes folder** on the home screen, until you have a [vault](01-features/03-library.md#your-first-vault) |

> [!TIP]
> Recent files keeps the last 50 opened files, so reopening a doc is usually one click — and inside a [vault](01-features/03-library.md#vaults) the list is that vault's own. Keep the ones you come back to and they get a column of their own beside it — see [Favorites](01-features/02-navigation.md#favorites).

## 2. Know what you are looking at

![The whole Leaftext window at once: the app bar with its tab strip across the top, the library pane at left, the rendered page with its collapsed outline in the middle, the minimap rail at right, and the floating toolbar over the foot of the page](../imgs/ui-tour.png)

### The app bar, across the top

| Area | What it does |
| --- | --- |
| Leaf mark | Returns to the home screen |
| Library button | Opens and closes the [library pane](01-features/03-library.md) |
| Back / Forward | Moves through document and scroll history |
| Tab bar | Keeps multiple documents open |
| Palette, Open, **+**, Export | Choose a [theme](01-features/06-themes.md#choose), open a file, start a [new document](01-features/07-editing.md#new-document), and [write the page you are reading as a PDF or as a web page](01-features/02-navigation.md#export-the-page). There is no Settings button — every control stands where it applies, so [preferences](01-features/05-settings.md) are wherever they are used |

### The page itself

| Area | What it does |
| --- | --- |
| Main reader | Shows the rendered Markdown, [XML](01-features/01-rendering.md#xml), [JSON/YAML](01-features/01-rendering.md#data-files-json-and-yaml), or [email](01-features/01-rendering.md#email-eml) |
| Outline | A collapsed list of the document's headings at the top, labeled with the document's line count, for jumping to a section |
| Minimap | Shows the whole document and your current viewport |
| Pager | Previous / Next at the foot, where a folder is joined by `README.md` files |

### The floating toolbar, over the foot of the page

| Control | What it does |
| --- | --- |
| Reading / Code / Graph | The three ways of looking at the open document; the one you are in is filled in the accent color |
| Padlock | Unlocks the view you are in so you can [type into it](01-features/07-editing.md#the-padlock) — the page and the source have one each |
| Speed reader | Dims the prose and marks each word's start — see [Speed Reader](01-features/05-settings.md#speed-reader) |
| Typing help | The wand beside the code view: suggestions drawn from your own notes — see [Typing help](01-features/07-editing.md#typing-help) |
| Undo / Save | Appear only when there is something to undo or [save](01-features/07-editing.md#save) |

## 3. Move around

### A second tab

Press `Ctrl+O` / `Cmd+O` again. Leaftext opens the next file in a new tab instead of replacing the current one. Each tab keeps its own history and its own place in the document.

### A link, without leaving the page

Hold `Ctrl` (`Cmd` on macOS) and click a link to another document, or click it with the middle button, and it opens as a tab behind the one you are reading — you keep your place, and it waits for you in the tab strip. Right-click a link for [the same by name](01-features/02-navigation.md#opening-a-link-in-a-new-page), plus copying it or finding the file it points at.

### Jump

Click a heading in the [outline](01-features/02-navigation.md#outline), or click a spot in the [minimap](01-features/04-minimap.md). That jump is added to scroll history, so Back takes you to the previous reading position.

### Shortcuts worth knowing

| Action | Windows | macOS |
| --- | --- | --- |
| Open a file | `Ctrl+O` | `Cmd+O` |
| Close tab | `Ctrl+W` | `Cmd+W` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Back | `Alt+Left` | `Cmd+Left` |
| Forward | `Alt+Right` | `Cmd+Right` |
| Save ([unsaved edits](01-features/07-editing.md#save), your own typing included) | `Ctrl+S` | `Cmd+S` |
| [Undo](01-features/07-editing.md#undo) — a word of your typing, then the last edit | `Ctrl+Z` | `Cmd+Z` |
| [Redo](01-features/07-editing.md#undo) a word of typing, or a whole edit, you took back | `Ctrl+Y` or `Ctrl+Shift+Z` | `Cmd+Shift+Z` |
| [Bold](01-features/07-editing.md#the-format-bar) the highlighted words | `Ctrl+B` | `Cmd+B` |
| [Italic](01-features/07-editing.md#the-format-bar) the highlighted words | `Ctrl+I` | `Cmd+I` |
| [Link](01-features/07-editing.md#the-format-bar) the highlighted words | `Ctrl+K` | `Cmd+K` |
| Select the page — or [the block, its section, the page](01-features/07-editing.md#deleting) with the caret in one | `Ctrl+A` | `Cmd+A` |
| Copy the words highlighted in the document | `Ctrl+C` | `Cmd+C` |
| [Open a link in a new page](01-features/02-navigation.md#opening-a-link-in-a-new-page) | `Ctrl`+click | `Cmd`+click |
| [Find](01-features/02-navigation.md#find-in-this-document) in this document | `Ctrl+F` | `Cmd+F` |
| [Find and replace](01-features/02-navigation.md#find-in-this-document) | `Ctrl+H` | `Cmd+H` |

Mouse side buttons also trigger Back and Forward on Windows.

## 4. Edit a line

Documents open **locked**, so a stray click never changes a file. Open the [padlock](01-features/07-editing.md#the-padlock) on the floating toolbar, then click into any sentence and type — the rendered page [edits in place](01-features/07-editing.md#inline-editing-the-reading-view), and the green **Save** button appears. Leaftext remembers the answer, so you only do this once.

- Highlight words for a [format bar](01-features/07-editing.md#the-format-bar).
- Use the handle and plus in the left [margin](01-features/07-editing.md#the-block-gutter) to drag a block or [add one](01-features/07-editing.md#adding-a-block).
- For the raw source instead, click the code-brackets button on the toolbar. It has a padlock of its own, so unlocking the page does not open the file's text.
- To start from nothing, press the **+** in the app bar for a [new document](01-features/07-editing.md#new-document); its first save asks where to put it.

Checkboxes are the exception to the padlock: a `- [ ]` box is clickable either way, and ticking it saves on the spot.

The [Editing](01-features/07-editing.md) page covers the whole flow.

## 5. Come back to it

Close the last tab and you will land on the home screen again, where [recent files](01-features/02-navigation.md#recent-files) are listed for quick reopening. To keep a whole folder within reach instead, name it a [vault](01-features/03-library.md#vaults) — then the [library pane](01-features/03-library.md) browses it, [search](01-features/03-library.md#search) covers it, and the [graph](01-features/03-library.md#graph) maps it.

## Try it on this file

Save this as `demo.md` and open it:

~~~md
# Demo

## Checklist

- [x] Open file
- [ ] Read docs

> [!NOTE]
> This is a callout.

```rust
fn main() {
    println!("Leaftext");
}
```
~~~

That single file lets you verify headings, task lists, callouts, and syntax highlighting.

## Next

- [Rendering](01-features/01-rendering.md) for supported syntax and examples
- [Navigation](01-features/02-navigation.md) for tabs, history, and live reload
- [Library](01-features/03-library.md) for [vaults](01-features/03-library.md#vaults), search, and [GitHub sync](01-features/03-library.md#github-sync)
- [Editing](01-features/07-editing.md) for the whole writing flow
