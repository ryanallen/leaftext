---
name: sync-docs
description: Update the docs under docs/ (and the /docs site nav) so they match the current app. Reviews recent app/feature changes and edits the right doc page(s), keeping them renderable by the leaftext web renderer, takes any screenshot a page asks for and does not have, then regenerates the SEO/AIO/LLM discovery files (robots.txt, sitemap.xml, sitemap-md.txt, llms.txt, llms-full.txt) so search and AI crawlers stay current. Run it before a release or whenever app behavior changes. Never touches git. Use when the user says "sync the docs", "update the docs", "bundle the docs", "refresh documentation", "update the sitemap/llms.txt", or "make the docs match the code".
argument-hint: "[topic | since-ref]"
user-invocable: true
---

# Sync Docs

Keep the user-facing documentation in `docs/` truthful to the app. This is a **docs-only** task: edit Markdown (and, if pages are added or removed, the site nav and README list), take any screenshot a page asks for and does not have (step 5), then regenerate the SEO/AIO/LLM discovery files with `scripts/seo-gen.mjs` (step 6). **Never run git** — releasing is a separate step handled by `/git-release`.

The docs are served at **leaftext.com/docs** by the static SPA in `docs/` (`index.html` + `docs.js` + `docs.css`). Each page is a plain `.md` file; `docs.js` renders it with the same renderer the root site uses (`site/markdown.js`) and routes by `#/<path>` (a route is the file path under `docs/` without `.md`).

## When to run

- Before cutting a release, so the published docs describe what shipped.
- Any time app behavior changes: new feature, changed shortcut, renamed setting, new theme, new dependency, changed install/release flow.
- On request for a specific area (pass it as the argument, e.g. `sync-docs themes`).

## Inputs

1. **Topic** (optional): a specific area to update (e.g. `library`, `themes`, `releasing`). If given, jump straight to the mapped page(s) below.
2. **Since-ref** (optional): a git ref to diff against to discover what changed (e.g. `v0.1.200`). If omitted, inspect the working tree plus recent commits to find changed app areas. **Read only** — do not commit, tag, or push.

## Process

### 1. Find what changed

If a topic was given, skip to step 2 for that area. Otherwise determine the changed app surface (read-only):

```bash
git diff --name-only HEAD~5..HEAD   # recent commits
git status --porcelain              # uncommitted work
```

Look at the actual source for anything relevant — the docs must describe real behavior, not guesses.

**Run this pass even if you edited docs while building the feature.** Editing the one section you were thinking about is not the same as auditing every page the change maps to. "I already touched the docs, so there's no drift" is exactly how stale rows survive — do the diff and the per-page audit anyway.

### 2. Map changes to doc pages

Pages carry an ordering prefix (`docs/01-features/03-library.md`); the prefix is
stripped from the route, so that page is `#/01-features/03-library` in the SPA and
`03-library.md` from a sibling.

| App area / source | Doc page(s) to update |
|:--|:--|
| Render pipeline, GFM/CommonMark coverage, syntax languages, emoji, alerts, math, footnotes, local images, sanitizer allowlist (`src/markdown/`, `src/xml.rs`, `src/tei.rs`, `src/data.rs`, `src/eml.rs`) | `docs/01-features/01-rendering.md` |
| A new readable format — one arm in `src/format.rs`, plus its extensions | `docs/01-features/01-rendering.md`, `docs/01-features/03-library.md#file-types`, `docs/02-installation.md#file-associations`, and the format lists in `README.md` |
| Tabs, document/scroll history, `ScrollAnchor`, live reload, recent files, shortcuts (`src/app/workspace.rs`, `src/app/history.rs`, `src/app/watch.rs`, `src/assets/shell/theme.js`) | `docs/01-features/02-navigation.md` |
| Library pane, vaults, the in-memory corpus, search, the graph, GitHub sync (`src/folder_tree.rs`, `src/vault_corpus.rs`, `src/doc_graph.rs`, `src/store/vaults.rs`, `src/git.rs`, `src/app/vaults.rs`, `src/app/vault_git.rs`) | `docs/01-features/03-library.md` |
| Minimap model and behavior (`src/minimap.rs`, `src/assets/shell/minimap.js`) | `docs/01-features/04-minimap.md` |
| Themes, theme sources, token contract (`LEAF_SEMANTIC_TOKEN_CONTRACT`, `reading_mode_css`, `themes/*.md`) | `docs/01-features/06-themes.md` and `docs/02-development/04-theming.md` |
| Anything under `design/` — a color, a token, an icon, a component | **nothing to edit by hand.** `docs/02-development/05-design-system.md` is generated from those files by `just bundle-design-docs`, and `just verify` fails if it has drifted. Edit `design/`, run the bundler |
| Settings struct, `settings.json`, persistence, the updater's user-facing behavior | `docs/01-features/05-settings.md` |
| Reading-view editing, the block gutter, the format bar, the flowchart sheet, the code view, typing help (`src/editing.rs`, `src/code_intel.rs`, `src/assets/shell/reading-edits.js`, `block-controls.js`, `selection-toolbar.js`, `flow-*.js`, `code-view.js`) | `docs/01-features/07-editing.md` |
| Which Monaco colorizers are bundled (`scripts/bundle-monaco.mjs`) | `docs/01-features/07-editing.md#code-view` — a format with no grammar opens as uncolored text, and the page says which |
| Crates, IPC commands, source-file roles, data structures | `docs/02-development/01-architecture.md` |
| Toolchain, `Justfile`, `just verify`, platform build deps | `docs/02-development/02-building.md` |
| Release flow (`Justfile` `release`, `scripts/prepare-release.mts`, `.github/workflows/release-*`), version | `docs/02-development/03-releasing.md` |
| Install paths, platforms, data dirs, app id (`wix/`, `leaf.rc`, `Cargo.toml`) | `docs/02-installation.md` |
| The pitch, the feature list, the keyboard-shortcut tour | `docs/01-introduction.md`, `docs/03-quickstart.md`, `README.md` |
| A word Leaftext uses for a part of itself | `docs/GLOSSARY.md` |

