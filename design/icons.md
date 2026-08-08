# Icons

> One row per icon: its name, its drawing, and where it is worn.

`just bundle-icons` compiles the rows below into `src/assets/icons.css`, one `.lt-icon-<name>` class each, drawn with `mask-image` and a `data:` URI. `just check-icons` fails when the generated file has drifted, when a row names a file that is not there, when a `.svg` under `src/assets/` has no row, when a row has no `Source`, when a `Source` names a pack with no license notice, and when a drawing sits in a box its weight was not drawn for.

An icon reaches the page as a name — `<span class="lt-icon lt-icon-back"></span>` — so a drawing used five times is in the app once. A mask reads only alpha, so the copy in the URI is painted flat black and the visible color is the control's own: `background-color: currentColor` on the base class.

Sixty-one `.svg` files sit under `src/assets/` and only sixty are listed. The odd one is `arrow-uturn-left.svg`, the arrow a footnote puts at the end of its own text to go back up: the renderer writes it into the document as markup rather than wearing it as a mask, so it has no class and no row. It is a redraw of Heroicons' u-turn arrow, and Heroicons' notice already ships.

## Source

**The row says which pack the drawing came from**, so the app can tell what licenses it owes rather than guessing from what a drawing looks like. `leaftext` is a drawing composed here; anything else names a pack, and the check fails unless `src/assets/` carries a `<Pack>-<License>.md` notice for it.

**It records where the license comes from, not who last touched the file.** A drawing traced from a pack and then edited — the bullets swapped on Heroicons' list, the bar shortened on Lucide's bold — still names the pack, because editing a drawing does not end the obligation that came with it. `leaftext` means composed here from nothing.

Where a drawing is identical in Feather and in Lucide, the row names `feather`: Lucide began as a fork of Feather and inherited those drawings unchanged, so Feather is where they came from.

| Pack | Notice | Drawings |
| --- | --- | --- |
| heroicons | `Heroicons-MIT.md` | 27 |
| lucide | `Lucide-ISC.md` | 16 |
| feather | `Feather-MIT.md` | 5 |
| tabler | `Tabler-MIT.md` | 1 |
| leaftext | — | 11 |

## Stroke

**The row sets the line weight, not the drawing.** A `.svg` arrives from wherever it was drawn carrying whatever number that tool wrote, and left alone those numbers drift — this set reached seven of them, so a new button in the app bar could sit beside an old one at half again the weight. `bundle-icons` stamps the row's weight over every stroke in the file, so what the drawing says is only a note, and the check fails when the two disagree.

**The `Box` column is the drawing the weight was set for**, and the check refuses a drawing in any other. A weight only means a thickness once you know how many units the drawing is across: regular's 1.5 in a 24-unit box worn at 16px lands on one rendered pixel, and hairline's 1 in a 12-unit box worn at 12px lands on the same one — different units per pixel, same line. Drop a drawing in at 32 units and it takes its row's weight and comes out at three quarters of everything beside it, which is what this refuses. A drawing with no strokes is held to no box, which is how the leaf stays at 64 and the drag grip at 24.

| Weight | Value | Box | Where |
| --- | --- | --- | --- |
| regular | 1.5 | 24 | Everything, unless a row says otherwise. |
| heavy | 2.25 | 24 | A drawing whose whole point is a bolder line: an unlocked padlock beside a shut one, the speed reader running beside stopped, a cross small enough that the regular weight disappears. |
| hairline | 1 | 12 | The window's own minimize / maximize / restore / close, which sit in the title bar beside the platform's chrome and have to match it, not us. |
| — | none | — | A drawing with no strokes at all: the leaf, the drag grip. |

**A row marked `heavy` in the fourth column gets a second mask** at the heavy weight, published as `--lt-icon-<name>-heavy`. The three view buttons use it: the view you are in is drawn a touch bolder as well as brighter, and a mask has no strokes to thicken, so the heavier drawing is its own mask.

