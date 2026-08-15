---
name: add-format
description: Teach the app to read another kind of file. One arm in src/format.rs, then fix every match the compiler then refuses — the file dialog, drag and drop, link following, the pager, the library pane and the render router all ask that one table, so there is never a second list of extensions. Use when the user wants a new file type opened, or asks why some extension does not open.
argument-hint: "[extension or format]"
user-invocable: true
---

# Add a format

`src/format.rs` is the **only** table of readable formats and their extensions. Six things ask it: the Open dialog's filters, drag and drop, whether a clicked link opens in the reading view or goes to the OS, the pager's page list, the library pane, and the render router.

So a new format is one arm there, and then whatever stops compiling. **Never a second list.** A hard-coded extension somewhere else is how the dialog and the pager end up disagreeing about what a document is.

## The work

1. **One arm in `DocumentFormat`**, with its extensions.
2. **`cargo check`.** The matches on the enum are exhaustive on purpose, so the compiler now names every place that has to account for it. Work the list.
3. **The renderer.** A format that parses to the same shape as an existing one goes through that pipeline — JSON and YAML both parse to one ordered tree and are rendered by `xml.rs`'s shape rules. A genuinely new shape is its own module beside them.
4. **Source ranges, if the reading view is to edit it.** A block gets `data-src-*` only where its range is *proved*, never guessed: the reading view splices that range verbatim, so a wrong end corrupts the file. If the ranges cover a value rather than its key — as they do for JSON and YAML — the block gutter must stay off for it, because moving a block would leave its key behind.
5. **A test per claim**, in `src/tests/`: it opens, it renders, and its ranges are right. `/sync-tests` names what is missing.
6. **`/sync-docs`.** Four published pages carry the format list: the rendering page, the library's file types, the installation page's file associations, and the README.

## What the two questions mean

- `for_path` answers **"can this be opened at all?"** — `None` if not. The dialog and drag-and-drop ask this one.
- `from_path` answers **"render it as what?"** — falling back to Markdown, so an extension-less `README` still opens.

Getting these the wrong way round makes every file openable, or none.

**Anything this pass finds that it is not here to do is a ticket, written before the hand-back** — with [`/ticket`](../ticket/SKILL.md), its row in `../docs/README.md`, ranked by [`/pm`](../pm/SKILL.md). Naming it in a reply instead is the failure `AGENTS.md` refuses: saying a thing is out of scope proves you found it and handed the filing back to the owner.

## Reference

- `src/format.rs` — the table.
- `src/xml.rs`, `src/data.rs`, `src/eml.rs`, `src/tei.rs` — what a renderer looks like.
- `/sync-tests`, `/sync-docs`.

<!-- keycode: LEAF-C08A -->
