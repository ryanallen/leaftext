---
name: sync-docs
description: Update the docs under docs/ (and the site nav) so they match the current app — edit the right pages, take missing screenshots, lint the set for faults that live between pages, sweep every Markdown file in the repo and the plan tree next door off the disk, then regenerate the SEO/AIO/LLM discovery files. Run before a release or whenever app behavior changes. Use when the user says "sync the docs", "update the docs", "lint the docs", "update the sitemap/llms.txt", or "make the docs match the code".
argument-hint: "[topic | since-ref]"
user-invocable: true
---

# Sync Docs

Keep the user-facing documentation in `docs/` truthful to the app. This is a **docs-only** task: edit Markdown (and, if pages are added or removed, the site nav and README list), take any screenshot a page asks for and does not have (step 5), lint the whole set for the faults that live between pages (step 6), sweep every Markdown file in the repo and the plan tree next door, read off the disk rather than off a list (step 7), then regenerate the SEO/AIO/LLM discovery files with `scripts/seo-gen.mjs` (step 8). **Never run git** — releasing is a separate step handled by `/git-release`.

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

Pages carry an ordering prefix (`docs/01-features/03-library.md`); the prefix is stripped from the route, so that page is `#/01-features/03-library` in the SPA and `03-library.md` from a sibling.

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
| A new check (`scripts/check-*.mjs`, a `just check-*` recipe), or a step added to or removed from `verify` | `docs/02-development/02-building.md` — the `verify` recipe line, the prose that names each check, **and** the **Individual tasks** table. All three carry the list, so one edited alone is drift |
| A new test subject file under `src/tests/`, a new test module, or a change to where a kind of code is tested (`src/tests/mod.rs`, `src/app/tests.rs`, `src/store/tests.rs`, `scripts/check-shell.mjs`) | `docs/02-development/07-workflow.md#where-a-test-goes` and the source-file roles in `docs/02-development/01-architecture.md`. `/sync-tests` holds the same table for a builder — the two say the same thing to two readers, so they move together |
| A skill added, removed or renamed under `.agents/skills/`, or a change to how the workflow runs — what gates what, what a plan owes, who may write git | `docs/02-development/07-workflow.md` (the order, the rules and the skill table), and the skill count in `README.md` |
| Release flow (`Justfile` `release`, `scripts/prepare-release.mts`, `.github/workflows/release-*`), version | `docs/02-development/03-releasing.md` |
| Install paths, platforms, data dirs, app id (`wix/`, `leaf.rc`, `Cargo.toml`) | `docs/02-installation.md` |
| The pitch, the feature list, the keyboard-shortcut tour | `docs/01-introduction.md`, `docs/03-quickstart.md`, `README.md` |
| A word Leaftext uses for a part of itself | `docs/GLOSSARY.md` |
| A word the *planning tree* uses for a part of itself — ticket, phase, box, tier, the record | `../docs/GLOSSARY.md`, the one next to the ticket README. Two files share the name: this one is published and is about the app, that one is not published and is about how work is planned |

Update **every** page a change touches. A renamed setting, for example, may appear in both `05-settings.md` and `03-library.md`.

**The README is a doc page for this purpose.** It carries its own copy of the feature tour, the network/privacy claims, the install steps and the format lists, so a change to any of those lands there as well as in `docs/`. Claims about what reaches the network, what is written to disk, and when an update installs itself are the ones worth re-deriving from the source rather than trusting: they are the promises a reader is most entitled to, and the easiest to leave behind.

### 3. Edit the page(s)

**Sweep each touched page for stale enumerations — don't just append.** A page usually carries one or more *enumerations* that mirror the code: a Summary/overview table, a keyboard-shortcut list, an IPC-command or settings table, a feature matrix. Adding a new section below does **not** fix a row that is now wrong or missing in a table above — that drift is silent and is the most common miss. For every touched page, find each such table/list and **re-derive it from the source**, not from memory. Known enumerations to re-check whenever the relevant area changes:

