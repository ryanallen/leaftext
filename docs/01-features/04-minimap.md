# Minimap

> Take in the whole page at once. A tiny version of your document runs down the side — real text, not abstract bars — with a marker showing where you are. Click to jump to any section; drag the marker to scroll.

The minimap is a scaled side-rail showing the actual document beside the reading view. It sits outside the page rather than on it — the page's border stops 4 px short and the rail stands on the same textured chrome as the [library](03-library.md) pane and the app bar, held off the window edge by the same gutter the page card is. It gives you spatial orientation in long documents and lets you jump to any section by clicking or dragging. Because it is a real rendering of the page, you can recognize where you are from the shape of the text itself: a heading, a code block, a verse, a dense paragraph.

## How it works

The minimap clones the rendered document and shrinks it to the rail width with a CSS transform — a `scale(...)` to the rail width, plus a vertical nudge so the thumbnail lines up with where the real content begins — the way a code editor's minimap does. What you see in the rail is a real (very small) copy of the page, so the text that is actually there is what shows up. The clone is stripped of ids and links so nothing in it is focusable or duplicated for assistive technology, and it inherits the active theme through the shared stylesheet — so switching light/dark needs no rebuild.

A viewport indicator overlays the portion currently visible; as you scroll, it moves in lockstep. When the document is taller than the rail, the thumbnail itself slides inside the rail (again, like a code editor) so the region around your position stays in view. Clicking anywhere on the rail scrolls the reader to that point in the document; dragging the indicator keeps the grabbed point under the cursor. Either way the point you land on becomes the reader's recorded position (see [Restore](02-navigation.md#restore)), so content that settles afterwards — images, diagrams, the [Pager](02-navigation.md#pager) — cannot pull you back to where you started.

The clone is rebuilt only when it needs to be — when the document's content changes (live reload, or code highlighting, Mermaid diagrams, and math settling in), when images finish loading, or when the rail resizes. It is **never** rebuilt on scroll. Only three CSS custom properties are written as you scroll:

- `--minimap-viewport-top` — positions the viewport indicator within the rail
- `--minimap-viewport-height` — sizes the indicator proportionally to the reader window
- `--minimap-preview-top` — slides the thumbnail inside the rail on tall documents (the CSS maps it to the clone's `top`)

A `requestAnimationFrame`-throttled loop writes those on scroll, so the rail stays fluid without blocking the main thread. The indicator's position and travel come from the reader's exact scroll position over its scrollable height, and the indicator's height is the reader window scaled to the rail — so click-to-scroll and the indicator stay aligned with the thumbnail on documents of any length.

> [!NOTE]
> The thumbnail is a second, scaled-down layout of the whole document, built for the rail so it can show real text at the right height. For a very large document that costs extra memory and a background layout pass when the thumbnail is (re)built, but it is never on the scroll path. It is the deliberate trade for a legible, honest thumbnail.

## Whether the rail appears

The Rust side produces a small `DocumentMinimap` for each document whose only job now is to report a positive line count: an empty or zero-line document reports `0` and the rail is skipped entirely. [XML](01-rendering.md#xml) and [JSON/YAML](01-rendering.md#data-files-json-and-yaml) documents report their count from the rendered block HTML (they have no Markdown source to line-scan), so an opened `.xml`, `.json`, or `.yaml` file gets the same real-text rail as a Markdown file — the thumbnail itself is always the live clone, whatever the source format.

The [code view](07-editing.md#code-view) uses this same minimap over the raw source: the identical rail, thumbnail clone, and drag/click behavior, mirroring the highlighted source text instead of the rendered page. There it renders regardless of the setting below, because with no native scrollbar it is the code view's vertical scroll affordance.

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
