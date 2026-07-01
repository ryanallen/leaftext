# Minimap

> leaftext's minimap paints a scaled thumbnail of the whole document to a canvas in a side rail, with a live viewport indicator. Click to jump to any section; drag the indicator to scroll.

The minimap is a scaled side-rail showing the full document structure beside the reading view. It gives you spatial orientation in long documents and lets you jump to any section by clicking or dragging.

## How it works

The minimap is a `<canvas>` painted once from the document's line model (see [Document model](#document-model)). Each source line maps to a row of the canvas: body blocks — paragraphs, lists, blockquotes, and code — are drawn as dim bars, and headings are painted over the top, so the document's structure stays legible even when tens of thousands of lines are compressed into a few hundred pixels. The bar colours come from the theme's minimap tokens. A viewport indicator overlays the portion currently visible; as you scroll, it moves in lockstep. Clicking anywhere on the rail scrolls the document to that position. Dragging the viewport indicator maps the pointer's position in the track proportionally to the document, so the reading view follows wherever you place the handle.

Because the canvas is a static thumbnail, it is painted once per document and repainted only when the rail is resized (debounced) or the theme changes — never on every scroll, and never when the document's DOM changes. This is what keeps a large document from being rendered twice: the minimap draws from the line model instead of cloning the reading area. Only the lightweight viewport indicator updates as you scroll.

The indicator is driven by two CSS custom properties so it stays in sync without repainting the canvas:

- `--minimap-viewport-top` — positions the viewport indicator within the rail
- `--minimap-viewport-height` — sizes the indicator proportionally to the reader window

A `requestAnimationFrame`-throttled loop writes those properties on scroll, so the rail stays fluid without blocking the main thread. Both the indicator's height and how far it travels are derived from the reader's real scroll range, so click-to-scroll and the indicator stay exact regardless of the thumbnail's line-based shape.

## Document model

Internally, `build_minimap_model()` produces a `DocumentMinimap` from the raw Markdown source — a series of `MinimapSpan` entries that record each line's category and structure without storing any source text:

```rust
pub struct DocumentMinimap {
    pub line_count: usize,
    pub spans: Vec<MinimapSpan>,
}

pub struct MinimapSpan {
    pub start_line: usize,
    pub line_count: usize,
    pub category: MinimapLineCategory,
    pub structure: MinimapLineStructure,
}
```

Each span's `category` is one of `Heading`, `Paragraph`, `Blank`, `List`, `Blockquote`, or `CodeFence`. Adjacent lines that share the same category and structure are compressed into a single span, so even a 20 000-line document produces a compact model. The model is serialized as JSON and handed to the WebView alongside the rendered HTML — the frontend paints the minimap canvas directly from these spans, mapping each span to a row of the rail and colouring it by category. An empty or zero-line document skips the rail entirely.

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
> Use the minimap to quickly gauge document length and find dense sections at a glance. Because it is painted from the document's line structure, headings, paragraphs, lists, blockquotes, and code each carry their own tint — so you can pick out section breaks and dense passages in the rail without reading a word.
