# Taking the settings menu apart

The gear in the app bar holds five unrelated things. Four of them belong
somewhere better and one of them is the updater, which is not a setting at all.
This is the plan to empty the menu and delete it.

Each phase stands on its own and ships on its own. Order matters only in that
phase 5 deletes what the first four have emptied.

## Checklist

- [ ] **Phase 1 — The updater gets its own bell.** A bell appears in the app bar
      only when there is an update; the spinner and the dot ride on it; clicking
      it opens the same panel with the same one button in it.
- [ ] **Phase 2 — Theme gets the app bar spot.** The palette icon stands where
      the gear stood and opens the theme sheet directly.
- [ ] **Phase 3 — Graph size moves into the graph view.** Four buttons in the
      reader toolbar's recess, shown only while the map is up.
- [ ] **Phase 4 — Minimap and next/previous stop being choices.** Both are always
      on; the toggles, the two commands and the two saved values go.
- [ ] **Phase 5 — Delete the menu.** Markup, styles, fragment, design rows,
      tests, docs page. The version number finds a new home first.

---

## What is there now

The menu is a `<details>` in the app bar's trailing group
(`src/assets/app-shell.html`, lines 34–82) holding, top to bottom: the update
button, the theme row, the graph-size select, the minimap checkbox, the
next/previous checkbox, and the version footer.

Every file that touches it:

| File | What it holds |
| --- | --- |
| `src/assets/app-shell.html` | the whole menu's markup |
| `src/assets/shell/dom.js` | `settingsMenu`, `minimapEnabledControl`, `graphScopeControl`, `pagerEnabledControl`, `themeSheetOpen`; and a drag-region exception for `.settings-menu` |
| `src/assets/shell/settings.js` | the minimap and pager toggles, and `window.leafMinimap` |
| `src/assets/shell/updater.js` | the whole updater, painting into the settings button and dot |
| `src/assets/shell/speed-reader.js` | the graph-size select's wiring (lines 214–223), oddly placed but there |
| `src/assets/shell/theme.js` | opens the sheet from the row, shuts the menu, mirrors the minimap checkbox |
| `src/assets/shell/navigation.js` | Escape and click-outside close the menu |
| `src/assets/shell/overflow.js` | folds the menu into the overflow panel when the bar runs out of room |
| `src/assets/reading.css` | `.settings-*` and `.setting-*` rules at 609–845 and 4387–4426 |
| `design/components.md` | the "Settings rows", "Theme setting row" and "Spinner" rows |
| `design/icons.md` | the `settings` and `theme` rows |
| `src/lib.rs` | `Settings` fields, including `minimap_enabled`, `pager_enabled`, `graph_scope` |
| `src/scripts.rs` | the `window.__leafSettings` payload |
| `src/app/events.rs`, `src/app/event_loop.rs` | `setMinimapEnabled`, `setPagerEnabled`, `setGraphScope`, and the four update commands |
| `src/tests/app_shell_chrome.rs` | asserts the menu's markup, its keyboard handling, and its CSS |
| `src/tests/app_shell_scripts.rs` | asserts the exact `__leafSettings` JSON |
| `src/tests/reading_css.rs`, `src/tests/minimap.rs`, `src/tests/updater.rs` | class and behavior assertions |
| `docs/01-features/05-settings.md` | the feature page |

Two things that look like they are in scope and are not:

- **The gear drawing stays.** `lt-icon-settings` is also worn by a vault row's own
  menu (`speed-reader.js`, `MENU_SETTINGS_SVG`). Only the app bar's use goes.
- **The settings *file* stays.** Theme, library width, graph size, code-view state
  and the updater's bookkeeping all still persist, and so does the toast that says
  the file could not be read.

---

## Phase 1 — The updater gets its own bell

**What it looks like.** Nothing in the bar until there is news. A bell appears
while an update is downloading, wearing the spinning ring; once the installer is
staged the ring becomes the dot. Clicking the bell drops the same panel down,
holding the same green "Restart to update" button and nothing else. When there is
no news the bell is not there at all.

**The drawing.** New file, `src/assets/bell.svg`, in the house style — no width or
height, `viewBox="0 0 24 24"`, stroke `currentColor`:

```svg
<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M10.268 21a2 2 0 0 0 3.464 0" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
  <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
</svg>
```

Steps:

1. Add `src/assets/bell.svg` and a row in `design/icons.md`: `| update |
   bell.svg | — | The update bell, shown in the app bar only when an update is
   downloading or waiting to install. |`. Run `just bundle-icons`. `just
   check-icons` fails on an SVG with no row, so the row is not optional.
2. In `app-shell.html`, add a second `<details class="update-menu"
   id="updateMenu" hidden>` in `#appActionsItems`, before the settings menu, with
   the bell, the alert dot, and a panel holding only the update button. The old
   update button markup moves across unchanged apart from its class names.
3. Rename in `reading.css`: `.settings-alert-dot` → `.update-alert-dot`,
   `.settings-update*` → `.update-button*`, and give `.update-menu` and
   `.update-panel` the box the settings panel had (including the `::before`
   caret at line 697). Copy the rules; do not re-derive the values — `just
   check-literals` will fail on a hand-written one.
4. In `updater.js`, point `renderUpdateButton` at the new ids and add one line:
   the whole `<details>` is hidden unless `downloading || staged`. Nothing else
   in that fragment changes — the state machine, the throttle and the GitHub
   call are all fine as they are.
5. `dom.js` gains the new ids; `navigation.js`'s Escape and click-outside
   handling covers both menus; `overflow.js` folds the bell like any other
   action.
