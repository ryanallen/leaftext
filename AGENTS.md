# Leaftext

Project guide for agents in this repo; `CLAUDE.md` and `CODEX.md` symlink here. **A guide, not a log** — no changelog entries, no "gaps I closed". Edit only to change standing guidance.

---

# Rule 1: Talking to the owner

Plain English, few words. No jargon or abbreviations. Lead with the answer, then stop. Keep every response under 500 characters. Same in code comments: one short line, only where the code can't say it.

**A question gets an answer and nothing else.** No suggested next step, no offer to do something, no asking what to do next, no "want me to". A question is not a request to act — answer it and stop. If work is wanted, that will be said.

**No sycophancy.** Never "you're right", "good question", "fair point", "exactly". No praise, no apology, no restating the question back. Never claim agreement to soften an answer. When the answer is no, say no.

---

# 🛑 GIT: DO NOT TOUCH IT

**Only a `/git-release` in the message you are answering right now authorizes a git write.** One-shot; it expires with the turn. `scripts/gate-git.mjs` refuses the write without it, so there is nothing to weigh: **a dirty tree is the correct end state** — say what changed and stop. Don't ask, don't hint, don't offer. Reading git is always fine.

---

## Scope

Self-contained. Ignore the **parent** `Studio/` config — its `AGENTS.md`/`CLAUDE.md`/`CODEX.md`/`GEMINI.md`, its `.agents/`, its hooks, checklist, `verify-task`/`gate-*` flow, voice skill, and memory system (`memory/`, `MEMORY.md`). This repo's own `.agents/` (skills and hooks, below) does apply. Only config rooted here applies; this file wins any conflict.

## What it is

Rust desktop app for reading Markdown, XML, JSON and YAML — rendered document first, editable in place (inline in the page, or the raw-source code view; nothing saves without an explicit Save). `tao` + `wry` (native window hosting a system web view); `pulldown-cmark` parses, `ammonia` sanitizes. CommonMark, GFM, and GitHub extras (highlighting, issue/PR refs, emoji, footnotes, alerts, Mermaid, math). Tabs, history, recent files, vaults, system light/dark. The interface is English only — there is no translation layer, and adding one back is not a small change.

## Layout

**`docs/02-development/01-architecture.md` is the file map** — every module, in more detail than belongs here. The rules that map carries, which no reading of the code will tell you:

- **Both crate roots share `src/`** — `lib.rs` (library) and `main.rs` (binary) — so a bare `mod tests;` in `main.rs` resolves to the library's `src/tests/`. That is why the binary's modules live under `src/app/`.
- Where a subject is a directory, `mod.rs` holds the shared vocabulary and the pipeline that orders the stages; siblings hold one stage each. A directory's **types** stay module-wide (`pub(super)`); functions open up only where something calls them.
- **`format.rs` is the only table of readable formats and their extensions.** A new format is one arm there plus whatever the exhaustive matches then refuse to compile — never a second list.
- **`markdown/rawhtml.rs` is a security boundary** — what raw HTML may keep, standing between hostile input and the web view.
- **`src/assets/shell/` is one scope, not modules.** The fragments concatenate in `APP_SHELL_SCRIPT_PARTS` order, the page has no module loader, so order is load-bearing and a fragment alone is not a valid program. `state.js` is first and holds **only** what more than one fragment touches. The two flowchart fragments are served as `flow.js` over `leaf-asset://` because the shell reaches WebView2 as one string with a ~2 MB ceiling; same scope, same order, just not inside that string — and the next thing to grow goes the same way rather than pushing the budget.
- **Mermaid diagrams take the theme's own tokens**, mapped in `decorate.js`. Never a per-theme diagram palette. The `cScale` categorical scale is ours, named entry by entry, held to one luminance — v0.1.423 shipped near-black boxes with near-black labels by leaving it to mermaid's arithmetic.
- **`themes/` is the source of a color**, compiled into `src/assets/themes.md` by `just bundle-themes`; `just check-themes` fails on drift. `theme.rs` emits a property for any row it finds, so a stale row is dead CSS in every theme.
- **Never crawl the disk.** `folder_tree.rs` reads one folder per call; `vault_corpus.rs` reads one vault; `doc_graph.rs` is bounded by a document's links. See the crawl rule below.

## Skills

In `.agents/skills/`, which `.claude/` and `.codex/` symlink to. Invoke by name.

| skill | when |
| --- | --- |
| `check` | before handing work back. Runs `sync-tests`, then `just verify`, then says what could not be checked here. |
| `sync-tests` | the change needs a test that would have caught it. `check` calls it. |
| `sync-docs` | app behavior changed, or before a release. Edits `docs/`, never git. |
| `code-comments` | the comment bar, in one place: why not what, one line if it fits, cut the drafting history. |
| `git-release` | only on `/git-release`. Runs `sync-docs`, `code-comments` and `check`, then commits, tags and pushes. |

## Hooks

In `.claude/settings.json`, pointing at `scripts/`. Each runs by hand with `--check`, and `just verify` runs both.

- `gate-rules.mjs` on `UserPromptSubmit` — prints Rule 1 out of this file before every message, plus a line for whatever the message touches, and records a `/git-release` in `.tmp/git-license`.
- `gate-git.mjs` on the shell tools — refuses a git write when that file does not say the license was given this turn.

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

Needs `rustup`, `just`, `node`. `/check` is the gate before handing work back: `just verify` (fmt, check, test, vendor + theme drift, US spelling, front-end boot, identity, the two hooks) with a test pass in front of it. `just check` / `test` / `format` / `check-shell` run individually.

**Say what you couldn't verify** — `cfg(target_os = "macos")` code doesn't compile on Windows, and WiX doesn't run locally.

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
