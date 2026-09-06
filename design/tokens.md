# Tokens

> Every value in the interface that is not a color. One value each, whatever theme is on.

A color is themed and lives in [colors.md](colors.md); these do not change with the theme, so this file holds the value itself.

`just bundle-tokens` compiles the tables below into `src/assets/tokens.css`, which is served ahead of the app stylesheet so every `var()` in it resolves. `just check-tokens` fails when the two drift. **Never edit `src/assets/tokens.css`** — it is generated, the same way `src/assets/themes.md` is.

A row is `| Token | Value | What it is for |`, the name written bare of the `--`.

## Corners

One scale every surface pulls from, so rounding swaps in a single place. The sizes are the values the components already used.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-radius-xs | 2px | A mark too small to look rounded at anything larger. |
| lt-radius-sm | 4px | A chip, a badge, a small field. |
| lt-radius-md | 6px | A button, a menu row. |
| lt-radius-lg | 8px | A card, a panel, a code block. |
| lt-radius-xl | 10px | A floating panel or a hover tip. |
| lt-radius-2xl | 14px | The largest curve in the app: the reader frame's top corners, and the selected tab's flare into the page. |
| lt-radius-pill | 999px | A fully rounded end, whatever the height. |
| lt-radius-full | 50% | A circle. |
| lt-radius-window | 20px | The Mac window's own corner, not a step on the scale above: macOS rounds a window far harder than Windows does, and this is macOS 27's figure. Windows keeps `lt-radius-lg`. |
| lt-radius-window-inner | 12px | The reading card's bottom corners inside that window, and again not a step on the scale: it is `lt-radius-window` less the 8px `reader-gutter` between the two, which is what strikes both arcs from one center so the band between them holds its width the whole way round. Move one of these two and move the other. |

## Document type

The reading view's own scale, and only its own — interface text does not use it. Every size derives from `type-base`, so a window that grows moves the whole document with it.

| Token | Value | What it is for |
| --- | --- | --- |
| type-base | `max(0.875rem, calc(1rem + (100vw - 1280px) / 140))` | The size everything else is a multiple of: 1rem at 1280px wide, growing with the window, never below 0.875rem. |
| type-measure-body | 75ch | How wide a line of body text is allowed to get before it stops being readable. |
| type-spacing | `calc(var(--type-base) * 1.5)` | The gap between blocks. |
| type-spacing-sm | `var(--type-base)` | The gap inside one — list rows, a caption under its figure. |
| type-body-size | `var(--type-base)` | Body text. |
| type-display-size | `calc(var(--type-base) * 3.2)` | A document's opening `h1`, which is set larger than the `h1`s below it. |
| type-h1-size | `calc(var(--type-base) * 2.2)` | Every later `h1`. |
| type-h2-size | `calc(var(--type-base) * 2)` | `h2`. |
| type-h3-size | `calc(var(--type-base) * 1.8)` | `h3`. |
| type-h4-size | `calc(var(--type-base) * 1.6)` | `h4`. |
| type-h5-size | `calc(var(--type-base) * 1.4)` | `h5`. |
| type-h6-size | `calc(var(--type-base) * 1.2)` | `h6`. |
| type-caption-size | `calc(var(--type-base) * 0.8125)` | A figure caption, a footnote, a table's small print. |
| type-display-line | 1.2 | The opening title's line height: tight, because it is the largest text on the page. |
| type-h1-line | 1.25 | `h1`. |
| type-h2-line | 1.25 | `h2`. |
| type-h3-line | 1.25 | `h3`. |
| type-h4-line | 1.25 | `h4`. |
| type-body-line | 1.6 | Body text, loose enough to read a paragraph down. |
| type-caption-line | 1.6 | Captions. |
| type-display-weight | 900 | The opening title. |
| type-h1-weight | 850 | `h1`. The scale steps down 50 a level, so depth reads as weight and not only as size. |
| type-h2-weight | 800 | `h2`. |
| type-h3-weight | 750 | `h3`. |
| type-h4-weight | 700 | `h4`. |
| type-h5-weight | 650 | `h5`. |
| type-h6-weight | 600 | `h6`. |

## Interface text

