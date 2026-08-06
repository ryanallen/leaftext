# Icons

> One row per icon: its name, its drawing, and where it is worn.

`just bundle-icons` compiles the rows below into `src/assets/icons.css`, one `.lt-icon-<name>` class each, drawn with `mask-image` and a `data:` URI. `just check-icons` fails when the generated file has drifted, when a row names a file that is not there, and when a `.svg` under `src/assets/` has no row.

An icon reaches the page as a name — `<span class="lt-icon lt-icon-back"></span>` — so a drawing used five times is in the app once. A mask reads only alpha, so the copy in the URI is painted flat black and the visible color is the control's own: `background-color: currentColor` on the base class.

## Stroke

**The row sets the line weight, not the drawing.** A `.svg` arrives from wherever it was drawn carrying whatever number that tool wrote, and left alone those numbers drift — this set reached seven of them, so a new button in the app bar could sit beside an old one at half again the weight. `bundle-icons` stamps the row's weight over every stroke in the file, so what the drawing says is only a note, and the check fails when the two disagree.

| Weight | Value | Where |
| --- | --- | --- |
| regular | 1.5 | Everything, unless a row says otherwise. |
| heavy | 2.25 | A drawing whose whole point is a bolder line: an unlocked padlock beside a shut one, the speed reader running beside stopped, a cross small enough that the regular weight disappears. |
| hairline | 1 | The window's own minimize / maximize / restore / close, which sit in the title bar beside the platform's chrome and have to match it, not us. |
| — | none | A drawing with no strokes at all: the leaf, the drag grip. |

**A row marked `heavy` in the fourth column gets a second mask** at the heavy weight, published as `--lt-icon-<name>-heavy`. The three view buttons use it: the view you are in is drawn a touch bolder as well as brighter, and a mask has no strokes to thicken, so the heavier drawing is its own mask.

| Name | File | Stroke | Heavy | Where it is worn |
| --- | --- | --- | --- | --- |
| back | arrow-left.svg | regular | — | The app bar's Back button. |
| forward | arrow-right.svg | regular | — | Forward, beside it. |
| settings | adjustments-vertical.svg | regular | — | A vault row's own settings — the sliders that open everything you can do to that vault. |
| update | bell.svg | regular | — | The update bell, in the app bar only while an update is downloading or waiting to install. |
| open-library | panel.svg | regular | — | The library toggle, left of Back. |
| open | folder-open.svg | regular | — | Open a file. |
| new | plus.svg | regular | — | New document, and the menu's add row. |
| code-view | code-bracket.svg | regular | yes | View source, in the reader's view group. |
| document | document.svg | regular | yes | The reading view. |
| graph | graph.svg | regular | yes | The graph view. |
| sync | arrow-path.svg | regular | — | A vault's sync button, spun while it works. |
| lock-closed | lock-closed.svg | regular | — | Editing is off. |
| lock-open | lock-open.svg | heavy | — | Editing is on. |
| speed-reader-on | speed-reader-on.svg | heavy | — | The speed reader, running. |
| speed-reader-off | speed-reader-off.svg | regular | — | The speed reader, stopped. |
| wand | wand.svg | regular | — | Tidy the document. |
| cloud | cloud.svg | regular | — | A vault whose saves reach somewhere else: a repository it pushes to, or a folder a sync client keeps. |
| computer | computer.svg | regular | — | The whole library — everything on this machine, which is what the switcher's first row stands for rather than a vault. |
| package-open | package-open.svg | regular | — | The vault you are in. |
| package | package.svg | regular | — | A vault you are not in. |
| folder | folder.svg | regular | — | A plain directory in the pane. |
| grip | grip-vertical.svg | — | — | A sheet's grab bar, and a block's drag handle. |
| close | x-mark.svg | regular | — | Close a sheet. |
| text | text.svg | regular | — | Paragraph, in the block gutter and the format bar. |
| heading | heading.svg | regular | — | Heading. |
| list | list-bullet.svg | regular | — | List. |
| quote | text-quote.svg | regular | — | Blockquote. |
| table | table.svg | regular | — | Table. |
| image | photo.svg | regular | — | Image. |
| divider | minus.svg | regular | — | Thematic break. |
| comment | message-square.svg | regular | — | Comment. |
| workflow | workflow.svg | regular | — | Flowchart — the block, and the editor's own button. |
| zoom-in | zoom-in.svg | regular | — | Zoom in, on a diagram and on the flow canvas. |
| zoom-out | zoom-out.svg | regular | — | Zoom out. |
| fit | fit.svg | regular | — | Fit the whole thing back on screen. |
| expand | expand.svg | regular | — | Open a drawn diagram on the whole window. |
| bold | bold.svg | regular | — | Bold, in the format bar. |
| italic | italic.svg | regular | — | Italic. |
| strikethrough | strikethrough.svg | regular | — | Strikethrough. |
| link | link.svg | regular | — | Link. |
| undo | undo.svg | regular | — | Undo the last edit, beside the view group. |
| missing-image | missing-image.svg | regular | — | A picture the reading view could not load. Every platform draws its own broken mark and they look nothing alike, so the app draws one. |
| chevron-down | chevron-down.svg | regular | — | The app bar's overflow toggle, and any "more below" mark. Also the find bar's next and previous, the one drawing turned over by CSS for previous. |
| replace | replace.svg | regular | — | The find bar's replace toggle: the row of Replace / All / Select all folds out under it. |
| theme | theme.svg | regular | — | The app bar's palette button, which opens the theme sheet. |
| redo | redo.svg | regular | — | Redo, beside undo in the flowchart editor. |
| window-minimize | window-minimize.svg | hairline | — | The window's own minimize button. Drawn on a 12px grid at a hairline, because it sits in the title bar beside the platform's own chrome. |
| window-maximize | window-maximize.svg | hairline | — | Maximize. Same grid. |
| window-restore | window-restore.svg | hairline | — | Restore down, shown in place of maximize when the window is already maximized. |
| window-close | window-close.svg | hairline | — | The window's close cross. |
| check | check.svg | regular | — | A chosen row in a menu, and the code block's "copied" mark. |
| check-circle | check-circle.svg | regular | — | The theme card's selected badge, where the tick needs a ring of its own to read on a colored card. |
| tab-close | tab-close.svg | heavy | — | A tab's close cross. Its own drawing rather than `close`, because at that size a 1.5 stroke disappears. |
| favorite-off | heart.svg | regular | — | The heart in a tab's other corner, on a file that is not kept. |
| favorite-on | heart-filled.svg | — | — | The same heart, filled, on one that is. A fill is a different drawing, not a bolder line, which is why it is its own row rather than the heavy weight. |
| back-long | back-long.svg | regular | — | The menu row that goes up a folder. A longer arrow than the app bar's Back, which is why it is not the same icon. |
| trash | trash.svg | regular | — | Delete, in the file menu. |
| copy | copy.svg | regular | — | Copy a code block. |
| leaf | leaf.svg | — | — | The header logomark, and a Markdown file's badge in the pane. |
