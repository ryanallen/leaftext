# Leaftext

Project guide for agents in this repo; `CLAUDE.md` and `CODEX.md` symlink here. **A guide, not a log** — no changelog entries, no "gaps I closed". Edit only to change standing guidance.

---

# Rule 1: Talking to the owner

Plain English, few words. Lead with the answer, then stop. No jargon, no abbreviations. Under 500 characters. Same in code comments: one short line, only where the code can't say it.

**A question gets an answer and nothing else.** No next step, no offer, no "want me to". A question is not a request to act; if work is wanted, that will be said.

**No sycophancy.** Never "you're right", "good question", "fair point", "exactly". No apology, no restating the question back, no claimed agreement to soften an answer. When the answer is no, say no.

**Say it in the owner's words, and name nothing they do not press** — no command, check, test, file, function, id, byte count or line number. They use the app; the build is your problem. So "everything passes", not what ran, and "the button on the find bar", not the id it carries. Anything named says what it does in the same breath. Never pad with a caveat that is true every single time; it teaches the reader to skip everything you write.

**Handing work back is two things: is anything broken, and what to press** — the gestures in the order a person makes them, "open a file, switch to source view, open the padlock, hold Ctrl and click in three spots, type". Never what changed, what was proved, what it cost, what a check found, what turned up on the way, or what is left for later. **A fact the owner cannot act on is not one of the two halves.** With both halves empty the whole reply is "Done." Anything learned goes in the ticket, which is what the ticket is for.

**What is next is a skill to run, named with your own host's sign, and nothing else** — a slash in Claude, a dollar in Codex, and you write yours, never the other's. `/ticket` to scope something, `/pm` to reorder, `/design` to read a plan against the code, `/dev` to build it, `/check` to gate it, `/git-release` to ship it, `/done` to close it, plus the narrow ones like `/sync-docs` when that is genuinely the work. One line: the command, then what it is for in the words of what they would otherwise see go wrong. Never a description of the work in place of the command. If nothing is next, say so.

**A paragraph is one line.** Never hard-wrap — not in a reply, a ticket, a skill, a doc page, this file, or a code comment. Everything that reads them reflows, so a wrapped paragraph has to be re-flowed by hand and diffs whole on a one-word change. `just check-wrapping` names the file; `--fix` joins them, in Markdown and in `.rs`/`.js`/`.css` comments alike. A break doing real work stays: two trailing spaces in Markdown, any indent of its own in a comment, or `<!-- keep-wrapping -->` on a line of its own, which takes a whole file out.

**Never round-trip a file through terminal text output.** Read and write Markdown as UTF-8 bytes with a file-safe tool; terminal output is for inspection, never file content.

**No background tasks and no subagents.** Every command runs in the foreground, in this session, and every step is done by you.

**One session at a time, working the checkout in front of it.** Every ticket, README row, box and status is written where the owner reads it, which is what lets them watch a build happen rather than ask whether one is. A second session against this checkout writes over the first one's work: the running order is one ranked list, and two rewrites of one list are not something any merge can settle.

**Never use the host's task list.** The ticket already holds every piece of work as a box, so a second list is the same work written twice and drifts the moment anything changes.

**US spellings, never British** — "favorite", "color", "canceled". In a reply, a comment, a ticket, a commit message. `just check-spelling` names the line, here and in the plan tree.

**Every date carries the time beside it** — `18 August 2026, 9:11pm` — wherever a date is written down: a found line, a designed line, a shipped note, a status cell, a retired or refused row, a record at the foot of a ticket, the ranking's own stamp. This tree fills a whole day in a day, so a day is not an answer to when: two stamps from one day cannot be put in order. Read the clock rather than remembering it (`Get-Date`); this machine keeps Arizona time all year, so there is no zone to convert. `just check-docs` refuses a bare day written from `2026-08-19` on; the ones before stay, because a time nobody recorded cannot be invented.

**Never invent a reason.** A cost, a limit, a risk — say it only if it is real and it applies here. Dressing an option up as expensive to steer the answer is lying, even when every word is separately true. If you don't know the cost, say you don't know.

**Every choice you hand over comes with a recommendation.** You have read the code and the owner has not. Each option gets what it wins and what it costs, one is marked the pick with the reason it is the pick, and the stakes are said: a choice they cannot see the stakes of is one they have to do your reading to answer.

