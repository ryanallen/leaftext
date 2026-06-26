---
name: sync-docs
description: Update the docs under docs/ (and the /docs site nav) so they match the current app. Reviews recent app/feature changes and edits the right doc page(s), keeping them renderable by the leaftext web renderer, then regenerates the SEO/AIO/LLM discovery files (robots.txt, sitemap.xml, sitemap-md.txt, llms.txt, llms-full.txt) so search and AI crawlers stay current. Run it before a release or whenever app behavior changes. Never touches git. Use when the user says "sync the docs", "update the docs", "bundle the docs", "refresh documentation", "update the sitemap/llms.txt", or "make the docs match the code".
argument-hint: "[topic | since-ref]"
user-invocable: true
---

# Sync Docs

Keep the user-facing documentation in `docs/` truthful to the app. This is a **docs-only** task: edit Markdown (and, if pages are added or removed, the site nav and README list), then regenerate the SEO/AIO/LLM discovery files with `scripts/seo-gen.mjs` (step 5). **Never run git** — releasing is a separate step handled by `/git-release`.

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

| App area / source | Doc page(s) to update |
|:--|:--|
| Render pipeline, GFM/CommonMark coverage, syntax languages, emoji, alerts, math, footnotes, local images, sanitizer allowlist (`src/lib.rs` render path) | `docs/features/markdown-rendering.md` |
| Tabs, document/scroll history, `ScrollAnchor`, live reload, recent files, shortcuts (`src/main.rs`) | `docs/features/navigation.md` |
| Library pane, indexer, SQLite manifest, crawl/skip rules, throttling (`src/indexer.rs`) | `docs/features/library.md` |
| Minimap model and behavior (`build_minimap_model`, minimap UI) | `docs/features/minimap.md` |
| Themes, theme sources, token contract (`LEAF_SEMANTIC_TOKEN_CONTRACT`, `compiled_theme_css`) | `docs/features/themes.md` and `docs/development/theming.md` |
| Settings struct, `settings.json`, persistence, localization | `docs/features/settings.md` |
| Crates, IPC commands, source-file roles, data structures | `docs/development/architecture.md` |
| Toolchain, `Justfile`, `just verify`, platform build deps | `docs/development/building.md` |
| Release flow (`Justfile` `release`, `scripts/prepare-release.mts`, `.github/workflows/release-*`), version | `docs/development/releasing.md` |
| Install paths, platforms, data dirs, app id (`wix/`, `leaf.rc`, `Cargo.toml`) | `docs/installation.md` |
| The pitch, the feature list, the keyboard-shortcut tour | `docs/introduction.md`, `docs/quickstart.md` |

Update **every** page a change touches. A renamed setting, for example, may appear in both `settings.md` and `library.md`.

### 3. Edit the page(s)

**Sweep each touched page for stale enumerations — don't just append.** A page usually carries one or more *enumerations* that mirror the code: a Summary/overview table, a keyboard-shortcut list, an IPC-command or settings table, a feature matrix. Adding a new section below does **not** fix a row that is now wrong or missing in a table above — that drift is silent and is the most common miss. For every touched page, find each such table/list and **re-derive it from the source**, not from memory. Known enumerations to re-check whenever the relevant area changes:

- `docs/features/library.md` — the **Summary** table (one row per library capability) and the **File actions** table (one row per right-click menu item).
- `docs/development/architecture.md` — the **IPC command** table (one row per `IpcCommand` variant in `src/main.rs`) and the **source-file roles** list.
- `docs/features/navigation.md` and `docs/quickstart.md` — the **keyboard-shortcut** lists.
- `docs/features/settings.md` — the **settings** table (one row per field in the settings struct).

A useful check: enumerate the source (e.g. the `IpcCommand` variants, the menu items, the settings fields) and confirm the doc table has exactly those rows — no extras, none missing.