Update **every** page a change touches. A renamed setting, for example, may appear
in both `05-settings.md` and `03-library.md`.

**The README is a doc page for this purpose.** It carries its own copy of the
feature tour, the network/privacy claims, the install steps and the format lists,
so a change to any of those lands there as well as in `docs/`. Claims about what
reaches the network, what is written to disk, and when an update installs itself
are the ones worth re-deriving from the source rather than trusting: they are the
promises a reader is most entitled to, and the easiest to leave behind.

### 3. Edit the page(s)

**Sweep each touched page for stale enumerations — don't just append.** A page usually carries one or more *enumerations* that mirror the code: a Summary/overview table, a keyboard-shortcut list, an IPC-command or settings table, a feature matrix. Adding a new section below does **not** fix a row that is now wrong or missing in a table above — that drift is silent and is the most common miss. For every touched page, find each such table/list and **re-derive it from the source**, not from memory. Known enumerations to re-check whenever the relevant area changes:

- `docs/01-features/03-library.md` — the **Summary** table (one row per library capability), the **File actions** table (one row per right-click menu item in `src/assets/shell/context-menu.js`), and the **Facts** table.
- `docs/02-development/01-architecture.md` — the **IPC command** table (one row per `IpcCommand` variant in `src/app/events.rs`, grouped where the code groups them) and the **source-file roles** list.
- `docs/01-features/02-navigation.md` and `docs/03-quickstart.md` — the **keyboard-shortcut** lists (the handlers are in `src/assets/shell/theme.js`, `code-view.js`, `selection-toolbar.js` and `navigation.js`).
- `docs/01-features/05-settings.md` — the **settings** table (one row per field in `Settings` in `src/lib.rs`).
- `docs/01-features/07-editing.md` — the **Summary** table and the block-kind list the insert row offers (`MARKDOWN_INSERTS` in `block-controls.js`).
- `docs/01-features/06-themes.md` and `README.md` — the **family list and count** (`themes/*.md`, one file per family).

A useful check: enumerate the source (e.g. the `IpcCommand` variants, the menu items, the settings fields) and confirm the doc table has exactly those rows — no extras, none missing.

**Link every concept that has a home — deep-link to the section, not just the page.** When prose names a feature, view, setting, theme, or concept that is documented, make it a link rather than plain text. Prefer the *most specific* target: link to `page#section-slug` when a matching section exists, not just the page top. This covers the README intro and cross-references between doc pages. The docs SPA supports `#/<route>#<anchor>` deep links; a section's slug is its heading text lowercased with spaces turned to hyphens and punctuation dropped (e.g. "Mermaid diagrams" → `mermaid-diagrams`, "Recent files" → `recent-files`). For the README, that means a relative `docs/<route>.md#<anchor>`; between doc pages, a relative `<page>.md#<anchor>` (which `docs.js` intercepts). Don't over-link: link the first, most relevant mention in a passage, not every repetition, and never link a word to the very page it sits on.

**Deepen existing page-level links too.** A link that already points at a page top is wrong when the link text or its sentence names a *specific* topic that has its own section on that page — upgrade it to `page#section`. For example, "Data paths → See [Settings](features/settings.md)" should be `features/settings.md#paths`; "the [library](library.md) pane stays current" (about live updates) should be `library.md#live-updates`. Page-level links remain correct where they genuinely point at the whole page: "Next" lists, overview tables, and a deliberate "relative link" demo.