- `docs/01-features/03-library.md` — the **Summary** table (one row per library capability), the **File actions** table (one row per right-click menu item in `src/assets/shell/context-menu.js`), and the **Facts** table.
- `docs/02-development/01-architecture.md` — the **IPC command** table (one row per `IpcCommand` variant in `src/app/events.rs`, grouped where the code groups them) and the **source-file roles** list.
- `docs/01-features/02-navigation.md` and `docs/03-quickstart.md` — the **keyboard-shortcut** lists (the handlers are in `src/assets/shell/theme.js`, `code-view.js`, `selection-toolbar.js` and `navigation.js`).
- `docs/01-features/05-settings.md` — the **settings** table (one row per field in `Settings` in `src/lib.rs`).
- `docs/01-features/07-editing.md` — the **Summary** table and the block-kind list the insert row offers (`MARKDOWN_INSERTS` in `block-controls.js`).
- `docs/01-features/06-themes.md` and `README.md` — the **family list and count** (`themes/*.md`, one file per family).
- `docs/02-development/07-workflow.md` — the **skill table** (one row per folder under `.agents/skills/`) and the **where a test goes** table (the same rows `/sync-tests` holds).
- `docs/02-development/02-building.md` — the **Individual tasks** table and the `verify` recipe (one row per `check-*` in the `Justfile`).

A useful check: enumerate the source (e.g. the `IpcCommand` variants, the menu items, the settings fields) and confirm the doc table has exactly those rows — no extras, none missing.

**Link every concept that has a home — deep-link to the section, not just the page.** When prose names a feature, view, setting, theme, or concept that is documented, make it a link rather than plain text. Prefer the *most specific* target: link to `page#section-slug` when a matching section exists, not just the page top. This covers the README intro and cross-references between doc pages. The docs SPA supports `#/<route>#<anchor>` deep links; a section's slug is its heading text lowercased with spaces turned to hyphens and punctuation dropped (e.g. "Mermaid diagrams" → `mermaid-diagrams`, "Recent files" → `recent-files`). For the README, that means a relative `docs/<route>.md#<anchor>`; between doc pages, a relative `<page>.md#<anchor>` (which `docs.js` intercepts). Don't over-link: link the first, most relevant mention in a passage, not every repetition, and never link a word to the very page it sits on.

**Deepen existing page-level links too.** A link that already points at a page top is wrong when the link text or its sentence names a *specific* topic that has its own section on that page — upgrade it to `page#section`. For example, `Data paths → See [Settings](features/settings.md)` should be `features/settings.md#paths`; `the [library](library.md) pane stays current` (about live updates) should be `library.md#live-updates`. Page-level links remain correct where they genuinely point at the whole page: "Next" lists, overview tables, and a deliberate "relative link" demo.

- **A paragraph is one line.** Never hard-wrap. The renderer reflows, GitHub reflows, every editor reflows — a wrap only costs, on every edit after it. `just check-wrapping` fails on one and names the file; `--fix` joins them, in Markdown and in `.rs`/`.js`/`.css` comments alike. A break doing real work keeps two trailing spaces, or the file carries `<!-- keep-wrapping -->` on a line of its own. **This applies to every file the sweep in step 7 reaches, not only the page being edited** — a wrapped file is fixed where it is found.
- A single `# Title` H1, followed by a one-line `> tagline` blockquote, then the intro paragraph.
- Plain, factual prose. No marketing fluff, no changelog entries ("now supports…"). State current behavior.
- Keep version numbers and counts (e.g. "last 8 files", "4 parse workers", "2 MB limit", current `Cargo.toml` version) matching the code.

**One page is generated and must not be hand-edited:** `docs/02-development/05-design-system.md`. Its every count is read out of `design/`, so an edit here is lost on the next run and `just check-design-docs` fails first. To change what it says, change `design/` (see `/design-tokens`) and run `just bundle-design-docs`.

**Renderer constraints — the docs are rendered by `site/markdown.js`, which supports a GFM subset. Use only:**

- Headings, paragraphs, **bold**/_italic_, lists (nested), tables, blockquotes, `inline code`, fenced code blocks, links, images, task lists, footnotes, emoji shortcodes, math (`$…$`, `$$…$$`), Mermaid fences.
- GitHub alerts via blockquote markers: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`.

**Do NOT use** Mintlify/MDX components (`<Tabs>`, `<Tab>`, `<Steps>`, `<Step>`, `<Card>`, `<CardGroup>`, `<Accordion>`, `<Note>`, `<Tip>`, `<Warning>`) or `theme={null}` on code fences. Convert those concepts to plain Markdown: tabs/steps/accordions → `###` subheadings or `**1. …**` numbered bold lines; cards → a bullet list of links; callouts → the `> [!TYPE]` alerts above.