**Link every concept that has a home — deep-link to the section, not just the page.** When prose names a feature, view, setting, theme, or concept that is documented, make it a link rather than plain text. Prefer the *most specific* target: link to `page#section-slug` when a matching section exists, not just the page top. This covers the README intro and cross-references between doc pages. The docs SPA supports `#/<route>#<anchor>` deep links; a section's slug is its heading text lowercased with spaces turned to hyphens and punctuation dropped (e.g. "Mermaid diagrams" → `mermaid-diagrams`, "Recent files" → `recent-files`). For the README, that means a relative `docs/<route>.md#<anchor>`; between doc pages, a relative `<page>.md#<anchor>` (which `docs.js` intercepts). Don't over-link: link the first, most relevant mention in a passage, not every repetition, and never link a word to the very page it sits on.

**Deepen existing page-level links too.** A link that already points at a page top is wrong when the link text or its sentence names a *specific* topic that has its own section on that page — upgrade it to `page#section`. For example, "Data paths → See [Settings](features/settings.md)" should be `features/settings.md#paths`; "the [library](library.md) pane stays current" (about live updates) should be `library.md#live-updates`. Page-level links remain correct where they genuinely point at the whole page: "Next" lists, overview tables, and a deliberate "relative link" demo.

- A single `# Title` H1, followed by a one-line `> tagline` blockquote, then the intro paragraph.
- Plain, factual prose. No marketing fluff, no changelog entries ("now supports…"). State current behavior.
- Keep version numbers and counts (e.g. "last 8 files", "4 parse workers", "2 MB limit", current `Cargo.toml` version) matching the code.

**Renderer constraints — the docs are rendered by `site/markdown.js`, which supports a GFM subset. Use only:**

- Headings, paragraphs, **bold**/_italic_, lists (nested), tables, blockquotes, `inline code`, fenced code blocks, links, images, task lists, footnotes, emoji shortcodes, math (`$…$`, `$$…$$`), Mermaid fences.
- GitHub alerts via blockquote markers: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`.

**Do NOT use** Mintlify/MDX components (`<Tabs>`, `<Tab>`, `<Steps>`, `<Step>`, `<Card>`, `<CardGroup>`, `<Accordion>`, `<Note>`, `<Tip>`, `<Warning>`) or `theme={null}` on code fences. Convert those concepts to plain Markdown: tabs/steps/accordions → `###` subheadings or `**1. …**` numbered bold lines; cards → a bullet list of links; callouts → the `> [!TYPE]` alerts above.

**Cross-page links** must be relative `.md` paths so they work both on GitHub and in the SPA: from `docs/installation.md` link `quickstart.md`; from `docs/features/navigation.md` link a sibling as `themes.md` and a top-level page as `../installation.md`. `docs.js` intercepts these and turns them into `#/route` navigations.

### 4. If you add or remove a page

Three places must stay in sync:

1. The `.md` file under `docs/` (create or delete).
2. The `NAV` table in `docs/docs.js` — add/remove the `{ route, title }` entry in the right group and order. `route` is the path under `docs/` without `.md`.
3. The **Documentation** list in the root `README.md` — keep the `docs/<route>.md` relative links current.

### 5. Regenerate the SEO / AIO / LLM discovery files

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

### 6. Verify

- Grep the changed files for leftovers: no `<Tabs`, `<Card`, `<Step`, `<Note`, `<Tip`, `<Warning`, `<Accordion`, or `theme={null}`.
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

### 7. Hand back — do NOT release

Leave the changes uncommitted. Tell the user what pages changed. If they want it published, that is a separate, explicit `/git-release` (site-only: no version bump).

## Reference

- `docs/docs.js` — the `NAV` table (sidebar + mobile dropdown + pager) and the routing/link-interception logic.
- `docs/index.html`, `docs/docs.css` — the docs shell and chrome.
- `site/markdown.js` — the renderer that defines what Markdown the docs may use.
- `README.md` — the **Documentation** section with relative `docs/<route>.md` links.
- `scripts/seo-gen.mjs` — regenerates the SEO/AIO/LLM discovery files (`robots.txt`, `sitemap.xml`, `sitemap-md.txt`, `llms.txt`, `llms-full.txt`) from `README.md` + `docs/`.
- `/git-release` — the separate skill that commits and pushes (site-only changes don't bump the version).
