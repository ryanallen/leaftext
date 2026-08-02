# Icons

> One row per icon: its name, its drawing, and where it is worn.

`just bundle-icons` compiles the rows below into `src/assets/icons.css`, one
`.lt-icon-<name>` class each, drawn with `mask-image` and a `data:` URI.
`just check-icons` fails when the generated file has drifted, when a row names a file
that is not there, and when a `.svg` under `src/assets/` has no row.

An icon reaches the page as a name — `<span class="lt-icon lt-icon-back"></span>` —
so a drawing used five times is in the app once. A mask reads only alpha, so the
copy in the URI is painted flat black and the visible color is the control's own:
`background-color: currentColor` on the base class.

**A row marked `heavy` gets a second mask** with its strokes drawn at 2.25 instead of
1.5, as `--lt-icon-<name>-heavy`. The three view buttons use it: the view you are in
is drawn a touch bolder as well as brighter, and a mask has no strokes to thicken, so
the heavier drawing is its own mask.

| Name | File | Heavy | Where it is worn |
| --- | --- | --- | --- |
| back | arrow-left.svg | — | The app bar's Back button. |
| forward | arrow-right.svg | — | Forward, beside it. |
| settings | adjustments-vertical.svg | — | The settings menu, and a vault row's own settings — the same sliders, because that panel is that vault's settings. |
| open-library | panel.svg | — | The library toggle, left of Back. |
| open | folder-open.svg | — | Open a file. |
| new | plus.svg | — | New document, and the menu's add row. |
| code-view | code-bracket.svg | yes | View source, in the reader's view group. |
| document | document.svg | yes | The reading view. |
| graph | graph.svg | yes | The graph view. |
| sync | arrow-path.svg | — | A vault's sync button, spun while it works. |
| lock-closed | lock-closed.svg | — | Editing is off. |
| lock-open | lock-open.svg | — | Editing is on. |
| speed-reader-on | speed-reader-on.svg | — | The speed reader, running. |
| speed-reader-off | speed-reader-off.svg | — | The speed reader, stopped. |
| wand | wand.svg | — | Tidy the document. |
| cloud | cloud.svg | — | A vault that reaches GitHub. |
| package-open | package-open.svg | — | The vault you are in. |
| package | package.svg | — | A vault you are not in. |
| folder | folder.svg | — | A plain directory in the pane. |
| grip | grip-vertical.svg | — | A sheet's grab bar, and a block's drag handle. |
| close | x-mark.svg | — | Close a sheet. |
| text | text.svg | — | Paragraph, in the block gutter and the format bar. |
| heading | heading.svg | — | Heading. |
| list | list-bullet.svg | — | List. |
| quote | text-quote.svg | — | Blockquote. |
| table | table.svg | — | Table. |
| image | photo.svg | — | Image. |
| divider | minus.svg | — | Thematic break. |
| comment | message-square.svg | — | Comment. |
| workflow | workflow.svg | — | Flowchart — the block, and the editor's own button. |
| zoom-in | zoom-in.svg | — | Zoom in, on a diagram and on the flow canvas. |
| zoom-out | zoom-out.svg | — | Zoom out. |
| fit | fit.svg | — | Fit the whole thing back on screen. |
| bold | bold.svg | — | Bold, in the format bar. |
| italic | italic.svg | — | Italic. |
| strikethrough | strikethrough.svg | — | Strikethrough. |
| link | link.svg | — | Link. |
| undo | undo.svg | — | Undo the last edit, beside the view group. |
| missing-image | missing-image.svg | — | A picture the reading view could not load. Every platform draws its own broken mark and they look nothing alike, so the app draws one. |
| chevron-down | chevron-down.svg | — | The app bar's overflow toggle, and any "more below" mark. |
| theme | theme.svg | — | The theme row in the settings menu. |
| redo | redo.svg | — | Redo, beside undo in the flowchart editor. |
| window-minimize | window-minimize.svg | — | The window's own minimize button. Drawn on a 12px grid at a hairline, because it sits in the title bar beside the platform's own chrome. |
| window-maximize | window-maximize.svg | — | Maximize. Same grid. |
| window-restore | window-restore.svg | — | Restore down, shown in place of maximize when the window is already maximized. |
| window-close | window-close.svg | — | The window's close cross. |
| check | check.svg | — | A chosen row in a menu, and the code block's "copied" mark. |
| check-circle | check-circle.svg | — | The theme card's selected badge, where the tick needs a ring of its own to read on a colored card. |
| tab-close | tab-close.svg | — | A tab's close cross. Its own drawing rather than `close`, because at that size a 1.5 stroke disappears. |
| back-long | back-long.svg | — | The menu row that goes up a folder. A longer arrow than the app bar's Back, which is why it is not the same icon. |
| trash | trash.svg | — | Delete, in the file menu. |
| copy | copy.svg | — | Copy a code block. |
| leaf | leaf.svg | — | The header logomark, and a Markdown file's badge in the pane. |