**Cross-page links** must be relative `.md` paths, written with the **prefixed file name**, so they work both on GitHub and in the SPA: from `docs/02-installation.md` link `03-quickstart.md`; from `docs/01-features/02-navigation.md` link a sibling as `06-themes.md` and a top-level page as `../02-installation.md`. `docs.js` intercepts these and turns them into `#/route` navigations, stripping the prefixes.

### 4. If you add or remove a page

**The nav builds itself.** `docs.js` derives the sidebar, the mobile dropdown and the pager from the folder listing (`site/docs-nav.js`), so there is no table to edit — the `NN-` prefix on the file name is what sets its place in the order, and a folder's `README.md` is that folder's index. Two places to keep in sync:

1. The `.md` file under `docs/` (create or delete), named with the prefix that puts it where you want it. Renumber its siblings if it has to land between two of them.
2. The **Documentation** list in the root `README.md` — keep the `docs/<path>.md` relative links current.

### 5. Take the pictures the pages ask for

A page that names a screenshot nobody took renders a broken frame at leaftext.com. Nothing else in the repo notices, so this step is where it is caught.

```bash
node scripts/doc-images.mjs            # every reference, and which are not there
node scripts/doc-images.mjs --missing  # page, reference, file — one per line
```

Take each missing one. Two commands, per picture — the app photographs itself, then the same encoder the diagram export uses writes the PNG:

```bash
pwsh scripts/capture-screenshot.ps1 -Doc <the document to open> -Out shot.bmp
just squeeze-png shot.bmp imgs/<name>.png --palette
```

- **The file name is already chosen** — it is whatever the page asks for. Write it there; never rename the reference to match a file you happened to make.
- **`-Doc` is what should be on screen**, and a screenshot of a feature has to *show* that feature. Omit it for the home screen. `-LibraryOpen` opens the library pane; `-Vault <folder>` registers one, which is the only way the search box and the vault switcher exist at all; `-Recents <files>` fills the home screen's list; `-Unlocked` lifts the padlocks, which typing in the page or the source needs. `-ThemeFamily` and `-ThemeMode` pin the theme (leave them at Fern light unless the picture is about a theme, so the set looks like one app). `-Width`/`-Height` change the window, and the page lays out at the size the window was created with.
- **`-Do` drives the window** before the shot, so a picture can show a menu, a sheet, a hover or a selection rather than only a document. Steps are `click:X,Y`, `rclick:X,Y`, `move:X,Y`, `drag:X1,Y1,X2,Y2`, `hold:…` (a drag caught mid-gesture), `scroll:X,Y,NOTCHES`, `type:text`, `key:{ESC}`, `wait:MS`. **Coordinates are pixels in the captured image**, so measure them off the last shot you took at the same size — take one plain shot first, look at it, then aim.
- **`-Crop "X,Y,W,H"`, same pixels.** Detail shots ship cropped: a whole window around a 200 px control is a picture of the window.
- `--palette` cuts the image to 256 colors: it halves the file and is the only step that moves a pixel. Use it for every screenshot.
- The shot runs against a throwaway profile under `-Work`, never the owner's — their settings, recent files and vault registry are not read or written. Nothing here needs `settings.json` hand-edited.
- **Anything the window cannot be made to show is not faked.** A macOS install dialog, an installer that cannot be built here, a state that needs a real GitHub repo or a pending release: leave the reference, say which pictures are still missing and why, in the hand-back.
- **Check every shot against the sentence that asks for it.** The alt text is a promise about what is in the frame; where the window will not produce it, fix the alt rather than shipping a picture that does not match.
- Batch politely: each capture launches the app and waits several seconds, so take them in one pass rather than one per edit.

A new reference is part of the same edit that adds it — writing `![…](imgs/x.png)` and moving on is what built the backlog this step exists to drain.

### 6. Lint the whole set, not just the pages you touched

Steps 2 and 3 keep a page truthful. This step keeps the *set* coherent — the faults that live between pages and that no single edit can see. Run it before a release, or any time a change spanned more than one page.

