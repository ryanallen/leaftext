# Leaftext

Project guide for agents in this repo; `CLAUDE.md` and `CODEX.md` symlink here. **A guide, not a log** — no changelog entries, no "gaps I closed". Edit only to change standing guidance.

---

# Rule 1: Talking to the owner

Plain English, few words. No jargon or abbreviations. Lead with the answer, then stop. Keep every response under 500 characters. Same in code comments: one short line, only where the code can't say it.

**A question gets an answer and nothing else.** No suggested next step, no offer to do something, no asking what to do next, no "want me to". A question is not a request to act — answer it and stop. If work is wanted, that will be said.

**No sycophancy.** Never "you're right", "good question", "fair point", "exactly". No praise, no apology, no restating the question back. Never claim agreement to soften an answer. When the answer is no, say no.

**Say it in words the owner uses.** Not the code's names for things, not the build's, not a phrase that needs the repo open to parse. If a thing has to be named, say what it does in the same breath. And never pad a reply with a caveat that is true every single time — it teaches the reader to skip everything you write.

**A paragraph is one line.** Never hard-wrap — not in a reply, a ticket, a skill, a doc page, this file, or a comment in the code. Everything that reads them reflows: the app's own renderer, GitHub, every editor. A wrap costs on every edit after it, because a word added in the middle has to be re-flowed by hand and a one-word change diffs as the whole paragraph. `just check-wrapping` fails on one and names the file; `--fix` joins them, in Markdown and in `.rs`/`.js` comments alike. A break doing real work stays: two trailing spaces in Markdown, any indent of its own in a comment — a command, a table, a list — or `<!-- keep-wrapping -->` on a whole file.

**US spellings, never British.** In a reply, in a comment, in a ticket, in a commit message — "favorite", "color", "canceled". `just check-spelling` fails on one and names the line; it reads this repo and the plan tree next door — the index, the running order, the glossary and every live ticket.

**Never invent a reason.** A cost, a limit, a risk — say it only if it is real and it actually applies here. Dressing an option up as expensive to steer the answer is lying, even when every word is separately true. Check the constraint against this repo before you spend it: the ~2MB ceiling is on the inline page script, so a vendored file does not pay it. If you don't know the cost, say you don't know.

**Every choice you hand over comes with a recommendation.** Asking which way to go is not neutral — you have read the code and the owner has not. So each option gets what it wins, what it costs, and one of them is marked the pick with the reason it is the pick. Say why the choice matters at all, or don't ask: a question the owner cannot see the stakes of is one they have to do your reading to answer. Never a bare list of options.

**When told you got it wrong, skip the response and do the work.** Don't own it, don't explain it, don't say what you meant, don't list the parts you got right. No sentence about the mistake at all — it was already said, repeating it back wastes the reply. Start at whatever comes after.

---

# 🛑 GIT: DO NOT TOUCH IT

**Only a `/git-release` in the message you are answering right now authorizes a git write.** One-shot; it expires with the turn. `scripts/gate-git.mjs` refuses the write without it, so there is nothing to weigh: **a dirty tree is the correct end state** — say what changed and stop. Don't ask, don't hint, don't offer. Reading git is always fine.

---

## Scope

Self-contained. Ignore the **parent** `Studio/` config — its `AGENTS.md`/`CLAUDE.md`/`CODEX.md`/`GEMINI.md`, its `.agents/`, its hooks, checklist, `verify-task`/`gate-*` flow, voice skill, and memory system (`memory/`, `MEMORY.md`). This repo's own `.agents/` (skills and hooks, below) does apply. Only config rooted here applies; this file wins any conflict.

## What it is

Rust desktop app for reading Markdown, XML, JSON and YAML — rendered document first, editable in place (inline in the page, or the raw-source code view; nothing saves without an explicit Save). `tao` + `wry` (native window hosting a system web view); `pulldown-cmark` parses, `ammonia` sanitizes. CommonMark, GFM, and GitHub extras (highlighting, issue/PR refs, emoji, footnotes, alerts, Mermaid, math). Tabs, history, recent files, vaults, system light/dark. The interface is English only — there is no translation layer, and adding one back is not a small change.

## Layout

