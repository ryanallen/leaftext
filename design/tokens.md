# Tokens

> Every value in the interface that is not a color. One value each, whatever theme is on.

A color is themed and lives in [colors.md](colors.md); these do not change with the theme, so this file holds the value itself.

`just bundle-tokens` compiles the tables below into `src/assets/tokens.css`, which is served ahead of `reading.css` so every `var()` in the stylesheet resolves. `just check-tokens` fails when the two drift. **Never edit `src/assets/tokens.css`** — it is generated, the same way `src/assets/themes.md` is.

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

**Thirteen steps, and every one even bar the hairline** — 2px apart to 16, 4px apart to 24, then 32 and 48. There were 23, every whole pixel from 1 to 14 and then a scatter, and a scale with a step for every pixel cannot be picked from: a value gets chosen by eye and frozen as a token, which is how one control's edge came to be 7px and one gap on the home screen 54px. A pull-back that is half of a box is not spacing at all — it belongs to the box, as `--lt-spinner-size` in `reading.css`.

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
| lt-z-50 | 50 | A floating menu. |
| lt-z-51 | 51 | A submenu or tooltip over it. |
| lt-z-60 | 60 | A toast — the top of the app, always. |

## Strokes, rings and one recess

Everything the app puts in a `box-shadow`. None of them is a cast shadow: a floating surface throws the dot halftone `reading.css` draws instead. Each takes a color from the contract or mixes one, so it still belongs to its theme.

**The halftone shadow** is the one cast shadow, and it is not a token because only its ink is a value — the geometry is one shared rule in `reading.css`. Every floating surface — menu, toast, dialog, sheet, find bar, rename box, drag ghost, link card — joins that rule's selector list rather than writing a shadow of its own: the strong grain ink on a thin band around the surface, thinning out under an ellipse, with the surface's own box punched back out so no dot lands on its face. The ellipse fades across a fraction of the box, so a surface as small as the link card lands its whole visible band in the nearly transparent tail and shows nothing; a surface that small keeps the shared rule and overrides only the fade stops, moving the fade into the band itself.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-shadow-raised | `0 1px 3px rgba(0, 0, 0, 0.18)` | A row or chip lifted a hair off its surface. |
| lt-shadow-inset | `inset 0 1px 2px rgba(0, 0, 0, 0.35)` | A field that reads as pressed into the surface. |
| lt-shadow-hairline | `inset 0 0 0 1px color-mix(in srgb, var(--lt-foreground) 12%, transparent)` | An edge drawn inside the box, so it costs no layout. |
| lt-shadow-hairline-strong | `inset 0 0 0 1px color-mix(in srgb, var(--lt-foreground) 26%, transparent)` | The same edge, for a hovered or selected box. |
| lt-shadow-focus | `0 0 0 2px color-mix(in srgb, var(--lt-link) 30%, transparent)` | The soft ring around a focused link or field. |
| lt-shadow-ring | `0 0 0 2px var(--lt-surface)` | A halo in the chrome's own color, to punch a mark out of what it overlaps. |

## Grain

The dot lattice's ink. Only the ink is a token: each rule writes the circles into its own `background-image`, because a custom property holding the whole gradient is substituted where it is declared and would paint every surface below it in one ink.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-grain-light | `rgba(0, 0, 0, 0.1)` | A light theme's speckle on chrome. |
| lt-grain-heavy | `rgba(0, 0, 0, 0.3)` | Heavier, so an inactive tab reads as a darker cell without an outline. |
| lt-grain-dark | `rgba(0, 0, 0, 0.35)` | A dark theme's chrome: it needs more alpha to show against an already-dark surface. |
| lt-grain-dark-heavy | `rgba(0, 0, 0, 0.72)` | A dark theme's inactive tab. |
| lt-grain-lift | `rgba(255, 255, 255, 0.07)` | The one grain that goes the other way: the darkest table row, where black has nowhere left to go. |
| lt-grain-hover | `rgba(0, 0, 0, 0.55)` | The pager button under the pointer. Black like the rest, so the box sinks on a light family and a dark one alike; heavier than the chrome's because dots cover about a quarter of what they fill, which lands the filled box about as far off its surface as [the wash](#the-hover-wash) moves a row. |

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
| lt-tint-row | `rgba(110, 118, 129, 0.08)` | A table's alternating row: a neutral gray so the stripe never picks up a theme's hue. |
| lt-grain-dot-strong | `rgba(0, 0, 0, 0.55)` | The grain under the tab strip's fade, which has to show through a mask. |

## The hover wash

One fill for everything under the pointer — a menu row, a toolbar button, a file in the pane. It is transparent and mixed from a color the family owns, so it lightens a dark theme and darkens a light one whatever it sits over and can never come out the same tone as the panel behind it. A hover that names a surface color instead can, and did: a right-click menu in one family drew its panel and its hovered row at the same value.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-wash-hover | `color-mix(in srgb, var(--lt-hover-tint) 16%, transparent)` | Every hover and expanded-state fill in the app. The ink is [`hover-tint`](colors.md), which a family may set and otherwise copies its quiet-text color. |

## Inset edges

An edge drawn inside the box as a shadow, so it costs no layout and never shifts what is around it. The geometry is the token; the color it is drawn in comes with it.

| Token | Value | What it is for |
| --- | --- | --- |
| lt-shadow-edge-strong | `inset 0 0 0 1px var(--lt-border-strong)` | A field that has to read as bounded without a border box. |
| lt-shadow-edge-accent | `inset 0 0 0 2px var(--lt-accent)` | A selected card. |
| lt-shadow-edge-link | `inset 0 0 0 1px var(--lt-link)` | A hovered link preview. |