- A single `# Title` H1, followed by a one-line `> tagline` blockquote, then the intro paragraph.
- Plain, factual prose. No marketing fluff, no changelog entries ("now supports…"). State current behavior.
- Keep version numbers and counts (e.g. "last 8 files", "4 parse workers", "2 MB limit", current `Cargo.toml` version) matching the code.

**One page is generated and must not be hand-edited:**
`docs/02-development/05-design-system.md`. Its every count is read out of `design/`, so
an edit here is lost on the next run and `just check-design-docs` fails first. To
change what it says, change `design/` (see `/design-tokens`) and run
`just bundle-design-docs`.

**Renderer constraints — the docs are rendered by `site/markdown.js`, which supports a GFM subset. Use only:**

- Headings, paragraphs, **bold**/_italic_, lists (nested), tables, blockquotes, `inline code`, fenced code blocks, links, images, task lists, footnotes, emoji shortcodes, math (`$…$`, `$$…$$`), Mermaid fences.
- GitHub alerts via blockquote markers: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`.

**Do NOT use** Mintlify/MDX components (`<Tabs>`, `<Tab>`, `<Steps>`, `<Step>`, `<Card>`, `<CardGroup>`, `<Accordion>`, `<Note>`, `<Tip>`, `<Warning>`) or `theme={null}` on code fences. Convert those concepts to plain Markdown: tabs/steps/accordions → `###` subheadings or `**1. …**` numbered bold lines; cards → a bullet list of links; callouts → the `> [!TYPE]` alerts above.

**Cross-page links** must be relative `.md` paths, written with the **prefixed file
name**, so they work both on GitHub and in the SPA: from `docs/02-installation.md`
link `03-quickstart.md`; from `docs/01-features/02-navigation.md` link a sibling as
`06-themes.md` and a top-level page as `../02-installation.md`. `docs.js` intercepts
these and turns them into `#/route` navigations, stripping the prefixes.

### 4. If you add or remove a page

**The nav builds itself.** `docs.js` derives the sidebar, the mobile dropdown and
the pager from the folder listing (`site/docs-nav.js`), so there is no table to
edit — the `NN-` prefix on the file name is what sets its place in the order, and a
folder's `README.md` is that folder's index. Two places to keep in sync:

1. The `.md` file under `docs/` (create or delete), named with the prefix that puts
   it where you want it. Renumber its siblings if it has to land between two of them.
2. The **Documentation** list in the root `README.md` — keep the `docs/<path>.md`
   relative links current.

### 5. Take the pictures the pages ask for

A page that names a screenshot nobody took renders a broken frame at leaftext.com.
Nothing else in the repo notices, so this step is where it is caught.

```bash
node scripts/doc-images.mjs            # every reference, and which are not there
node scripts/doc-images.mjs --missing  # page, reference, file — one per line
```

Take each missing one. Two commands, per picture — the app photographs itself, then
the same encoder the diagram export uses writes the PNG:

```bash
pwsh scripts/capture-screenshot.ps1 -Doc <the document to open> -Out shot.bmp
just squeeze-png shot.bmp imgs/<name>.png --palette
```

- **The file name is already chosen** — it is whatever the page asks for. Write it
  there; never rename the reference to match a file you happened to make.
- **`-Doc` is what should be on screen**, and a screenshot of a feature has to
  *show* that feature. Omit it for the home screen. `-LibraryOpen` opens the library
  pane; `-Vault <folder>` registers one, which is the only way the search box and the
  vault switcher exist at all; `-Recents <files>` fills the home screen's list;
  `-Unlocked` lifts the padlocks, which typing in the page or the source needs.
  `-ThemeFamily` and `-ThemeMode` pin the theme (leave them at Fern light unless the
  picture is about a theme, so the set looks like one app). `-Width`/`-Height` change
  the window, and the page lays out at the size the window was created with.
- **`-Do` drives the window** before the shot, so a picture can show a menu, a sheet,
  a hover or a selection rather than only a document. Steps are `click:X,Y`,
  `rclick:X,Y`, `move:X,Y`, `drag:X1,Y1,X2,Y2`, `hold:…` (a drag caught mid-gesture),
  `scroll:X,Y,NOTCHES`, `type:text`, `key:{ESC}`, `wait:MS`. **Coordinates are pixels
  in the captured image**, so measure them off the last shot you took at the same
  size — take one plain shot first, look at it, then aim.
- **`-Crop "X,Y,W,H"`, same pixels.** Detail shots ship cropped: a whole window
  around a 200 px control is a picture of the window.
- `--palette` cuts the image to 256 colors: it halves the file and is the only step
  that moves a pixel. Use it for every screenshot.
