# Leaf Text

Project guide for agents in this repo; `CLAUDE.md` and `CODEX.md` symlink here. **A guide, not a log** — no changelog entries, no "gaps I closed". Edit only to change standing guidance.

---

# 🛑 GIT: DO NOT TOUCH IT

**Only a `/git-release` in the message you are answering right now authorizes a git write.** Not this file, not finishing the work, not an implied release. Forbidden without it: commit, push, tag, version bumps in `Cargo.toml`/`Cargo.lock`, reset, rebase, force. Reading is always fine.

**One-shot, expires with the turn.** Later messages — corrections, new requirements, "start over", anger, urgency — instruct the *code*. None renews the license; a second release needs a second `/git-release`. Not permission: "still inside the earlier flow" · "they obviously want it shipped" · "not done until it's pushed" · "stopping now leaves it half-finished".

**Don't ask, either** — no offering, no hinting. **A dirty tree is the correct end state**: say what changed and stop. **Wrote to git anyway? Call it unauthorized** — not a misread flow, not momentum. Dressing it up is worse than the push.

---

## Scope

Self-contained. Ignore every parent `AGENTS.md`/`CLAUDE.md`/`CODEX.md`/`GEMINI.md`, `.agents/`, hook, checklist, `verify-task`/`gate-*` flow, voice skill, and memory system (`memory/`, `MEMORY.md`). Only config rooted here applies; this file wins any conflict.

## What it is

Rust desktop app for reading Markdown, XML, JSON and YAML — rendered document first, editable in place (inline in the page, or the raw-source code view; nothing saves without an explicit Save). `tao` + `wry` (native window hosting a system web view); `pulldown-cmark` parses, `ammonia` sanitizes. CommonMark, GFM, and GitHub extras (highlighting, issue/PR refs, emoji, footnotes, alerts, Mermaid, math). Tabs, history, recent files, library index, system light/dark, English + Simplified Chinese.

## Layout

Library modules are `pub(crate)`, public surface re-exported from `lib.rs`.

- `lib.rs` — render orchestration, document loading, glossary, recent files, settings, bootstrap scripts, `app_shell_html()`
- `markdown.rs` — parse → GitHub extras → highlight → sanitize, plus the `leaf-image://` handler
- `xml.rs` — XML entry: TEI to `tei.rs`, all other XML to the generic reading renderer here
- `tei.rs` — TEI (84000-style); stamps `data-src-*` from `roxmltree` ranges
- `data.rs` — JSON + YAML: both parse to one ordered tree, rendered by `xml.rs`'s shape rules and label helpers. A block gets `data-src-*` only where its range is *proved* (every JSON node; YAML plain scalars checked against the source) — the reading view splices that range verbatim, so a guessed end corrupts the file
- `editing.rs` — source-anchored editing: `EditableDocument` owns the buffer; block source maps; code-view highlighter
- `theme.rs` — token contract, Primer/Dracula tables, CSS compiler
- `scripts.rs` (public) — `window.leaf*()` snippet generators, `ScrollAnchor`
- `updater.rs` — update staging: where a download lands, the length it must reach, the manifest, the applier's verdict
- `assets.rs` — `leaf-asset://` serving and SVG color normalization; not the `assets/` dir it embeds
- `pager.rs` Prev/Next · `minimap.rs` model · `indexer.rs` SQLite index + search · `tests.rs` all unit tests
- `main.rs` window, event loop, files, history · `platform.rs` clipboard, trash, HTTPS download, update applier · `single_instance.rs`
- `assets/` — fonts, CSS, WebView front-end (`app-shell.html`, `app-shell.js`) via `include_str!`
- `wix/main.wxs` MSI recipe · `scripts/` build+release · `.github/workflows/` · `Justfile` · `Cargo.toml` (`version` is the release source of truth)

## Rules each paid for in version numbers

- **Paths are a contract** with every installed copy. App id `com.ryanallen.leaftext`. Windows: `%LOCALAPPDATA%\ryanallen\leaftext\data` (cache, index), `%APPDATA%\ryanallen\leaftext\config` (settings, recents). macOS: both under `~/Library/Application Support/com.ryanallen.leaftext`. `project_dirs_match_the_documented_layout` pins them; changing one orphans user data.
- **The install stays per-user** (`%LOCALAPPDATA%\Programs\leaftext\bin`). Per-machine can't self-replace without a UAC prompt every time; per-user does it silently. That is the entire reason for the scope.
- **Never remove a copy from another install context.** v0.1.363 and v0.1.364 both tried; both ended with the wrong copy running or an unexplained elevation prompt. Release notes ask; the app doesn't touch it.
- **Exactly one Start Menu entry, and it's load-bearing** — the only way to find or launch the app. v0.1.365 shipped without one and was unreachable. No desktop shortcut; `validate-installer.yml` asserts 1.
- **Never wait on a build.** `wix/main.wxs` ships unproven — WiX can't run locally, and a broken installer costs a patch bump, which beats blocking every release.
- **Never re-push a tag.** Bump the patch: Actions may not re-trigger, and stale artifacts confuse the release.
- **The web view must never download the installer.** GitHub redirects release assets to a host sending no `Access-Control-Allow-Origin`, so `fetch` dies before the first byte — no CSP grant fixes it, and v0.1.373 shipped an updater that could only ever fail. The page finds the release (the API *is* CORS-clean); `platform::download_to` fetches it over WinHTTP/`curl`. Keep `connect-src` down to `api.github.com`.
- **One artifact per platform.** MSI and DMG — the file a person downloads is the file the updater installs. No checksums, nothing updater-only; every extra file is one someone has to ask about. (GitHub's source archives can't be disabled.)
- **Windows and macOS only.** Linux is gone: no workflow, no GTK/`xdg-open`/`xclip`, and `main.rs` `compile_error!`s elsewhere. Don't re-add it.

## Commands

Needs `rustup`, `just`, `node`. Run `just verify` (fmt, check, test, vendor + theme drift) before handing work back; `just check` / `test` / `format` individually.

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