**One answer, never a yes and a no.** No "but", no "however", no "though", no "that said", no clause qualifying the answer you just gave. Where something genuinely does not fit the answer, that is a fact about the work and it goes in the ticket, not in the sentence.

**Never name work in a reply instead of filing it.** Anything the app does not do, does wrong, or cannot do yet is a ticket, written in that same reply with [`/ticket`](.agents/skills/ticket/SKILL.md), given its row in `../docs/README.md` and ranked by [`/pm`](.agents/skills/pm/SKILL.md). **A sentence saying a thing "needs a ticket", "is not covered", "is out of scope", "would be its own work", or "is a different feature" is the failure itself** — you found it and handed the filing back to the owner. The sentence is only allowed once the file exists, and then it names the file. This holds when the finding is a question the owner asked, and when you are certain they will say no: a refused ticket is a decision recorded, and an unfiled one is a decision nobody can find.

**When told you got it wrong, skip the response and do the work.** Don't own it, don't explain it, don't say what you meant, don't list the parts you got right. Start at whatever comes after.

---

# 🛑 GIT: DO NOT TOUCH IT

**Only a `/git-release` or `$git-release` in the message you are answering right now authorizes a git write.** One-shot; it expires with the turn. `scripts/gate-git.mjs` refuses the write without it, so there is nothing to weigh: **a dirty tree is the correct end state** — say what changed and stop. Don't ask, don't hint, don't offer. Reading git is always fine. **Putting the installers out needs the same word**, even where nothing is committed: finishing a stranded release publishes downloads to everybody, which is the decision the license exists to keep.

---

# 🛑 MEMORY: DO NOT WRITE ONE

**Never write a memory file**, even where the host says to. Rules go here, decisions in the ticket.

---

## Scope

Self-contained. Ignore the **parent** `Studio/` config — its `AGENTS.md`/`CLAUDE.md`/`CODEX.md`/`GEMINI.md`, its `.agents/`, its hooks, checklist, `verify-task`/`gate-*` flow, voice skill, and memory system. This repo's own `.agents/` does apply; nothing else does, and this file wins any conflict.

## What it is

Rust desktop app for reading Markdown, XML, JSON and YAML — rendered document first, editable in place (inline in the page, or the raw-source code view; nothing saves without an explicit Save). `tao` + `wry` (native window hosting a system web view); `pulldown-cmark` parses, `ammonia` sanitizes. CommonMark, GFM, and GitHub extras (highlighting, issue/PR refs, emoji, footnotes, alerts, Mermaid, math). Tabs, history, recent files, vaults, system light/dark. The interface is English only, and adding a translation layer back is not a small change.

## Layout

### The file map

**[`docs/02-development/01-architecture.md`](docs/02-development/01-architecture.md) is the file map** — every module under `src/`, named, with what it is for. Open it when the work reaches a source file.

### Rules the file map does not carry

These hold across the tree and are read before a session knows which file it will open, which is why they are the guide's and not that page's:

