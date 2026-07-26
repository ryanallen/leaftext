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
| Highlighting | The source is coloured by the app's own highlighter — Markdown, XML, JSON, and YAML |
| Line numbers | A gutter numbers each source line, staying pinned when long lines wrap |
| Wrapped lines | Long lines wrap; the code view never scrolls sideways |
| Minimap | The same [minimap](04-minimap.md) rail as the reading view, over the source |
| Editing | Type directly; native undo, `Tab` inserts a tab character |
| Save | A green **Save** button (or `Ctrl+S` / `Cmd+S`) appears only with unsaved changes |
| Unsaved marker | A tab with unsaved edits shows a dot beside its name |
| Read-only | A [setting](05-settings.md#reading-view-editing) turns reading-view editing off, keeping the rendered page read-only — except checkboxes, which still toggle |

## Inline editing (the reading view)

The rendered page is a live editor. The **source stays the single source of truth** — every edit is anchored to the exact byte range of the source it came from and spliced back there, so what you see and what is saved never drift apart. Editing is intentional per block and never rewrites parts of the file you did not touch.

- **Click into a sentence and type.** Paragraphs, headings, **lists, tables, and block quotes** edit in place with their styling intact — bold stays bold, links stay links, table pipes, list markers, and `>` prefixes are rewritten for you — and your change is written back into the Markdown at that spot. Interactive **checkboxes** toggle their `[ ]` / `[x]` marker in the source, in task lists and [table cells](01-rendering.md#tables) alike. A checkbox is a quick action rather than an edit: it saves to disk immediately, records no undo step, and stays clickable even when reading-view editing is turned off.
- **Blocks behave like a block editor.** `Enter` splits a block at the caret — a split heading stays a heading at the same level — or starts a fresh paragraph when pressed at the end (keep pressing to keep writing). `Shift+Enter` inserts a line break, and `Backspace` at the very start of a block merges it into the one above, with the caret staying put. In a list, `Enter` adds an item and `Backspace` joins items.
- **Every other block edits its exact source.** Code blocks, [alerts](01-rendering.md#blockquotes-and-alerts), loose lists, blocks with images, footnotes, or math, and blocks containing raw HTML tags outside a small safe set (links, line breaks, bold, italic, strikethrough, inline code, and the inline HTML tags Leaf Text can rebuild exactly — `<abbr>`, `<kbd>`, `<mark>`, `<ins>`, `<sub>`, `<sup>`, `<span>`, and `<div>`) open their raw source in place when you click them, then splice back on the way out. This is also how **[XML](01-rendering.md#xml)** edits: XML carries meaning the rendered HTML cannot reconstruct, so an XML block is edited as its true source.
- **Nothing is ever mangled.** A block only edits WYSIWYG when its rendered form can be turned back into the identical source; anything else edits its source directly. Either way the edit is a precise splice, and the [live reload](02-navigation.md#reload) watcher recognizes your own save so it never fights it.
- Edits raise the same green **Save** button and unsaved-dot as the code view, and save the same way.
- Prefer a pure reading experience? Turn off **Reading-view editing** in [Settings](05-settings.md#reading-view-editing) and the rendered page becomes read-only — clicks no longer enter edit mode. Checkboxes are the one exception: they still toggle and auto-save, since ticking a box is an action, not text editing. The [code view](#code-view) still edits the source, so the file is never locked outright.

## Undo

Reading-view edits are undoable, step by step.

- Every inline edit — a typed change, a block split or merge — records one undo step. An **Undo** button appears beside Save whenever there is a step to take back, and disappears when there is nothing left to undo. (Checkbox toggles are the exception: they auto-save and are not undoable.)
- Click it, or press `Ctrl+Z` (`Cmd+Z` on macOS), to revert the most recent edit. While you are still typing inside a block, the platform's own undo handles keystrokes as usual; the app-level undo covers edits that have already been written into the buffer.
- A successful **Save** makes the current text the new baseline and clears the undo history, so Undo only ever steps back through edits made since your last save — it never walks you below saved text.

## Code view

The toggle is the code-brackets button in the app bar, left of Settings — it appears whenever a document is open. Click it and the rendered page is replaced by the file's raw source; the button swaps to a document icon, and clicking again returns to the reading view.

- The source is coloured by the same Rust highlighter that colours fenced code blocks in the [reading view](01-rendering.md#code), with Markdown, XML, JSON, and YAML all in its language table. Each construct's *delimiters* are coloured to match their content the way a code editor does — the `#` of a heading, the `[]` and `()` of a link, the `**` and backticks of bold and inline code, the `>` of a quote — rather than left as plain text, and headings and bold read in bold. An [XML](01-rendering.md#xml) file shows its tags, with element names in bold and attribute names in their own colour, and a [JSON or YAML](01-rendering.md#data-files-json-and-yaml) file shows its keys, values, and punctuation the way an editor would.
- Long lines wrap instead of scrolling sideways, and the line-number gutter numbers *source* lines — a wrapped line keeps one number, pinned to its first row.
- The rail on the right is the reader's own [minimap](04-minimap.md), showing a scaled thumbnail of the source; click or drag it to move, exactly as in the reading view.
- Toggling keeps your place: the code view opens on the source line of the block you were reading, and toggling back lands the reading view on that same block. Switching to another tab and back does too — a tab left in the code view comes back in the code view, scrolled to where you left it.

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
- [Minimap](04-minimap.md) for the rail the code view shares