- **Contradictions.** Two pages describing the same behavior differently. The pairs worth checking are the ones that share a subject: `README.md` against `01-introduction.md` (the pitch and the feature list), `03-library.md` against `05-settings.md` (a setting named in both), `02-installation.md` against `02-development/03-releasing.md` (paths and versions), `02-navigation.md` against `03-quickstart.md` (the shortcut lists). Where they differ, the source settles it — not whichever page reads better.
- **Stale claims.** A sentence that was true at some version and quietly is not: a count, a limit, a "this is not supported yet", a named default. These survive because nothing links to them and nothing tests them. Re-derive the number.
- **Orphans.** A page nothing links to. The nav reaches every page by folder listing, so an orphan still renders — it just never gets found from the page a reader is already on. Give it an inbound link from the page whose subject leads to it.
- **A concept with no home.** A word the docs use across several pages as though it were defined somewhere, and it is not — no section, no glossary row. Either it gets a `docs/GLOSSARY.md` row or the page that owns the subject gets a section, and the other mentions link there. This is what stops a term meaning something slightly different on each page. **The same fault has a second home:** a word the *tickets, rankings and skills* lean on with no row in `../docs/GLOSSARY.md` drifts the same way, and step 7 is where that is swept.
- **What was learned and never written down.** If this session derived something real about how the app behaves — a limit, an order of operations, a reason a thing works the way it does — and no page says it, that belongs on a page now. Otherwise the next person re-derives it. This is the most common way the docs fall behind while every individual edit was correct.

Say what the lint found in the hand-back, including anything left unfixed and why.

### 7. Every Markdown file, not just the published pages

The page map in step 2 covers what the app publishes. It is not the whole set of writing this session can have made untrue, and a map written by hand is exactly what misses a folder somebody added last week. **Read the set off the disk:**

```bash
just check-docs                     # fail on a file no role covers
node scripts/check-docs.mjs --list  # every Markdown file in both trees, and its role
```

The list is generated by walking the folders, so a page added anywhere shows up without anyone editing anything. **Work down it and ask one question of each file: did this session make a word of it untrue?** Only files where the answer is yes get edited — this is a sweep, not a rewrite of 150 documents.

**Every file in both trees is a guide, not a log** — `AGENTS.md` says so for the whole repo, and this sweep is where it is enforced. A page, a `design/` table, a skill: no changelog entry, no "what this pass found", no count of what was audited, no paragraph explaining why the file now says what it says. Cut one where the sweep finds it. What a build turned up belongs in its ticket. The one exception is a rule that was paid for in a version number, which is evidence the rule is real.

What each role means in practice:

| Role | What makes it untrue, and what to do |
|:--|:--|
| **published** (`docs/`) | Behavior changed. Step 2's map says which page; step 3 says how to edit it |
| **source of a token / a color** (`design/`, `themes/`) | Never edited here. A value changes in `design/` and the bundlers regenerate — see [`/design-tokens`](../design-tokens/SKILL.md) |
| **a repeatable job** (`.agents/skills/`) | The steps a skill names moved, or a rule it enforces changed. A skill describing a script or a path that no longer exists is worse than no skill. A change here is also published: [Workflow](../../../docs/02-development/07-workflow.md) is the account of these skills a contributor reads, so it is swept in the same pass |
| **the guide** (`AGENTS.md`, and `README.md`) | A standing rule changed, or the repo grew a file the guide's tables do not reach. Never a log of what shipped |
| **a license notice** (`src/assets/*-MIT.md`) | Only when what is vendored changes |
| **installer text** (`wix/`) | Only when the install flow changes |
| **any of them, always** | A hard-wrapped paragraph, and the same in a comment in the code. `just check-wrapping --fix` joins them across both trees, whatever else the sweep found |
| **plan** (`../docs/features/`, `../docs/refactor/`, `../docs/fixes/`, each grouped into subject folders) | **The one this step exists for.** A plan for something that now ships is the most misleading writing in either tree: move the file into the matching subject folder under `../docs/done/`, and move its row in [`../docs/README.md`](../../../../docs/README.md) under Shipped saying what shipped. A plan half-built gets the built part struck through, not deleted |
| **the running order** (`../docs/PLAN.md`) | The live tickets ranked, one file rewritten in place. When one ships, its row is wrong here: strike it, say what the build found, then **move it into [`../docs/done/PLAN.md`](../../../../docs/done/PLAN.md)** without its position number, which belongs to the live list only. The live file is the work that is left; the shipped one keeps the reasons |
| **the ticket README** (`../docs/README.md`) | Its "What the folders mean" paragraph names every folder next door, its paragraph under that names every subject folder inside them, and its "Needs a second look" table holds every ticket whose own status disagrees with the folder it sits in. A new folder or a settled status lands here |
| **the planning glossary** (`../docs/GLOSSARY.md`) | Every word that tree uses about itself, and what makes it untrue is the *process* changing, not the app: a new folder, a renamed part of a ticket, a rule about rows or tiers that moved. Sweep it whenever a skill under `.agents/skills/` changed, since those are what spend the words. A word used in a ticket or a ranking and defined nowhere gets a row — column headings and status values included; a word this file defines and nothing uses any more loses its row. **An entry is one or two sentences saying what the word means today**, with a link to whatever owns it: no history, no dates, no counts, no account of what it used to be |
| **shipped / canceled / a test document** | Kept for the reasoning. Left alone unless it is now factually wrong about the app |
| **reading from elsewhere** (`../docs/learn/`) | Somebody else's writing, copied in to read. It is not about this app, so nothing this session did can make it untrue. Never edited here — a correction belongs upstream, and rewriting it loses what was actually said |

