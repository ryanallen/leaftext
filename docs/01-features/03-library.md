# Library

> Point Leaftext at a folder and it becomes a vault: a browsable file tree, a searchable body of text, and a map of how those documents link to each other. Nothing is crawled, nothing is written into your folder, and a vault can sync itself to GitHub.

The library is the part of Leaftext that helps you find documents, not just read the one you already opened. It lives in a left-side pane, and everything it shows is read from disk when you ask for it.

![The library pane open beside a document: the vault switcher at top left, the folder breadcrumb beneath it, the search box, and a file list showing folders first and then files](../../imgs/library.png)

## Summary

| Feature | What you get |
| --- | --- |
| [Vaults](#vaults) | A folder you name as a library root. The switcher beside the breadcrumb creates, edits and moves between them |
| [First-launch bubble](#the-bubble-on-your-first-launch) | One bubble points at the switcher the first time you open the pane, and goes for good the moment you point at that button |
| [File tree](#file-tree) | One folder at a time, with a breadcrumb showing where you are and a row that steps back out |
| [Breadcrumb](#file-tree) | The folder path above the search box; every crumb steps back to that level, and what does not fit collapses into a `…` menu |
| [Search](#search) | Filename and content search across the active vault |
| [Filtering](#filtering) | More than words in the search box: `#work status:open due:<friday -draft` |
| [Other names](#other-names) | A note's `aliases` field: every name in it works wherever the file's own name works |
| [Graph](#graph) | A force-directed map of how documents link to each other, shown on the page rather than in the pane |
| [Cloud folders](#your-cloud-is-already-a-folder) | Dropbox, OneDrive, iCloud Drive, Box, Nextcloud and Google Drive become vaults on their own when their app is on this machine, and their rows wear a cloud |
| [GitHub sync](#github-sync) | A vault can be a git repository that pushes to GitHub, with a sync button in its own header — and a repository can be [cloned](#clone-a-repository) into a new vault |
| [File actions](#file-actions) | Right-click a file to open, cut/copy, copy path, rename, reveal, view properties, or delete |
| [Folder actions](#folders-and-the-space-around-them) | Right-click a folder — or the empty space in the pane — to paste, reveal it, or see its properties |
| [Narrow windows](#narrow-windows) | Too tight for a pane beside the page? The library slides in over it as a full-width sheet |

## Vaults

![The vault switcher open, lit as one shape with the vault's name beside it: the Library entry at the top for the no-vault state, then each vault with a settings button on its row and a cloud on the ones a sync client keeps, then New vault and Clone a repository at the foot](../../imgs/vault-switcher.png)

A **vault** is a folder you have told Leaftext to treat as a library root. It is the unit that search and syncing work over, and it is what makes the [graph](#graph) bigger — but not what makes the graph possible.

The button at the left of the breadcrumb opens the vault switcher. What it wears says what you are in: **this machine** for the whole library, a **box** for a vault whose files only live here, and a **cloud** when saving in that vault also reaches somewhere else — [GitHub](#github-sync), or a [cloud folder](#your-cloud-is-already-a-folder).

While the list is open, the button and the vault's name beside it light as one shape, because what you pick changes the whole pane — the name, the path, the file tree and what search reads — rather than the icon you pressed. The name is still a place: clicking it goes to the vault's top folder.

- **Library** is the no-vault state, marked with the machine rather than a box because it is not a collection — the pane starts at your drive roots and browses anywhere. Search is unavailable, because it has no bounded set of words to read. The graph still works: it maps the open document instead of a vault.
- **A vault** roots the pane at that folder. Everything below it is browsable, searchable and mappable.
- **New vault…** opens a folder picker; the folder's name becomes the vault's name.
- **Clone a repository…** takes a git address and makes the clone a vault. See [below](#clone-a-repository).
- The settings button on a vault's row opens a panel to rename it, point it at a different folder, remove it, or connect it to [GitHub](#github-sync).

> [!NOTE]
> **Nothing is written into your folder.** A vault is a row in Leaftext's own database, not a marker file. Removing a vault forgets it; the folder and its files are untouched.

### The bubble on your first launch

A caret and a mark is not much to go on, so the first time you open Leaftext with the pane showing, a small bubble floats over the window with a chevron aimed at that button, saying **"Pick which folder the list below shows."**

It goes the moment you point at the button, and it never comes back — pressing the button does the same. The bubble itself ignores the pointer, so moving across it on the way somewhere else neither takes the words away nor gets in the way of what is under it. There is no close button and no timer.

One bubble per launch at most, with a quiet launch in between, and nothing at all once you have met them. With the pane shut there is no bubble, and that launch is not spent — you get it the next time the pane is open.

### Your cloud is already a folder

If you have the Dropbox, OneDrive, iCloud Drive, Box, Nextcloud or Google Drive app installed, that cloud is a real folder on this machine — so **Leaftext makes it a vault for you**. There is nothing to press: the folders are there in the switcher the first time you open it, named after themselves, and each wears a cloud because saving in one goes wherever that client sends it.

Leaftext holds no account and no password for any of them. **Their app does the syncing; Leaftext only reads and writes the files** — so there is no refresh to wait for here, and a file that has not arrived yet is one their app has not finished with.

Only what is really there is added: a client you do not have is not listed, and neither is one whose folder has been deleted. Where a client records having been moved — Dropbox, OneDrive, Nextcloud — that record is what gets read, so a Dropbox living somewhere other than the default is still found. Nothing is scanned to do it; each is a named place, checked.

Remove one and it comes back the next time Leaftext looks. A vault is a row in a list, not a copy of anything, and it is a folder you have — the alternative is remembering a refusal forever to save you a row.

Google Drive is found on macOS only. On Windows it mounts as a drive letter you choose and records nowhere which one, and guessing would mean offering somebody else's disk — use **New vault…** and pick it.

A vault *inside* one of these folders wears the cloud too. Where the files end up is what the mark is about, and a folder under Dropbox syncs exactly as Dropbox does.

## Browsing

### File tree

The pane lists one folder at a time — the folder you are in, not a whole hierarchy.

- Click a folder row — or its `›` chevron — to go into it.
- The row above the list steps back out one level.
- The **breadcrumb** above the search box is the path you are on: `Vajrayana › docs › features`. Click any crumb to step back to that level. It shows as much of the path as fits the band, so widening the pane reveals more crumbs and dragging the divider refits it mid-drag. Whatever does not fit collapses behind a `…` button that opens a menu of the skipped folders.
- Folders sort before files, each alphabetized. Hidden folders, common build folders, and symlinks or Windows reparse points are not descended.
- Opening a file moves the pane to that file's folder and highlights the row. A file inside a vault switches to that vault first; a file in none switches to the whole library.
- The folder you are in is saved, so a restart reopens it. If the folder has gone, the pane falls back to the top of the vault.

Each call reads exactly one directory, so nothing below what you opened is ever touched.

### File types

The pane lists every format the reader opens: Markdown (`.md`, `.markdown`, `.mdown`), [XML](01-rendering.md#xml) (`.xml`), [JSON and YAML](01-rendering.md#data-files-json-and-yaml) (`.json`, `.yaml`, `.yml`), and [email](01-rendering.md#email-eml) (`.eml`, `.mht`, `.mhtml`). Anything else is left alone.

Data files are searchable by name and title but draw no [graph](#graph) edges at all — not even to [web addresses](#web-addresses). A string inside a `.json` or `.yaml` is a value, and scanning one as prose would invent links nobody wrote. Emails draw none either — their bodies are transfer-coded in the file, so a scan would read base64, not links. They still appear as nodes.

### Skipped folders

Browsing skips hidden folders and the common heavy or generated ones:

- `node_modules`
- `target`
- `vendor`
- `dist`
- `build`
- `.venv`
- `__pycache__`

At a drive root, system directories such as `Windows`, `Program Files`, `AppData` and `Library` are skipped too. Symlinks and Windows reparse points are not descended.

## File actions

![A right-click context menu open on a file row in the library pane, listing Open, Cut, Copy, Copy path, Rename, Reveal file, Properties and Delete](../../imgs/file-actions.png)

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

A link inside a document you are reading has [its own menu](02-navigation.md#opening-a-link-in-a-new-page), which shares Reveal file and Copy path with this one.

Delete is reversible — the file goes to the Recycle Bin or Trash, not gone for good. Reveal and Properties map to each OS:

- Windows: Explorer; the file Properties dialog.
- macOS: Finder; Get Info.

### Folders, and the space around them

Right-clicking a **folder row** — or the empty space below the rows, which stands for the folder you are browsing — offers what a place can do rather than what a document can:

| Action | What it does |
| --- | --- |
| Open folder | Goes into it. Only on a folder row; the empty space is already the folder you are in |
| Paste | Puts what you last cut or copied into this folder. Only shown when there is something to paste |
| Reveal folder | Shows the folder in your OS file manager |
| Properties | Opens the OS folder-properties view |

### Cut, copy, paste

Cut or Copy a file, then Paste it into a folder to move or copy it there. A cut is used up by the paste; a copy can be pasted again.

Two things are worth knowing:

- **Nothing is overwritten.** Pasting where the name is already taken refuses and says so, rather than replacing what is there.
- **This clipboard is Leaftext's own.** Cut and Copy also put the file on the *system* clipboard, so you can paste it in Explorer or Finder — but the reverse does not hold: a file you copied in your file manager is not what Paste here acts on.

Copying a whole folder is not supported; a folder can be pasted only as a move (Cut, then Paste).

## Search

![Search results in the library pane: a filename match ranked at the top, then content matches each showing the document name and a snippet with the search terms highlighted in context](../../imgs/search.png)

Search covers the active vault. With no vault the field is hidden rather than left to return nothing — a box that looks like it works and does not is worse than no box.

| Search type | Behavior |
| --- | --- |
| Name matches | Ranked first, and by how much of the name you typed: the whole name, then the start of it, then the start of a word in it, then buried inside one |
| Its [other names](#other-names) | Counted as names, on the same scale — a note's `aliases` entry matched end to end is worth what its file name matched end to end is worth. The row says which name matched |
| Folder names | Counted, and weakly — everything under `notes/` matches "notes" |
| Content matches | Ranked by how often the terms appear **for the document's size**, so a long file cannot out-count a one-page note by being long |
| A match in a heading | Outranks the same word in a paragraph |
| Multiple terms | Every term must appear, in a name, the folder or the body |
| More than words | The box takes a [filter](#filtering) — `#work status:open due:<friday -draft` |
| Rows per file | Up to three, one per place the word is |
| Result limit | The best 50 files. Past that the count says so — "84 results in the first 50 files" |

Opening a result lands on the line the match is on. Documents whose source the pane cannot place a line in — anything but Markdown — fall back to the nearest heading above the match.

Asking the same thing twice costs nothing: the last answer is kept and handed straight back while the query and the vault's text are both unchanged, which is what happens when you walk the folder tree with a search still in the box. Typing one more letter costs almost nothing either — only the files that matched the shorter word can match the longer one, so those are the only ones read again. Anything else, including a letter deleted or a file saved while you type, reads the vault afresh.

To search **inside** the document you are reading rather than across the vault, see [Find in this document](02-navigation.md#find-in-this-document).

The text search reads is the same copy the [graph](#graph) reads: one pass over the vault, held in memory, patched a file at a time by the [watcher](#live-updates) and dropped when you switch vaults or quit. There is no index on disk, so nothing can go stale relative to your files.

## Filtering

The search box takes more than words.

| You type | You get |
| --- | --- |
| `dharma` | the word, in a name, one of its [other names](#other-names), the folder path or the text |
| `"the dharma bums"` | those words in that order |
| `-draft` | not that. It goes in front of anything, not just a word — `-status:open` works |
| `#work` | the note carries that tag, or one under it like `#work/reports` |
| `status:open` | a [frontmatter field](01-rendering.md#frontmatter) with that value |
| `status:` | the field is set, whatever it says |
| `due:<friday` | a date field before that day |
| `rating:>4` | a number field over that. `<`, `>`, `<=` and `>=` all work |
| `ext:md` | a file of that kind |
| `in:notes/2026` | inside that folder, or anything under it |
| `task:open` | the document holds an unfinished `- [ ]`; `task:done` wants every box in it ticked |
| `a OR b` | either. `OR` and `AND` are the only reserved words, and only in capitals — a note called `or` is still found by typing `or` |
| `(a OR b) -c` | grouped |

A date can be `today`, `tomorrow`, `yesterday`, a weekday name (`friday` means the next one, and today when today is a Friday), `2026-08-10`, or `last7d` / `next7d` for any number of days. The day it counts from is your machine's, not a server's.

**Nothing you type is an error.** A search box spends most of its life holding half a filter, so every unfinished shape means something: an unclosed quote runs to the end of what you typed, an unclosed bracket groups to the end, a stray `)` is ignored, and a trailing `OR` drops with the side you did type still standing. Inside quotes nothing is special, so `"-draft"` and `"#work"` find those characters.

A colon only starts a field when what is in front of it looks like a field name and what follows does not start with a slash — so `C:\Users\me`, `https://leaftext.com` and `12:30` are all still findable text rather than filters that match nothing.

**It says what it understood.** Type anything past plain words and a line appears under the box reading the filter back — `tagged work, status is open, due before 2026-08-07, not draft` — and naming any field the vault has never set. A filter on a field nobody uses matches nothing, and an empty list that really means "there is no such field" is the one thing a filter must not do quietly.

**It completes as you type.** The field names your vault actually uses, and the values each one holds, are offered under the box. Arrows walk the list, Enter or Tab takes one, Escape closes it — and only then does a second Escape clear the field.

## Other names

A note can answer to more than the name of its file. Give it an `aliases` field and every name in the list works everywhere the file's own name works:

```markdown
---
aliases:
  - Mozart
  - W. A. Mozart
---
```

Now `[[Mozart]]` reaches `Wolfgang Amadeus Mozart.md` — it draws that edge on the map, finds the note in [search](#search), previews it on hover, and appears in the `[[` popup with the file it opens named beside it. Written `aliases: [Mozart, W. A. Mozart]` on one line, or as a single `aliases: Mozart`, it reads the same. This is the same field [Obsidian](https://obsidian.md/help/properties) uses, so a vault written there opens here with its links intact.

A few rules, so a preferred name can never quietly take a real one:

- **A file name always wins.** If one note is called `Mozart.md` and another prefers the name, `[[Mozart]]` opens the file.
- **Between two notes preferring one name**, the first found wins, and the code view's [broken-link check](07-editing.md#typing-help) says which note the link opens and which others wanted it.
- **A node on the map keeps its file's name** — a node labeled with a preferred name is one you cannot find by the name on disk. Hover it to see the rest.
- **Thirty-two per note.** Past that they are ignored, and the check marks the `aliases` line to say how many there were.

It works outside a vault too: for a document in a plain folder, Leaftext reads the top of each file beside it — the field block and no further — for up to 500 files. One folder, never the tree below it.

## Graph

![The graph view filling the page: dozens of document nodes joined by arrowed lines, the open document highlighted larger in the accent color, names floating in dim gray beneath the nodes](../../imgs/graph.png)

A force-directed relationship map. Each **node** is one of your documents or a [web address](#web-addresses) one of them links to; each **edge** is a link that resolves — a Markdown link, an `<a href>`, a `[[wiki]]` link matched by file name or by one of the note's [other names](#other-names), a TEI `target=`, or a bare URL in the text.

It is a **view of the page**, not a panel — reach it from the [floating toolbar](02-navigation.md#the-floating-toolbar) under the document, beside reading and the source view. All it needs is a document open. It does **not** need a vault.

### What it maps

What it draws over depends on where the open document lives, and you never choose between them:

- **Inside your active vault** — the map is of the whole vault. Every document in it is a node, so you see what links *to* the document you are on as well as what it links to, and `[[wiki]]` names resolve against the whole collection.
- **Anywhere else** — the map is of that document: itself, the documents in its folder, and whatever it links to, wherever those live. A link is followed one hop out; nothing below the folder is read.

The second map is **smaller, not wrong**. A document only ever records what it links to — what links *back* is written in somebody else's file — so reading the folder is what recovers incoming links, and it stops there. A link to a *document* outside the set simply draws no line. [Web addresses](#web-addresses) are unaffected — those are nodes in their own right, so a document's outbound links show up either way. Put the folder in a vault and the map widens.

> [!NOTE]
> Neither map reads anything you did not point at. The vault's map reads the folder you named. A document's map reads that document, one folder listing, and one file per link. Opening the map on a file sitting at `C:\` does not walk your drive.

### Moving around it

- The map **opens framed on everything it drew** — the tightest zoom that still holds the whole layout, centered. Two documents fill the view; two thousand shrink to fit. The first pan, zoom, drag or flight hands the view over to you, and it stops reframing.
- While the layout settles the view **follows only what leaves the frame**, then frames everything once more when it comes to rest. A force layout breathes as it works, and a camera refitting on every frame of that put the pumping on screen.
- The document you are reading is highlighted in the accent color and pulled larger.
- **Names** float in dim gray beneath the nodes. They stay a fixed size as you zoom and are decluttered by fit: where the layout is open every name shows, and where nodes crowd only the ones that clear their neighbors do. The document you are on always keeps its name, and hovering shows the hovered node's name and its neighbors'.
- **Edges point the way the link was written.** An arrowhead sits where the line meets the document being linked *to*. Two documents that link each other get one line with a head at both ends, not two lines on top of each other. Heads are left off a very dense map, and while you are zoomed far out — at that size they are ink and nothing else.
- **Click** a node to open that document and **keep the map** — it redraws around what you opened and flies to its node, so you can carry on following links from there. **Hover** to light up a node's direct links and dim the rest.
- **Drag** a node to reposition it, **drag the background** to pan, **scroll** to zoom.
- Opening a document from the pane while the map is up **keeps the map up** too, and moves the highlight. Changing what you are looking at is not a reason to change how you are looking at it.
- Closing the last tab closes the map with it: the start screen is not one of a document's views.
- Editing a document the map covers **redraws it in place**: every node keeps its position, your pan and zoom are kept, and the layout eases into what changed rather than laying itself out again. An edit that draws the same map — a word typed into a document that links nowhere new — changes nothing on screen at all.
- Building the map shows the same spinner a slow document does — including the redraw after a node click, which builds a new map. Leaving the map shows it too: open a search hit or switch to the [source](07-editing.md#code-view) and the map holds until its replacement is ready rather than dropping to a half-drawn page, with the wait shown on top of it.

### How much it draws

How many documents it draws is set by the [Graph size](05-settings.md#graph-size) setting — from a tight **Focus** neighborhood (the open document and its direct links) up to **Everything**. Smaller sizes render faster; larger ones stay responsive by easing the layout and repainting less often as it settles.

### Web addresses

A `http`/`https` link is a node too, drawn as a **ring with a dot at its center** rather than a filled disc, and labeled by its domain — `reddit.com`, not the whole URL, which stays in the tooltip. **Clicking one opens your browser and leaves the map exactly as it is** — no redraw, because nothing here replaced the document you are on.

They are found wherever the reader can click one: written out as `[text](https://…)`, in `<https://…>` angle brackets, in an `<a href>`, and **bare in the text**, by the same finder that turns bare URLs into links when the document is rendered. So the graph and the page can't disagree about what a link is.

**Two documents citing one page share one node** — the point of drawing them. The scheme and host are matched case-insensitively and a `#fragment` or trailing slash is ignored, so `https://Example.org/a/`, `https://example.org/a` and `https://example.org/a#notes` are one page.

- Email addresses are not nodes. Neither is any other scheme — `mailto:`, `file:`, a custom one.
- One document contributes at most **25** web addresses. A bibliography is a real document, and without a cap it would bury the notes around it.

## GitHub sync

![A vault's settings panel showing the connected GitHub repository address with a Change repo button beside it, and the sync button at the end of the breadcrumb carrying a count of changes waiting to be pushed](../../imgs/github-sync.png)

A vault can be a git repository that pushes to GitHub. Open a vault's settings from the switcher to see where it stands.

### What it needs

**git is the only requirement.** Leaftext never holds a token: it runs the `git` already on your machine, which already knows who you are and how to sign in.

| What is installed | What the panel offers |
| --- | --- |
| git and [`gh`](https://cli.github.com) | **Create a private repo** — one click, made and pushed |
| git alone | **Create it on GitHub ↗** — opens GitHub with the name filled in; paste the address back and the panel points the vault at it |
| neither | A link to install git, and nothing else |

On Windows, Git for Windows installs Git Credential Manager and sets it as the default, so the first push opens a browser once and never asks again. On macOS the bundled credential helper cannot sign in to GitHub any more, so `gh` or Git Credential Manager has to be installed; the panel says so rather than letting a push fail.

The panel also warns before the fact about the two things git needs and often lacks: an identity (`user.name` and `user.email`) and a way to authenticate.

### Clone a repository

**Clone a repository…** in the vault switcher takes a git address, asks where it should go, and makes the clone a vault. Paste `https://github.com/owner/repo.git` or the `git@` form; the folder you pick is the *parent*, and the repository gets its own folder inside it named after itself.

Nothing of yours is at risk if it goes wrong: git makes that folder and removes it again if the clone fails, so a broken clone leaves nothing behind and no vault is registered. A name already taken in the folder you picked is refused rather than cloned into.

Again there is no sign-in of Leaftext's own. A public repository just works; a private one works when your own git can already reach it, and says what is missing when it cannot — Leaftext never puts up a password box, because a prompt behind a window it cannot show is the one thing worse than a clear refusal.

### Changing the repository

The settings panel names the address the vault points at now. **Change repo…** opens a field for a new one, with **Save** and **Cancel**: nothing changes until you press Save, and the address it replaces is offered back with one press in case the change was a mistake.

Setting or changing the address only points the vault — it never pushes on its own. Sending your files is always a separate, deliberate [Sync](#syncing), so naming a repository can never overwrite what is already in it. Leaftext also refuses to act on a repository the vault folder merely sits *inside*; it works only on a repository the folder is the root of.

### Syncing

**Sync** commits everything changed, pulls with a rebase, and pushes. Commit messages describe the change — `Update README.md`, or `Update 4 files` — and carry no mention of the app.

A **sync button appears at the end of the vault's breadcrumb** whenever there is work that has not reached GitHub, carrying the count. It spins while it works and fades out still spinning — more slowly under [Reduce Motion](05-settings.md#reduce-motion), which slows every spinner rather than stopping it — and a growl in the corner says where the push landed. It is absent when there is nothing to send.

The count is uncommitted changes plus unpushed commits — both answerable from disk. Whether the *remote* has moved needs a fetch, so it is not checked in the background; behind-counts appear in the vault's settings panel and after a sync, where you have asked for them.

> [!IMPORTANT]
> A rebase that hits a conflict is undone before the sync returns. There is no merge view in a reader, so the panel says what happened and leaves the folder as it found it, for you to resolve in git.

### Repositories inside repositories

A vault whose folder already holds a repository somewhere below it — a project vault with the code in `app/` — has that named in the panel. Creating a repository at the vault root adds those nested ones to a new `.gitignore`, with the reason written beside them: each has its own remote, and tracking one from outside records a pointer nobody else can resolve.

A vault sitting *inside* someone else's repository is told so too. Creating a repository there is legal and common, but it should not be a surprise afterwards.

## Live updates

The pane keeps up with changes on disk, so a file you just created shows up without a refresh.

- The same file watcher that drives live reload watches the active vault **recursively**, plus the open document's folder when it sits outside the vault. With no vault, only the folder you are browsing is watched, and not recursively — browsing a drive root should not subscribe to the whole drive.
- A file added, renamed or removed in the folder you are looking at refreshes the list.
- Something *you* did — a [paste, rename or delete](#file-actions) — refreshes the list the moment it lands, rather than waiting on the watcher to notice.
- The vault's in-memory text is patched for the one file that changed, so [search](#search) and the [graph](#graph) stay current without re-reading the vault. Only a document whose text actually moved counts: a vault is a folder you work in, and git writing to itself, a saved image or an editor's temp file are not changes to your documents.
- A [graph of one document](#graph) rather than a vault holds nothing in memory to patch, so it is simply read again — a folder listing and a file per link, which is cheap enough not to cache. It cannot go stale, and a redraw that produces the same picture never reaches the screen.
- The [sync count](#syncing) is re-read too, whether the change was to the document you are editing or to any other file in the vault.

## Layout

| Behavior | Rule |
| --- | --- |
| Toggle | The panel button in the app bar, left of Back, opens and closes the pane. It never folds into the app bar's overflow menu, so it is reachable at every window size |
| Motion | Opening springs slightly past its width and settles; closing slams to the page's padding, bounces off it once and seats there, the pane's contents fading with the travel. The pane, the tabs above it and the page edge move as one, dragging the divider tracks the pointer exactly, and under [Reduce Motion](05-settings.md#reduce-motion) both land instantly |
| Snap shut | Drag narrower than 40 px |
| Reader minimum | Reader stays at least 360 px wide |
| Small window | Too tight for a pane beside the page, so the library becomes a full-width sheet over it — see [Narrow windows](#narrow-windows) |

Saved library state includes:

- `library_closed`
- `library_width`
- `graph_scope`
- `library_project_path`

The active vault is saved in `manifest.db` beside the vault list, not in [settings](05-settings.md).

### Narrow windows

![A narrow Leaftext window with the library open as a full-width sheet over the document, the vault name and search box at its top and the leaf and library button still visible above it](../../imgs/library-sheet.png)

Below the point where a pane and a usable reader both fit, the library stops being a column beside the page and becomes a sheet over it. The same panel button opens it: it slides in from the left at full width, covering the document, with the path and search box in their usual places at the top — or arrives in place, with no slide, under [Reduce Motion](05-settings.md#reduce-motion). Picking a document dismisses it, since the page you just opened is behind it. The app bar stays above the sheet, so the button that opened it also closes it.

The sheet is not saved. It describes the current view rather than a preference, so widening the window puts the pane back beside the page and there is no sheet to restore.

## Facts

| Item | Value |
| --- | --- |
| Vault registry | `manifest.db` — the vaults you have named, and which one is active |
| Vault text | Held in memory for the active vault only; dropped on a switch and on quit |
| Documents read | Up to 5,000 per vault |
| Search results | Top 50 |
| Folder listing | One directory per click |
| First-launch bubbles | One per launch at most, with a quiet launch between; each one shows until you point at what it points at, then never again |

> [!NOTE]
> `manifest.db` keeps its name from when it held a file index. It no longer does — anything that reads a document reads the disk. What it holds now is the list of folders you called vaults, which is why losing it loses that list.

## Next

- [Settings](05-settings.md)
- [Navigation](02-navigation.md#the-floating-toolbar)
- [Architecture](../02-development/01-architecture.md)