The chrome's own sizes, in pixels because chrome does not scale with a document. A document's text uses the type scale above.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-text-9 | 9px | The smallest label in the app. |
| lt-text-10 | 10px | A badge, a count. |
| lt-text-10-5 | 10.5px | A tight label beside a control. |
| lt-text-11 | 11px | Secondary chrome text. |
| lt-text-11-5 | 11.5px | Between the two, where 11 crowds and 12 wraps. |
| lt-text-12 | 12px | The chrome's body size, and the most-used one. |
| lt-text-12-5 | 12.5px | A half-step up for a row that has to read first. |
| lt-text-13 | 13px | A menu row, a tab's label. |
| lt-text-13-5 | 13.5px | The theme card's name — a half-step kept as drawn, because nudging it to 13 or 14 changes every card's height. |
| lt-text-14 | 14px | A heading inside the chrome. |
| lt-text-15 | 15px | A sheet's title. |
| lt-text-16 | 16px | The start screen's welcome prose — read like a page, so it sits above the chrome scale; kept as drawn rather than nudged to 15. |
| lt-text-18 | 18px | The largest chrome text there is. |

## Interface weight

| Token | Value | What it is for |
| --- | --- | --- |
| lt-weight-400 | 400 | Normal. |
| lt-weight-500 | 500 | A shade heavier, where 600 would shout. |
| lt-weight-600 | 600 | The chrome's emphasis: a label, an active tab. |
| lt-weight-700 | 700 | A heading. |
| lt-weight-800 | 800 | The heaviest the interface goes. |

## Stroke

Named `stroke` and not `border`, because `lt-border` is a color.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-stroke-1 | 1px | Every hairline in the app. |
| lt-stroke-1-5 | 1.5px | A hairline that has to read over a busy surface. |
| lt-stroke-2 | 2px | A focus ring, a selected edge. |
| lt-stroke-3 | 3px | A quote bar, a strong marker. |
| lt-stroke-4 | 4px | The heaviest edge, on an alert. |
| lt-stroke-6 | 6px | The alert callout's left bar, its whole signal. |

## Line height

Interface line heights. A document's come from the type scale above.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-leading-1 | 1 | An icon or glyph that must not add leading. |
| lt-leading-1-04 | 1.04 | The start screen's headline, set solid — the largest text in the app; kept as drawn, because the nearest step opens the brand lockup. |
| lt-leading-1-2 | 1.2 | A tight two-line label, and every chrome control that used to rest on `normal`. |
| lt-leading-1-25 | 1.25 | The start screen's subtitle — kept as drawn, between the label step and the menu row. |
| lt-leading-1-3 | 1.3 | A menu row. |
| lt-leading-1-35 | 1.35 | A wrapped row in the library pane. |
| lt-leading-1-4 | 1.4 | Chrome text that runs to a second line. |
| lt-leading-1-45 | 1.45 | A paragraph inside a sheet. |
| lt-leading-1-5 | 1.5 | Loose chrome prose. |
| lt-leading-1-55 | 1.55 | An alert's body. |
| lt-leading-1-6 | 1.6 | The start screen's prose, the loosest in the interface — a document's own body leading. |

## Letter spacing

| Token | Value | What it is for |
| --- | --- | --- |
| lt-tracking-020 | 0.02em | A hair of air in a small label. |
| lt-tracking-040 | 0.04em | A wider small-caps label. |
| lt-tracking-060 | 0.06em | An all-caps heading. |
| lt-tracking-120 | 0.12em | The widest tracking in the app. |
| lt-tracking-tight-005 | -0.005em | Pulled in slightly, for text set large. |
| lt-tracking-tight-01 | -0.01em | Pulled in further, for the largest chrome text. |

## Opacity

`0` and `1` stay literal: fully hidden and fully shown are not design decisions.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-opacity-35 | 0.35 | Barely there — a disabled glyph. |
| lt-opacity-38 | 0.38 | A faint overlay. |
| lt-opacity-40 | 0.4 | A dimmed control. |
| lt-opacity-45 | 0.45 | A resting hint. |
| lt-opacity-46 | 0.46 | A hairline overlay that has to stay under the text. |
| lt-opacity-50 | 0.5 | Half. |
| lt-opacity-55 | 0.55 | A quiet secondary mark. |
| lt-opacity-60 | 0.6 | Readable but plainly secondary. |
| lt-opacity-75 | 0.75 | Nearly solid. |
| lt-opacity-78 | 0.78 | A surface showing a little of what is behind it. |
| lt-opacity-85 | 0.85 | A touch off solid. |
| lt-opacity-92 | 0.92 | All but solid, so the rail reads as glass. |

