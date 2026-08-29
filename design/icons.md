# Icons

> One row per icon: its name, its drawing, and where it is worn.

`just bundle-icons` compiles the rows below into `src/assets/icons.css`, one `.lt-icon-<name>` class each, drawn with `mask-image` and a `data:` URI. It writes a third answer as well: `LEAF_ICON_PACK_RANGES` in `src/theme.rs`, where each pack's block sits in that sheet in bytes, so a page written out beside a document can be handed a sheet holding only the pack it wears. Those numbers are only true of the exact sheet written beside them, which is why one generator writes both. `just check-icons` fails when any of the generated files has drifted, when a row names a file that is not there, when a `.svg` under `src/assets/` has no row, when a row has no `Source` or names a pack with no license notice, when a drawing sits in a box its weight was not set for, and when two rows compile to the same mask — two controls wearing one drawing. That last one is measured on the mask, so an inert attribute cannot hide a copy and one shape at two named weights is not one.

An icon reaches the page as a name — `<span class="lt-icon lt-icon-back"></span>` — so a drawing used five times is in the app once. A mask reads only alpha, so the copy in the URI is painted flat black and the visible color is the control's own: `background-color: currentColor` on the base class.

**A row's `Source` is the pack its drawing came from**, so the app can say which licenses it owes: `leaftext` is a drawing composed here and owes nothing, anything else names a pack and needs a `<Pack>-<License>.md` notice beside the drawings.

## Stroke

**The row sets the line weight, not the drawing.** A `.svg` arrives from wherever it was drawn carrying whatever number that tool wrote, and left alone those numbers drift — this set reached seven of them, so a new button in the app bar could sit beside an old one at half again the weight. `bundle-icons` stamps the row's weight over every stroke in the file, so what the drawing says is only a note, and the check fails when the two disagree.

**A weight is only a thickness once you know how many units the drawing is across**, so `Box` is the box the value beside it was set for. A drawing in a wider box is scaled up to match rather than left thin — the same 1 in 24 units is half the line it is in 12, so `bundle-icons` stamps 2 there and the reader gets the weight this row asked for whichever set drew it. The app's own drawings are still refused outside their weight's box, so the scale only ever moves an outside pack's; a strokeless row is held to no box at all, which is how the leaf stays at 64 and the drag grip at 24.

| Weight | Value | Box | Where |
| --- | --- | --- | --- |
| regular | 1.5 | 24 | Everything, unless a row says otherwise. |
| heavy | 2.25 | 24 | A drawing whose whole point is a bolder line: an unlocked padlock beside a shut one, the speed reader running beside stopped, a cross small enough that the regular weight disappears. |
| hairline | 1 | 12 | The window's own minimize / maximize / restore / close, which sit in the title bar beside the platform's chrome and have to match it, not us. |
| — | none | — | A drawing with no strokes at all: the leaf, the drag grip. |

## Packs

**A pack is a whole set of drawings a theme family can wear**, and `leaftext` is one of them: the mixed set below is this app's own pack, a permanent choice a family can name, and the fallback every outside pack uses where it has no drawing for the same job. An outside pack's drawings sit in `src/assets/icon-packs/<pack>/`, one file per icon name in the table below rather than per whatever that pack called it, so six packs shipping their own `arrow-left.svg` never collide.

**The box and the stroke are the pack's, not the weight's.** The Stroke table above is one number per weight and refuses a drawing in any other box, which is right for drawings composed here and wrong for six outside sets: Phosphor draws in a 256-unit box and Remix fills rather than strokes, so either would be refused whole. A pack row says which box its drawings are in and whether they carry strokes; a filled pack takes no weight at all, and a stroked one takes the icon row's weight scaled to that box, so an outside drawing sits at the same line weight as everything beside it rather than at the same number. A drawing borrowed from another pack is scaled against the box of the pack that drew it.

**A pack that is not `leaftext` owes a license notice** beside the drawings, exactly as a row's `Source` does.

