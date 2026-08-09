# Screenshots

One row per picture in `imgs/`: what it shows, and what takes it. Before this existed the commands were gone the moment each shot was taken, so a fault common to all of them — a black strip round two dozen of them, a vault list belonging to one machine — could not be fixed as a batch. See [Building](02-building.md#documentation-screenshots) for the script itself.

## How a picture is taken

```
pwsh scripts/capture-screenshot.ps1 -Doc <file> -Out shot.bmp [flags]
just squeeze-png shot.bmp imgs/<name>.png --palette
```

Four things about it are worth knowing before a retake:

- **The picture is the app's own rectangle.** The script photographs the client rectangle, so a shot at the pinned `-Width 1000 -Height 799` comes back 1500x1199 on a 1.5-scaling display, with none of the window's invisible resize border in it. Pointer steps in `-Do` are offset the same way, so a coordinate is a pixel in the picture — measure the next click off the last shot.
- **The profile starts empty every run.** Settings, recent files and the vault registry are all written from nothing, and `%USERPROFILE%` with the three `OneDrive` variables point at a folder with no sync client under it. So a shot never shows anything belonging to the machine it was taken on, and a batch never carries one picture's state into the next.
- **A cloud vault is staged, not borrowed.** Creating `%TEMP%\leaftext-shot\home\Dropbox` before a run is enough: the app finds it the way it finds a real one and registers it as a vault wearing a cloud.
- **Several vaults need `-Command`, not `-File`.** Through `-File` an array collapses into one comma-joined string and registers as a single vault with a wrong path. `powershell -Command "& '<script>' -Vault @('a','b') …"` passes them properly.

## Every picture

Only the marked row has been run as written. The rest are reconstructed from the picture and the words beside it, so treat one as a starting point rather than a record — correct it in place the first time it is used.

| Picture | What it shows | How it is taken |
| --- | --- | --- |
| `block-gutter.png` | A block lifted out mid-drag, its neighbors closing the gap | `-Unlocked`, then a `hold:` drag from the block's gutter handle |
| `code-view.png` | A Markdown file as raw source, with the editor's minimap rail | `-Unlocked`, click the code view button in the floating toolbar, cropped to 701x666 |
| `data.png` | A GitHub Actions workflow rendered as headed sections | `-Doc .github/workflows/release-windows.yml` |
| `editing.png` | The same document twice, rendered mid-edit and as source | Two shots composed side by side at 1000x799 |
| `email.png` | An `.eml` message: subject as heading, fields, body, attachments | `-Doc <a .eml file>` — no sample is in the repo |
| `file-actions.png` | The right-click menu on a file row in the library pane | `-Vault <folder> -LibraryOpen`, then `rclick:` on a file row |
| `flowchart-editor.png` | The flowchart editor as a full-window sheet, canvas and text | `-Doc ../docs/tests/mermaids.md -Unlocked`, then open a diagram's editor |
| `format-bar.png` | The format bar floating over a few selected words | `-Unlocked`, a `drag:` across words in a paragraph, cropped to 720x152 |
| `glossary-sheet.png` | A glossary entry open in a bottom sheet over the page | `-Doc <a document with a glossary>`, then click an underlined term |
| `graph.png` | The link graph filling the page | `-Vault <folder> -GraphScope xl`, then open the graph |
| `home.png` | The home screen: the two buttons, the recent list and the kept list beside it | no `-Doc`, `-Recents <files> -Favorites <files>` |
| `insert-row.png` | The insert row fanned out over an empty line | `-Unlocked`, then click an empty line |
| `leaftext.png` | The whole window: library, rendered page, minimap | `-Doc <a document> -Vault <folder> -LibraryOpen` |
| `library-sheet.png` | The library over the page as a sheet in a narrow window | `-Width 390 -Vault <folder> -LibraryOpen` |
| `library.png` | The library pane beside a document | `-Vault <folder> -LibraryOpen` |
| `link-hint.png` | The tooltip beside a hovered link | a `move:` onto a link, cropped to 1000x290 |
| `mermaid.png` | A flowchart and a pie chart in the theme's own colors | `-Doc ../docs/tests/mermaids.md` |
| `minimap-code.png` | The code view's own minimap rail at the right edge | `-Unlocked`, the code view, cropped to 501x520 at the right edge |
| `minimap.png` | The minimap rail beside the page | cropped to 701x356 at the right edge |
| `navigation.png` | The app bar across the top of the window | cropped to 1478x62 at the top edge |
| `outline.png` | A document's Outline row expanded under its title | click the Outline row |
| `pager.png` | The Previous / Next bar at the foot of a document | `-Doc <a document in a folder of them>`, scrolled to the foot |
| `permalink.png` | The permalink mark beside a hovered heading | a `move:` onto a heading, cropped to 367x199 |
| `pinned-headings.png` | Two heading rows pinned at the top of the code view | the code view scrolled into a subsection, cropped to 1360x300 |
| `rendering.png` | The reading view at the pinned window size | `-Doc docs/01-features/01-rendering.md` |
| `rendering-2x.png` | The same, at the full picture size | `-Doc docs/01-features/01-rendering.md` |
| `search.png` | Search results in the library pane | `-Vault <folder> -LibraryOpen`, click the search box, `type:` a word |
| `settings.png` | The settings panel | click the settings button, cropped to 470x625 |
| `speedreader.png` | A paragraph with Speed Reader on | Speed Reader turned on, cropped to 1121x792 |
| `theme-diagrams.png` | One page of diagrams under two themes | two shots at different `-ThemeFamily`, composed side by side |
| `theme-picker.png` | The theme picker as a bottom sheet | click the palette button in the app bar |
| `typing-help.png` | The completion popup after `[[`, and a broken link underlined | `-Vault <folder> -Unlocked`, the code view, `type:[[` |
| `ui-tour.png` | The whole window with every part in view | `-Vault <folder> -LibraryOpen` |
| `vault-switcher.png` | The vault switcher open, one row wearing a cloud | **Run 5 August 2026.** `-Doc docs/01-features/03-library.md -Vault @('docs','design','themes') -LibraryOpen -Do 'click:50,82'`, with `%TEMP%\leaftext-shot\home\Dropbox` created first |
| `xml.png` | An XML sitemap rendered as a table of records | `-Doc sitemap.xml` |
| `xml-feed.png` | An RSS feed rendered as a heading and one section per item | `-Doc <an RSS file>` — no sample is in the repo |
| `xml-tei.png` | An 84000 TEI translation | `-Doc <a TEI file>` — no sample is in the repo |

`install-mac.png`, `install-mac-open-anyway.png`, `install-mac-open-confirm.png`, `install-mac-password.png`, `install-windows.png` and `install-windows-msi.png` are of the operating system, not the app, and are taken by hand on each platform. `imgs/themes/` holds one preview per theme family, listed in [Theming](04-theming.md).