## Spacing

Padding, margins and gaps, in pixels. `0` stays `0`, and a negative pull-back is the same token flipped: `calc(var(--lt-space-8) * -1)`. Spacing *inside* a document stays in `em`, because it has to follow the text size.

**Thirteen steps, and every one even bar the hairline** — 2px apart to 16, 4px apart to 24, then 32 and 48. There were 23, every whole pixel from 1 to 14 and then a scatter, and a scale with a step for every pixel cannot be picked from: a value gets chosen by eye and frozen as a token, which is how one control's edge came to be 7px and one gap on the home screen 54px. A pull-back that is half of a box is not spacing at all — it belongs to the box, as `--lt-spinner-size` in `src/assets/reading/buttons.css`.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-space-1 | 1px | A hairline nudge, against a border or a focus ring. |
| lt-space-2 | 2px | The tightest gap between two things. |
| lt-space-4 | 4px | Inside a control, and where two controls' paddings meet in one shape. |
| lt-space-6 | 6px | Between an icon and its label, everywhere in the app. |
| lt-space-8 | 8px | The workhorse: a control's own edge, between rows, around a panel. |
| lt-space-10 | 10px | A comfortable inset. |
| lt-space-12 | 12px | Between groups. |
| lt-space-14 | 14px | A panel's inset. |
| lt-space-16 | 16px | Between sections. |
| lt-space-20 | 20px | A wide inset, and a sheet's own. |
| lt-space-24 | 24px | Between the big blocks of a view. |
| lt-space-32 | 32px | The page's own margin. |
| lt-space-48 | 48px | The widest gap in the app, holding a header off its content. |

## Duration

Every transition and animation length, in milliseconds. `0.12s` and `120ms` were the same duration written two ways; both are `lt-duration-120` now.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-duration-0 | 0ms | Motion off — how long anything lasts once Reduce Motion is on. The one row that is not a length. |
| lt-duration-100 | 100ms | A hover that must feel instant. |
| lt-duration-120 | 120ms | The default: hover, fade, color change. |
| lt-duration-140 | 140ms | A small move. |
| lt-duration-150 | 150ms | A transform. |
| lt-duration-160 | 160ms | A fade paired with a move. |
| lt-duration-200 | 200ms | A panel appearing. |
| lt-duration-220 | 220ms | A sheet sliding. |
| lt-duration-260 | 260ms | The slowest single move that answers a click. A whole gesture drawn as one animation runs longer and takes a row of its own. |
| lt-duration-280 | 280ms | A bottom sheet's whole dismissal: the pull-up and the departure, one animation. |
| lt-duration-300 | 300ms | A deliberate reveal. |
| lt-duration-400 | 400ms | A bottom sheet's whole landing: the rise past its seat and the settle onto it, one animation. |
| lt-duration-700 | 700ms | One turn of a slow spinner. |
| lt-duration-800 | 800ms | One turn of the reader's spinner. |
| lt-duration-1100 | 1100ms | A long pulse. |
| lt-duration-1250 | 1250ms | A slower pulse. |
| lt-duration-1600 | 1600ms | A two-part loading cycle. |
| lt-duration-2400 | 2400ms | The longest loop, for something that waits on the network. |

## Easing

**A curve says which way a move is going.** Something arriving decelerates, something leaving accelerates, and something staying put while it changes shape or place takes emphasized. An exit is also shorter than the enter that matched it — you have already stopped caring about it. The three shapes are Material Design 3's, at its values.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-ease | ease | A hover, a color change — anything with no direction to say. |
| lt-ease-linear | linear | A spinner or a progress bar, where any curve reads as a stutter. |
| lt-ease-in-out | ease-in-out | A loop that has to come back the way it went, so it never reads as a jerk. |
| lt-ease-emphasized | `cubic-bezier(0.2, 0, 0, 1)` | Something already on screen, changing shape or place. Starts and ends at rest. |
| lt-ease-decelerate | `cubic-bezier(0.05, 0.7, 0.1, 1)` | Something arriving. Fast in, settling hard. |
| lt-ease-accelerate | `cubic-bezier(0.3, 0, 0.8, 0.15)` | Something leaving. Slow off the mark, then gone. |
| lt-ease-sheet | `cubic-bezier(0.32, 0.72, 0, 1)` | A sheet rising: fast off the mark, settling slowly. Emphasized-decelerate drawn by hand against a real drag, and kept because that is what it was tuned on. |
| lt-ease-overshoot | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Something arriving with spring in it: runs about a tenth past its mark and settles back. The library pane's open. |

