# Minimap

> leaftext's minimap is a shrunken clone of the rendered document in a side rail — real, tiny text, not abstract bars — with a live viewport indicator. Click to jump to any section; drag the indicator to scroll.

The minimap is a scaled side-rail showing the actual document beside the reading view. It gives you spatial orientation in long documents and lets you jump to any section by clicking or dragging. Because it is a real rendering of the page, you can recognize where you are from the shape of the text itself: a heading, a code block, a verse, a dense paragraph.

## How it works

The minimap clones the rendered document and shrinks it to the rail width with a CSS `transform: scale(...)`, the way a code editor's minimap does. What you see in the rail is a real (very small) copy of the page, so the text that is actually there is what shows up. The clone is stripped of ids and links so nothing in it is focusable or duplicated for assistive technology, and it inherits the active theme through the shared stylesheet — so switching light/dark needs no rebuild.

A viewport indicator overlays the portion currently visible; as you scroll, it moves in lockstep. When the document is taller than the rail, the thumbnail itself slides inside the rail (again, like a code editor) so the region around your position stays in view. Clicking anywhere on the rail scrolls the reader to that point in the document; dragging the indicator keeps the grabbed point under the cursor.

The clone is rebuilt only when it needs to be — when the document reflows (images or fonts settling, Mermaid diagrams rendering, the reading column changing width) or when the rail resizes. It is never rebuilt on scroll. Only two CSS custom properties are written as you scroll:

- `--minimap-viewport-top` — positions the viewport indicator within the rail
- `--minimap-viewport-height` — sizes the indicator proportionally to the reader window

plus the thumbnail's `top` offset for the slide. A `requestAnimationFrame`-throttled loop writes those on scroll, so the rail stays fluid without blocking the main thread. Both the indicator's height and how far it (and the thumbnail) travel are derived from the reader's real scroll range, so click-to-scroll and the indicator stay exact on documents of any length.

> [!NOTE]
> Showing real text means the document is laid out twice — once for the reader and once, scaled down, for the rail. For very large documents (a full glossary of tens of thousands of entries) that costs extra memory and a second layout pass. It is the deliberate trade for a legible, honest thumbnail.

## Responsive behavior

The minimap adjusts its preview lane width depending on the available space:

| Breakpoint | Preview width |
| ---------- | ------------- |
| > 900 px   | 68 px         |
| 601–900 px | 46 px         |
| ≤ 600 px   | 38 px         |

On screens narrower than 600 px the minimap gutters shrink alongside the preview lane, keeping the reading column as wide as possible. The minimap is never hidden on small screens — it remains the primary scroll affordance at every window size.

## Toggling the minimap

The minimap can be toggled from **Settings** in the app bar. The setting is persisted across restarts via `{config_dir}/leaftext/settings.json` as the `minimap_enabled` field, so leaftext reopens in the same state you left it.

When the minimap is off, the reading layout switches from a two-column grid to a centred single-column layout (`reader-layout-no-minimap`) so no empty gutter remains to the right of the document.

> [!TIP]
> Use the minimap to quickly gauge document length and find dense sections at a glance. Because it is a real rendering of the page, headings, code blocks, verse, and dense paragraphs each keep their own shape — so you can pick out section breaks and dense passages in the rail from the layout itself, without reading a word.
