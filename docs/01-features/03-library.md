# Library

> The library pane lets you browse and search Markdown files from a local SQLite index, with a Graph relationship map plus Project, Tree, and All files views.

The library is the part of leaftext that helps you find documents, not just read the one you already opened. It lives in a left-side pane and is backed by a local indexer.

## Summary

| Feature | What you get |
| --- | --- |
| Graph view | A force-directed map of how your documents link to each other (the default view) |
| Project view | One folder at a time, drilled into the current project |
| Tree view | Nested folder hierarchy |
| All files view | One alphabetized file list |
| Search | Filename and content search, optionally scoped to the files on screen |
| File actions | Right-click a file to open, cut/copy, copy path, rename, reveal, view properties, or delete |

## Views

Pick a view from the picker at the top of the pane. **Graph** is the default; the choice is remembered across restarts.

```mermaid
flowchart LR
    A[Library pane] --> G[Graph]
    A --> B[Project]
    A --> C[Tree]
    A --> D[All files]
```

### Graph

A force-directed relationship map of your library: each **node** is a document, each **edge** is a link that resolves from one indexed document to another (a Markdown link, or a `[[wiki]]` link matched by filename). It answers "how does this fit with everything else?" rather than "where is this file?".

- The document you are reading is highlighted in the accent colour and pulled larger, so you can always spot where you are.
- **Click** a node to open that document. **Hover** a node to light up its direct links and dim the rest.
- **Drag** a node to reposition it, **drag the background** to pan, and **scroll** to zoom.
- **Click a document's tab** in the tab bar and the graph flies to that document's node and zooms in on it. Clicking the tab you are already on rebuilds the map from the current index, so it always reflects the latest links rather than staying on a stale view.
- Resizing the pane re-fits the map to the new size; it no longer waits for a view switch.

How many documents the map draws is set by the [Graph size](05-settings.md#graph-size) setting — from a tight **Focus** neighborhood (the open document and its direct links) up to **Everything** (every indexed document). Smaller sizes render faster; the larger sizes are tuned to stay responsive by easing the layout and repainting less often as it settles.

> [!NOTE]
> With nothing open — the start screen — the **Focus** size seeds the map from your [recent files](02-navigation.md#recent-files) and their links, so the graph is never empty just because no document is active.

### Project

Best when you want to stay focused on one folder.

- Click folders to drill in.
- Use the back arrow to move up.
- Opening a file also points Project view at that file's folder.

### Tree

Best when you want the whole hierarchy visible.

- Folders expand and collapse independently.
- Expanded state is saved.
- Folders with no Markdown files are pruned.

### All files

Best when you know the filename but not the path. (Labelled **All files** in the view picker.)

- One alphabetized list
- No folder nesting

## Search

Search matches both file names and document content.

| Search type | Behavior |
| --- | --- |
| Name matches | Listed first |
| Content matches | Ranked with BM25 and shown with snippets |
| Result limit | Top 50 |
| CJK text | Prefix matching works for unspaced Han text |

Example:

- Query `release` might match `release-notes.md` first by filename.
- It can also match a paragraph inside `roadmap.md`, with a snippet preview.

Opening a content result jumps to the nearest heading.

### Focus vs All

A toggle beside the search box chooses how wide the search reaches:

| Scope | What it searches |
| --- | --- |
| All | The whole indexed library (the default) |
| Focus | Only the documents currently shown in the pane |

In **Focus**, "the documents currently shown" means the [Graph](#graph)'s visible nodes in Graph view, or the listed files in Project, Tree, and All files views — so a search inside a graph focused on one document only turns up matches from that document's neighborhood. The filter runs in the query itself, so a Focus match ranked below the top 50 of a library-wide search still surfaces. Flipping the toggle re-runs the current query, and so does switching views while a Focus search is active. A shown set larger than 1,500 documents is treated as All.

## File actions

Right-click a file row for a context menu of file actions:

| Action | What it does |
| --- | --- |
| Open | Opens the file in the reader |
| Cut | Puts the file on the system clipboard to move on paste |
| Copy | Puts the file on the system clipboard to copy on paste |
| Copy path | Copies the file's full path as text |
| Rename | Edits the name inline; press Enter to apply, Escape to cancel |
| Reveal file | Shows the file in your OS file manager |
| Properties | Opens the OS file-properties view |
| Delete | Moves the file to the Recycle Bin / Trash |

Cut and Copy place the file itself on the system clipboard, so you paste it in your file manager (Explorer, Finder). Delete is reversible — the file goes to the Recycle Bin or Trash, not gone for good. Reveal and Properties map to each OS:

- Windows: Explorer; the file Properties dialog.
- macOS: Finder; Get Info.
- Linux: the default file manager; Properties falls back to revealing the file.

> [!NOTE]
> Clipboard "Copy"/"Cut" and "Properties" are best-effort on Linux, where behavior varies by desktop.

## Live updates

The library pane keeps up with changes on disk, so a file you just created shows up without a manual rescan.

- The same file watcher that drives live reload watches two places: the open document's folder, and — while you are in [Project view](#project) — the folder you are browsing.
- The Project-view folder is watched recursively, so a Markdown file added in it or any of its subfolders is indexed immediately and the pane refreshes, even when no document is open.
- A Markdown file created or edited in the open document's folder is indexed the same way.
- Renaming or deleting a file from the right-click menu updates the pane right away.
- Moving, renaming, or deleting a folder outside the app syncs the affected subtree immediately — new files are indexed and removed files are forgotten without a manual rescan.
- Folders outside both watched locations appear after the next full crawl, or as soon as you open a file from them.

## Indexing

```mermaid
flowchart LR
    A[Filesystem crawl] --> B[4 parse/hash workers]
    B --> C[SQLite manifest]
    C --> D[Graph / Project / Tree / All files views]
    C --> E[Search results]
```

## Facts

| Item | Value |
| --- | --- |
| Storage | `manifest.db` |
| Worker pool | 4 parallel parse/hash workers |
| Large-file cutoff | Files over 2 MB are skipped |
| DB mode | SQLite WAL |
| Progress throttle | 150 ms |
| Full tree refresh throttle | 1500 ms |

## Skips

### Status

- unreadable files
- files over 2 MB
- missing files after a successful rescan

### Folders

Common heavy or generated folders are skipped, including:

- `.git`
- `node_modules`
- `target`
- `vendor`
- `dist`
- `build`
- `.venv`
- `__pycache__`

Root-level system directories are also skipped where appropriate, such as `Windows`, `Program Files`, `AppData`, `Library`, `proc`, and `sys`.

Symlinks and Windows reparse points are not descended.

## Layout

| Behavior | Rule |
| --- | --- |
| Snap shut | Drag narrower than 40 px |
| Reader minimum | Reader stays at least 360 px wide |
| Small window | Pane auto-hides if space is too tight |

Saved library state includes:

- `library_closed`
- `library_width`
- `library_view`
- `graph_scope`
- `library_project_path`
- `library_expanded`

## Toggle

Indexing is off by default.

When enabled:

1. A background crawl starts right away — and again on each app launch while the setting stays on.
2. Search and browse expand as the manifest fills in.

When disabled:

- No background crawl runs.
- Existing manifest data still shows.
- Files you open manually are still indexed.

## Next

- [Settings](05-settings.md)
- [Navigation](02-navigation.md)
- [Architecture](../02-development/01-architecture.md)