## Hover reveal

**A control drawn at nothing and shown under the pointer leaves one way.** Every one of them waits a beat before it starts to go, so a hand crossing a row of them does not strobe a mark on and off at each one it passes, and it leaves faster than it arrived because you have already stopped caring about it. Two recipes rather than a duration and a curve at each site: nine of these were written four different ways before this. Other legs — a fill, a border, a color — sit beside the recipe in the same shorthand.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-transition-hover-reveal-arrive | `opacity var(--lt-duration-120) var(--lt-ease-decelerate)` | The opacity leg on the rule that shows it. |
| lt-transition-hover-reveal-leave | `opacity var(--lt-duration-100) var(--lt-ease-accelerate) var(--lt-duration-300)` | The opacity leg on the rule that holds it at nothing: held for 300ms, then gone over 100ms. |

## Inactive window

**One amount the whole window steps back by while another app holds it.** Every visible part of the app sits inside one element, so the state is a single `filter` on that element rather than a list of re-pointed colors — which is what makes the leaf, the document, a picture inside the page and the minimap move by the same amount on the same beat. It is also the only form that can fade at all: a custom property is not an animatable type and was watched jumping straight to its new value, where the filter was watched interpolating frame by frame over the same window. The floor for this one state is 3:1 rather than the 4.5:1 everything else is held to, because the palette's tightest legible pair is already 4.515:1 and any visible softening drops under that — a window another app is holding is one the reader has stepped away from and is one click from restoring. At the two amounts below the tightest pair the tree declares, across all 22 theme sources and with the filter applied to both halves of it, is 3.42 and nothing reads under 3 — both amounts were chosen from that table rather than by eye.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-inactive-saturation | 0.5 | How much color the window keeps while another app has it. Half: enough that a red is still plainly red, little enough that the whole frame reads as stepped back. |
| lt-inactive-contrast | 0.9 | How far that window's blacks and whites come toward each other, so black text goes less dark and the paper comes down to meet it. |

## Layers

Every `z-index` of 20 or more is a page layer and takes a token. Values of 11 or less order siblings inside one component and stay literal — they mean nothing outside it.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-z-below | -1 | Behind its own parent: a backdrop drawn by a pseudo-element. |
| lt-z-20 | 20 | A sticky header inside a scrolling pane. |
| lt-z-30 | 30 | The app bar and the library rail. |
| lt-z-40 | 40 | A sheet's backdrop. |
| lt-z-41 | 41 | The sheet on it. |
| lt-z-42 | 42 | A second backdrop, over the first sheet. |
| lt-z-43 | 43 | The sheet on that. |
| lt-z-44 | 44 | A card or bubble a rest raises: over every sheet, under every menu. |
| lt-z-45 | 45 | A message: over every card, under every menu. |
| lt-z-50 | 50 | A floating menu. |
| lt-z-51 | 51 | A submenu or tooltip over it. |

## Shadow spread

How far the one cast shadow reaches past the surface throwing it, and the only length its recipe spends. One value for every floating surface and for the window's own band, so the app has one shadow size rather than a size per box: the ring is four edge ramps intersected over this distance, and the band's outside corner is the surface's own corner plus it, which strikes both arcs from one center.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-shadow-spread | 12px | How far a cast shadow reaches past the surface throwing it, and how much its outer corner is rounded beyond that surface's own. It is what the halftone below has to narrow across: at the display this app is usually read on a CSS pixel is one and a half device pixels, so eight of them left the band twelve pixels deep, its lattice three pixels to a tile, and every dot in it the one pixel a three-pixel tile can hold — four rows that could not differ however the curve was written. Twelve gives four rows of a coarser tile and the dot four widths to move through. |

## Strokes, rings and one recess

Everything the app puts in a `box-shadow`. None of them is a cast shadow, and none may be: the app has one light, hung overhead and centered, and a `box-shadow` with a vertical offset is a second one pointing somewhere else. A floating surface throws the dot halftone the stylesheet draws instead. Each takes a color from the contract or mixes one, so it still belongs to its theme.