- **Both crate roots share `src/`** — `lib.rs` and `main.rs` — so a bare `mod tests;` in `main.rs` resolves to the library's `src/tests/`. That is why the binary's modules live under `src/app/`.
- Where a subject is a directory, `mod.rs` holds the shared vocabulary and the pipeline that orders the stages; siblings hold one stage each. Types stay module-wide (`pub(super)`); functions open up only where something calls them.
- **`format.rs` is the only table of readable formats and their extensions.** A new format is one arm there plus whatever the exhaustive matches then refuse to compile — never a second list.
- **`markdown/rawhtml.rs` is a security boundary** — what raw HTML may keep, standing between hostile input and the web view.
- **`src/assets/shell/` is one scope, not modules.** The fragments concatenate in `APP_SHELL_SCRIPT_PARTS` order and are served as `app.js` over `leaf-asset://`, behind the page's one script tag; the page reaches WebView2 as one string with a ~2 MB ceiling. There is no module loader, so order is load-bearing and a fragment alone is not a valid program: `journal.js` leads (its error handlers are the only thing that sees a later fragment throw as it loads, and it must reach `window.ipc` directly), the flowchart pair follows, `state.js` after that and holding **only** what more than one fragment touches, and the last fragment ends with the bootstrap call. Nothing is substituted into the script, which is why it can be a file at all.
- **Mermaid diagrams take the theme's own tokens**, mapped in `decorate.js` — never a per-theme diagram palette. The `cScale` categorical scale is ours, named entry by entry, held to one luminance; left to mermaid's arithmetic it drew near-black labels on near-black boxes.
- **`design/` is the source of a token, `themes/` of a color's value.** [`design/colors.md`](design/colors.md) compiles to the contract in `theme.rs`, [`design/tokens.md`](design/tokens.md) to `src/assets/tokens.css`, [`design/icons.md`](design/icons.md) to `src/assets/icons.css` (one `.lt-icon-*` mask class each), and [`design/components.md`](design/components.md) is a row per component with the markup it is drawn with. `gallery.html` — every theme, color, icon and component on one page — is built from all four and is a page in the repo, not a feature in the app. [`themes/`](themes/README.md) holds the values, one file per family. `just bundle-tokens`, `bundle-icons`, `bundle-gallery`, `bundle-design-docs` and `bundle-themes` generate; their `check-` twins fail on drift, on a theme row nobody lists, on an SVG with no row, and on a component with no sample. Never edit a generated file.
- **An icon reaches the page as a name, not a drawing** — `<span class="lt-icon lt-icon-back">` — so one used five times is in the app once. A mask reads only alpha, so the control's own `currentColor` paints it, and a bolder active state swaps to a second mask (`--lt-icon-*-heavy`) rather than thickening a stroke a mask does not have. Even the broken-image mark is a mask, kept an `<img>` so a later fetch can go back to its own source. **The line weight is `design/icons.md`'s, not the drawing's** — a `Stroke` cell per row, one of three named weights, stamped over whatever the file was saved at, and the weight names the box too: regular and heavy 24 units across, hairline 12, strokeless none. A row also names the pack the drawing came from, and a named pack owes a license notice beside the drawings; `leaftext` means composed here. `just check-icons` names a file that disagrees.
- **Every class in `reading.css` is accounted for in `design/components.md`** — as a component, as something a rendered document brings, or as a state. `just check-classes` fails on one that is not, so new interface joins the design system rather than growing beside it.
- **No hand-written value in `reading.css`.** Color, spacing, text size, weight, stroke, line height, letter spacing, opacity, duration, easing, shadow and layer come from a token; `just check-literals` names the line. Widths, heights, positional offsets and a document's `em` sizing are one component's geometry, not tokens.
- **Nothing in that stylesheet takes a page's frame.** The whole of it is what a browser is handed, so a rule keyed on nothing lands on leaftext.com and Emptyguru as well as on the app — `body { overflow: hidden }` left both sites with no scrollport at all on any device. `just check-page-frame` refuses an `overflow`, `position` or `touch-action` on a bare `html`, `body` or `:root`, at any depth. The app's own page is keyed on `.app-surface`.
- **Never crawl the disk.** `folder_tree.rs` reads one folder per call, `vault_corpus.rs` one vault, `doc_graph.rs` is bounded by a document's links. **A vault stops at a folder that says it holds generated files** — a standard `CACHEDIR.TAG`, or one of eleven names a build tool picks — and `folder_holds_generated_files` in `vault_corpus.rs` is the only list of them; `watch.rs` refuses the same folders off `path_holds_generated_files`, because `notify` cannot exclude a subtree from a recursive watch, and `git.rs`'s nested-repository scan asks it too. The folder the open document sits in is the one exception, so a README read out of `node_modules` still live-reloads.
- **The renderer runs in a browser too, so anything it reaches for is `host.rs`'s.** The window, the web view, the file dialog, the watcher and SQLite are optional dependencies the binary asks for by name. A change that makes the library reach the disk, spawn a process, or name a `file://` URL breaks the browser build silently, because `just verify` does not build it — put it behind `LeafHost`, every read with a default, so a host that cannot answer renders the document without that decoration rather than failing. **A waiting state is a promise**: the Previous/Next strip is a host answer because a skeleton once spun for ever in a browser. `web/` is the module, `just build-web` proves it, `just export-web` writes a folder of documents out as a static site, `just preview-web` serves it. **The result needs no server** — both published sites are static files on GitHub Pages.
- **Both published sites draw their documents through that module, and never through a copy of it.** `site/leaftext-core.js` loads the module and `site/pager.js` fills the waiting strip it draws; everything else in `site/` draws the page **around** the document and stays each site's own. **No built file is ever committed** — `.gitignore` refuses `assets/leaftext`, `publish-site.yml` builds at publish time, and `scripts/site-assets.mjs` is the one table naming those paths, which `check-site` holds the pages, the ignore rules and the workflow to. Emptyguru fetches the same files from leaftext.com, which is why it needs no Rust and why a page whose module does not arrive says so rather than waiting. Where a page names the module is a `<meta name="leaftext-renderer">` in its own head, with no default.
- **One front end, three hosts — and a command with no line in every one of them does not ship.** A window, a published static site, and a document inside somebody else's product all run the same page and script. `IpcCommand` is the one typed list of what the page may send, and every arm carries a written line in **each** browser host: answered, refused on purpose with the reason, or not yet with the ticket that owns it. `just check-web-commands` fails on an arm with no line, a line naming no arm, and a command the front end sends that no host has. Write the line in the same edit as the command — the page raises a waiting state before it sends and clears it when the answer arrives, so an unanswered command waits for ever. `check-shell` boots both hosts offline (**neither may carry an `import`**, since it boots one by stripping `export`), and a tagged release builds the modules for `wasm32`.
- **An embedded document is an editor, not a picture of one, because the module holds the buffer.** The browser module's buffer is the library's `EditableDocument`, so there is one splice, one undo stack, one table rewrite and one field parser shared with the desktop. A buffer is opened over a document's **bytes** rather than a string, so the source comes back out spelled the way it went in — a product owning the save cannot re-spell somebody's file. `web/buffer.json` pins the text after every kind of edit, and both sides walk it.