**[`docs/02-development/01-architecture.md`](docs/02-development/01-architecture.md) is the file map** — every module, in more detail than belongs here. The rules that map carries, which no reading of the code will tell you:

- **Both crate roots share `src/`** — `lib.rs` (library) and `main.rs` (binary) — so a bare `mod tests;` in `main.rs` resolves to the library's `src/tests/`. That is why the binary's modules live under `src/app/`.
- Where a subject is a directory, `mod.rs` holds the shared vocabulary and the pipeline that orders the stages; siblings hold one stage each. A directory's **types** stay module-wide (`pub(super)`); functions open up only where something calls them.
- **`format.rs` is the only table of readable formats and their extensions.** A new format is one arm there plus whatever the exhaustive matches then refuse to compile — never a second list.
- **`markdown/rawhtml.rs` is a security boundary** — what raw HTML may keep, standing between hostile input and the web view.
- **`src/assets/shell/` is one scope, not modules.** The fragments concatenate in `APP_SHELL_SCRIPT_PARTS` order and are **served as `app.js` over `leaf-asset://`**, behind the page's one script tag — the page reaches WebView2 as one string with a ~2 MB ceiling, and the script was 88% of it. There is no module loader, so order is load-bearing and a fragment alone is not a valid program: `journal.js` leads (its error handlers are the only thing that sees a later fragment throw as it loads, and it must reach `window.ipc` directly — `send` in `dom.js` is a `const` in its dead zone until then), the flowchart pair follows (everything else calls into it), `state.js` after that and holding **only** what more than one fragment touches, and the last fragment ends with the bootstrap call. Nothing is substituted into the script, which is why it can be a file at all.
- **Mermaid diagrams take the theme's own tokens**, mapped in `decorate.js`. Never a per-theme diagram palette. The `cScale` categorical scale is ours, named entry by entry, held to one luminance — v0.1.423 shipped near-black boxes with near-black labels by leaving it to mermaid's arithmetic.
- **`design/` is the source of a token, `themes/` of a color's value.** [`design/colors.md`](design/colors.md) lists the 82 names and compiles to the contract in `theme.rs`; [`design/tokens.md`](design/tokens.md) holds the other 162 values and compiles to `src/assets/tokens.css`; [`design/icons.md`](design/icons.md) lists the icons and compiles to `src/assets/icons.css`, one `.lt-icon-*` mask class each; [`design/components.md`](design/components.md) is a row per component, with the markup it is drawn with. `gallery.html` — every theme, color, icon and component on one page, at leaftext.com — is built from all four; it is a page in the repo, not a feature in the app. `just bundle-tokens`, `bundle-icons`, `bundle-gallery` and `bundle-design-docs` generate; their `check-` twins fail on drift, on a theme row nobody lists, on an SVG with no row, and on a component with no sample to draw it with. [`themes/`](themes/README.md) holds the values — one file per family, all eleven linked from that folder's own page — compiled by `just bundle-themes`. Never edit a generated file. `theme.rs` emits a property for any row it finds, so a stale row would be dead CSS in every theme.
- **An icon reaches the page as a name, not a drawing** — `<span class="lt-icon lt-icon-back">` — so one used five times is in the app once. A mask reads only alpha, so the control's own `currentColor` paints it, and a control with a bolder active state swaps to a second mask (`--lt-icon-*-heavy`) rather than thickening a stroke a mask does not have — the same reason a `stroke-width` in `reading.css` aimed at an `.lt-icon` does nothing. Even the broken-image mark is a mask: it stays an `<img>` so a later fetch can go back to its own source, with `src` on a transparent pixel purely to stop the platform drawing its glyph over ours. **The line weight is `design/icons.md`'s, not the drawing's** — a `Stroke` cell per row, one of three named weights, stamped over whatever the file was saved at; `just check-icons` names a file that disagrees. Seven weights had drifted in before that column existed.
- **Every class in `reading.css` is accounted for in `design/components.md`** — as a component (with the markup the gallery draws it with), as something a rendered document brings, or as a state. `just check-classes` fails on one that is not, so new interface joins the design system rather than growing beside it, and a component that appears there appears in the gallery by existing.
- **No hand-written value in `reading.css`.** A color, spacing, text size, weight, stroke, line height, letter spacing, opacity, duration, easing, shadow or layer comes from a token; `just check-literals` fails on one and names the line. Widths, heights, positional offsets and a document's `em` sizing are not tokens — they are one component's geometry, or they follow the text.
- **Never crawl the disk.** `folder_tree.rs` reads one folder per call; `vault_corpus.rs` reads one vault; `doc_graph.rs` is bounded by a document's links. See the crawl rule below.

