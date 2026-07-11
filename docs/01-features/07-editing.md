# Editing

> A code view for every document: see the raw Markdown or XML source, edit it in place, and save explicitly — the reading view stays a reader.

leaftext is reading-first, but sometimes the fastest fix is in the source. The code view swaps the rendered page for the file's actual text — syntax-highlighted, line-numbered, and editable — and a green **Save** button writes it back to disk. There is no autosave: nothing touches your file until you say so.

## Summary

| Feature | What it means |
| --- | --- |
| Code view | Toggle the rendered page to the raw source and back |
| Highlighting | The source is coloured by the app's own highlighter — Markdown and XML both |
| Line numbers | A gutter numbers each source line, staying pinned when long lines wrap |
| Wrapped lines | Long lines wrap; the code view never scrolls sideways |
| Minimap | The same [minimap](04-minimap.md) rail as the reading view, over the source |
| Editing | Type directly; native undo, `Tab` inserts a tab character |
| Save | A green **Save** button (or `Ctrl+S` / `Cmd+S`) appears only with unsaved changes |
| Unsaved marker | A tab with unsaved edits shows a dot beside its name |

## Code view

The toggle is the code-brackets button in the app bar, left of Settings — it appears whenever a document is open. Click it and the rendered page is replaced by the file's raw source; the button swaps to a document icon, and clicking again returns to the reading view.

- The source is coloured by the same Rust highlighter that colours fenced code blocks in the [reading view](01-rendering.md#code), with both Markdown and XML in its language table — so a `.md` file shows heading, bold, link, and list markers in colour, and a [TEI XML](01-rendering.md#tei-xml-84000-translations) file shows its tags and attributes.
- Long lines wrap instead of scrolling sideways, and the line-number gutter numbers *source* lines — a wrapped line keeps one number, pinned to its first row.
- The rail on the right is the reader's own [minimap](04-minimap.md), showing a scaled thumbnail of the source; click or drag it to move, exactly as in the reading view.
- Toggling keeps your place: the code view opens at the same relative position you were reading, and toggling back returns there.

## Editing the source

The code view is a real editor surface: click anywhere and type.

- Undo and redo are the platform's own (`Ctrl+Z` / `Cmd+Z`), and selection, caret movement, and IME input all behave natively.
- `Tab` inserts a tab character at the caret instead of moving focus; `Shift+Tab` remains the keyboard escape out of the editor.
- Edits re-highlight through the same Rust path on a short debounce, so colour follows what you type.
- Each tab keeps its own edit buffer: switching tabs or toggling back to the reading view never loses unsaved work.
- The reading view renders the *buffer*, not the disk — toggle back before saving and you see your edits rendered.

## Save

Saving is always explicit.

- With no unsaved changes there is no save control at all. The moment the buffer differs from the file, a green **Save** button appears in the app bar and the tab shows a dot beside its name.
- Click **Save** or press `Ctrl+S` (`Cmd+S` on macOS) to write the buffer to disk. The button and dot clear on success.
- A save does not bounce the view: the file watcher recognizes the app's own write and skips the [live reload](02-navigation.md#reload) it would otherwise trigger.

## External changes

The [live reload](02-navigation.md#reload) watcher keeps working alongside editing:

- With a **clean** buffer, an outside change reloads as usual — and if the code view is open, the source refreshes in place.
- With **unsaved edits**, an outside change never clobbers the buffer: your edits stay, and saving writes them over the file.

## Formats

The code view edits the raw source, so it works for both formats leaftext opens: Markdown (`.md`, `.markdown`, `.mdown`) and [TEI XML](01-rendering.md#tei-xml-84000-translations) (`.xml`). The *rendered* view remains read-only for both — editing happens in the source, and the reader shows the result.

## Next

- [Rendering](01-rendering.md) for what the saved Markdown renders as
- [Navigation](02-navigation.md) for tabs, history, and live reload
- [Minimap](04-minimap.md) for the rail the code view shares
