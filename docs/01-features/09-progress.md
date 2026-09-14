# Your Grove

> A record of how you use Leaftext, kept on your own disk and turned off with one switch.

Leaftext keeps a quiet record of what you do in it and shows it as your **Grove**: thirteen Growth areas, each leveled by its own kind of use, and a Grove level that adds them up. Nothing about it changes how a document reads, and nothing it counts leaves your computer.

## Open your Grove

The **Grove** pill sits at the bottom of the [library pane](03-library.md), under the row of buttons for Scheduled tasks, Favorites, Recent and Search. It runs the width of that row and shows the Leaftext leaf and your Grove level. Press it and a large sheet rises from the bottom of the window with a year of days — one square a day, darker the more grew on it — and every Growth area, its level and a bar for how far into that level it has grown. Drag the sheet down, press the cross, press outside it or press Escape to put it away. The document stays open underneath.

![The Grove sheet risen over a document: Your Grove with four seeds and the Keep a record switch on in its header, Grove 17, a year of days with today shaded, the Growth areas in two columns with Leafing listing the fifteen formats and Markdown lit, and the four Landmarks in a column beside them, over the leaf-marked Grove pill at the foot of the library pane](../../imgs/grove-sheet.png)

When the library pane is dragged narrow the pill's words shorten and then go, and the leaf stays. When the pane is shut the pill goes with it; open the pane to reach it again.

## What it counts

Each area grows from one kind of thing you already do:

| Growth area | What grows it |
| --- | --- |
| Leafing | Reading documents |
| Scribing | Writing prose |
| Marking | Highlighting passages and hanging notes off them |
| Charting | Drawing flowcharts |
| Tabling | Filling in tables |
| Furnishing | Ticking checkboxes, writing fields and placing pictures |
| Wayfinding | Following links, opening the map and the glossary |
| Seeking | Opening what a vault search found |
| Tending | Making, renaming and moving files, and setting favorites |
| Rooting | Adding vaults, linking them to a repository and syncing |
| Sharing | Exporting a diagram, a picture, a PDF or a page |
| Delving | Looking at a document's source |
| Foraging | Reading a new kind of file and wearing a new theme |

Leafing counts the words you actually reach: a paragraph, heading or other block counts once it has been on screen for two seconds, and every 500 words is a point. A page Leaftext cannot split into blocks counts by how far down you have read it. Reading the same document again in one sitting adds nothing, and nothing counts while nobody has scrolled, typed or moved the pointer for five minutes, so a window left open overnight earns nothing. An area that has not counted anything yet stays at level 1 and says **Not started**. The first unit of anything puts an area at level 2, the third at level 3, and level 50 is the top. Every level gained anywhere is also a **seed**, shown beside the title.

The record holds counts and nothing else: never a file's name, its folder, or a word of what it says.

## Where it is kept

The record is `profile.json`, beside `settings.json` and `recent-files.json` in Leaftext's settings folder — `%APPDATA%\ryanallen\leaftext\config` on Windows and `~/Library/Application Support/com.ryanallen.leaftext` on a Mac. Leaftext writes it about half a minute after something changes, and once more when you close the window. If the file is missing or cannot be read, Leaftext starts a fresh record and opens as normal.

## Turn it off

Open your Grove and press **Keep a record** in the sheet's header. With the record off nothing is counted, the pill reads **Grove** with no number, and the sheet holds only the switch and a line saying so. Press the switch again to start counting where you left off.

The published site and a document embedded in another product keep no record, and show no pill.