- The shot runs against a throwaway profile under `-Work`, never the owner's — their
  settings, recent files and vault registry are not read or written. Nothing here
  needs `settings.json` hand-edited.
- **Anything the window cannot be made to show is not faked.** A macOS install
  dialog, an installer that cannot be built here, a state that needs a real GitHub
  repo or a pending release: leave the reference, say which pictures are still
  missing and why, in the hand-back.
- **Check every shot against the sentence that asks for it.** The alt text is a
  promise about what is in the frame; where the window will not produce it, fix the
  alt rather than shipping a picture that does not match.
- Batch politely: each capture launches the app and waits several seconds, so take
  them in one pass rather than one per edit.

A new reference is part of the same edit that adds it — writing `![…](imgs/x.png)`
and moving on is what built the backlog this step exists to drain.

### 6. Regenerate the SEO / AIO / LLM discovery files

The files AI crawlers and search engines read are generated from the docs, not hand-maintained. After editing docs — and always after adding or removing a page — regenerate them:

```bash
node scripts/seo-gen.mjs
```

It rewrites five files at the repo root (the deployed site root) from `README.md` + the `docs/` tree:

- `robots.txt` — allows the major search + AI crawlers (Googlebot, Bingbot, GPTBot, OAI-SearchBot, ChatGPT-User, CCBot, PerplexityBot, ClaudeBot, Google-Extended) and points at the sitemap.
- `sitemap.xml` — every canonical page URL **and** its raw `.md` source URL, each with a git-derived `<lastmod>`.
- `sitemap-md.txt` — one `.md` source URL per line.
- `llms.txt` — a concise index: page title → `.md` link.
- `llms-full.txt` — a fuller enumeration: title, page URL, Markdown URL, and a one-line description per page.

Page list, titles, summaries, and `<lastmod>` dates are all derived from the current files, so there is no list to maintain by hand. It is deterministic — byte-identical output for the same tree, so a no-op run leaves git untouched. (`<lastmod>` reads the last commit date per file; it refreshes on the next run after you commit.)

### 7. Verify

- Grep the changed files for leftovers: no `<Tabs`, `<Card`, `<Step`, `<Note`, `<Tip`, `<Warning`, `<Accordion`, or `theme={null}`.
- `node scripts/doc-images.mjs` — every picture a touched page asks for is there, and any that are not are named in the hand-back with the reason.
- Re-run `node scripts/seo-gen.mjs` and confirm it leaves the discovery files unchanged (a dirty tree here means step 5 was skipped or a doc changed after it ran).
- For every touched page, confirm each Summary/overview table, shortcut list, and enumerated command/settings/feature table matches the source one-for-one — no stale, missing, or extra rows.
- Confirm every internal link resolves to a real `.md` / route, and that each `#anchor` (including the anchor half of a deep link) matches a real heading slug on the target page.
- Scan touched pages and the README intro for feature/concept names left as plain text that have a doc page or section — link them, deep-linking to the section anchor where one exists.
- Audit existing page-top links: if the link text or its sentence names a specific section that exists on the target page, deepen it to `page#section` (leave "Next" lists, overview tables, and the relative-link demo at page level).
- Optional but preferred: serve and click through.

  ```bash
  python -m http.server 8000   # from the repo root
  # open http://localhost:8000/docs/ and click through the pages + pager
  ```

  Or smoke-test rendering without a browser:

  ```bash
  node docs/render-docs-check.mjs   # renders every docs/*.md and fails on a throw
  ```

### 8. Hand back — do NOT release

Leave the changes uncommitted. Tell the user what pages changed. If they want it published, that is a separate, explicit `/git-release` (site-only: no version bump).

## Reference

- `docs/docs.js` — the shell, the routing and the link interception. Its nav comes from `site/docs-nav.js`, which reads the folder listing, so there is no page list in it.
- `docs/index.html`, `docs/docs.css` — the docs shell and chrome.
- `site/markdown.js` — the renderer that defines what Markdown the docs may use.
- `README.md` — the **Documentation** section with relative `docs/<route>.md` links.
- `scripts/doc-images.mjs` — which pictures the docs ask for, and which are missing.
- `scripts/capture-screenshot.ps1` + `just squeeze-png` — how a picture gets taken. See [Building](../../../docs/02-development/02-building.md#documentation-screenshots).
- `scripts/seo-gen.mjs` — regenerates the SEO/AIO/LLM discovery files (`robots.txt`, `sitemap.xml`, `sitemap-md.txt`, `llms.txt`, `llms-full.txt`) from `README.md` + `docs/`.
- `/git-release` — the separate skill that commits and pushes (site-only changes don't bump the version).

<!-- keycode: LEAF-8F50 -->