### The plan stage

**A stage in the running order is read off the ticket, never written ahead of it.** `Designed`, `Dev` and `Released` all rest on one fact — the ticket carries a dated `Designed` line — so a row claiming one without it tells the owner a build is under way on a plan nobody has read against the code. A ticket is not built until [`/design`](.agents/skills/design/SKILL.md) has written that line, however small the change, however recently the owner asked for it, and however few minutes ago this session wrote the ticket. `just check-plan-stage` refuses the row and `scripts/gate-design.mjs` refuses the build.

## Skills

In [`.agents/skills/`](.agents/skills/), which `.claude/` and `.codex/` symlink to — one folder per repeatable job, each carrying its own description and triggers, and the host surfaces every one. A skill is named with the host's own sign — `/ticket` in Claude, `$ticket` in Codex; both spellings work everywhere one is read. The workflow is `/ticket`, `/design`, `/dev`, `/git-release`, then `/done`; `/check` gates every hand-back, and only `/git-release` writes git.

## Hooks

In [`.agents/settings.json`](.agents/settings.json), pointing at `scripts/`. Each holds its own rules in its header comment, runs by hand with `--check`, and `just verify` runs all six.

- `gate-rules.mjs` — prints Rule 1 before every message and records the git license, granted only when the message **starts** with `/git-release` or `$git-release`.
- `gate-git.mjs` — refuses a git write, a command that throws the working tree away, and the release commands, unless this turn in this session was licensed. An edit is undone by editing it back, never by asking git for the old bytes; `git show <ref>:<path>` is a read and stays allowed.
- `gate-checklist.mjs` — writes this turn's step list from the numbered headings of the skill the message names. **A bullet is a step, never work** — work is the ticket's boxes, which outlive the session.
- `gate-touched.mjs` — writes down every file this session changes, so a release stages its own work and leaves another session's alone.
- `gate-voice.mjs` — refuses to end the turn on a reply breaking the half of Rule 1 that names its own words, or one owing a keycode or leaving a checklist bullet un-struck. It is the only `Stop` hook on purpose: the host allows one a turn.
- `gate-keycode.mjs` — proof the rules were read rather than remembered. This file and every `SKILL.md` ends with a keycode; each message owes this file's plus any skill it names, reported with `node scripts/gate-keycode.mjs <file> <code>`.