| Pack | Notice | Box | Drawn |
| --- | --- | --- | --- |
| leaftext | — | — | The Stroke table's own boxes and weights, unchanged: this is the app's own set. |
| feather | Feather-MIT.md | 24 | stroked |
| lucide | Lucide-ISC.md | 24 | stroked |
| tabler | Tabler-MIT.md | 24 | stroked |
| remix | Remix-Apache.md | 24 | filled |
| phosphor | Phosphor-MIT.md | 256 | filled |
| heroicons | Heroicons-MIT.md | 24 | stroked |

**A row marked `heavy` in the fifth column gets a second mask** at the heavy weight, published as `--lt-icon-<name>-heavy`. The three view buttons use it: the view you are in is drawn a touch bolder as well as brighter, and a mask has no strokes to thicken, so the heavier drawing is its own mask.

| Name | File | Source | Stroke | Heavy | Audit | Feather | Lucide | Tabler | Remix | Phosphor | Heroicons | Where it is worn |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| back | arrow-left.svg | heroicons | regular | — | back | arrow-left | move-left | arrow-narrow-left | arrow-left-long | arrow-left | arrow-long-left | The app bar's Back button. |
| forward | arrow-right.svg | heroicons | regular | — | forward | arrow-right | move-right | arrow-narrow-right | arrow-right-long | arrow-right | arrow-long-right | Forward, beside it. |
| settings | adjustments-vertical.svg | heroicons | regular | — | settings | sliders | sliders-horizontal | adjustments-horizontal | equalizer | sliders-horizontal | adjustments-horizontal | A vault row's own settings — the sliders that open everything you can do to that vault. |
| update | bell.svg | lucide | regular | — | update | bell | bell | bell | notification-3 | bell | bell | The update bell, in the app bar only while an update is downloading or waiting to install. |
| open-library | panel.svg | leaftext | regular | — | open-library | sidebar | panel-left | layout-sidebar | layout-left-2 | sidebar-simple | leaftext | The library toggle, left of Back. |
| open | folder-open.svg | heroicons | regular | — | open | folder | folder-open | folder-open | folder-open | folder-open | folder-open | Open a file. |
| new | plus.svg | heroicons | regular | — | new | plus | plus | plus | add | plus | plus | New document, and the menu's add row. |
| code-view | code-bracket.svg | heroicons | regular | yes | code-view | code | code-2 | code | code-s-slash | code | code-bracket | View source, in the reader's view group. |
| document | document.svg | heroicons | regular | yes | document | file-text | file-text | file-text | file-text | file-text | document-text | The reading view. |
| graph | graph.svg | leaftext | regular | yes | graph | leaftext | leaftext | leaftext | leaftext | leaftext | leaftext | The graph view. |
| sync | arrow-path.svg | heroicons | regular | — | sync | refresh-cw | refresh-cw | refresh | refresh | arrows-clockwise | arrow-path | A vault's sync button, spun while it works. |
| lock-closed | lock-closed.svg | heroicons | regular | — | lock-closed | lock | lock | lock | lock | lock | lock-closed | Editing is off. |
| lock-open | lock-open.svg | heroicons | heavy | — | lock-open | unlock | lock-open | lock-open | lock-unlock | lock-open | lock-open | Editing is on. |
| speed-reader-on | speed-reader-on.svg | lucide | heavy | — | speed-reader-on | leaftext | gauge | gauge | dashboard-2 | gauge | leaftext | The speed reader, running. |
| speed-reader-off | speed-reader-off.svg | lucide | regular | — | speed-reader-off | leaftext | gauge | gauge | dashboard-2 | gauge | leaftext | The speed reader, stopped. |
| wand | wand.svg | lucide | regular | — | wand | leaftext | wand-sparkles | wand | magic | magic-wand | leaftext | Tidy the document. |
| cloud | cloud.svg | lucide | regular | — | cloud | cloud | cloud | cloud | cloud | cloud | cloud | A vault whose saves reach somewhere else: a repository it pushes to, or a folder a sync client keeps. |
| export | cloud-download.svg | lucide | regular | — | export | download-cloud | cloud-download | cloud-download | download-cloud | cloud-arrow-down | cloud-arrow-down | Save what is on screen as its own file: the page, in the app bar; a diagram, in the corner of a drawn diagram and on the full-window view; and a picture, in the corner of a widened one. |
| computer | computer.svg | heroicons | regular | — | computer | monitor | monitor | device-desktop | computer | monitor | computer-desktop | The whole library — everything on this machine, which is what the switcher's first row stands for rather than a vault. |
| package-open | package-open.svg | lucide | regular | — | package-open | leaftext | package-open | leaftext | leaftext | leaftext | leaftext | The vault you are in. |
| package | package.svg | lucide | regular | — | package | package | package | package | box-3 | package | cube | A vault you are not in. |
| folder | folder.svg | heroicons | regular | — | folder | folder | folder | folder | folder | folder | folder | A plain directory in the pane. |
| grip | grip-vertical.svg | lucide | — | — | grip | leaftext | grip-vertical | grip-vertical | draggable | dots-six-vertical | leaftext | A sheet's grab bar, and a block's drag handle. |
| close | x-mark.svg | heroicons | regular | — | close | x | x | x | close | x | x-mark | Close a sheet. |
| text | text.svg | leaftext | regular | — | text | type | type | letter-t | feather:type | text-t | leaftext | Paragraph, in the block gutter and the format bar. |
| heading | heading.svg | lucide | regular | — | heading | leaftext | heading-1 | heading | heading | text-h-one | h1 | Heading. |
| list | list-bullet.svg | heroicons | regular | — | list | list | list | list | list-unordered | list-bullets | list-bullet | List. |
| quote | text-quote.svg | lucide | regular | — | quote | remix:double-quotes-l | remix:double-quotes-l | blockquote | double-quotes-l | quotes | remix:double-quotes-l | Blockquote. |
| table | table.svg | lucide | regular | — | table | table | table-2 | table | table | table | table-cells | Table. |
| image | photo.svg | heroicons | regular | — | image | image | image | photo | image | image | photo | Image. |
| divider | minus.svg | heroicons | regular | — | divider | minus | minus | minus | subtract | minus | minus | Thematic break. |
| comment | message-square.svg | feather | regular | — | comment | message-square | message-square | message | chat-3 | chat-text | chat-bubble-left | Comment. |
| workflow | workflow.svg | lucide | regular | — | workflow | phosphor:flow-arrow | workflow | hierarchy-2 | flow-chart | flow-arrow | phosphor:flow-arrow | Flowchart — the block, and the editor's own button. |
| zoom-in | zoom-in.svg | feather | regular | — | zoom-in | zoom-in | zoom-in | zoom-in | zoom-in | magnifying-glass-plus | magnifying-glass-plus | Zoom in, on a diagram and on the flow canvas. |
| zoom-out | zoom-out.svg | feather | regular | — | zoom-out | zoom-out | zoom-out | zoom-out | zoom-out | magnifying-glass-minus | magnifying-glass-minus | Zoom out. |
| fit | fit.svg | lucide | regular | — | fit | minimize-2 | minimize-2 | arrows-minimize | collapse-diagonal-2 | arrows-in | arrows-pointing-in | Fit the whole thing back on screen. |
| expand | expand.svg | heroicons | regular | — | expand | maximize-2 | maximize-2 | arrows-maximize | expand-diagonal | arrows-out | arrows-pointing-out | Open a drawn diagram on the whole window. |
| bold | bold.svg | lucide | regular | — | bold | bold | bold | bold | bold | text-b | bold | Bold, in the format bar. |
| italic | italic.svg | feather | regular | — | italic | italic | italic | italic | italic | text-italic | italic | Italic. |
| strikethrough | strikethrough.svg | leaftext | regular | — | strikethrough | leaftext | strikethrough | strikethrough | strikethrough | text-strikethrough | strikethrough | Strikethrough. |
| link | link.svg | feather | regular | — | link | link | link | link | link | link | link | Link. |
| undo | undo.svg | heroicons | regular | — | undo | leaftext | undo-2 | arrow-back-up | arrow-go-back | arrow-counter-clockwise | arrow-uturn-left | Undo the last edit, beside the view group. |
| missing-image | missing-image.svg | leaftext | regular | — | missing-image | leaftext | image-off | photo-off | leaftext | image-broken | leaftext | A picture the reading view could not load. Every platform draws its own broken mark and they look nothing alike, so the app draws one. |
| chevron-down | chevron-down.svg | heroicons | regular | — | chevron-down | chevron-down | chevron-down | chevron-down | arrow-down-s | caret-down | chevron-down | The app bar's overflow toggle, and any "more below" mark. Also the find bar's next and previous, the one drawing turned over by CSS for previous. |
| replace | replace.svg | lucide | regular | — | replace | leaftext | replace | replace | find-replace | leaftext | leaftext | The find bar's replace toggle: the row of Replace and All folds out under it. |
| select-all | select-all.svg | leaftext | regular | — | select-all | lucide:text-select | text-select | select-all | lucide:text-select | selection-all | lucide:text-select | Put a cursor on every match, on the find bar's always-visible row. Two I-beams, the second stepped below the first: side by side and level they read as a pause button at 16px, which is the size this is worn at. |
| theme | theme.svg | tabler | regular | — | theme | leaftext | palette | palette | palette | palette | leaftext | The app bar's palette button, which opens the theme sheet. |
| redo | redo.svg | heroicons | regular | — | redo | leaftext | redo-2 | arrow-forward-up | arrow-go-forward | arrow-clockwise | arrow-uturn-right | Redo, beside undo in the reader tool bar and in the flowchart editor. |
| window-minimize | window-minimize.svg | leaftext | hairline | — | window-minimize | minus | minus | leaftext | subtract | minus | minus | The window's own minimize button. Drawn on a 12px grid at a hairline, because it sits in the title bar beside the platform's own chrome. |
| window-maximize | window-maximize.svg | leaftext | hairline | — | window-maximize | square | square | leaftext | checkbox-blank | square | leaftext | Maximize. Same grid. |
| window-restore | window-restore.svg | leaftext | hairline | — | window-restore | leaftext | leaftext | leaftext | leaftext | leaftext | leaftext | Restore down, shown in place of maximize when the window is already maximized. |
| window-close | window-close.svg | leaftext | hairline | — | window-close | x | x | x | close | x | x-mark | The window's close cross. |
| check | check.svg | heroicons | regular | — | check | check | check | check | check | check | check | A chosen row in a menu, and the code block's "copied" mark. |
| check-circle | check-circle.svg | heroicons | regular | — | check-circle | check-circle | check-circle | circle-check | checkbox-circle | check-circle | check-circle | The theme card's selected badge, where the tick needs a ring of its own to read on a colored card. |
| tab-close | tab-close.svg | lucide | heavy | — | tab-close | x | x | x | close | x | x-mark | A tab's close cross. Its own drawing rather than `close`, because at that size a 1.5 stroke disappears. |
| favorite-off | heart.svg | heroicons | regular | — | favorite-off | heart | heart | heart | heart | heart | heart | The heart in a tab's other corner, on a file that is not a favorite. |
| favorite-on | heart-filled.svg | heroicons | — | — | favorite-on | heart filled | heart filled | heart-filled | heart-fill | heart-fill | heart-filled | The same heart, filled, on one that is. A fill is a different drawing, not a bolder line, which is why it is its own row rather than the heavy weight. |
| back-long | back-long.svg | heroicons | regular | — | back | arrow-left | arrow-left | arrow-left | arrow-left | arrow-left | arrow-left | The menu row that goes up a folder. A longer arrow than the app bar's Back, which is why it is not the same icon. |
| trash | trash.svg | heroicons | regular | — | trash | trash-2 | trash-2 | trash | delete-bin | trash | trash | Remove vault, in the vault settings menu. |
| copy | copy.svg | heroicons | regular | — | copy | copy | copy | copy | file-copy | copy | square2-stack | Copy a code block. |
| leaf | leaf.svg | leaftext | — | — | logo | leaftext | leaftext | leaftext | leaftext | leaftext | leaftext | The header logomark, and a Markdown file's badge in the pane. |
| windows | windows.svg | leaftext | — | — | windows | leaftext | leaftext | leaftext | leaftext | leaftext | leaftext | The Windows mark on the landing page's Download for Windows button — a document names it in the button's braces. Four squares, so it is composed here. |
| apple | apple.svg | simpleicons | — | — | apple | leaftext | leaftext | leaftext | leaftext | leaftext | leaftext | The Apple mark on the Download for macOS button beside it. |