**The halftone shadow** is the one cast shadow, and it is not a token because only its ink is a value — the geometry is one shared rule in `src/assets/reading/panels.css`, spending the one spread above. Every floating surface — menu, toast, dialog, sheet, find bar, rename box, drag ghost, link card, filter menu, first-run bubble, both toolbars and the tool tray — and the Previous / Next card at the foot of a page joins that rule's selector list rather than writing a shadow of its own: the strong grain ink on a band one spread wide around the surface, drawn by four edge ramps intersected so the ring weighs the same on every side and at every corner whatever the surface's size or shape. The layer takes the spread as padding, which makes its content box the surface's own, so the browser derives the ring's inner curve from its outer one; the outer corner is the surface's own corner plus the spread, read from the `--lt-shadow-host-radius` each host declares beside its own border. The window's band is the same recipe over the same distance, drawn as a sibling of the app surface rather than a child, so it needs no punch. The pager card is the one host sitting inside the document rather than over it, so it is the one that overrides the layer: the shared negative depth falls behind the opaque reading shell and never draws.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-shadow-inset | `inset 0 1px 2px rgba(0, 0, 0, 0.35)` | A field that reads as pressed into the surface. |
| lt-shadow-hairline | `inset 0 0 0 1px color-mix(in srgb, var(--lt-foreground) 12%, transparent)` | An edge drawn inside the box, so it costs no layout. |
| lt-shadow-hairline-strong | `inset 0 0 0 1px color-mix(in srgb, var(--lt-foreground) 26%, transparent)` | The same edge, for a hovered or selected box. |
| lt-shadow-focus | `0 0 0 2px color-mix(in srgb, var(--lt-link) 30%, transparent)` | The soft ring around a focused link or field. |
| lt-shadow-ring | `0 0 0 2px var(--lt-surface)` | A halo in the chrome's own color, to punch a mark out of what it overlaps. |

## Grain

The dot lattice's ink. Only the ink is a token: each rule writes the circles into its own `background-image`, because a custom property holding the whole gradient is substituted where it is declared and would paint every surface below it in one ink. The lattice's four lengths — how far the dot is solid, where its ramp ends, how far the shadow's soft blob reaches, and the tile they all repeat in — are not tokens either, but they are said once: `--lt-grain-radius`, `--lt-grain-edge`, `--lt-grain-blob` and `--lt-grain-tile` sit in the metrics block in `src/assets/reading/base.css`, where a length carries no ink and so is safe to hoist, and a display at 100% takes bigger ones from the resolution branch at the foot of that file. The shadow band's own tokens below are a halftone rather than a fade: the ramps lift coverage off a soft blob before one alpha curve cuts it, so the dot narrows toward the rim and its ink never moves.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-grain-light | `rgba(0, 0, 0, 0.1)` | A light theme's speckle on chrome. |
| lt-grain-heavy | `rgba(0, 0, 0, 0.3)` | Heavier, so an inactive tab reads as a darker cell without an outline. |
| lt-grain-dark | `rgba(0, 0, 0, 0.35)` | A dark theme's chrome: it needs more alpha to show against an already-dark surface. |
| lt-grain-dark-heavy | `rgba(0, 0, 0, 0.72)` | A dark theme's inactive tab. |
| lt-grain-lift | `rgba(255, 255, 255, 0.07)` | The one grain that goes the other way: the darkest table row, where black has nowhere left to go. |
| lt-grain-hover | `rgba(0, 0, 0, 0.55)` | The gap a dragged row on the home screen will land in. Black like the rest, so the box sinks on a light family and a dark one alike; heavier than the chrome's because dots cover about a quarter of what they fill, which lands the filled box about as far off its surface as [the wash](#the-hover-wash) moves a row. |
| lt-grain-shadow-base | `#ffffff` | The opaque ground the shadow's coverage field is built on. White is the identity for both blends over it, so a pixel no layer touches carries no coverage and the curve below cuts it away. |
| lt-grain-shadow-blob | `#000000` | The core of the shadow's soft per-tile blob, which falls away to nothing by `--lt-grain-blob` and is multiplied into the ground. How much of it survives the curve is what makes one dot wider than another. |
| lt-grain-shadow-rim | `rgba(255, 255, 255, 0.6)` | How much coverage the four edge ramps lift back off the blob at the band's outer rim, screened over it. The more they lift, the less of the blob clears the curve, so the outermost dot is a speck. |
| lt-grain-shadow-mid | `rgba(255, 255, 255, 0.365)` | The same lift at half the spread. The pair bends the ramp, because a straight one bunches the three inner dot rows at nearly one width and only the outermost row reads as smaller. |
| lt-grain-shadow-curve | `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='halftone' color-interpolation-filters='sRGB'%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1 0 0 0 1' result='coverage'/%3E%3CfeComponentTransfer in='coverage' result='cut'%3E%3CfeFuncA type='linear' slope='4.5' intercept='-0.949'/%3E%3C/feComponentTransfer%3E%3CfeComposite in='cut' in2='SourceGraphic' operator='in'/%3E%3C/filter%3E%3C/svg%3E#halftone")` | The one alpha curve, carried as a data URI so a published page gets it without any markup of the app's. It reads the coverage field's darkness as alpha, keeps what clears 0.32 and fades away over the fifth of coverage below that, and clips itself back to the band — so every dot is painted at one ink and only its width changes. A `contrast()`/`brightness()` pair cannot do this: neither touches alpha, so the band comes out a solid slab. The slope is what makes a dot a circle rather than a block: a curve steep enough to be a hard threshold decides each device pixel in or out with nothing in between, and a dot four pixels across then rasterizes square. This one saturates over about one and a half device pixels, which is the soft rim a circle needs at the size the band draws one. |
| lt-grain-shadow-opacity | `1` | The shadow band's ink where it meets the surface throwing it. It is full because the band's own mask takes it from there to nothing at the rim, so the strength is a starting point rather than a level held across the whole band — which is what leaves two crossing bands weakest exactly where they overlap most, at their rims. |