## Rules each paid for in version numbers

- **Paths are a contract** with every installed copy. App id `com.ryanallen.leaftext`. Windows: `%LOCALAPPDATA%\ryanallen\leaftext\data` (`manifest.db`, staged updates), `%APPDATA%\ryanallen\leaftext\config` (settings, recents). macOS: both under `~/Library/Application Support/com.ryanallen.leaftext`. `project_dirs_match_the_documented_layout` pins them; changing one orphans user data.
- **`manifest.db` is not a cache.** It holds the vault registry and nothing else, so losing it loses which folders the user called vaults. It keeps the old file name because every installed copy already has one there. Anything that reads a document reads the disk.
- **The install stays per-user** (`%LOCALAPPDATA%\Programs\leaftext\bin`). Per-machine can't self-replace without a UAC prompt every time.
- **Never remove a copy from another install context.** v0.1.363 and v0.1.364 both tried and both ended with the wrong copy running or an unexplained elevation prompt. Release notes ask; the app doesn't touch it.
- **Exactly one Start Menu entry, and it's load-bearing** — the only way to find or launch the app. v0.1.365 shipped without one and was unreachable. No desktop shortcut; `validate-installer.yml` asserts 1.
- **Never wait on a build.** `wix/main.wxs` ships unproven — WiX can't run locally, and a broken installer costs a patch bump, which beats blocking every release.
- **Never re-push a tag.** Bump the patch: Actions may not re-trigger, and stale artifacts confuse the release.
- **A release stopped by a GitHub outage is finished on the tag it already has, never with a new number.** Everything but the last step survives one. `just publish-release <version>` starts both release builds against that tag; it makes no tag, moves none, touches no version and commits nothing. v1.15.6 built both installers, published neither, and left the newest download at v1.15.5.
- **Justfile interpolations have no surrounding quotes.** `cmd.exe /C` passes them through as argument characters and drops a value with spaces; `just check-justfile-quotes` refuses either quote style.
- **Exactly one tag exists at a time**, here and on GitHub. The build deletes every older release and tag when it publishes, so a tag left behind comes back on the next push that carries tags — and GitHub creates no push event at all for a push carrying more than three, which publishes nothing while the tag sits there looking shipped (v0.1.502). Delete the old tags before making the new one, and confirm a run exists for the tag pushed. **The gate comes before the cleanup, and the whole release is one command** — check, delete the old tags, commit, tag, push `main`, push the tag — so a gate that stops leaves the last released tag where it was. A failure after the cleanup is a release that failed and is said so plainly.
- **The web view must never download the installer.** GitHub redirects release assets to a host sending no `Access-Control-Allow-Origin`, so `fetch` dies before the first byte and no CSP grant fixes it. The page finds the release (the API *is* CORS-clean); `platform::download_to` fetches it over WinHTTP/`curl`. Keep `connect-src` down to `api.github.com`.
- **Every published file is an installer a person can run.** No checksums, nothing published for the updater alone. (GitHub's source archives can't be disabled.) macOS has one, the DMG. Windows has two — the MSI, and an EXE for a machine whose policy blocks Windows Installer packages. They produce the same install, and which one a copy updates through is written at install time rather than chosen by a reader.
- **No diagram drawn with box characters.** `┌ │ └ ─` line up in one font at one size and nowhere else, so a frame arrives ragged in the app's own renderer, on GitHub and in every editor. A drawing is a picture: `scripts/wireframe.mjs` photographs an HTML sketch, and the sketch stays in `../docs/imgs/wireframes/` so a later edit redraws it. `just check-ascii-art` names the line; `cargo tree` output is left alone.
- **Windows and macOS only.** Linux is gone: no workflow, no GTK/`xdg-open`/`xclip`, and `main.rs` `compile_error!`s elsewhere. Don't re-add it.
- **Never crawl the device.** A background indexer once walked every drive: on macOS it wanders into `~/Documents`, `~/Desktop` and iCloud, each its own consent gate, so it collects a couple of approvals and *looks* like it stopped; on Windows nothing refuses it, so it grinds through the whole disk while someone is trying to read. What replaced it reads only what the user pointed at — one folder for the pane, one vault for the graph and search — and a folder chosen through the file dialog carries its own macOS consent.

