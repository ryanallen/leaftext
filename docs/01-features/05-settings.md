# Settings

> Your settings live on your machine, not in an account. Theme, speed reader, minimap, pager, updates, library layout, and window size sit in a plain JSON file you can read, plus the interface language in the WebView's local storage.

Most settings are owned by the Rust app rather than browser storage, which keeps them durable across restarts and consistent across the embedded WebView. The one exception is the interface language, kept in the WebView's local storage under `leaf.localeMode`.

## Options

| Setting | Options | Default |
| --- | --- | --- |
| Theme | Amaranth, Arabica, Bloodleaf, Fern, Ginger, GitHub, Goldenrod, Halcyon, Nightshade, Pippin, Sage, Random | Fern |
| Appearance | System, Light, Dark, Daylight | System |
| Language | System, English, Simplified Chinese | System |
| Minimap | On / Off | On |
| Pager | On / Off | On |
| Graph size | Focus, Medium, Large, Everything | Focus |

**Speed Reader** is not in this panel. It is a reading-view tool on the [floating toolbar](02-navigation.md#the-toolbar) — a way of reading rather than a setting to hunt for — though it saves to the same file as the rest.

Whether the rendered page can be typed into is **not** here. It is a padlock on the document in front of you — see [Editing](07-editing.md#the-padlock).

## Open

Click **Settings** in the app bar. The panel opens as a dropdown and updates the app immediately as you change values. The version you are running is shown at the foot of the panel ([Updates](#updates)).

## Files

| File | Purpose |
| --- | --- |
| `{config_dir}/settings.json` | Preferences |
| `{config_dir}/recent-files.json` | Last 8 opened files |
| `{data_dir}/manifest.db` | The [vaults](03-library.md#vaults) you have named, and which one is active |
| `{data_dir}/webview2` | WebView2 data |
| `{data_dir}/updates` | Verified installer waiting to be applied ([Updates](#updates)) |

Here `{config_dir}` and `{data_dir}` are the per-app directories derived from the app id `com.ryanallen.leaftext` — they already include the vendor/app path segments (there is no extra `leaftext/` component to add). See [Paths](#paths) for the real per-platform locations.

Both JSON files are editable by hand, and a byte order mark in front of the opening brace is fine — Windows editors add one by default. If `settings.json` still cannot be read, Leaf Text starts on its defaults and says so in the corner rather than coming up looking factory-fresh; the file is left untouched for you to look at.

## Example

```json
{
  "minimap_enabled": true,
  "pager_enabled": true,
  "speed_reader_enabled": false,
  "theme_family": "fern",
  "theme_mode": "system",
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
  "update_auto_applied": ""
}
```

Missing fields fall back to defaults when the file is loaded.

## Recents

`recent-files.json` stores the last 8 opened file paths.

Example:

```json
{
  "files": [
    "/Users/alice/projects/api/README.md",
    "/Users/alice/notes/daily.md"
  ]
}
```

Leaf Text removes broken entries automatically and collapses equivalent path spellings to one item.

## Language

| Mode | Result |
| --- | --- |
| System | `zh*` locales become Simplified Chinese; everything else becomes English |
| English | Forces English UI |
| Simplified Chinese | Forces Simplified Chinese UI |

The app ships both language dictionaries locally and applies changes without a restart.

## Behavior

### Theme

- Saved as `theme_family` (family or `random`) and `theme_mode` (appearance)
- Choosing [Random](06-themes.md#random) draws a fresh family at each launch; `theme_random_used` records the families already shown in the current no-repeat cycle so the rotation survives restarts

### Graph size

- Controls how many documents the [graph](03-library.md#graph) draws
- **Focus** (default) shows the open document and its direct links
- **Medium** shows up to the 2,000 most-linked documents, **Large** up to 5,000, and **Everything** the whole vault with no cap
- Smaller sizes open faster; the larger ones stay responsive by settling the layout sooner and repainting less often
- Saved as `graph_scope`, stored as `small`, `medium`, `large`, or `xl`

### Minimap

- On by default
- Can be turned off for a single-column reading layout
- Saved as `minimap_enabled`

### Speed Reader

- Off by default, toggled from the reading view's [toolbar](02-navigation.md#the-toolbar) rather than this panel
- Dims non-anchor prose text (including headings) so bold lead anchors carry the most contrast against the background
- Quiets links to the dimmed prose color with a faint underline, until hover or keyboard focus brightens them
- Regularizes existing bold text and adds bold lead anchors at word starts; all-caps acronyms (HTML, GFM) are bolded whole
- Saved as `speed_reader_enabled`

### Pager

- On by default
- Appends a Previous / Next bar at the bottom of documents in a folder tree connected by `README.md` files
- Turn it off when you prefer clean document bottoms without navigation buttons
- Saved as `pager_enabled`

### Updates

- **Updating is not a setting.** It always happens, and it means what it says: **quit and reopen, and the app you get is the new one.** There is nothing to click and nothing to switch off
- **Every launch asks GitHub for the latest release**, unthrottled — opening the app is when you expect it to know whether it is current. A window left open re-checks in the background at most every six hours; `update_last_checked` records when it last did, so a long session does not spend requests against the rate limit
- When a newer release exists, its installer downloads in the background — the same `.dmg` or `.msi` published for hand-installing, since a release carries nothing else. A download that arrives short or oversized is deleted rather than kept, and the digest of what did land is recorded so the installer can be re-checked before it runs
- While it downloads, the button carries a spinner and fills left to right with the percentage; the dot over the Settings button turns into a spinning ring
- **The next launch installs it, before any window opens.** Windows cannot replace a running executable, so this is the one moment it can happen without interrupting anything: the app hands off to a detached helper, which waits for it to exit, installs, and starts the new version. No prompt — Leaf Text installs per-user, which is what lets it replace itself without administrator rights
- **Restart to update** is still on the button for anyone who does not want to wait for the next launch
- Each staged version is installed automatically **once**. `update_auto_applied` records the attempt before the installer runs, so an installer that fails silently cannot be retried on every launch — that would be a boot loop. After one failed attempt the version waits for a deliberate click, and the next launch says what went wrong and names the reason
- **The update status, at the foot of the panel beside the version, is itself the button.** It reports what the last attempt found — *Up to date*, when it last checked, or why it could not: a refused request, a release with no installer for this platform, or a download that failed — and clicking it forces a fresh check at any time, past the six-hour throttle. Before the first check of a session it reads *Check for updates*
- The running version is printed at the foot of the panel, so after a relaunch you can confirm which build is installed
- Saved as `update_last_checked`, `update_staged_version`, and `update_auto_applied`

> [!NOTE]
> Only one staged installer is kept. Skipping several releases does not accumulate several downloads, and once an update is applied the folder is cleared.

### Window size

- The window reopens at the size it had when it last closed, and maximized if it was maximized
- Saved as `window_width` and `window_height` (in logical, DPI-independent pixels) plus `window_maximized`
- The size is stored separately from the maximized state, so un-maximizing returns to the windowed dimensions rather than the full-screen ones
- Window position is not restored — only the size and maximized state

## Paths

These per-app directories are derived from the app id `com.ryanallen.leaftext`:

- macOS: `config_dir` = `data_dir` = `~/Library/Application Support/com.ryanallen.leaftext`
- Windows: `config_dir` = `%APPDATA%\ryanallen\leaftext\config`; `data_dir` = `%LOCALAPPDATA%\ryanallen\leaftext\data`

Both live inside your user profile, so Leaf Text never needs administrator rights to run. They are also independent of where the app is installed — reinstalling or moving it keeps your settings, recent files, and [vaults](03-library.md#vaults).

## Next

- [Library](03-library.md)
- [Themes](06-themes.md)