## Fixed colors

Five values that are not the theme's to choose. A color in [colors.md](colors.md) changes with the family; these do not, and each says why.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-mask-opaque | #000 | The opaque stop in a `mask-image`. A mask reads only alpha, so this is not a color at all — the theme must never reach it, or a fade stops fading. |
| lt-white | #ffffff | Plain white, where white is the point: the dark-theme search field's focus border, which keys off the ink instead on a light theme. |
| lt-window-close | #e81123 | The Windows close button's red. A platform convention, the same in every theme. |
| lt-window-close-foreground | #ffffff | The cross on it. |
| lt-checkbox-accent | #6e7681 | The `accent-color` a task-list checkbox is drawn with. The browser paints this one, not us. |

## Fixed tints

Black or gray at an alpha, where a mix toward a theme color would go the wrong way on one appearance. Each has its reason in the rule it serves.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-tint-recess | `rgba(0, 0, 0, 0.16)` | A recess pressed into the chrome. Black at an alpha, never a mix toward the foreground — that lightens on a dark theme, which reads as lit from inside. |
| lt-tint-backdrop | `rgba(0, 0, 0, 0.45)` | The scrim behind a sheet, so the page under it reads as dimmed rather than tinted. |
| lt-grain-dot-strong | `rgba(0, 0, 0, 0.55)` | The grain under the tab strip's fade, which has to show through a mask. |

## The hover wash

One fill for everything under the pointer — a menu row, a toolbar button, a file in the pane. It is transparent and mixed from a color the family owns, so it lightens a dark theme and darkens a light one whatever it sits over and can never come out the same tone as the panel behind it. A hover that names a surface color instead can, and did: a right-click menu in one family drew its panel and its hovered row at the same value.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-wash-hover | `color-mix(in srgb, var(--lt-hover-tint) 16%, transparent)` | Every hover and expanded-state fill in the app. The ink is [`hover-tint`](colors.md), which a family may set and otherwise copies its quiet-text color. |
| lt-hover-lift | 1.08 | The one hover that lifts its own fill instead of washing over it: the Save button, which is already drawn in the accent, so a wash over it would only mud the color it is there to carry. |

## Inset edges

An edge drawn inside the box as a shadow, so it costs no layout and never shifts what is around it. The geometry is the token; the color it is drawn in comes with it.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-shadow-edge-strong | `inset 0 0 0 1px var(--lt-border-strong)` | A field that has to read as bounded without a border box. |
| lt-shadow-edge-accent | `inset 0 0 0 2px var(--lt-accent)` | A selected card. |
| lt-shadow-edge-link | `inset 0 0 0 1px var(--lt-link)` | A hovered link preview. |
