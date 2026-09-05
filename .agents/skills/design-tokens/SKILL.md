---
name: design-tokens
description: Change how the app looks without writing a value by hand. A color goes in design/colors.md, any other value in design/tokens.md, an icon in design/icons.md, a component in design/components.md — then `just bundle-tokens`, `bundle-icons`, `bundle-gallery`. Never edit a generated file; `just check-literals` fails on a hand-written value and names the line. Use when the user wants to change a color, spacing, size, shadow, icon or component, add a token, or asks where a value lives.
argument-hint: "[what to change]"
user-invocable: true
---

# Design tokens

Every value in the interface comes from a token, and the tokens live in four Markdown files under `design/`. Nothing in the stylesheet is typed by hand — a check fails the build on one and names the line.

**Never edit a generated file.** `src/assets/tokens.css`, `icons.css`, `gallery.html`, the token list in `src/theme.rs`, `src/assets/themes.md`, `themes/README.md` and `docs/02-development/05-design-system.md` are all written by a bundler. An edit there is lost on the next run, and `just verify` fails first.

## Process

### 1. Put the value in its source table

Choose colors, tokens, icons or components from the table below and edit only that source.

### 2. Add the component contract when needed

Give new interface its markup and states in `design/components.md` before styling it.

### 3. Bundle every generated consumer

Run the bundlers named by the source table rather than editing their output.

### 4. Apply the generated name

Use the token, icon or component name in the interface without writing a literal value.

### 5. Look at the result

Open the gallery or the app surface that changed and compare the actual state requested.

### 6. Check the design system

Run the design checks alone — `just check-tokens check-icons check-gallery check-design-docs check-classes check-literals` — and fix the source table and rebundle if any of them disagrees. Never the complete suite: the build that called this pays for that once, at its end.

## Where a thing lives

| What | File | Then run |
| --- | --- | --- |
| a color | `design/colors.md` — the name and what it is for, no value | `just bundle-tokens`, then a value in all 11 files under `themes/`, then `just bundle-themes` |
| a color's value | the family's file under `themes/` | `just bundle-themes` |
| anything else with a value — spacing, text size, weight, stroke, line height, letter spacing, opacity, duration, easing, shadow, layer, a fixed color | `design/tokens.md` | `just bundle-tokens` |
| an icon | `design/icons.md`, plus the `.svg` in `src/assets/` | `just bundle-icons` |
| a component | `design/components.md` — its class family, what builds it, and the markup the gallery draws it with | `just bundle-gallery` |
| a class that is not a component — something the renderer writes into a document, or a state flag | the second or third table in `design/components.md` | nothing to generate; `just check-classes` stops failing |

A color is **themed**: 11 families, light and dark, so `colors.md` holds names only. Everything else is one value for the whole app, so `tokens.md` holds the value.

## A new part of the interface

**Styling a new thing is not finished until it is listed.** `just check-classes` reads every class in `src/assets/reading/` and fails on one that `design/components.md` does not account for, naming the line. There are three honest answers:

1. **It is a component.** A row in the first table: the class family, what builds it, and a snippet of its real markup. That snippet is what the gallery draws it with, so the component appears at leaftext.com/gallery.html by existing — nobody has to remember to add it. If the component owns other prefixes (`app-bar` also owns `app-trailing`), list them in **Also owns**.
2. **The renderer writes it into a document** — a footnote, an alert, a syntax color. A prefix in the second table. Those have no state to show and nothing to draw.
3. **It is a state**, like `is-selected` or `open`. Anything starting `is-`, `has-` or `no-` needs no row at all; anything else spelled differently goes in the third table.

Renaming or deleting a class works the same way round: the check fails on a row whose family nothing styles any more, so the list cannot keep a component the app lost.

## Adding a token

1. A row in the right file. The name says the value —`lt-space-8` is 8px, `lt-duration-120` is 120ms — so a reader never has to look it up. The "what it is for" column earns its place: say where it is used, not what it is.
2. `just bundle-tokens` (or `bundle-icons`).
3. Use it: `var(--lt-space-8)`.
4. `just check-tokens check-icons check-literals` — the checks about the thing you changed, never the complete suite.

**Reuse before adding.** 162 values exist. A new one that is 1px from an old one is two names for one idea, and the gallery will show them side by side looking identical.

## Changing a value

Edit the row, run the bundler, run the design checks. That is all — nothing else holds a copy.

**A value change moves the interface**, so the ticket says what looks different and where.

## What is not a token

- **Widths, heights, positional offsets.** One component's geometry, used once. 56 of them exist and a name for each would buy nothing.
- **A document's `em` sizing.** It follows the text on purpose.
- **`0` and `1`.** Fully hidden and fully shown are not design decisions.
- **A `z-index` of 11 or less.** Those order siblings inside one component and mean nothing outside it. 20 and up is a page layer and takes a token.

`just check-literals` knows this list. If it flags something you believe belongs in one of these, the check is what to change — with the reason in its comment.

## Looking at it

`gallery.html` — the page at **leaftext.com/gallery.html** — draws every theme, color, value, icon and component on one page, in the app's own stylesheet, with a switcher for the family and for light or dark. A component that loses its styling shows up there before anyone reports it.

`just bundle-gallery` builds it, and it needs a compile: the stylesheet comes out of the binary (`--dump-css`), because the theme compiler is Rust. It is a page in the repo, not a feature in the app — nothing about it ships to a reader.

**Anything this pass finds that it is not here to do is a ticket, written before the hand-back** — [`/ticket`](../ticket/SKILL.md), its row in the live index `../docs/README.md`, [`/pm`](../pm/SKILL.md).

## Reference

- `design/colors.md`, `design/tokens.md`, `design/icons.md`, `design/components.md` — the four sources. Plain Markdown, so Leaftext opens them.
- `docs/02-development/04-theming.md` — how a theme is written and checked.
- `docs/02-development/05-design-system.md` — the published page, generated from the same four files.
