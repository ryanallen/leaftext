# Settings

> leaftext stores preferences locally: theme, speed reader, minimap, pager, line numbers, reading-view editing, indexing, library layout, and window size in a JSON file, plus the interface language in the WebView's local storage.

Most settings are owned by the Rust app rather than browser storage, which keeps them durable across restarts and consistent across the embedded WebView. The one exception is the interface language, kept in the WebView's local storage under `leaf.localeMode`.

## Options

| Setting | Options | Default |
| --- | --- | --- |
| Theme | Amaranth, Fern, GitHub, Halcyon, Nightshade, Sage, Random | Fern |
| Appearance | System, Light, Dark, Daylight | System |
| Language | System, English, Simplified Chinese | System |
| Speed Reader | On / Off | Off |
| Minimap | On / Off | On |
| Pager | On / Off | On |
| Line numbers | On / Off | Off |
| Reading-view editing | On / Off | On |
| Indexing | On / Off | Off |
| Library view | Project, Graph | Project |
| Graph size | Focus, Medium, Large, Everything | Focus |

## Open

Click **Settings** in the app bar. The panel opens as a dropdown and updates the app immediately as you change values.

## Files

| File | Purpose |
| --- | --- |
| `{config_dir}/settings.json` | Preferences |
| `{config_dir}/recent-files.json` | Last 8 opened files |
| `{data_dir}/manifest.db` | Library index |
| `{data_dir}/webview2` | WebView2 data |

Here `{config_dir}` and `{data_dir}` are the per-app directories the `directories` crate computes from the app id `com.ryanallen.leaftext` — they already include the vendor/app path segments (there is no extra `leaftext/` component to add). See [Paths](#paths) for the real per-platform locations.

## Example

```json
{
  "indexing_enabled": true,
  "minimap_enabled": true,
  "pager_enabled": true,
  "speed_reader_enabled": false,
  "line_numbers_enabled": false,
  "reader_editing_enabled": true,
  "theme_family": "fern",
  "theme_mode": "system",
  "theme_random_used": [],
  "library_view": "project",
  "graph_scope": "small",
  "library_project_path": "",
  "library_closed": false,
  "library_width": 240,
  "window_width": 1080,
  "window_height": 820,
  "window_maximized": false
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

leaftext removes broken entries automatically and collapses equivalent path spellings to one item.

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

- Controls how many documents the [Graph view](03-library.md#graph) draws
- **Focus** (default) shows the open document and its direct links — or, on the start screen, the [recent files](02-navigation.md#recent-files) and theirs
- **Medium** shows up to the 2,000 most-linked documents, **Large** up to 5,000, and **Everything** the whole indexed library with no cap
- Smaller sizes open faster; the larger ones stay responsive by settling the layout sooner and repainting less often
- Saved as `graph_scope`, stored as `small`, `medium`, `large`, or `xl`

### Minimap

- On by default
- Can be turned off for a single-column reading layout
- Saved as `minimap_enabled`

### Speed Reader

- Off by default
- Dims non-anchor prose text (including headings) so bold lead anchors carry the most contrast against the background
- Quiets links to the dimmed prose color with a faint underline, until hover or keyboard focus brightens them
- Regularizes existing bold text and adds bold lead anchors at word starts; all-caps acronyms (HTML, GFM) are bolded whole
- Saved as `speed_reader_enabled`

### Pager

- On by default
- Appends a Previous / Next bar at the bottom of documents in a folder tree connected by `README.md` files
- Turn it off when you prefer clean document bottoms without navigation buttons
- Saved as `pager_enabled`

### Line numbers

- Off by default
- Numbers each block in the left gutter as a copyable [block permalink](01-rendering.md#inline-html)
- Hidden until you hover a block (or the number itself) on pointer devices; stays faintly visible on touch devices and narrow windows, where a single tap copies the link
- Turning it off hides the numbers; blocks keep their ids, so `#id` deep links still resolve
- Saved as `line_numbers_enabled`

### Reading-view editing

- On by default
- Lets you edit the rendered page directly — click a block to edit it — as described in [Editing](07-editing.md#inline-editing-the-reading-view)
- Turn it off to keep the reading view read-only; task checkboxes still toggle (and auto-save), and the [code view](07-editing.md#code-view) still edits the raw source
- Saved as `reader_editing_enabled`

### Indexing

- Off by default
- Enabling it starts a whole-device background crawl right away, and again on each launch while it stays on
- Files you open manually are still indexed even if background indexing is off

### Window size

- The window reopens at the size it had when it last closed, and maximized if it was maximized
- Saved as `window_width` and `window_height` (in logical, DPI-independent pixels) plus `window_maximized`
- The size is stored separately from the maximized state, so un-maximizing returns to the windowed dimensions rather than the full-screen ones
- Window position is not restored — only the size and maximized state

## Paths

The `directories` crate derives these per-app directories from the app id `com.ryanallen.leaftext`:

- macOS: `config_dir` = `data_dir` = `~/Library/Application Support/com.ryanallen.leaftext`
- Windows: `config_dir` = `%APPDATA%\ryanallen\leaftext\config`; `data_dir` = `%LOCALAPPDATA%\ryanallen\leaftext\data`
- Linux: `config_dir` = `$XDG_CONFIG_HOME/leaftext` (or `~/.config/leaftext`); `data_dir` = `$XDG_DATA_HOME/leaftext` (or `~/.local/share/leaftext`)

## Next

- [Library](03-library.md)
- [Themes](06-themes.md)
