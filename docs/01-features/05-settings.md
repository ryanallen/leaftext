# Settings

> Your settings live on your machine, not in an account. Theme, speed reader, updates, library layout, and window size sit in a plain JSON file you can read.

Settings are owned by the Rust app rather than browser storage, which keeps them durable across restarts and consistent across the embedded WebView.

**There is no settings panel.** Every control stands where it applies, and this page is the account of the file they all save to.

## Options

| Setting | Options | Default | Where the control is |
| --- | --- | --- | --- |
| [Theme](#theme) | Amaranth, Arabica, Bloodleaf, Fern, Ginger, GitHub, Goldenrod, Halcyon, Nightshade, Pippin, Sage, Random | Random | The palette in the app bar |
| [Appearance](06-themes.md#appearance) | System, Light, Dark, Daylight | Daylight | The same [theme picker](06-themes.md#choose) |
| [Graph size](#graph-size) | Focus, Medium, Large, Everything | Focus | The [graph](03-library.md#graph) view's own toolbar |

Three more preferences are saved here but toggled elsewhere, where they apply: the [Speed Reader](#speed-reader), [typing help](#typing-help), and [the two padlocks](#the-padlocks).

**Speed Reader** is a reading-view tool on the [floating toolbar](02-navigation.md#the-floating-toolbar) — a way of reading rather than a setting to hunt for — though it saves to the same file as the rest. The code view's [typing help](07-editing.md#typing-help) wand works the same way: toggled where it applies, saved here.

Two things stopped being choices: the [minimap](#minimap) and the [pager](#pager) are always on.

One preference is not saved here at all, because it is your system's: [Reduce Motion](#reduce-motion).

### The padlocks

Whether a document can be typed into is the [padlock](07-editing.md#the-padlock) on the floating toolbar, and there are two — one for the reading view, one for the source — because unlocking the page you read is not consent to rewrite the file by hand.

Both are saved (`reading_unlocked`, `code_unlocked`), so the answer you gave last time is the answer next launch, on every document. Both start locked.

## Open

There is nothing to open. Every control changes the app the moment you use it and saves straight away. The version you are running is at the foot of the home screen ([Updates](#updates)).

## Files

| File | Purpose |
| --- | --- |
| `{config_dir}/settings.json` | Preferences, the tabs to reopen, and any [unsaved edits](07-editing.md#save) the window was closed on |
| `{config_dir}/recent-files.json` | Last 8 opened files |
| `{data_dir}/manifest.db` | The [vaults](03-library.md#vaults) you have named, and which one is active |
| `{data_dir}/webview2` | WebView2 data |
| `{data_dir}/updates` | Verified installer waiting to be applied ([Updates](#updates)) |
| `{data_dir}/journal.log` | What the app printed this run, and any crash ([Journal](#journal)) |
| `{data_dir}/journal.prev.log` | The previous journal, kept when the live one fills up |

Here `{config_dir}` and `{data_dir}` are the per-app directories derived from the app id `com.ryanallen.leaftext` — they already include the vendor/app path segments (there is no extra `leaftext/` component to add). See [Paths](#paths) for the real per-platform locations.

Both JSON files are editable by hand, and a byte order mark in front of the opening brace is fine — Windows editors add one by default. If `settings.json` still cannot be read, Leaftext starts on its defaults and says so in the corner rather than coming up looking factory-fresh; the file is left untouched for you to look at.

## Example

```json
{
  "session": {
    "tabs": [
      { "path": "/Users/alice/notes/daily.md", "title": "Daily notes", "code_view": false, "anchor": { "section": "tasks", "block": 1, "offsetY": -18.0 }, "saved_code_scroll": null, "untitled": false, "unsaved_text": null, "saved_text": null },
      { "path": "Untitled.md", "title": "Untitled", "code_view": false, "anchor": null, "saved_code_scroll": null, "untitled": true, "unsaved_text": "Notes from the call\n", "saved_text": null }
    ],
    "active": 0
  },
  "speed_reader_enabled": false,
  "code_intel_enabled": true,
  "reading_unlocked": false,
  "code_unlocked": false,
  "theme_family": "random",
  "theme_mode": "daylight",
  "theme_random_used": [],
  "graph_scope": "small",
  "library_project_path": "",
  "library_closed": false,
  "library_width": 240,
  "window_width": 1080,
  "window_height": 820,
  "window_maximized": false,
  "update_last_checked": 0,
  "update_staged_version": "",
  "update_auto_applied": "",
  "hint_launches": 0,
  "hints_seen": [],
  "hint_last_launch": 0
}
```

Missing fields fall back to defaults when the file is loaded, and unknown ones are ignored — so a file written by an older version, carrying keys for settings that stopped being choices, loads fine and loses them on the next save.

## Recents

`recent-files.json` stores the last 50 opened file paths, and the [favorites](02-navigation.md#favorites) beside them in the same file. A favorite carries the vault it was marked inside (`null` for one outside every vault), the path, and whether it points at a document or a folder; there is no cap on that list, because each entry is a choice somebody made.

Example:

```json
{
  "files": [
    "/Users/alice/projects/api/README.md",
    "/Users/alice/notes/daily.md"
  ],
  "favorites": [
    { "vaultId": 1, "path": "/Users/alice/notes/daily.md", "kind": "document" }
  ]
}
```

Leaftext removes broken entries from the recent list automatically and collapses equivalent path spellings to one item.

## Behavior

### Theme

- The palette button in the app bar opens the [theme picker](06-themes.md#choose); its tooltip names the family and appearance you are on
- Saved as `theme_family` (family or `random`) and `theme_mode` (appearance)
- New installs default to `random` and `daylight`; once you pick a theme your choice is saved and used from then on
- Choosing [Random](06-themes.md#random) draws a fresh family at each launch; `theme_random_used` records the families already shown in the current no-repeat cycle so the rotation survives restarts

### Graph size

- A labeled dropdown in the [floating toolbar](02-navigation.md#the-floating-toolbar), shown only while the graph is up — it is the map's own setting, so it stands on the map
- Controls how many documents the [graph](03-library.md#graph) draws
- **Focus** (default) shows the open document and its direct links
- **Medium** shows up to the 2,000 most-linked documents, **Large** up to 5,000, and **Everything** the whole vault with no cap
- Smaller sizes open faster; the larger ones stay responsive by settling the layout sooner and repainting less often
- Saved as `graph_scope`, stored as `small`, `medium`, `large`, or `xl`

### Minimap

- **Always on.** It is not a choice any more, and there is nothing to switch
- The rail still comes and goes with the document, and only appears on windows wide enough for it
- Nothing is saved: a `minimap_enabled` left in an older `settings.json` is ignored and dropped on the next save

### Speed Reader

![The same paragraph with Speed Reader on: the prose dimmed back and the first few letters of each word set in bold, so a path of anchors runs down the page](../../imgs/speedreader.png)

- Off by default, toggled from the reading view's [toolbar](02-navigation.md#the-floating-toolbar)
- Dims non-anchor prose text (including headings) so bold lead anchors carry the most contrast against the background
- Quiets links to the dimmed prose color with a faint underline, until hover or keyboard focus brightens them
- Regularizes existing bold text and adds bold lead anchors at word starts; all-caps acronyms (HTML, GFM) are bolded whole
- Saved as `speed_reader_enabled`

### Typing help

- On by default, toggled with the wand on the code view's [toolbar](07-editing.md#typing-help)
- Monaco's IntelliSense, answered from your notes: suggests them after `[[`, headings after `#`, previews a note on hover, and underlines [broken links](07-editing.md#typing-help) in the code view
- Saved as `code_intel_enabled`

### Pager

- **Always on.** It is not a choice any more, and there is nothing to switch
- Appends a Previous / Next bar at the bottom of documents in a folder tree connected by `README.md` files
- Nothing is saved: a `pager_enabled` left in an older `settings.json` is ignored and dropped on the next save

### Updates

- **Updating is not a setting.** It always happens, and it means what it says: **quit and reopen, and the app you get is the new one.** There is nothing to click and nothing to switch off
- **Every launch asks GitHub for the latest release**, unthrottled — opening the app is when you expect it to know whether it is current. A window left open re-checks in the background at most every six hours; `update_last_checked` records when it last did, so a long session does not spend requests against the rate limit
- When a newer release exists, its installer downloads in the background — the same `.dmg` or `.msi` published for hand-installing, since a release carries nothing else. A download that arrives short or oversized is deleted rather than kept, and the digest of what did land is recorded so the installer can be re-checked before it runs
- While it downloads, the bell wears a spinning ring, and the button under it carries a spinner and fills left to right with the percentage
- **The next launch installs it, before any window opens.** Windows cannot replace a running executable, so this is the one moment it can happen without interrupting anything: the app hands off to a detached helper, which waits for it to exit, installs, and starts the new version. No prompt — Leaftext installs per-user, which is what lets it replace itself without administrator rights
- **Restart to update** is still on the button for anyone who does not want to wait for the next launch
- Each staged version is installed automatically **once**. `update_auto_applied` records the attempt before the installer runs, so an installer that fails silently cannot be retried on every launch — that would be a boot loop. After one failed attempt the version waits for a deliberate click
- **An install that does not take says so.** A failed install starts the version you already had, so the window that comes back is the window you left — the one thing you could not otherwise tell. The next launch shows a message naming the version that failed, why it failed, and the version you are still running. It appears once, on that launch and no other, and the reason is written to `journal.log` as well so it can be quoted in a bug report
- **The updater only speaks when it can install, or when an install failed.** A check that found nothing, one that could not reach GitHub, and a release with no installer for this platform all pass in silence — there is nothing for you to do about any of them, and the next check retries on its own. What it shows is the download in progress, *Restart to update*, and the message above
- **The bell is only in the app bar while there is news.** No update, no bell — its presence is the message, and there is no control sitting there saying nothing
- The running version is printed at the foot of the home screen, so after a relaunch you can confirm which build is installed
- Saved as `update_last_checked`, `update_staged_version`, and `update_auto_applied`

> [!NOTE]
> Only one staged installer is kept. Skipping several releases does not accumulate several downloads, and once an update is applied the folder is cleared.

### Window size

- The window reopens at the size it had when it last closed, and maximized if it was maximized
- Saved as `window_width` and `window_height` (in logical, DPI-independent pixels) plus `window_maximized`
- The size is stored separately from the maximized state, so un-maximizing returns to the windowed dimensions rather than the maximized ones
- Window position is not restored — only the size and maximized state
- [Full screen](06-themes.md#macos) is not saved: macOS owns the spaces it puts a full-screen window in, and restoring it is that system's rather than Leaftext's

### Unsaved edits

- Closing the window with [unsaved edits](07-editing.md#save) writes them here rather than discarding them, and the next launch puts them back in their [tabs](02-navigation.md#tabs) with the dot lit
- Saved on the tab as `unsaved_text` (the words as they stood) and `saved_text` (the same document as it was last written to disk), both `null` for a tab with nothing unsaved
- The second is what the next launch compares the file against: matched, the words go back; changed underneath, the file wins and both are dropped; gone from the disk, the words come back as a note with no file wearing the name it had, since nothing is left to compare them with
- A [new document](07-editing.md#new-document) with words in it is carried too, marked `untitled` and with no `saved_text`, since there is no file to compare against. It comes back as the note it was — the name it was wearing, its words, its dot, and its first save still asking where it goes — and a note nobody typed into is not written here at all
- Only closing writes them. A window left open saves nothing of what you have typed, and what has been typed in the last fraction of a second before the close is not carried

### First-launch bubble

- The [bubble that points at the vault switcher](03-library.md#the-bubble-on-your-first-launch) shows once and then never again, so what has already been met is remembered here
- Saved as `hints_seen` (the ones you have met), `hint_launches` (launches that had one to show) and `hint_last_launch` (the launch the last bubble showed at, which is what puts a quiet launch between two of them)
- The [pane's vault introduction](03-library.md#your-first-vault) is remembered in the same `hints_seen` list, though it is a box in the pane rather than a bubble
- A launch with nothing to point at — the pane shut — is not counted, so it costs you nothing
- Emptying `hints_seen` and setting both numbers to `0` puts the bubbles back

### Reduce Motion

Leaftext follows your system's Reduce Motion setting. There is no control for it here, because the switch already exists in Windows Settings (Accessibility → Visual effects → Animation effects) and macOS System Settings (Accessibility → Display → Reduce motion), and it updates live — no restart.

With it on, nothing in the app slides, rises or fades. Panels, sheets, menus, the find bar and the tab strip all arrive in place, and a control you point at takes its highlight in one frame. Three things carry on, because stopping them would say something untrue:

- **Spinners keep turning, more slowly.** A still spinner reads as a hang, and the app is still working.
- **A [wide table](01-rendering.md#tables)'s edge marks stay.** They only move when you scroll the table, so they follow your hand rather than a clock.
- **A loading placeholder stays dim.** At full strength the gray bars read as text that has finished loading.

With it off, a panel arriving slows as it lands and one leaving is gone quicker, and a button, row or link you point at lights up over about a tenth of a second and goes dark the same way. A document or folder you open is on screen at once either way — see [every destination arrives at once](02-navigation.md#history).

## Journal

Leaftext keeps a plain text note of what it did, at `{data_dir}/journal.log`. It is written for bug reports: if something goes wrong, that file is what to attach.

- It holds what the app printed and the details of a crash — nothing else
- **Your writing is never in it.** File paths are recorded, document text is not
- It stops at about a megabyte, at which point it becomes `journal.prev.log` and a fresh one starts. That is two files, and it never grows past them
- It is safe to delete, and it is not sent anywhere — nothing leaves your machine unless you attach it yourself

## Paths

These per-app directories are derived from the app id `com.ryanallen.leaftext`:

- macOS: `config_dir` = `data_dir` = `~/Library/Application Support/com.ryanallen.leaftext`
- Windows: `config_dir` = `%APPDATA%\ryanallen\leaftext\config`; `data_dir` = `%LOCALAPPDATA%\ryanallen\leaftext\data`

Both live inside your user profile, so Leaftext never needs administrator rights to run. They are also independent of where the app is installed — reinstalling or moving it keeps your settings, recent files, and [vaults](03-library.md#vaults).

## Next

- [Library](03-library.md)
- [Themes](06-themes.md)