## Commands

Needs `rustup`, `just`, `node`, GitHub's own `gh` (the one tool that can start a build, which is how a release stranded by an outage is finished) and `rustup component add rust-analyzer` — the analyzer is the agent's go-to-definition, find-all-references and live compile errors, started by the plugin row in `.agents/settings.json`. `/check` is the gate before handing work back: `just verify` runs everything — format, compile, tests, drift in every generated file, the stylesheet rules, the document and plan rules, the front-end boot, identity and the hooks. `just check` / `test` / `format` / `check-shell` run individually.

**A gate gets two cores, not the machine.** Cargo takes every one by default, so a gate used to leave nobody a machine to work on; `.cargo/config.toml` gives them a two-job share instead. A machine nobody is using can have the lot for one run — `CARGO_BUILD_JOBS=16 just verify` — and the committed default stays where it is. `just check-build-jobs` fails if it goes missing, stops being a whole number, is zero, or is quietly raised.

**A compiler warning is an error.** `warnings = "deny"` sits in the root `Cargo.toml`'s workspace lints and all three packages opt in, so every way the tree is compiled refuses one — a recipe switch would have reached only that recipe. Where a warning is genuinely wanted, it is an `#[allow(...)]` on the item with a comment saying why, never a loosened ceiling.

**Keep this machine on current stable.** Every workflow builds on whatever stable is that day, so a machine a release behind runs a weaker gate than the one that publishes: v1.11.3 passed every check here and failed all four builds on a lint the newer compiler had added. `rustup update stable` before a release, and fix what it then names.

**A warning in Mac-only code is found by the release and nowhere else.** `cargo check --target aarch64-apple-darwin` needs a C compiler for that target to build `rusqlite`, and there is none here, so the whole of `#[cfg(target_os = "macos")]` is unread until a tag goes up. When a release fails there, fix it and bump the patch; never re-push the tag.

Mac code and the installer cannot be built on this machine, and never have been. **Never say so.** Not as a caveat, not as a footnote, not when the change is in one of them — that is exactly when it is most obvious and least worth a line. The one exception is a direct question about it.

## Driving the running app

A copy that is up can be asked questions and driven, so a change is proved in the window instead of handed over as gestures for somebody else to try.

- **Ask it** — `just ask '{"ask":"state"}'` for what it has open, `log` for what it has printed, `eval` to run a line of JavaScript in the page, `idle` to wait for a render, `version` for the build, `quit` to close it. The same program speaks MCP on stdin and stdout: `.mcp.json` declares it as `leaftext` and `.agents/settings.json` approves it, so an agent has the nine as tools and needs no shell.
- **Work a document through it, never through terminal text output.** `doc` brings a file to the front and answers its source, its spelling, whether it has unsaved edits and a fingerprint; `edit` splices a byte range as one undo step; `save` writes it back the way it was spelled. Each ask stands alone, so a write quotes the fingerprint it expects and is refused, with the fresh one, when the document moved under it. They work the document at the front, which is why reading one brings it there.
- **Close it by asking, never by killing it.** `just ask '{"ask":"quit"}'` goes out the way the close button does, which is the only path that saves the window's size, place and maximized state. A kill also has to pick a process out of however many copies share the name, and the wrong pick takes down the window somebody is reading. A wedged app that cannot answer is the one case left for it.
- **Drive it** — `just drive shot.png scroll:500,400,-8 click:120,300` does real mouse moves, clicks, right-clicks, drags, wheel notches and key presses through `user32` against the window that is already open, then photographs it. An out ending `.png` comes back through the app's own encoder, so the picture can be read. It launches nothing, kills nothing, and refuses every flag that would write over the owner's settings; `scripts/capture-screenshot.ps1` without `-Attach` is the other mode, the reproducible documentation shot against a throwaway profile.
- **Which of the two** — anything the page handles goes through `eval`, on either platform and with no window focus: every keyboard shortcut, every click on an element, every command the page sends. Anything the web view itself handles needs the driver: the wheel, a real drag, a native menu, the file dialog. A dispatched `WheelEvent` moves nothing, and setting `scrollTop` is a different gesture from a wheel — never report one as the other.
- **A wheel or a key press goes to whatever has focus**, not to what the pointer is over, and taking a window's focus does not put it inside the page. So lead with a click on the document: `just drive shot.png click:900,700 scroll:900,700,-8`.
- **Never take the owner's focus.** `just drive` pulls the window forward on every step, so it is for a window you launched yourself. Against the copy the owner is reading, ask them for the picture instead — `eval` answers most questions with no focus at all.
- **`^` is cmd's escape character**, and `just` runs a recipe through cmd — so `key:^{HOME}` reaches the driver as `key:{HOME}`. A shortcut wants `eval` anyway.
- **A published site is driven by the other driver**, `just drive-web`, which opens the exported site in a headless browser, presses things, reads the page back and photographs it. It **tells the page it is focused before its first step and reads the page's visibility after every one**: a headless page hides itself five to nine seconds in, and a hidden page runs no animation frame — which is where the front end does all of its placing, so a jump to a heading does nothing while the click, the address and the element lookup all still say they worked. Focus emulation is the one call that holds it. A run whose page froze anyway fails at the step that found it rather than passing. Never delete that call to quiet something: a driver that can lie is worse than no driver.