| Name | File | Source | Stroke | Heavy | Where it is worn |
| --- | --- | --- | --- | --- | --- |
| back | arrow-left.svg | heroicons | regular | — | The app bar's Back button. |
| forward | arrow-right.svg | heroicons | regular | — | Forward, beside it. |
| settings | adjustments-vertical.svg | heroicons | regular | — | A vault row's own settings — the sliders that open everything you can do to that vault. |
| update | bell.svg | lucide | regular | — | The update bell, in the app bar only while an update is downloading or waiting to install. |
| open-library | panel.svg | leaftext | regular | — | The library toggle, left of Back. |
| open | folder-open.svg | heroicons | regular | — | Open a file. |
| new | plus.svg | heroicons | regular | — | New document, and the menu's add row. |
| code-view | code-bracket.svg | heroicons | regular | yes | View source, in the reader's view group. |
| document | document.svg | heroicons | regular | yes | The reading view. |
| graph | graph.svg | leaftext | regular | yes | The graph view. |
| sync | arrow-path.svg | heroicons | regular | — | A vault's sync button, spun while it works. |
| lock-closed | lock-closed.svg | heroicons | regular | — | Editing is off. |
| lock-open | lock-open.svg | heroicons | heavy | — | Editing is on. |
| speed-reader-on | speed-reader-on.svg | lucide | heavy | — | The speed reader, running. |
| speed-reader-off | speed-reader-off.svg | lucide | regular | — | The speed reader, stopped. |
| wand | wand.svg | lucide | regular | — | Tidy the document. |
| cloud | cloud.svg | lucide | regular | — | A vault whose saves reach somewhere else: a repository it pushes to, or a folder a sync client keeps. |
| computer | computer.svg | heroicons | regular | — | The whole library — everything on this machine, which is what the switcher's first row stands for rather than a vault. |
| package-open | package-open.svg | lucide | regular | — | The vault you are in. |
| package | package.svg | lucide | regular | — | A vault you are not in. |
| folder | folder.svg | heroicons | regular | — | A plain directory in the pane. |
| grip | grip-vertical.svg | lucide | — | — | A sheet's grab bar, and a block's drag handle. Lucide's grip with fatter dots. |
| close | x-mark.svg | heroicons | regular | — | Close a sheet. |
| text | text.svg | leaftext | regular | — | Paragraph, in the block gutter and the format bar. |
| heading | heading.svg | lucide | regular | — | Heading. |
| list | list-bullet.svg | heroicons | regular | — | List. Heroicons' list with its bullets redrawn as real circles. |
| quote | text-quote.svg | lucide | regular | — | Blockquote. |
| table | table.svg | lucide | regular | — | Table. Lucide's table with one dividing row instead of two. |
| image | photo.svg | heroicons | regular | — | Image. |
| divider | minus.svg | heroicons | regular | — | Thematic break. |
| comment | message-square.svg | feather | regular | — | Comment. |
| workflow | workflow.svg | lucide | regular | — | Flowchart — the block, and the editor's own button. |
| zoom-in | zoom-in.svg | feather | regular | — | Zoom in, on a diagram and on the flow canvas. |
| zoom-out | zoom-out.svg | feather | regular | — | Zoom out. |
| fit | fit.svg | lucide | regular | — | Fit the whole thing back on screen. |
| expand | expand.svg | heroicons | regular | — | Open a drawn diagram on the whole window. Heroicons' outward arrows, redrawn corner by corner. |
| bold | bold.svg | lucide | regular | — | Bold, in the format bar. Lucide's bold with both bars pulled in a unit. |
| italic | italic.svg | feather | regular | — | Italic. |
| strikethrough | strikethrough.svg | leaftext | regular | — | Strikethrough. |
| link | link.svg | feather | regular | — | Link. |
| undo | undo.svg | heroicons | regular | — | Undo the last edit, beside the view group. |
| missing-image | missing-image.svg | leaftext | regular | — | A picture the reading view could not load. Every platform draws its own broken mark and they look nothing alike, so the app draws one. |
| chevron-down | chevron-down.svg | heroicons | regular | — | The app bar's overflow toggle, and any "more below" mark. Also the find bar's next and previous, the one drawing turned over by CSS for previous. |
| replace | replace.svg | lucide | regular | — | The find bar's replace toggle: the row of Replace and All folds out under it. |
| select-all | select-all.svg | leaftext | regular | — | Put a cursor on every match, on the find bar's always-visible row. Two I-beams, the second stepped below the first: side by side and level they read as a pause button at 16px, which is the size this is worn at. |
| theme | theme.svg | tabler | regular | — | The app bar's palette button, which opens the theme sheet. |
| redo | redo.svg | heroicons | regular | — | Redo, beside undo in the flowchart editor. |
| window-minimize | window-minimize.svg | leaftext | hairline | — | The window's own minimize button. Drawn on a 12px grid at a hairline, because it sits in the title bar beside the platform's own chrome. |
| window-maximize | window-maximize.svg | leaftext | hairline | — | Maximize. Same grid. |
| window-restore | window-restore.svg | leaftext | hairline | — | Restore down, shown in place of maximize when the window is already maximized. |
| window-close | window-close.svg | leaftext | hairline | — | The window's close cross. |
| check | check.svg | heroicons | regular | — | A chosen row in a menu, and the code block's "copied" mark. |
| check-circle | check-circle.svg | heroicons | regular | — | The theme card's selected badge, where the tick needs a ring of its own to read on a colored card. |
| tab-close | tab-close.svg | lucide | heavy | — | A tab's close cross. Its own drawing rather than `close`, because at that size a 1.5 stroke disappears. |
| favorite-off | heart.svg | heroicons | regular | — | The heart in a tab's other corner, on a file that is not kept. |
| favorite-on | heart-filled.svg | heroicons | — | — | The same heart, filled, on one that is. A fill is a different drawing, not a bolder line, which is why it is its own row rather than the heavy weight. |
| back-long | back-long.svg | heroicons | regular | — | The menu row that goes up a folder. A longer arrow than the app bar's Back, which is why it is not the same icon. |
| trash | trash.svg | heroicons | regular | — | Delete, in the file menu. |
| copy | copy.svg | heroicons | regular | — | Copy a code block. |
| leaf | leaf.svg | leaftext | — | — | The header logomark, and a Markdown file's badge in the pane. |
