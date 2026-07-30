# Minimap

> Take in the whole page at once. A tiny version of your document runs down the side — real text, not abstract bars — with a marker showing where you are. Click to jump to any section; drag the marker to scroll.

The minimap is a scaled side-rail showing the actual document beside the reading view. It sits outside the page rather than on it — the page's border stops 4 px short and the rail stands on the same textured chrome as the [library](03-library.md) pane and the app bar, held off the window edge by the same gutter the page card is. It gives you spatial orientation in long documents and lets you jump to any section by clicking or dragging. Because it is a real rendering of the page, you can recognize where you are from the shape of the text itself: a heading, a code block, a verse, a dense paragraph.

## How it works

The minimap clones the rendered document and shrinks it to the rail width with a CSS transform — a `scale(...)` to the rail width, plus a vertical nudge so the thumbnail lines up with where the real content begins — the way a code editor's minimap does. What you see in the rail is a real (very small) copy of the page, so the text that is actually there is what shows up. The clone is stripped of ids and links so nothing in it is focusable or duplicated for assistive technology, and it inherits the active theme through the shared stylesheet — so switching light/dark needs no rebuild.

On a document taller than the rail, the clone holds the slice the rail can actually show rather than the whole page. The rail is a few hundred pixels over a thumbnail that on a large glossary is hundreds of thousands of pixels tall, so a whole-document clone is almost entirely off-screen — a second copy of every element on the page, which is enough to make each wheel click cost the better part of a second. The window carries a rail's worth of document above and below what is visible, so you can scroll that far before it is rebuilt. It is still a clone of the real rendering, so the rail shows real text rather than a synthesized pattern of lines; and on a document the rail can show in full the window *is* the whole document, which is why none of this depends on a size threshold.

A viewport indicator overlays the portion currently visible; as you scroll, it moves in lockstep. When the document is taller than the rail, the thumbnail itself slides inside the rail (again, like a code editor) so the region around your position stays in view. Clicking anywhere on the rail scrolls the reader to that point in the document; dragging the indicator keeps the grabbed point under the cursor. Either way the point you land on becomes the reader's recorded position (see [Restore](02-navigation.md#restore)), so content that settles afterwards — images, diagrams, the [Pager](02-navigation.md#pager) — cannot pull you back to where you started.

The clone is rebuilt only when it needs to be — when the document's content changes (live reload, or code highlighting, Mermaid diagrams, and math settling in), when images finish loading, when the rail resizes, and when scrolling or a drag leaves the window it was built for. Scrolling otherwise writes three CSS custom properties and nothing else:

- `--minimap-viewport-top` — positions the viewport indicator within the rail
- `--minimap-viewport-height` — sizes the indicator proportionally to the reader window
- `--minimap-preview-top` — slides the thumbnail inside the rail on tall documents (the CSS maps it to a `transform`, not `top`: the lane moves every frame, and moving it by a layout property made the browser re-lay-out the page to do it)

A `requestAnimationFrame`-throttled loop writes those on scroll, and reads no geometry at all while doing it. The rail's measurements — the document's height, the thumbnail's scale, the rail's own height — change only when the content or the window does, so they are cached and dropped by the things that can change them; scrolling changes none of them. Re-measuring per wheel click instead forces a fresh layout of the entire document, which on a large file is the whole difference between a rail that follows the wheel and one that answers a second later. The indicator's position and travel come from the reader's exact scroll position over its scrollable height, and the indicator's height is the reader window scaled to the rail — so click-to-scroll and the indicator stay aligned with the thumbnail on documents of any length.

> [!NOTE]
> The thumbnail is a second, scaled-down layout, so it cannot exist until the document itself has been laid out. Until it does the rail shows a small spinner rather than an empty lane — on a large document that build is a visible wait, and a blank rail beside a finished page reads as one that failed rather than one still working.

## Whether the rail appears

The Rust side produces a small `DocumentMinimap` for each document whose only job now is to report a positive line count: an empty or zero-line document reports `0` and the rail is skipped entirely. That count is the only part of the model the page is sent — the thumbnail comes from the clone, so the model's per-line detail would be megabytes of payload on a large document that nothing reads. [XML](01-rendering.md#xml) and [JSON/YAML](01-rendering.md#data-files-json-and-yaml) documents report their count from the rendered block HTML (they have no Markdown source to line-scan), so an opened `.xml`, `.json`, or `.yaml` file gets the same real-text rail as a Markdown file — the thumbnail itself is always the live clone, whatever the source format.

## The code view's minimap

The [code view](07-editing.md#code-view) has a rail of its own — the editor's, not this one. It draws the source rather than cloning a page, which is what lets it stay honest on a file far too large to lay out twice, and it is always present there: with no scrollbar in the source view, the rail is how you see where you are. The reader's rail and the editor's are two implementations of one idea, so they are dressed alike — the same viewport box, the same border and rounding, the same width and standing-off from the page.

Both rails are **chrome, not page**: they stand on the window's textured surface beside the card, and the page's own right border is the line between the two. In the code view that means the editor paints no background out there and the map's own drawing surface is transparent, so the chrome's dot grain shows through between the lines of the map — the map reads as text on the window rather than as a second, differently-colored page.

> [!NOTE]
> The reading view's rail is a real clone of the page; the code view's is the editor's drawing of the source. They look and behave alike on purpose, but the [minimap setting](#toggling-the-minimap) governs only the first — the code view always has its rail.

## Responsive behavior

The minimap adjusts its preview lane width depending on the available space:

| Breakpoint | Preview width |
| ---------- | ------------- |
| > 900 px   | 68 px         |
| 601–900 px | 46 px         |
| ≤ 600 px   | 38 px         |

On screens narrower than 600 px the minimap gutters shrink alongside the preview lane, keeping the reading column as wide as possible. The minimap is never hidden on small screens — it remains the primary scroll affordance at every window size.

## Toggling the minimap

The minimap can be toggled from **Settings** in the app bar. The setting is persisted across restarts via `{config_dir}/leaftext/settings.json` as the `minimap_enabled` field, so Leaf Text reopens in the same state you left it.

When the minimap is off, its column collapses to zero and the page widens back out to the window gutter, so no empty band remains to the right of the document. The reader's native scrollbar comes back as a thin one at that point: with no rail there would otherwise be nothing at all showing where you are in a long page. While the rail is present the scrollbar stays hidden, because the rail is that indicator.

> [!TIP]
> Use the minimap to quickly gauge document length and find dense sections at a glance. Because it is a real rendering of the page, headings, code blocks, verse, and dense paragraphs each keep their own shape — so you can pick out section breaks and dense passages in the rail from the layout itself, without reading a word.
