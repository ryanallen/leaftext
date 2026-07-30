# Editing

> Write where you read. Click into a sentence and type, or drop to the raw source — both write back to the same file, and nothing saves until you say so.

Leaf Text is reading-first, but it is also editable. You can edit **in the reading view itself** — click into a sentence and type, toggle a checkbox — and the change is written back into the source at exactly that spot. When you would rather work in the raw text, the **code view** swaps the page for the file's actual source — Markdown, XML, JSON, or YAML. Both paths share one source of truth and one green **Save** button. There is no autosave for text edits: nothing touches your file until you say so — the one exception is ticking a checkbox, which saves on the spot.

## Summary

| Feature | What it means |
| --- | --- |
| Inline editing | Click into the rendered page and edit it directly — see [Formats](#formats) for what each one allows |
| Block editing | `Enter` splits a block or starts a new one; `Backspace` at the start merges into the block above |
| Interactive checkboxes | Click a task checkbox — in a list or a table cell — to check or uncheck it; it saves on the spot and works even with editing off |
| Undo | An Undo button (and `Ctrl+Z` / `Cmd+Z`) steps back through reading-view edits |
| Code view | Toggle the rendered page to the raw source and back |
| Highlighting | The source is colored in the active [theme](06-themes.md)'s syntax colors — Markdown, XML, JSON, and YAML |
| Line numbers | A gutter numbers each source line, staying pinned when long lines wrap |
| Wrapped lines | Long lines wrap; the code view never scrolls sideways |
| Minimap | The editor's own [minimap](04-minimap.md#the-code-views-minimap) rail, drawn on the window's chrome beside the page |
| Editing | Type directly; undo/redo, selection, clipboard, and IME all work, and `Tab` indents instead of moving focus. A multi-megabyte file [stays responsive](#editing-the-source) |
| Save | A green **Save** button (or `Ctrl+S` / `Cmd+S`) appears only with unsaved changes |
| Unsaved marker | A tab with unsaved edits shows a dot beside its name |
| Read-only | Documents open locked. The [padlock](#the-padlock) on the reading view's toolbar unlocks the one in front of you — except checkboxes, which toggle either way |

## Inline editing (the reading view)

The rendered page is a live editor. The **source stays the single source of truth** — every edit is anchored to the exact byte range of the source it came from and spliced back there, so what you see and what is saved never drift apart. Editing is intentional per block and never rewrites parts of the file you did not touch.

- **Click into a sentence and type.** Paragraphs, headings, **lists, tables, and block quotes** edit in place with their styling intact — bold stays bold, links stay links, table pipes, list markers, and `>` prefixes are rewritten for you — and your change is written back into the Markdown at that spot. Interactive **checkboxes** toggle their `[ ]` / `[x]` marker in the source, in task lists and [table cells](01-rendering.md#tables) alike. A checkbox is a quick action rather than an edit: it saves to disk immediately, records no undo step, and stays clickable even when reading-view editing is turned off.
- **Blocks behave like a block editor.** `Enter` splits a block at the caret — a split heading stays a heading at the same level — or starts a fresh paragraph when pressed at the end (keep pressing to keep writing). `Shift+Enter` inserts a line break, and `Backspace` at the very start of a block merges it into the one above, with the caret staying put. In a list, `Enter` adds an item and `Backspace` joins items.
- **Every other block edits its exact source.** Code blocks, [alerts](01-rendering.md#blockquotes-and-alerts), loose lists, blocks with images, footnotes, or math, and blocks containing raw HTML tags outside a small safe set (links, line breaks, bold, italic, strikethrough, inline code, and the inline HTML tags Leaf Text can rebuild exactly — `<abbr>`, `<kbd>`, `<mark>`, `<ins>`, `<sub>`, `<sup>`, `<span>`, and `<div>`) open their raw source in place when you click them, then splice back on the way out. This is also how **[XML](01-rendering.md#xml)** edits: XML carries meaning the rendered HTML cannot reconstruct, so an XML block is edited as its true source.
- **Nothing is ever mangled.** A block only edits WYSIWYG when its rendered form can be turned back into the identical source; anything else edits its source directly. Either way the edit is a precise splice, and the [live reload](02-navigation.md#reload) watcher recognizes your own save so it never fights it.
- Edits raise the same green **Save** button and unsaved-dot as the code view, and save the same way.
- A document opens **locked**: clicks do not enter edit mode until you say so. See [The padlock](#the-padlock).

## The padlock

Whether the rendered page can be typed into is a fact about *that page*, not a preference for every document you will ever open — so it is a padlock on the reading view's own tools, in the recess beside the reading button on the [floating toolbar](02-navigation.md#the-toolbar).

- A shut padlock means the page is read-only. An open one means you can click into it and type.
- Documents open **locked**. Reading is the default posture, and one click is a cheap price for not editing a file by brushing it.
- The answer lasts as long as the window. A document reopened tomorrow is read-only again, which is the safe way round to be wrong.
- **Checkboxes toggle either way.** Ticking a box is a quick action that auto-saves and records no undo, not text editing.
- The [code view](#code-view) is an editor whatever the padlock says, so a file is never locked outright.
- Flipping the padlock commits whatever block was mid-edit rather than discarding it.

The other reading-view tool lives in the same recess: the [speed reader](05-settings.md#speed-reader), which stays an app-wide preference because it is a way of reading rather than a property of a file. Neither it nor the padlock is filled in the accent color — that treatment means "this is the view you are in", and a setting inside a view must not wear it.

## Undo

Reading-view edits are undoable, step by step.

- Every inline edit — a typed change, a block split or merge — records one undo step. An **Undo** button appears beside Save whenever there is a step to take back, and disappears when there is nothing left to undo. (Checkbox toggles are the exception: they auto-save and are not undoable.)
- Click it, or press `Ctrl+Z` (`Cmd+Z` on macOS), to revert the most recent edit. While you are still typing inside a block, the platform's own undo handles keystrokes as usual; the app-level undo covers edits that have already been written into the buffer.
- A successful **Save** makes the current text the new baseline and clears the undo history, so Undo only ever steps back through edits made since your last save — it never walks you below saved text.

## Code view

The toggle is the code-brackets button on the [floating toolbar](02-navigation.md#the-toolbar) under the page, beside reading and the [graph](03-library.md#graph). Click it and the rendered page is replaced by the file's raw source; click the reading button to come back.

Opening another document while you are in the source view opens **that** document in the source view. The view is where you are working, not a property of the file you picked.

- The source is colored in the active [theme](06-themes.md#tokens)'s own syntax colors, so the code view looks like the rest of the app rather than like a foreign editor dropped into it: headings and list markers in the keyword color and bold, bold and italic text at their real weight and slant, inline and fenced code in the string color, links in the link color, block quotes in the comment color. An [XML](01-rendering.md#xml) file shows its tags and attribute names in their own colors, and a [JSON or YAML](01-rendering.md#data-files-json-and-yaml) file its keys, values, numbers, and punctuation. Switching theme or flipping light/dark re-colors the open source in place.
- Long lines wrap instead of scrolling sideways, and the gutter numbers *source* lines — a wrapped line keeps one number, pinned to its first row. The gutter widens to fit the highest number in the file, and the numbers stand clear of the page's left border rather than against it.
- The rail on the right is the editor's own [minimap](04-minimap.md#the-code-views-minimap): a scaled drawing of the source, with the same viewport box the reading view's rail uses. Drag the box or click the rail to move. It stands on the window's textured chrome, not on the page — the page's right border is the line between them.
- Toggling keeps your place: the code view opens on the source line of the block you were reading, and toggling back lands the reading view on that same block. Switching to another tab and back does too — a tab left in the code view comes back in the code view, scrolled to where you left it.

## Editing the source

The code view is a real editor surface: click anywhere and type. It is Monaco — the editor Visual Studio Code is built on — compiled into the app rather than fetched from anywhere, and loaded the first time you open the source view. That first toggle spends a moment on the spinner; every one after it is immediate.

- Selection, caret movement, undo and redo (`Ctrl+Z` / `Cmd+Z`, `Ctrl+Y` / `Cmd+Shift+Z`), clipboard (`Ctrl+C` / `X` / `V`), and your platform's IME are the editor's own. `Tab` indents at the caret rather than moving focus.
- Color follows your typing: the source is tokenized as you go, so a construct takes its color the moment you finish typing it.
- A multi-megabyte file types and scrolls like a short one, because only the lines on screen are ever drawn. Earlier versions carried a hand-built surface to manage that; the editor does it now.
- What reaches the host is the edit, not the file: the offset, how much was removed, and what was typed. Sending a multi-megabyte buffer on every pause in typing cost a fifth of a second of it. The message carries the buffer's new length too, so if the host's copy ever disagreed it would ask for the whole text again rather than splice into a buffer it no longer understood.
- Each tab keeps its own edit buffer: switching tabs or toggling back to the reading view never loses unsaved work.
- The reading view renders the *buffer*, not the disk — toggle back before saving and you see your edits rendered.

## Save

Saving is always explicit.

- With no unsaved changes there is no save control at all. The moment the buffer differs from the file, a green **Save** button appears on the [floating toolbar](02-navigation.md#the-toolbar) and the tab shows a dot beside its name.
- Click **Save** or press `Ctrl+S` (`Cmd+S` on macOS) to write the buffer to disk. The button and dot clear on success.
- A save does not bounce the view: the file watcher recognizes the app's own write and skips the [live reload](02-navigation.md#reload) it would otherwise trigger.

## External changes

The [live reload](02-navigation.md#reload) watcher keeps working alongside editing:

- With a **clean** buffer, an outside change reloads as usual — and if the code view is open, the source refreshes in place.
- With **unsaved edits**, an outside change never clobbers the buffer: your edits stay, and saving writes them over the file.

## Formats

The [code view](#code-view) edits every format Leaf Text opens, as the whole-file source editor: Markdown (`.md`, `.markdown`, `.mdown`), [XML](01-rendering.md#xml) (`.xml`), and [JSON and YAML](01-rendering.md#data-files-json-and-yaml) (`.json`, `.yaml`, `.yml`).

What the *reading view* offers differs by format, because a block can only be edited in place when the app knows the exact bytes it came from:

| Format | In the reading view |
|---|---|
| Markdown text blocks | Edit WYSIWYG — type in the rendered page, styling intact |
| Markdown blocks that cannot round-trip losslessly | Edit their exact source in place |
| XML | Edit their exact source in place |
| JSON | Edit their exact source in place |
| YAML plain values | Edit their exact source in place |
| YAML lists, tables, quoted strings, block scalars | Read-only; edited in the code view |

### Editing data files

A data file is edited as *source*, never as rendered text. Click a JSON value in the reading view and you get the real thing — `"0.1.380"` with its quotes — which is what keeps an edit from turning a string into something the file no longer parses as.

That only works where the byte range is certain, so Leaf Text offers it only where it is:

- **JSON** — everywhere. The reader knows precisely where each value begins and ends, so every value is click-to-edit.
- **YAML plain values** — where proven. A plain scalar's source text is checked character-for-character against the value it parsed to; when they match, the range is exact and the value is editable.
- **Everything else in YAML** — read-only in the reading view. A quoted string or a block scalar (`|`, `>`) carries quotes or an indicator that its value does not, and nothing can prove where a YAML list or mapping *ends* — its closing position points at whatever token came next. Rather than splice an edit over a guessed range and corrupt the file, Leaf Text offers no inline editor and leaves these to the code view.

> [!NOTE]
> This is a deliberate floor, not a gap to work around: a range that is off by one byte writes an edit into the wrong place silently. Where the range cannot be proved, the code view edits the file with the full source in front of you.

## Next

- [Rendering](01-rendering.md) for what the saved Markdown renders as
- [Navigation](02-navigation.md) for tabs, history, and live reload
- [Minimap](04-minimap.md#the-code-views-minimap) for the rail beside the source