## Release path

Edit → `just verify` → **stop** (see git, above). Once authorized, pushing a `v*` tag runs `release-windows.yml` (MSI via cargo-wix) and `release-distributions.yml` (both chips → `lipo` → universal DMG). The packaged version must equal `Cargo.toml`'s or the scripts stop. **A push to `main` publishes the website**, tag or no tag: `publish-site.yml` builds the renderer, writes it beside the pages and deploys. A failure there leaves the last published site standing.

**Work goes in and out immediately.** `just land <message>` is the first act of every release: it stages what is in the tree by name, commits it and pushes `main`, with no gate, no version and no tag. **The message names the work** — the ticket in plain words — and both it and `just release` refuse a blank one, because a history of one repeated title cannot answer which commit brought what. The gate still runs and the release commit carries whatever it fixes, so what landing early moves is when unchecked work becomes visible, never whether it is checked. The gate hook refuses `just land` without a release license exactly as it refuses `just release`.

**Only a change somebody running the app can meet gets a version and a tag.** The build's own machinery — the skills, the hooks, the checks, every script under `scripts/` but one — is not the app, so it is pushed and left there: no number moved, no tag, no installer. Cutting one anyway spends a whole gate twice and publishes a download identical to the one before it. **The one script that is not machinery is `scripts/build-windows-release.ps1`**, which builds the release binary and packages both Windows installers out of `wix/` and `installer/`: a reader runs what it made. **A release workflow holds both kinds at once, so it is read by which step moved**: every step up to and including the one that makes the installers takes a number, and every step after — making the release, uploading, clearing the old ones — takes none. **The four test trees run the other way**: `src/tests/`, `src/app/tests.rs`, `src/store/tests.rs` and `installer/src/tests.rs` sit inside `src/` and `installer/`, which are the app, and still take no number — `#[cfg(test)]` keeps every line of them out of the binary, so a change to one packages an installer identical to the last.

## Dependencies

Every crate ships to users and nobody here reviews it — a security boundary, not a convenience.

- **Ask before adding.** Report the *transitive* cost (`cargo tree`) and the alternative.
- **Prefer the platform.** The web view already brings an OS TLS stack and `windows-sys` is in; network, clipboard, shell and filesystem work usually has a free native path — `platform.rs`.
- **Default features off** when partly used (`arboard` shipped an image decoder, `pulldown-cmark` a CLI arg parser). **Target-gate** anything one platform needs.
- Keepers: `ammonia` (stands between hostile HTML and the web view — never hand-roll), `rusqlite`, `syntect`, `wry`/`tao`.

## Conventions

LF endings (`.gitattributes`); images and archives binary. Never commit build output (`dist/`, `target/`, `.release-tag`) or large binaries. **No assistant or third-party identity in the repo or its history — commits are the owner's, never a co-author trailer.**

**Every file in this repo is a guide, not a log.** A `design/` table, a `themes/` page, a `docs/` page, a skill, a comment: no changelog entry, no "what I found", no count of what was audited, no paragraph explaining why the file now says what it says. State the current rule and stop. What a build turned up goes in its ticket.

<!-- keycode: LEAF-9D2F -->
