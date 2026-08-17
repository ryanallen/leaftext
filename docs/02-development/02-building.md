# Building

> Set up a Rust development environment, clone the repository, and run the Leaftext verification suite with `just verify` before contributing.

Leaftext is a Rust application (edition 2021). Building from source requires the Rust toolchain and the `just` command runner.

## Prerequisites

Before building Leaftext, make sure the following are installed:

- **Rust (stable toolchain)** — install via [rustup](https://rustup.rs/). The project targets Rust 2021 edition as declared in `Cargo.toml`.
- **`just` command runner** — install with `cargo install just`. Leaftext uses a `Justfile` to orchestrate formatting, type-checking, testing, and releases.
- **rust-analyzer** — `rustup component add rust-analyzer`. Nothing in the build uses it, so it is optional; an editor or an agent working in this checkout uses it for go-to-definition, find-all-references and compile errors as you type, and `.agents/settings.json` already enables it on the Claude Code side. Without the component the bare name on `PATH` is a rustup proxy that exits with an error, so the language server starts and dies rather than being missing.
- **Platform-specific WebView dependency**: none to install. macOS provides WKWebView, and Windows provides WebView2 through the Microsoft Edge WebView2 Runtime.

> [!NOTE]
> Leaftext builds for Windows and macOS only. Any other target stops the build with a `compile_error!` in `src/main.rs` rather than failing later in a platform code path.

## Clone and build

Clone the repository and compile in debug mode:

```sh
git clone https://github.com/ryanallen/leaftext.git
cd leaftext
cargo build
```

The first build downloads and compiles all dependencies listed in `Cargo.toml` — `tao`, `wry`, `pulldown-cmark`, `syntect`, `rusqlite` (bundled), and others. Subsequent builds are incremental.

Every build here takes two cores, not the machine: `.cargo/config.toml` sets `build.jobs = 2` so a long compile leaves the computer usable to whoever is sitting at it. Give one run the whole machine with `CARGO_BUILD_JOBS`, which beats the file without changing it — `CARGO_BUILD_JOBS=16 cargo build`.

## Run

Launch the app directly from the source tree:

```sh
cargo run
```

This compiles (if needed) and starts Leaftext. Open a Markdown file with `Ctrl+O` / `Cmd+O`.

Dependencies are compiled with optimizations even in this debug build (`[profile.dev.package."*"]` in `Cargo.toml`). Parsing, sanitizing, and syntax highlighting all happen inside crates, so leaving them unoptimized made a development build several times slower than the one users get — slow enough to send you hunting performance problems that do not exist in a release build. Dependencies change rarely, so they are compiled once and cached; rebuilds of this crate stay at debug speed.

## Verification suite

Before submitting a contribution, run the full suite:

```sh
just verify
```

This runs formatting, type checking, the tests, the drift checks over everything that is generated, the design-system rules, the spelling check, the front-end check, the docs-coverage check, and the repo guards, in sequence. All steps must pass. The `verify` recipe is defined in the project `Justfile` as:

```text
verify: format-check check check-web check-installer check-web-commands test check-vendor check-themes check-tokens check-icons check-gallery check-design-docs check-classes check-literals check-page-frame check-hover-fills check-scratch-names check-release check-verify check-justfile-quotes check-build-jobs check-spelling check-docs check-doc-images check-plan check-learn-snapshots check-wrapping check-ascii-art check-site check-site-boot check-shell check-identity check-hooks check-release-package check-workflow-installs check-mcp check-agent-settings check-driver check-shot-edges check-compose-shots
```

The design-system steps are the ones worth knowing about. `check-tokens`, `check-icons`, `check-gallery` and `check-design-docs` fail when a generated file has drifted from the four files in `design/` it is built from — the stylesheet's fixed values, the icon classes, the page at [leaftext.com/gallery.html](https://leaftext.com/gallery.html), and [Design system](05-design-system.md). `check-classes` fails on a class in `reading.css` that `design/components.md` does not account for, so new interface joins the design system rather than growing beside it. `check-literals` fails on a color, size, spacing or duration typed into `reading.css` instead of coming from a value, and on any `font` shorthand there except `font: inherit` — the parts a shorthand does not name reset silently, an unnamed line height to whatever the loaded face gives, so there is nothing on the line for the value rules to judge. `check-page-frame` reads that stylesheet for a rule that would take a published page's frame — an `overflow`, `position` or `touch-action` on a bare `html`, `body` or `:root`, at any depth. The same file is what [leaftext.com](https://leaftext.com) and Emptyguru are handed to draw a document with, so a rule keyed on nothing reaches somebody else's page: `body { overflow: hidden }` is the app window's own rule, and where the root element's overflow is `visible` a browser takes the viewport's from `body`, which left both sites with no scrollport at all and unscrollable on every device from v1.5.0. A class, an attribute, a pseudo-class or a combinator takes a selector out of the check's reach, which is how every rule the window needs stays where it is. `check-hover-fills` reads the same stylesheet for two things the pointer must not paint: a background behind the values in a note's field block, where the caret is the cue and a band would be the app drawing a form over somebody's words, and a button that clears its own fill at rest without naming one for hover — the app-wide `button:hover` is a pseudo-class and an element, so it outranks a rest rule of one class alone and fills such a control with the primary color, leaving its quiet label unreadable on top. Only a class the markup in `design/components.md` draws on a button is held to the second rule, so the check widens by itself as the design system grows. `check-verify` fails when a check exists but this recipe does not run it. `check-scratch-names` fails on a path in the OS temp folder built from a fixed name: two runs of the suite at once on one checkout share every such file, and the failure that follows names anything but the second writer — a scratch name carries the run's own process id, or the OS hands it out, and the paths that have to stay fixed each carry a row saying why, with a row matching nothing failing too. `check-web` type-checks the browser package, which `cargo check --all-targets` never reaches — the workspace's only default member is the app itself — and it checks both feature ends, because the whole app in a browser is behind a feature the core does not have, and that is where it once stopped compiling while every check here stayed green. `check-installer` is there for the same reason and about the third package: the Windows EXE installer links nothing of the app, so nothing else in the suite compiles it, and everything it does is a plan before it is an act — the files, the registry values and the one Start Menu entry as data — which is why the whole of it can be tested on a machine with nothing installed. `check-web-commands` is the other half of that split: the app and a published site are one front end with two hosts under it, so every command in `IpcCommand` — the app's one typed list of what the page may send — has to carry a written line in the browser's own host saying what a browser does about it, and the check fails on an arm with no line, on a line naming no arm, and on a command the front end sends by name that neither host has an arm for. A control whose command goes unanswered is not a control that does nothing: the page raises a waiting state before it sends and clears it only when the answer arrives, so it waits for ever. `check-docs` fails on a Markdown file — in this repo or the plan folder beside it — that no role covers, so a new kind of document has to say who keeps it true rather than quietly going stale. It also opens every relative link in those files whose target ends `.md` and fails on one that is not a file, naming the file, the line and the target, so a citation that stopped opening anything when its target moved is caught rather than found by a reader. Code is stripped first — fenced blocks a line at a time, then inline spans — because a page teaching an author how to write a link is documentation of a link, not a link. In the same read it asks whether a live ticket adding a control says what that control looks like: a ticket whose phases name `design/components.md` is one adding a control, since `check-classes` refuses any class the stylesheet paints that has no row there, so a `## What it looks like` section is owed and the check fails without one. A ticket that draws nothing new says so in that section in one sentence rather than being refused for work it is not doing, and the matcher is proved off a table of cases before either tree is opened. It cannot see a ticket that moves an existing control without touching `design/`. `check-plan` holds the running order beside those tickets to the same standard, on the seven things about its shape that can be settled without judgment: a file that opens on a table of work rather than on its own name, since a named document needs its name before its contents and a reader meeting a headerless table first cannot tell what they are reading, a live ticket with no row anywhere, a position that skips or repeats, one of the three counts at the foot disagreeing with what is on disk, a row ranked above the ticket it says it is waiting on, a fix ranked below the tier for what is wrong today, and a feature ranked inside it. Its own rules are proved against made-up files before the real one is opened. Each of those has gone wrong silently — a ticket with no row is work nobody picks up, and a row above its own blocker is the one fault that actively sends somebody at a ticket they cannot start. `check-learn-snapshots` is about the one folder of writing beside those plans that is this repo's own: the shareable article explaining how the work gets done is handed on with an exact copy of every skill it cites, so a reader can hold what the article claims against the rule itself, and a copy that has drifted is the article teaching something that was retired with nothing in the folder saying which half is current. It compares each copy to the skill of that name and fails naming the copy, its source and the first line they disagree on, so the drift is refused in the turn that caused it rather than found months later by somebody outside this repo; `--fix` rewrites every copy from its source as bytes, because a check with no way to repair what it names is one somebody works around. A copy naming a skill that no longer exists fails too, so a renamed or retired skill cannot leave a copy of nothing behind. `check-site` opens each page the site publishes, follows the script it loads, and fails on a file the page fetches by a path with nothing at it — a 404 that shows up only once the page is live. It also holds the site to what it advertises: every address in `sitemap.xml`, `sitemap-md.txt`, `llms.txt` and `llms-full.txt` resolves to a file, none of them hides behind a `#` a server never sees, and each entry page names its own Markdown source and the two AI indexes — in the head for a machine, and in a `noscript` block for anything reading the body without running the script. It re-runs `scripts/seo-gen.mjs` in memory and fails when a committed discovery file disagrees with what the generator would write today, naming the address it should gain or lose, so a doc page added or renamed cannot leave those files quietly stale. Dates are left out of that comparison: a `<lastmod>` is a file's own last commit date, which the commit that changes the file cannot know in advance. It also runs the site's own link-tooltip code, since nothing else does, and fails when a Previous / Next button's tooltip stops naming the page it opens. The last thing it holds is the renderer the site draws its documents with, which is built when the site publishes and never committed: every path a page names for that module or its stylesheet has to be one the publish really writes, every one of those paths has to be one `.gitignore` refuses, and the publish workflow has to still run the build and the write. All three faults are otherwise invisible until the site is live — a renamed output leaves the pages fetching nothing, and a path that stopped being ignored puts a 2.7 MB compiled module in the tree. `check-site-boot` is the half of that `check-site` cannot do: it *runs* those files rather than reading them, booting both entry readers and every helper they import against a stand-in page, a stand-in fetch and a stand-in renderer module, which is the only thing in the suite that ever executes the code standing between the app's own renderer and somebody reading either published site — a typo in the loader, a missing export or a script that throws as it loads otherwise reaches a reader as a blank page. What it reads is the finished page rather than the absence of a throw: both readers catch a mid-boot fault into a status line over a half-drawn document, so a check stopping at "it did not throw" passes on a page the reader itself gave up on. So the status line has to be down, the document drawn, the tab titled from the document, the sidebar carrying the pages the folder listing named, and the Previous / Next strip filled rather than left spinning. It also presses the strip's own button, since its address is a route and the in-page-jump branch beside it once canceled the click, and it runs the inline module in the front page's foot, which is the one piece of this code that is not a file. A `.js` under `site/` that neither reader imports fails it as well, because nothing would ever boot it. `check-identity` fails on an assistant credited anywhere in the repo or its history, and `check-hooks` self-tests the five hooks. `check-wrapping` fails on a paragraph broken across lines, in Markdown and in a comment in the code alike — a `//` run and a `/* */` block in a stylesheet both, the block measured against its own indent because its lines are aligned under the opener rather than starting at column zero; `--fix` joins them, and `check-ascii-art` fails on a diagram drawn with box characters, since those only line up in one font at one size. `check-shot-edges` fails on a screenshot carrying a black strip nobody drew, from one of the two bands the window holds around the app. `check-doc-images` is the other picture check and reads the pages rather than the files: it fails on one naming a screenshot that is not on disk, which draws a broken frame at leaftext.com and nowhere a reader of this repo would meet it. It self-tests its own scanner first, on a picture that is not there, one that is, one written inside code — the theming page shows an author the shape of that line — and one on another host. Three references went out under every publish while it was run by hand only. `check-release-package` fails when the release workflows could no longer find the app's binary in the workspace — the browser package sorts ahead of it, so a workflow that took the first member it found would build both Mac chips and then have nothing to package. `check-workflow-installs` reads the same workflows for a pairing either half of which is fine alone: a cache holding a directory `cargo install` writes to, and an install into it with nothing to stop it running twice. A cache is there so a compiled tool survives to the next run, and `cargo install` refuses to overwrite a binary already in its destination — so the second run of such a workflow dies at the install, three steps in, having restored the very binary it is trying to build. That is what stopped the site publishing and stopped the only build that compiles the browser crate for the target it runs on. A lookup before the install, a condition on the step, or `--force` all count as stopping it, so the check refuses the fault rather than picking the fix. `check-agent-settings` reads `.agents/settings.json` for what an agent opening this checkout is owed — today the one plugin row that enables the Rust analyzer, so definitions, callers and compile errors are answered by the compiler rather than by a text search. Lose the row and nothing breaks loudly: the editor asks to install it again, one person answers into their own settings, and the next machine asks again. The analyzer program itself is a per-machine `rustup component add rust-analyzer` and is deliberately not checked, since a suite failing on it would fail for anyone who has not run one optional command for a tool the build never uses. The last two are about driving a running copy: `check-mcp` holds the ask pipe's wrapper, its registration and `src/pipe.rs` to each other, and `check-driver` covers all three provers with the half of each that needs no app and no site — it dry-runs every step the gesture driver takes, since a machine with no window open can read the step list back even though it cannot press anything, it drives the browser driver against an empty page for eight seconds, failing if the page comes back hidden, and it reads the motion probe's element, trigger and property back off a dry run, failing when the probe accepts a run with one of them missing. That second one is a real run rather than a reading of the script, because what it guards against is a browser that stops honoring the call that keeps a headless page awake, and no amount of reading can see that.

`check-compose-shots` proves the vertical, diagonal, and grid PNG joins keep the selected pixels and expected dimensions.

`check-justfile-quotes` fails when a recipe puts single or double quotes directly around an interpolation, because Windows passes those characters into the program instead of using them to group a value.

`check-release` self-tests the release path itself, with nothing released: every command a release would run goes through one runner, so the test hands it a fixture and reads the order back — the old tags are deleted only after the gate has passed, and a failed gate, a moving plan tree, a clean tree or a version that disagrees with the manifest reaches no tag cleanup, no commit, no tag and no push. What must not happen is proved by the commands that were never reached.

`check-build-jobs` fails when the compile share is missing, is not a whole number, is zero — which is Cargo's word for every core — or has been raised. Cargo compiles on every core unless something tells it not to, and every compile in this suite is a Cargo command, so `.cargo/config.toml` gives all of them two jobs and leaves the rest of the machine to whoever is using it. That costs a cold suite time and buys back the computer it is running on. A machine nobody is sitting at can have the lot for a single run — `CARGO_BUILD_JOBS=16 just verify` — which beats the file without changing it, and is why the share is a setting rather than a number typed into each recipe.

A compiler warning is an error here. `[workspace.lints.rust]` in the root `Cargo.toml` sets `warnings = "deny"` and all three packages opt in, so every way the tree is compiled refuses one — the four checks above, `cargo test`, the editor's analyzer at the line, and the release builds. The manifest rather than a flag on one recipe is what makes that true everywhere, and Cargo caps lints in dependencies to `allow`, so only this repo's own code is held to it. Where a warning is genuinely wanted, the fix is an `#[allow(...)]` on the item that needs it, with a comment saying why.

A passing `just verify` is the baseline requirement before handing any work back.

The Mermaid, KaTeX, and Noto assets are embedded in the binary from `src/assets` and also served as static files from `site/`. `src/assets` is the source of truth; `check-vendor` fails if the `site/` copies have drifted. Run `just sync-vendor` to recopy them and clear the drift.

Theme palettes work the same way: `src/assets/themes.md` (embedded in the binary) is compiled from the editable `themes/` folder of per-family Markdown files. `check-themes` fails if it has drifted; run `just bundle-themes` to recompile it. See [Theming](04-theming.md#palettes-are-data-themesmd).

Spelling comes next: this repo writes US English, so `check-spelling` fails on the British form of any word in `scripts/check-spelling.mjs`'s list — the `-our` spelling of "color", for one. It reads only files the repo authors: vendored bundles, build output, and generated files are skipped, and the two identifiers that are British by specification (`aria-labelledby`, WiX's `ProgramMenuFolder`) are exempt.

`check-shell` runs the WebView front-end rather than reading it. The script fragments in `src/assets/shell/` are concatenated the way the binary concatenates them and executed against a stand-in page built from the ids and classes the real markup declares, so nothing has to be listed twice. It fails if the script does not parse, if it throws as it loads — which is what a declaration moved below its first use does, and the reason fragment order is load-bearing — or if the code view's edit arithmetic is wrong. That last one matters most: the editor sends the host only the part of the text that changed, and the host splices it into what it writes to disk, so each case is checked by rebuilding the new text from the splice.

In a private session, `check-learn-snapshots` compares every mismatched copy with the same skill in every managed workspace, one named path per record. A copy that is byte-for-byte another session's skill is named as held and let past, even where this session changed that skill too; this session's change is not in the article yet. A pair nobody holds still answers `cut` or `drifted` as it did before, and `--fix` leaves both cut and held pairs alone.

The primary checkout has the matching reading. A session that changes a skill privately regenerates the copies in the plan tree everybody shares, so from here the copy is the newer rule and the skill beside it is the older one — the check compares each mismatched copy with the same skill in every managed workspace, one named path per record, and a copy that is byte-for-byte a session's own skill is named with the session holding it and let past. A copy edited in the plan tree alone still fails, and `--fix` leaves every held copy alone rather than writing that session's work back out.

## Individual tasks

Each step in the verification pipeline can also be run on its own:

| Task         | Command                     | What it does                                   |
| ------------ | --------------------------- | ---------------------------------------------- |
| Format       | `cargo fmt`                 | Reformat the code in place                     |
| Format check | `cargo fmt --check`         | Verify code formatting without modifying files |
| Type check   | `cargo check --all-targets` | Check all targets without producing a binary   |
| Browser crate | `just check-web`           | Type-check the browser package at both feature ends, which the check above never reaches. No wasm target needed |
| Windows installer | `just check-installer`  | Type-check and test the EXE installer package, which the check above never reaches either. Nothing is installed: what it writes is a plan a test can read |
| Browser commands | `just check-web-commands` | Fail on a command the app can send that the browser host says nothing about, on a stale row, and on a command the front end sends that nothing answers on either host |
| Tests        | `cargo test`                | Run the full test suite                        |
| Vendor check | `just check-vendor`         | Verify `site/` vendored assets match `src/assets` |
| Themes check | `just check-themes`         | Verify `src/assets/themes.md` matches the `themes/` folder |
| Values check | `just check-tokens`         | Verify the color contract and the fixed values match `design/` |
| Icons check  | `just check-icons`          | Verify the icon classes match `design/icons.md`, and every row names a licensed pack and a drawing in its weight's box |
| Gallery check | `just check-gallery`       | Verify `gallery.html` matches `design/` |
| Design docs check | `just check-design-docs` | Verify [Design system](05-design-system.md) matches `design/` |
| Classes check | `just check-classes`       | Fail on a class in `reading.css` that `design/components.md` does not account for |
| Values written by hand | `just check-literals` | Fail on a color, size, spacing or duration typed into `reading.css`, and on any `font` shorthand but `font: inherit` |
| A published page's frame | `just check-page-frame` | Fail on an `overflow`, `position` or `touch-action` in `reading.css` on a bare `html`, `body` or `:root`, which reaches every page the app's stylesheet is handed to |
| Hover fills  | `just check-hover-fills`    | Fail on a rule painting behind a note's field values under the pointer, and on a button that clears its own fill at rest without naming one for hover |
| Scratch names | `just check-scratch-names` | Fail on a temp-folder path built from a fixed name, which two runs at once would share |
| Release path | `just check-release`        | Self-test the release, with nothing released: the old tags go only after the gate passes, and a failed gate, a moving plan tree, a clean tree or a wrong version reaches no cleanup, commit, tag or push |
| Suite check  | `just check-verify`         | Fail when a check exists that `verify` does not run |
| Justfile quotes | `just check-justfile-quotes` | Fail when quote characters directly surround an interpolation in a recipe |
| Compile share | `just check-build-jobs`    | Fail when the two-job Cargo default is missing, malformed, zero or raised — the setting that leaves the machine usable while the suite compiles |
| Spelling     | `just check-spelling`       | Fail on British spelling in the repo's own writing |
| Docs coverage | `just check-docs`          | Fail on a Markdown file that nothing keeps true, on a relative `.md` link that opens nothing, and on a live ticket that adds a control and never says what it looks like. A link crossing between the plan tree and the app is resolved inside the other tree's own root, and one into an app file only the copy the owner reads has is reported as waiting rather than failed. `node scripts/check-docs.mjs --list` prints every one and its role |
| Doc pictures | `just check-doc-images`     | Fail on a page naming a picture that is not on disk, which draws a broken frame at leaftext.com. `just doc-images` is the same read as a list, for a pass about to take one |
| Running order | `just check-plan`          | Fail on a running order opening on a table of work rather than on its own name, a live ticket with no row in the running order, a position that skips or repeats, a count at the foot that disagrees with the folders, a row ranked above what it is waiting on, a fix ranked below the top tier, or a feature inside it |
| Shared skill copies | `just check-learn-snapshots` | Fail on a copy of a skill in the shareable workflow article that no longer matches the skill it was taken from, except a private workspace pair that was already cut across a primary edit, or a copy here that is exactly what some session's own skill says. `node scripts/check-learn-snapshots.mjs --fix` rewrites every pair this checkout changed and leaves both of those alone |
| Wrapping     | `just check-wrapping`       | Fail on a paragraph broken across lines, in Markdown and in a comment in the code alike. `--fix` joins them, and the join is self-tested before either mode reads a file |
| Box diagrams | `just check-ascii-art`      | Fail on a diagram drawn with box characters, which line up in one font at one size and nowhere else — a diagram is a picture |
| Site paths   | `just check-site`           | Fail on a file the published pages fetch by a path that has nothing at it, on an advertised address a fetcher cannot ask for, on an entry page that stops naming its own Markdown source, on a discovery file the generator would now write differently, on a Previous / Next tooltip that stops naming its page, and on the renderer the site publishes — a path no build writes, a published path the tree would commit, or a publish that stopped building it |
| Site boot    | `just check-site-boot`      | Boot the code that draws the published pages — both entry readers and every helper they pull in — against a stand-in page, fetch and renderer module, and read the finished page each one drew |
| Front end    | `just check-shell`          | Run the page's script against a stand-in page: it parses, it boots, and its edit offsets are right |
| Identity     | `just check-identity`       | Fail on an assistant credited in the repo or its history |
| Hooks        | `just check-hooks`          | Self-test the five hooks |
| Release package | `just check-release-package` | Fail when the release workflows could no longer find the app's binary among the workspace's packages |
| Workflow installs | `just check-workflow-installs` | Fail when a workflow caches a directory `cargo install` writes to and installs into it with nothing to stop the install running twice |
| Ask pipe     | `just check-mcp`            | Fail when the MCP wrapper, its registration and `src/pipe.rs` disagree about what can be asked, or where |
| Agent settings | `just check-agent-settings` | Fail when `.agents/settings.json` stops enabling a plugin every agent opening this checkout needs — today the Rust analyzer |
| Provers      | `just check-driver`         | Fail when the gesture driver cannot read its own step list back, when an attached run accepts a flag that would rewrite your settings, when the browser driver no longer keeps its page awake, or when the motion probe takes a run with an argument missing |
| Screenshot edges | `just check-shot-edges` | Fail on a published picture carrying a black strip nobody drew — one of the two bands the window holds around the app, photographed |
| Composed pictures | `just check-compose-shots` | Fail when the helper every composed picture is joined or tiled with stops producing what it is asked for |
| Full verify  | `just verify`               | All steps above in sequence                    |
| Browser modules | `just build-web`         | Build all three browser modules, render a document through each, ask the third for the page, front end, boot state and document call a published site is served with, and hold the core to its size ceiling. Needs the `wasm32-unknown-unknown` target, so it is not part of `verify` |
| Static site  | `just export-web [folder]`  | Write a folder of documents out as a static Leaftext site — no server needed to read it |
| Browser preview | `just preview-web [folder]` | Export, then serve that folder locally so it can be looked at |
| Browser driver | `just drive-web <url> [steps]` | Click things in the exported site, read the page back, photograph it — holding the page awake, and failing rather than reporting a step that ran on a frozen one |
| Motion probe | `just probe-motion <selector> <trigger>` | Sample one element's computed value every frame while a trigger runs against the copy that is open, print time and value per frame, and fail when the first frame is already at the resting value. Classes arrive on schedule whether or not anything draws, so a proof that reads them passes on a motion that snapped |

Additional convenience tasks are available via `just --list`, including `just sync-vendor` to recopy the vendored assets into `site/` and `just bundle-themes` to recompile `themes.md` from the `themes/` folder.

### The browser build

The renderer also builds for the browser. `rustup target add wasm32-unknown-unknown` once, then `just build-web` produces three modules — the core, the same with the code highlighter compiled in, and one carrying the app's whole page and front end — and proves each answers: a document rendered through every one, and the third asked for the page, the front end, the boot state and the document call a published site is actually served with. `just export-web [folder]` writes a folder of documents out as a static Leaftext site that needs no server; `just preview-web [folder]` exports and serves it locally, because a page cannot fetch its neighbors off `file://`. See [The browser modules](01-architecture.md#the-browser-modules).

### Asking a running app

A running Leaftext answers questions on a local channel — see `src/pipe.rs`. `just ask '<json>'` puts one question to it and prints the reply:

```bash
just ask '{"ask":"version"}'
just ask '{"ask":"state"}'
just ask '{"ask":"state","reader":true}'
just ask '{"ask":"idle"}'
just ask '{"ask":"log","lines":40}'
just ask '{"ask":"eval","script":"document.title"}'
just ask '{"ask":"doc","path":"notes/a.md"}'
just ask '{"ask":"edit","path":"notes/a.md","start":0,"end":7,"text":"# Retitled","expect":"<fingerprint>"}'
just ask '{"ask":"save","path":"notes/a.md","expect":"<fingerprint>"}'
just ask '{"ask":"quit"}'
```

`state` answers out of the app's own workspace — the tabs, their paths, which have unsaved edits, the active vault. With `reader` it asks the page as well, for the things only the page holds: where the document is scrolled to and the block it is anchored to, which panels are up, the selected text, and whether a render is still in flight. That half is opt-in because the plain ask has to keep working on an app that is stuck, and a page too stuck to reply would otherwise take the tab list down with it — when it cannot answer, `reader` carries the reason and everything else still comes back.

`idle` waits for that render to finish and then answers the same reader fields, so a driven pass reads the result instead of sleeping and hoping. It gives up inside the two seconds the pipe allows and says which of the two it hit.

`quit` closes the copy that answered, out through the same path the close button takes — the window's size, place and maximized state are saved first. This is how a copy launched to prove a change should be ended: killing the process is the one way out that skips that save, and the process name is shared with any other copy on the machine, where an ask reaches exactly the copy whose pipe it went down. The reply says it is closing and arrives before the app goes: the loop answers, and only once the asker has taken that answer is the app told to close, because a reply still in the pipe when the process ends is thrown away. An app too stuck to answer refuses it like any other ask, which is the one case a kill is still for.

`doc`, `edit` and `save` are the document workflow: `doc` opens the file or brings it to the front and answers its source, how the file is spelled, whether it has unsaved edits and a fingerprint of the buffer; `edit` splices a byte range of that source as one undo step; `save` writes it through the same host save the page's Save button reaches, so the file goes back to disk spelled the way it arrived. Both writes quote the fingerprint they expect, and a document that has moved on since — somebody typed, the file was reloaded — refuses the write and says what the fingerprint is now. There is no session behind them: the pipe holds nothing between asks, so the fingerprint is the whole of what makes a write safe. They work the document at the front, which is why `doc` brings it there — the window always shows what is being worked on. A document with no file of its own is refused a save, since naming one opens a dialog only the person at the window can answer.

`just mcp` runs the same program as an MCP server on stdin/stdout, so an AI gets one tool per ask. `.mcp.json` at the repo root declares it and `.agents/settings.json` approves it, so a session in this folder has the tools without being told to shell out. It is **not a shipped artifact**: one MSI and one DMG is the rule, and every extra file in a release is one somebody has to ask about. Neither release workflow builds it, and `just verify` cannot run it because it needs the app running — `check-mcp` covers what can be checked offline, which is that the tools, the registration and the app's asks still agree.

`eval` runs arbitrary JavaScript inside the app. It is the reason the pipe beats reading the journal afterwards, and it is reachable by anything running under the same account.

### Documentation screenshots

`scripts/capture-screenshot.ps1` photographs the app for the documentation, and `just squeeze-png <in.bmp> <out.png>` writes the file — the same encoder the [diagram export](../01-features/07-editing.md#export) uses, so there is only one of them. Add `--palette` for a screenshot: it cuts the image to 256 colors, which halves the file and is the one step that moves a pixel.

```bash
pwsh scripts/capture-screenshot.ps1 -Doc docs/01-features/01-rendering.md -Out shot.bmp
just squeeze-png shot.bmp imgs/rendering.png --palette
```

`just doc-images` lists every picture the documentation asks for and which of them are not there, so a page cannot quietly point at a screenshot nobody took. `just check-doc-images` is the same read as a gate and is in `just verify`, so a page naming a picture nobody took fails the build rather than shipping a broken frame. The list stays for a pass that is about to take a picture, and the repo's `sync-docs` skill runs it.

[Screenshots](06-screenshots.md) is the list of what each picture in `imgs/` shows and what takes it. `just check-shot-edges` fails on one carrying a black strip nobody drew — one of the two bands around the app, photographed.

The script closes any running copy first (the app is single-instance, so a second launch hands the file over and exits), and writes the window size and theme into a `settings.json` of its own, because the webview lays out at the size it was created with. That file, the recent-files list and the vault registry are all written from nothing on every run, in a throwaway profile under `-Work`: the app resolves both roots from `%APPDATA%` and `%LOCALAPPDATA%`, so a screenshot never reads or writes your own. `%USERPROFILE%` and the three `OneDrive` variables point there too, because the app makes a vault of every cloud folder it finds under them, and a picture of the vault list would otherwise show the folders on the machine the shot was taken on.

The picture is the app itself, which is smaller than the window twice over: `GetWindowRect` spans an invisible resize border, and inside that the app holds itself off the window on all four sides so its own shadow has room. Nothing renders into either band, so both photograph as pure black — the color the app draws nowhere, which is exactly what `check-shot-edges` refuses — and both are cut off. Two dozen published pictures shipped with the first band round them before it was noticed. A throwaway shot goes first purely to measure the second one, because pointer steps are offset by both, so a step is a pixel in the picture and a `-Crop` is measured off the app rather than off the window around it.

The pointer is parked off the window before those steps run. The capture draws what the pointer is over and never the pointer itself, so a control that only appears under one — a tab's close cross, a block's drag handle — otherwise photographs as a control that is simply always there, in a picture with nothing visibly hovering it. A deliberate hover is a `move:` step and is untouched by the park. The first-run bubble is off in the shot profile for the same reason: the profile is new every run, so every picture with the library pane open would otherwise carry one.

Beyond `-Doc`, `-Width`, `-Height`, `-ThemeFamily` and `-ThemeMode`:

| Option | What it is for |
| --- | --- |
| `-LibraryOpen` | Opens the [library](../01-features/03-library.md) pane |
| `-Vault <folder>` | Registers a [vault](../01-features/03-library.md#vaults). The search box and the vault switcher do not exist without one |
| `-Recents <files>` | Fills the home screen's [recent files](../01-features/02-navigation.md#recent-files) list |
| `-Favorites <files>` | Fills the home screen's [favorites](../01-features/02-navigation.md#favorites) column. Without one the screen draws the recent list alone |
| `-Unlocked` | Lifts the [padlocks](../01-features/07-editing.md#the-padlock), for a picture of typing in the page or the source |
| `-GraphScope <size>` | How much of the link graph the [graph view](../01-features/03-library.md#graph) draws: `small`, `medium`, `large` or `xl`. A big vault at `xl` is a hairball with no readable name in it |
| `-Do <steps>` | Drives the window before the shot: `click:X,Y`, `rclick:X,Y`, `move:X,Y`, `drag:X1,Y1,X2,Y2`, `hold:…` (a drag caught mid-gesture), `scroll:X,Y,NOTCHES`, `type:text`, `key:{ESC}`, `wait:MS` |
| `-Crop "X,Y,W,H"` | Cuts the shot down to one control |

`-Do` and `-Crop` coordinates are pixels in the captured image, so they are measured off a shot already taken at the same size and in the same state: take one plain picture, look at it, then aim. The floating toolbar in particular sits at different pixels with the library pane open and shut, because it centers on the page. Through `-File` a `-Do` array collapses at its commas, so several steps go in as one `-Steps 'click:1,2 wait:900'` string instead.

### Driving the copy you already have open

The same script with `-Attach` drives the window that is up instead of launching one, and leaves it up afterwards. `just drive` is the short way in, with the steps separated by spaces:

```bash
just drive shot.png click:900,700 scroll:900,700,-8
```

An out ending `.png` comes back through the app's own encoder, so the picture can be read without a second command. Nothing about the profile is touched — no folders, no settings file, no recents, no vault registry — and every flag that would have shaped one is **refused with the reason** rather than quietly ignored, because this is your session and not a throwaway.

A change that moves something on the screen is proved against the same open copy, by where it was rather than by which classes ran:

```bash
just probe-motion '#themeSheet' 'openThemeSheet()'
```

That samples the element's computed `transform` every frame while the trigger runs, prints time and value per frame, and fails when the first frame is already at the resting value. `--property` watches something else and `--for` sets how long it samples. It is worth the command because the class timeline keeps schedule whether or not anything moves — the runner behind each sheet carries a timer for the case where no end event arrives — so a proof that reads classes passes on a motion that snapped.

Two things about real input. A wheel notch and a key press go to whatever has focus, not to what the pointer is over, and bringing a window forward does not put focus inside the page — so lead with a click on the document, as above, or the notches land somewhere else and the app sits where it was. And `^` is cmd's escape character, so `key:^{HOME}` reaches the script as `key:{HOME}`; a keyboard shortcut is better sent through `eval`, which needs no focus at all and works on both platforms.

That split is worth knowing before driving anything: everything the page handles — every shortcut, every click on an element, every command the page sends — can go through `eval`, and only what the web view itself handles needs real input: the wheel, a real drag, a native menu, the file dialog. A `WheelEvent` dispatched into the page moves nothing, and setting `scrollTop` is a different gesture from a wheel.