## Skills

In [`.agents/skills/`](.agents/skills/), which `.claude/` and `.codex/` symlink to. Invoke by name; each row links the file that defines it.

| skill | when |
| --- | --- |
| [`check`](.agents/skills/check/SKILL.md) | before handing work back. Runs `sync-tests`, then `just verify`, and names anything the change left untested. |
| [`sync-tests`](.agents/skills/sync-tests/SKILL.md) | the change needs a test that would have caught it. `check` calls it. |
| [`sync-docs`](.agents/skills/sync-docs/SKILL.md) | app behavior changed, or before a release. Edits `docs/` and the ticket index next door, never git. |
| [`code-comments`](.agents/skills/code-comments/SKILL.md) | the comment bar, in one place: why not what, one line if it fits, cut the drafting history. |
| [`design-tokens`](.agents/skills/design-tokens/SKILL.md) | changing how the app looks. A value goes in `design/`, never into a rule. |
| [`add-dependency`](.agents/skills/add-dependency/SKILL.md) | a new crate. Reports what it drags in, then asks. |
| [`add-format`](.agents/skills/add-format/SKILL.md) | teaching the app another file type. One arm in `format.rs`. |
| [`shell-fragment`](.agents/skills/shell-fragment/SKILL.md) | adding, splitting or reordering a front-end fragment. Order is load-bearing. |
| [`ticket`](.agents/skills/ticket/SKILL.md) | scoping work instead of building it. Writes a phased plan with checkboxes into a subject folder under `../docs/features/`, `../docs/refactor/` or `../docs/fixes/`, and keeps `../docs/README.md` — the one line per ticket that says what shipped, what is planned and what was turned down. Read that index before planning anything; it is the only thing standing between a new plan and one this tree already answered. |
| [`pm`](.agents/skills/pm/SKILL.md) | deciding what to build next. Ranks every live ticket into one running order and writes it to `../docs/PLAN.md` — wrong today first, then what other tickets are waiting on, then cost. It does not retire a row: `pre-release` moves a shipped one to `../docs/done/PLAN.md`, so this list is the length of the work that is left. |
| [`design`](.agents/skills/design/SKILL.md) | designing a ticket before anyone builds it. Opens every line it cites, holds the plan against the rules here, fixes it, dates the top of the file, and records what was wrong. |
| [`dev`](.agents/skills/dev/SKILL.md) | building a ticket somebody already planned. Runs `design` first if nothing has dated the file, then works the phases in order, ticks the boxes, drives what it can reach in the running window, and **stops at the owner's own box**. It closes nothing and moves nothing — a machine agreeing with itself is not evidence. |
| [`pre-release`](.agents/skills/pre-release/SKILL.md) | the owner has said a built ticket works. **The only thing that closes a ticket**: ticks that last box, writes the shipped note, moves the file into `../docs/done/`, rewrites its index row, moves its running-order row across, fixes any published page the work made untrue, then runs `sync-docs`, `code-comments`, `check` and `pm`. Never git. |
| [`git-release`](.agents/skills/git-release/SKILL.md) | only on `/git-release`. Runs `pre-release` on any ticket waiting only on the owner's box — asking for the release is the sentence — then `sync-docs`, `code-comments` and `check`, then commits, tags and pushes. |

## Hooks

In [`.agents/settings.json`](.agents/settings.json) — `.claude/settings.json` is the same file through the symlink — pointing at `scripts/`. Each runs by hand with `--check`, and `just verify` runs all four.