6. `design/components.md`: split a new "Update bell" row out of "Settings rows",
   with the bell, the dot and the staged button as its sample. The gallery picks
   it up by existing — `just bundle-gallery`, then `just check-classes`.
7. Tests: `app_shell_chrome.rs` grows an assertion that the bell is hidden
   without news; the existing settings-update assertions move to the new names.

**Open point.** The bell is absent when there is nothing to say, so the version
number in the panel footer would be unreachable. Phase 5 gives it a new home; the
footer stays in the settings menu until then.

## Phase 2 — Theme gets the app bar spot

The palette already exists as `lt-icon-theme`. Replace the gear's
`<summary>` with a plain icon button in the same slot:

```html
<button type="button" id="themeSheetOpen" class="icon-button" aria-label="Themes" title="Themes" aria-haspopup="dialog">
  <span class="lt-icon lt-icon-theme"></span>
</button>
```

`theme.js` already listens on `themeSheetOpen`, so the click path is unchanged;
drop the two lines that shut the settings menu on open. The `.setting-theme-*`
rules (`reading.css` 4387–4426) and the "Theme setting row" row in
`design/components.md` go with the row. Update `design/icons.md`'s `theme` row —
it says the row in the settings menu, which will no longer be true.

## Phase 3 — Graph size moves into the graph view

The reader toolbar already has a recess for "what the view you are in can do"
(`#readerViewTools`), and it is empty on the map by design. Put the four sizes
there: `small` `medium` `large` `xl`, one `reader-subtool` each,
`aria-pressed` on the current one, shown only while `graphViewOpen`.

Move the wiring out of `speed-reader.js` (lines 214–223) and into `graph.js`,
where the rest of the graph lives — it reads `graphScope`, so it belongs there.
The `setGraphScope` command, the `GraphScope` enum and the saved value are
unchanged.

**This phase needs four drawings that do not exist.** Four dot-cluster icons,
growing — `graph-size-1` through `graph-size-4` — each with a row in
`design/icons.md`. If that is more drawing than it is worth, the cheaper shape is
two buttons stepping the scale up and down using the `zoom-in` / `zoom-out`
icons already in the app, with the current size in the tooltip. Four buttons say
more at a glance; two cost nothing to draw.

## Phase 4 — Minimap and next/previous stop being choices

Both features stay and are always on. What goes is the ability to turn them off:

- `settings.js` keeps `window.leafMinimap` (theme.js, minimap.js and render-state
  all subscribe to it) but loses the two control listeners; the pager's
  `data-pager-enabled` attribute is pinned to `true`, or the CSS that reads it is
  simplified away.
- `theme.js` line 233 stops mirroring a checkbox that is gone.
- Rust: drop `minimap_enabled` and `pager_enabled` from `Settings`, the two
  `IpcCommand` arms, the two `event_loop` arms, and the two keys in
  `scripts.rs`. `app_shell_scripts.rs` asserts the payload character for
  character, so its expected JSON changes with them.

**Worth saying out loud:** dropping the two fields means anyone who had turned
the minimap off gets it back on the next launch, with no way to turn it off
again. That is the point of the change, but it is a real thing that happens to
real installs. Leaving the fields in place, unread, would not help — the toggle
is what is going.

## Phase 5 — Delete the menu

Only once the four phases above have emptied it.

1. **The version number needs a home first.** The home screen is the honest one:
   a small `v0.1.x` under the recent-files list, in `render-document.js`'s empty
   state. It is the one screen that is always reachable and is already where the
   app introduces itself.
2. Delete the `<details class="settings-menu">` block from `app-shell.html`, the
   `settings.js` fragment if nothing is left in it (check `APP_SHELL_SCRIPT_PARTS`
   in `src/scripts.rs` and follow `/shell-fragment` — the order is load-bearing),
   the `.settings-*` and `.setting-*` rules from `reading.css`, and the ids from
   `dom.js`.
3. `navigation.js` loses the settings half of its Escape and click-outside
   handling; `dom.js` loses `.settings-menu` from the drag-region exception list.
4. `design/components.md`: delete the "Settings rows" row, and rewrite the
   "Spinner" row's sample, which draws itself inside a `.settings-footer`.
   `just bundle-gallery`, `just check-classes`.
5. Tests: `app_shell_chrome.rs` loses
   `app_shell_groups_settings_menu_with_accessible_descriptions` and
   `app_shell_keeps_settings_menu_keyboard_and_pointer_polish`, and gains their
   replacements for the bell and the palette. Keep
   `app_shell_reacts_to_minimap_and_theme_settings` — the host still injects
   settings, there is just no panel showing them.
6. Docs: `docs/01-features/05-settings.md` becomes the update page, or goes and
   its content is spread across the theme, minimap and graph pages. Run
   `/sync-docs` — it handles the nav in `docs/docs.js` and regenerates the
   sitemap and `llms.txt` files.

---

## Checks that will catch a half-finished phase

`just verify` runs all of these. The ones this refactor will trip:

- `check-icons` — an SVG with no row in `design/icons.md`, or a stale
  `icons.css`.
- `check-classes` — a class in `reading.css` with no home in
  `design/components.md`.
- `check-literals` — a hand-written color, size or duration in a copied rule.
- `check-gallery` — a component row with no sample on the gallery page.
- `check-shell` — a fragment that no longer boots, which is how a deleted `const`
  that something else still reads shows up.
- `cargo test` — the shell-markup assertions, which read the HTML as text.
