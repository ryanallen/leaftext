---
name: shell-fragment
description: Add, split or reorder a file in src/assets/shell/ — the front-end, written as ordered fragments sharing one scope. Where it goes in the list is load-bearing, state.js holds only what more than one fragment touches, no fragment may carry a placeholder, and `just check-shell` boots them in order so a fragment that throws fails the build instead of opening a blank window. Use when the user wants front-end code added or a fragment moved or split.
argument-hint: "[fragment]"
user-invocable: true
---

# Shell fragments

The front-end is 28 files under `src/assets/shell/`, joined in `APP_SHELL_SCRIPT_PARTS` order and served as one file. **They are one scope, not modules** — the page has no module loader — so a fragment alone is not a valid program, and where it sits in the list decides what it can see.

## Process

### 1. Read the fragment order and shared scope

Open the ordered asset list, the neighboring fragments and `state.js` before placing anything.

### 2. Put each value in its owner

Keep one-fragment state local and move only values multiple fragments touch into `state.js`.

### 3. Add or split the fragment in load order

Declare every load-time dependency earlier, keep bootstrap last and leave no placeholder.

### 4. Add the interface contract

Record every new class and component in the design system in the same edit.

### 5. Add the front-end check

Boot the changed behavior through its subject file in `scripts/check-shell/`.

### 6. Check the joined program

Run `/check` against the fragments in their real order.

## The rules the list carries

1. **The flowchart pair leads.** `flow-model.js` then `flow-canvas.js`: everything else calls into them.
2. **`state.js` comes next**, and holds **only what more than one fragment touches.** State one fragment reads belongs in that fragment. This is the rule that rots fastest: it is always easier to put a variable in `state.js` than to decide where it lives.
3. **The last fragment ends with the bootstrap call** that must run after everything else is defined.
4. **A fragment declares before it is used, in file order.** A function called while another fragment is *loading* has to be defined in an earlier file — `renderLibrary` runs as `library-search.js` loads and calls `escapeAttr`, which is in `minimap.js`, and that only works because of where the two sit.

## Adding one

1. Write it. One subject per file, named after the subject.
2. Add `include_str!` to `APP_SHELL_SCRIPT_PARTS` in `lib.rs`, **in the position its dependencies demand** — after anything it calls at load time, before anything that calls it at load time.
3. `just check-shell`. It boots them joined, in order, against a stand-in page, so a fragment that throws as it loads fails the build rather than opening a blank window on somebody's machine.
4. A test in the `scripts/check-shell/` file for whatever the fragment claims, or a new file there where the subject is new. `/sync-tests` names what is missing.

## New interface needs a row

A fragment that builds something new, with classes of its own, is not finished when it works. `just check-classes` fails on a class `design/components.md` does not account for. Add the row — the class family, this fragment as what builds it, and a snippet of its markup — and the thing appears in the gallery at leaftext.com/gallery.html without anyone remembering to put it there. See `/design-tokens`.

Same for the values it paints with: no color, size, spacing or duration typed into `src/assets/reading/`. `just check-literals` names the line.

## Never put a placeholder in a fragment

No `{{TOKEN}}`. The script is **served as a file**, so there is nothing to substitute into it — that is what lets the page be 4% of its size limit instead of 82%.

Something only the host knows reaches the fragments another way: the theme bootstrap publishes it on `window.__lt` before any of this runs. The vendored runtimes' URLs go that way, because the asset scheme differs by platform.

## Watch the size

The page is handed to the web view as one string with a ~2 MB ceiling; past it the app will not start. The script is out of that string now, so a fragment costs nothing there — but `app.js` is still one download and one parse before the first paint, so a fragment that only one view needs should load when that view opens, the way the graph and editor runtimes do.

## Splitting or reordering

- **Splitting** is free as long as the pieces keep their relative order.
- **Reordering** is not: run `just check-shell` and read what it says. A silent reorder that happens to work today is a blank window tomorrow.
- Two script tags would be two scopes. There is one, and the theme bootstrap's own, which runs first and shares nothing.

**Anything this pass finds that it is not here to do is a ticket, written before the hand-back** — [`/ticket`](../ticket/SKILL.md), its row in `../docs/README.md`, [`/pm`](../pm/SKILL.md).

## Reference

- `src/lib.rs` — `APP_SHELL_SCRIPT_PARTS`, the order.
- `scripts/check-shell/` — the checks, one file per subject; `scripts/check-shell.mjs` beside them runs them in order.
- `docs/02-development/01-architecture.md` — what each fragment is for.

<!-- keycode: LEAF-16D8 -->
