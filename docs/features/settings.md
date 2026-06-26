# Settings

> leaftext stores preferences locally in JSON: theme, language, speed reader, minimap, indexing, and library layout state.

Settings are owned by the Rust app, not by browser storage. That keeps them durable across restarts and consistent across the embedded WebView.

## Options

| Setting | Options | Default |
| --- | --- | --- |
| Theme | System, Light, Dark, Dracula | System |
| Language | System, English, Simplified Chinese | System |
| Speed Reader | On / Off | Off |
| Minimap | On / Off | On |
| Pager | On / Off | On |
| Indexing | On / Off | Off |
| Library view | Project, Tree, Flat | Project |

## Open

Click **Settings** in the app bar. The panel opens as a dropdown and updates the app immediately as you change values.

## Files

| File | Purpose |
| --- | --- |
| `{config_dir}/leaftext/settings.json` | Preferences |
| `{config_dir}/leaftext/recent-files.json` | Last 8 opened files |
| `{local_data_dir}/leaftext/manifest.db` | Library index |
| `%LOCALAPPDATA%\ryanallen\leaftext\data\webview2` | Windows WebView2 data |

## Example

```json
{
  "indexing_enabled": true,
  "minimap_enabled": true,
  "pager_enabled": true,
  "speed_reader_enabled": false,
  "theme_mode": "system",
  "library_view": "tree",
  "library_expanded": [],
  "library_project_path": "",
  "library_closed": false,
  "library_width": 240
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

### Indexing

- Off by default
- Enables whole-device background crawling on next launch
- Files you open manually are still indexed even if background indexing is off

## Paths

- macOS `config_dir`: `~/Library/Application Support`
- Windows `config_dir`: `%APPDATA%`
- Linux `config_dir`: `$XDG_CONFIG_HOME` or `~/.config`
- Linux `local_data_dir`: `$XDG_DATA_HOME` or `~/.local/share`

## Next

- [Library](library.md)
- [Themes](themes.md)