- `gate-rules.mjs` on `UserPromptSubmit` — prints Rule 1 out of this file before every message, plus a line for whatever the message touches, and records the license in `.tmp/git-license`. Granted only when the message **starts** with `/git-release`: matching it anywhere let a message that merely quoted the string release v0.1.442. It also keeps the last 20 raw payloads in `.tmp/prompt-payloads.jsonl`, untracked — the license turns on what the host puts in `prompt`, and a turn where that went wrong is otherwise unreconstructable.
- `gate-git.mjs` on the shell tools — refuses a git write when that file does not say the license was given this turn.
- `gate-voice.mjs` on `Stop` — refuses to end the turn on a reply over Rule 1's 500-character ceiling, or one opening with praise or an apology, or one that has not reported this turn's keycodes. Only the countable half of Rule 1; the rest stays a reminder. Printing the rule every turn was not enough on its own, which is why this exists. It measures each block of the reply on its own, and **waits for the last one to reach the transcript** — reading the transcript the instant the turn ends caught only the short lines said between tool calls, which is how a 952-character sign-off went out unrefused.
- `gate-keycode.mjs` — proof the rules were read rather than remembered. This file and every `SKILL.md` ends with a keycode in an HTML comment. Each message owes this file's, plus the keycode of any skill it names with a slash, reported with `node scripts/gate-keycode.mjs <file> <code>`; the Stop hook holds the turn until all of them are in. The record is one file in the OS temp folder, cleared at the start of every message, so it never grows and never reaches a context window. A wrong code is refused, and `just verify` fails on a keyed file with no code or two files sharing one.

## Rules each paid for in version numbers

- **Paths are a contract** with every installed copy. App id `com.ryanallen.leaftext`. Windows: `%LOCALAPPDATA%\ryanallen\leaftext\data` (`manifest.db`, staged updates), `%APPDATA%\ryanallen\leaftext\config` (settings, recents). macOS: both under `~/Library/Application Support/com.ryanallen.leaftext`. `project_dirs_match_the_documented_layout` pins them; changing one orphans user data.
- **`manifest.db` is not a cache any more.** It holds the vault registry and nothing else, so losing it loses which folders the user called vaults. It keeps the old file name because every installed copy already has one at that path. Anything that reads a document reads the disk — the database is never asked what is in a file.
- **The install stays per-user** (`%LOCALAPPDATA%\Programs\leaftext\bin`). Per-machine can't self-replace without a UAC prompt every time; per-user does it silently. That is the entire reason for the scope.
- **Never remove a copy from another install context.** v0.1.363 and v0.1.364 both tried; both ended with the wrong copy running or an unexplained elevation prompt. Release notes ask; the app doesn't touch it.
- **Exactly one Start Menu entry, and it's load-bearing** — the only way to find or launch the app. v0.1.365 shipped without one and was unreachable. No desktop shortcut; `validate-installer.yml` asserts 1.
- **Never wait on a build.** `wix/main.wxs` ships unproven — WiX can't run locally, and a broken installer costs a patch bump, which beats blocking every release.
- **Never re-push a tag.** Bump the patch: Actions may not re-trigger, and stale artifacts confuse the release.
- **The web view must never download the installer.** GitHub redirects release assets to a host sending no `Access-Control-Allow-Origin`, so `fetch` dies before the first byte — no CSP grant fixes it, and v0.1.373 shipped an updater that could only ever fail. The page finds the release (the API *is* CORS-clean); `platform::download_to` fetches it over WinHTTP/`curl`. Keep `connect-src` down to `api.github.com`.
- **One artifact per platform.** MSI and DMG — the file a person downloads is the file the updater installs. No checksums, nothing updater-only; every extra file is one someone has to ask about. (GitHub's source archives can't be disabled.)
- **Windows and macOS only.** Linux is gone: no workflow, no GTK/`xdg-open`/`xclip`, and `main.rs` `compile_error!`s elsewhere. Don't re-add it.
- **Never crawl the device.** There was a background indexer that walked every drive to build a manifest of every Markdown file, and it failed on both platforms it shipped to: on macOS it wanders into `~/Documents`, `~/Desktop`, iCloud and the rest, each its own TCC consent gate, so it collects a couple of approvals, is refused the others, and *looks* like it stopped; on Windows there is nothing to refuse it, so it grinds through the whole disk — four parse threads, hashing every file — while someone is trying to read. Migration 6 drops what it built. What replaced it reads only what the user pointed at: one folder for the pane, one vault for the graph and search. A folder chosen through the file dialog carries its own macOS consent, which is the other half of why this works.

