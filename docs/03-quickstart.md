# Quickstart

> Open a Markdown or TEI XML file, learn the core controls, and get comfortable with [tabs](01-features/02-navigation.md#tabs), [history](01-features/02-navigation.md#history), the [minimap](01-features/04-minimap.md), and the [library](01-features/03-library.md) in a few minutes.

leaftext is meant to be usable immediately. This page shows the smallest useful path through the app: open a file, read it, move around, and reopen it later.

## Start

1. Press `Ctrl+O` on Windows/Linux or `Cmd+O` on macOS.
2. Pick any `.md` or `.xml` file.
3. Scroll the document.
4. Use the minimap on the right to jump.
5. Open another file to create a new tab.

## Flow

```mermaid
flowchart LR
    A[Launch leaftext] --> B[Open a .md or .xml file]
    B --> C[Read in main pane]
    C --> D[Jump with minimap]
    C --> E[Open another file]
    E --> F[New tab]
    F --> G[Back / Forward keeps history per tab]
```

## Open

| Method | How |
| --- | --- |
| Keyboard | `Ctrl+O` / `Cmd+O` |
| Drag and drop | Drop a `.md` or `.xml` file onto the window |
| Recent files | Click a file on the no-file home screen |
| Command line / Open with | Launch leaftext with a file path |

> [!TIP]
> Recent files keeps the last 8 opened files, so reopening a doc is usually one click.

## UI

| Area | What it does |
| --- | --- |
| Tab bar | Keeps multiple documents open |
| Main reader | Shows the rendered Markdown or TEI XML |
| Outline | A collapsed list of the document's headings at the top, labelled with the document's line count, for jumping to a section |
| Minimap | Shows the whole document and your current viewport |
| Back / Forward | Moves through document and scroll history |
| Code view | Toggles the page to its raw, editable source — see [Editing](01-features/07-editing.md) |
| Save | A green button that appears when the source has [unsaved edits](01-features/07-editing.md#save) |
| Library pane | Lets you browse, graph, and search indexed Markdown files |

## Basics

### New tab

Press `Ctrl+O` / `Cmd+O` again. leaftext opens the next file in a new tab instead of replacing the current one.

### Jump

Click a heading in the document or click a spot in the minimap. That jump is added to scroll history, so Back takes you to the previous reading position.

### History

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Back | `Alt+Left` | `Cmd+Left` |
| Forward | `Alt+Right` | `Cmd+Right` |
| Close tab | `Ctrl+W` | `Cmd+W` |
| Save ([unsaved edits](01-features/07-editing.md#save)) | `Ctrl+S` | `Cmd+S` |
| [Undo](01-features/07-editing.md#undo) the last edit | `Ctrl+Z` | `Cmd+Z` |

Mouse side buttons also trigger Back and Forward on Windows and Linux.

### Edit

Click into any sentence and type — the rendered page [edits in place](01-features/07-editing.md#inline-editing-the-reading-view), checkboxes toggle, and the green **Save** button appears. For the raw source instead, click the code-brackets button left of Settings. The [Editing](01-features/07-editing.md) page covers the whole flow.

### Reopen

Close the last tab and you will land on the no-file view again, where recent files are listed for quick reopening.

## Demo

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
    println!("leaftext");
}
```
~~~

That single file lets you verify headings, task lists, callouts, and syntax highlighting.

## Next

- [Rendering](01-features/01-rendering.md) for supported syntax and examples
- [Navigation](01-features/02-navigation.md) for tabs, history, and live reload
- [Library](01-features/03-library.md) for search and indexing
