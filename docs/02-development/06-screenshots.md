# Screenshots

One row per picture in `imgs/`: what it shows, and what takes it. Before this existed the commands were gone the moment each shot was taken, so a fault common to all of them — a black strip round two dozen of them, a vault list belonging to one machine, a close cross on every tab — could not be fixed as a batch. See [Building](02-building.md#documentation-screenshots) for the script itself.

## How a picture is taken

```
pwsh scripts/capture-screenshot.ps1 -Doc <file> -Out shot.bmp [flags]
just squeeze-png shot.bmp imgs/<name>.png --palette
```

Seven things about it are worth knowing before a retake:

- **The picture is the app's own rectangle.** Two frames are cut off it: the window's invisible resize border, and the band the app holds itself off the window by so its shadow has room. Both photograph as pure black, which the app draws nowhere, and a shot at the pinned `-Width 1000 -Height 799` comes back 1440x1166 on a 1.5-scaling display. Pointer steps are offset the same way, so a coordinate is a pixel in the picture — measure the next click off the last shot, and measure a `-Crop` off it too.
- **Nothing is hovered unless a step asks for it.** The pointer is parked off the window before the steps run, because the capture draws what the pointer is over and never the pointer itself — so a control that only appears under one photographs as a control that is simply there.
- **The first-run bubble is off.** The profile is new every run, so without that every picture with the library open would carry one floating over the control it points at.
- **The profile starts empty every run.** Settings, recent files and the vault registry are all written from nothing, and `%USERPROFILE%` with the three `OneDrive` variables point at a folder with no sync client under it. So a shot never shows anything belonging to the machine it was taken on, and a batch never carries one picture's state into the next.
- **A cloud vault is staged, not borrowed.** Creating `%TEMP%\leaftext-shot\home\Dropbox` before a run is enough: the app finds it the way it finds a real one and registers it as a vault wearing a cloud. A folder of real documents can be junctioned in under it, which is what `<vault>` below is.
- **Several vaults need `-Command`, not `-File`.** Through `-File` an array collapses into one comma-joined string and registers as a single vault with a wrong path. `powershell -Command "& '<script>' -Vault @('a','b') …"` passes them properly. Several steps have the same trouble: pass them as one `-Steps 'click:1,2 wait:900'` string rather than as a `-Do` array.
- **The floating toolbar moves with the page.** Its buttons sit at different coordinates with the library pane open and shut, so a step aimed at one is measured off a shot with the same pane state.

`<vault>` in the rows below is `%TEMP%\leaftext-shot\home\Dropbox\emptyguru`, a junction to a folder of documents, so it registers as a vault wearing a cloud. Any folder of Markdown files does the same job; the names in the pictures are that folder's.

## Every picture

Only the marked rows have been run as written. The rest are reconstructed from the picture and the words beside it, so treat one as a starting point rather than a record — correct it in place the first time it is used.

| Picture | What it shows | How it is taken |
| --- | --- | --- |
| `block-gutter.png` | A block lifted out mid-drag, its neighbors closing the gap | **Run 11 August 2026.** `-Doc <vault>\docs\openmind.md -Unlocked -Steps 'move:660,600 hold:121,598,660,555'` — the move reveals the gutter handle, and the hold leaves the button down so the shot catches the block in flight |
| `code-view.png` | A Markdown file as raw source, with the editor's minimap rail | **Run 11 August 2026.** `-Doc README.md -Unlocked -Steps 'click:700,1111 wait:3000'` |
| `data.png` | A GitHub Actions workflow rendered as headed sections | **Run 11 August 2026.** `-Doc .github/workflows/release-windows.yml` |
| `delete-confirm.png` | The confirmation over a file the reader asked to delete | reconstructed: a vault of throwaway documents, `rclick:` a file row, then Delete. The vault it was taken against is not in the repo |
| `delete-undo.png` | The toast offering to undo a delete, cropped to it | reconstructed: the same run as `delete-confirm.png`, one step further on |
| `editing.png` | The same document twice, rendered mid-edit and as source | Two shots composed side by side at 1000x799 |
| `email.png` | An `.eml` message: subject as heading, fields, body, attachments | **Run 11 August 2026.** `-Doc ../docs/tests/message.eml` |
| `file-actions.png` | The right-click menu on a file row in the library pane | **Run 11 August 2026.** `-Doc <vault>\docs\openmind.md -Vault <vault> -LibraryOpen -Steps 'rclick:127,309'` |
| `flowchart-editor.png` | The flowchart editor as a full-window sheet, canvas and text | **Run 11 August 2026.** `-Doc ../docs/tests/flowcharts.md -Unlocked -Steps 'move:660,430 click:1084,554 wait:4000'` — the move brings up the diagram's own toolbar, whose second button opens the editor |
| `format-bar.png` | The format bar floating over a few selected words | `-Unlocked`, a `drag:` across words in a paragraph, cropped to 720x152 |
| `frontmatter-fields.png` | A note's fields as rows: text, date, checkbox and tags, with Add a field | reconstructed: a document whose front matter carries one of each kind, cropped to the block. The document is not in the repo |
| `glossary-sheet.png` | A glossary entry open in a bottom sheet over the page | **Run 11 August 2026.** `-Doc <vault>\docs\openmind.md -Steps 'click:849,370 wait:2000'` — the click lands on an underlined term |
| `graph.png` | The link graph around one document, its neighbors named | **Run 11 August 2026.** `-Doc <vault>\docs\collection-1-words-of-the-buddha--kangyur\volume-2-discourses--sutras\book-4-heap-of-jewels\README.md -Vault <vault> -LibraryOpen -GraphScope small -Steps 'click:941,1111 wait:8000'` — `xl` over a vault this size is a hairball with no readable name in it |
| `home.png` | The home screen: the two buttons, the recent list and the favorites beside it | no `-Doc`, `-Recents <files> -Favorites <files>` |
| `insert-row.png` | The insert row fanned out over an empty line | **Run 11 August 2026.** `-Doc <vault>\docs\openmind.md -Unlocked -Steps 'click:660,445 click:128,467'` — the first click puts the plus on the empty line, the second fans it out |
| `leaftext.png` | The whole window: library, rendered page, minimap | **Run 11 August 2026.** `-Doc <vault>\docs\openmind.md -Vault <vault> -LibraryOpen` — the same picture as `ui-tour.png` and `library.png`, filed three times |
| `library-sheet.png` | The library over the page as a sheet in a narrow window | `-Width 390 -Vault <folder> -LibraryOpen` |
| `library.png` | The library pane beside a document | **Run 11 August 2026.** the same shot as `leaftext.png` |
| `link-hint.png` | The tooltip beside a hovered link | a `move:` onto a link, cropped to 1000x290 |
| `mermaid.png` | A flowchart and a pie chart in the theme's own colors | **Run 11 August 2026.** `-Doc ../docs/tests/flowcharts.md` |
| `minimap-code.png` | The code view's own minimap rail at the right edge | `-Unlocked`, the code view, cropped to 501x520 at the right edge |
| `minimap.png` | The minimap rail beside the page | **Run 11 August 2026.** `-Doc <vault>\docs\defining_thought.md -Crop '800,60,640,700'` |
| `navigation.png` | The app bar across the top of the window | **Run 11 August 2026.** `-Doc <vault>\docs\openmind.md -Vault <vault> -LibraryOpen -Steps 'click:120,267' -Crop '0,0,1440,67'` — the click opens the second document so the strip has two tabs, and the crop is the app's own top edge down to six rows below the bar |
| `outline.png` | A document's Outline row expanded under its title | **Run 11 August 2026.** `-Doc <vault>\docs\openmind.md -Vault <vault> -LibraryOpen -Steps 'click:520,292'` |
| `pager.png` | The Previous / Next bar at the foot of a document | **Run 11 August 2026.** `-Doc <vault>\docs\openmind.md -Steps 'click:700,600 scroll:700,600,-60 scroll:700,600,-60'` |
| `permalink.png` | The permalink mark beside a hovered heading | a `move:` onto a heading, cropped to 367x199 |
| `pinned-headings.png` | Two heading rows pinned at the top of the code view | the code view scrolled into a subsection, cropped to 1360x300 |
| `rendering.png` | The reading view at the pinned window size | **Run 11 August 2026.** `-Doc docs/01-features/01-rendering.md` — the same shot as `rendering-2x.png`. The pair used to be one picture at each scaling, and this machine draws only the larger of the two |
| `rendering-2x.png` | The same, at the full picture size | **Run 11 August 2026.** `-Doc docs/01-features/01-rendering.md` |
| `search.png` | Search results in the library pane | **Run 11 August 2026.** `-Doc <vault>\docs\openmind.md -Vault <vault> -LibraryOpen -Steps 'click:180,133 type:thought wait:20000'` — the wait is for a vault of this size to answer |
| `settings.png` | The settings panel | click the settings button, cropped to 470x625 |
| `speedreader.png` | A paragraph with Speed Reader on | **Run 11 August 2026.** `-Doc docs/01-features/01-rendering.md -Steps 'click:603,1111 wait:3000'` |
| `theme-diagrams.png` | One page of diagrams under two themes | two shots at different `-ThemeFamily`, composed side by side |
| `theme-picker.png` | The theme picker as a bottom sheet | **Run 11 August 2026.** `-Doc <vault>\docs\openmind.md -Vault <vault> -LibraryOpen -Steps 'click:1094,31'` |
| `typing-help.png` | The completion popup after `[[`, and a broken link underlined | `-Vault <folder> -Unlocked`, the code view, `type:[[` |
| `ui-tour.png` | The whole window with every part in view | **Run 11 August 2026.** the same shot as `leaftext.png` |
| `vault-switcher.png` | The vault switcher open, one row wearing a cloud | **Run 11 August 2026.** through `-Command`: `-Doc docs/01-features/03-library.md -Vault @('docs','design','themes') -LibraryOpen -Steps 'click:40,83'`, with `%TEMP%\leaftext-shot\home\Dropbox` created first |
| `xml.png` | An XML sitemap rendered as a table of records | **Run 11 August 2026.** `-Doc sitemap.xml` |
| `xml-feed.png` | An RSS feed rendered as a heading and one section per item | **Run 11 August 2026.** `-Doc ../docs/tests/feed.xml` |
| `xml-tei.png` | An 84000 TEI translation | **Run 11 August 2026.** `-Doc ../docs/tests/tei.xml` |

`install-mac.png`, `install-mac-open-anyway.png`, `install-mac-open-confirm.png`, `install-mac-password.png`, `install-windows.png` and `install-windows-msi.png` are of the operating system, not the app, and are taken by hand on each platform. `imgs/themes/` holds one preview per theme family, listed in [Theming](04-theming.md).