## Commands

Needs `rustup`, `just`, `node`. `/check` is the gate before handing work back: `just verify` (fmt, check, test, vendor + theme + token + icon + gallery + docs drift, no hand-written values, US spelling, no hard-wrapped paragraph, every Markdown file has something keeping it true, no shipped plan left in a live folder, every path the published pages fetch is a file, front-end boot, identity, the two hooks) with a test pass in front of it. `just check` / `test` / `format` / `check-shell` run individually.

Mac code and the installer cannot be built on this machine, and never have been. **Never say so.** Not as a caveat, not as a footnote, not "it ships unproven", not when the change is in one of them — that is exactly when it is most obvious and least worth a line. GitHub builds both on a tagged release and a break shows up there. It is true every single time, so saying it is the padding Rule 1 refuses. The one exception is a direct question about it.

## Driving the running app

A copy that is up can be asked questions and driven, so a change is proved in the window instead of handed over as gestures for somebody else to try.

- **Ask it** — `just ask '{"ask":"state"}'` for what it has open, `log` for what it has printed, `eval` to run a line of JavaScript in the page, `version` for the build. The same program speaks MCP on stdin and stdout: `.mcp.json` at the repo root declares it as `leaftext` and `enabledMcpjsonServers` in `.agents/settings.json` approves it, so an agent has the four as tools and needs no shell at all. `scripts/check-mcp.mjs` holds the wrapper, that registration and `src/pipe.rs` to each other.
- **Drive it** — `just drive shot.png scroll:500,400,-8 click:120,300` does real mouse moves, clicks, right-clicks, drags, wheel notches and key presses through `user32` against the window that is already open, then photographs it. An out ending `.png` comes back through the app's own encoder, so the picture can be read. It launches nothing and kills nothing, and it refuses every flag that would write over the owner's settings — `scripts/capture-screenshot.ps1` without `-Attach` is the other mode, the reproducible documentation shot against a throwaway profile. `just check-driver` reads the step list back with no app running.
- **Which of the two** — anything the page handles goes through `eval`, on either platform and with no window focus: every keyboard shortcut, every click on an element, every command the page sends. Anything the web view itself handles needs the driver: the wheel, a real drag, a native menu, the file dialog. A dispatched `WheelEvent` moves nothing, and setting `scrollTop` is a different gesture from a wheel — never report one as the other.
- **A wheel or a key press goes to whatever has focus**, not to what the pointer is over, and taking a window's focus does not put it inside the page. So lead with a click on the document: `just drive shot.png click:900,700 scroll:900,700,-8`. Without it the notches go somewhere else and the app sits exactly where it was. The driver refuses outright when Windows will not bring the window forward at all.
- **`^` is cmd's escape character**, and `just` runs a recipe through cmd — so `key:^{HOME}` reaches the driver as `key:{HOME}`. A shortcut wants `eval` anyway.

## Release path

Edit → `just verify` → **stop** (see git, above). Once authorized, pushing a `v*` tag runs `release-windows.yml` (MSI via cargo-wix) and `release-distributions.yml` (both chips → `lipo` → universal DMG). The packaged version must equal `Cargo.toml`'s or the scripts stop.

## Dependencies

Every crate ships to users and nobody here reviews it — a security boundary, not a convenience.

- **Ask before adding.** Report the *transitive* cost (`cargo tree`) and the alternative.
- **Prefer the platform.** The web view already brings an OS TLS stack and `windows-sys` is in; network, clipboard, shell, and filesystem work usually has a free native path — `platform.rs`.
- **Default features off** when partly used (`arboard` shipped an image decoder, `pulldown-cmark` a CLI arg parser). **Target-gate** anything one platform needs.
- Keepers: `ammonia` (stands between hostile HTML and the web view — never hand-roll), `rusqlite`, `syntect`, `wry`/`tao`.

## Conventions

LF endings (`.gitattributes`); images and archives binary. Never commit build output (`dist/`, `target/`, `.release-tag`) or large binaries. **No assistant or third-party identity in the repo or its history — commits are the owner's, never a co-author trailer.**

<!-- keycode: LEAF-9D2F -->