**A plan with every box ticked and still filed as live work fails `just check-docs` and names itself.** The move above is remembered by two skills and was still missed once — v0.1.462 shipped `scroll-position` and left it in `../docs/fixes/`, so the running order went on calling it next up. The check runs inside `/check`, so a release cannot go out past it.

**A file with no role fails `just check-docs` and names itself.** That is the backstop: add a new kind of document and the suite stops until this table says who keeps it true. Fixing it means adding the folder to `ROLES` in `scripts/check-docs.mjs` *and* a row above — never just the script.

Never link from `docs/` into `../docs/`: those pages are published and that folder is not. Links only go the other way. **Two files are named `GLOSSARY.md`** and they are not interchangeable — `docs/GLOSSARY.md` is published and defines app words, `../docs/GLOSSARY.md` is not published and defines planning words. A row filed in the wrong one is published writing about tickets, or a ticket word nobody reading the app can find.

### 8. Regenerate the SEO / AIO / LLM discovery files

The files AI crawlers and search engines read are generated from the docs, not hand-maintained. After editing docs — and always after adding or removing a page — regenerate them:

```bash
node scripts/seo-gen.mjs
```

It rewrites five files at the repo root (the deployed site root) from `README.md` + the `docs/` tree:

- `robots.txt` — allows the major search + AI crawlers (Googlebot, Bingbot, GPTBot, OAI-SearchBot, ChatGPT-User, CCBot, PerplexityBot, ClaudeBot, Google-Extended) and points at the sitemap.
- `sitemap.xml` — every address a fetcher can actually ask for, each with a git-derived `<lastmod>`. A doc page's advertised address **is** its raw `.md`: a `#/route` never reaches the server, so advertising one is 18 addresses that all answer with the docs shell. The router still serves those routes for people who share them; they are simply not what a crawler is pointed at.
- `sitemap-md.txt` — one `.md` source URL per line.
- `llms.txt` — a concise index: page title → `.md` link.
- `llms-full.txt` — a fuller enumeration: title, page URL, Markdown URL, and a one-line description per page.

Page list, titles, summaries, and `<lastmod>` dates are all derived from the current files, so there is no list to maintain by hand. It is deterministic — byte-identical output for the same tree, so a no-op run leaves git untouched. (`<lastmod>` reads the last commit date per file; it refreshes on the next run after you commit.)

**Forgetting this step is now caught rather than shipped.** `check-site.mjs` runs the generator in memory on every `just verify` and names any committed file that disagrees, along with the address it should gain or lose — so a doc page added, renamed or removed cannot leave the discovery files quietly stale. Dates are not compared: a file's `<lastmod>` is its own last commit date, which the commit that changes it cannot know in advance.

### 9. Verify

- `just check-wrapping` — no paragraph or comment broken across lines in either tree, the stylesheets included.
- Grep the changed files for leftovers: no `<Tabs`, `<Card`, `<Step`, `<Note`, `<Tip`, `<Warning`, `<Accordion`, or `theme={null}`.
- `node scripts/doc-images.mjs` — every picture a touched page asks for is there, and any that are not are named in the hand-back with the reason.
- Re-run `node scripts/seo-gen.mjs` and confirm it leaves the discovery files unchanged (a dirty tree here means step 8 was skipped or a doc changed after it ran).
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

### 10. Hand back — do NOT release

Leave the changes uncommitted. Tell the user what pages changed, and what the lint found that is still open. If they want it published, that is a separate, explicit `/git-release` (site-only: no version bump).

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
