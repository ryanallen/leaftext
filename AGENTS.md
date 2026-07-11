# Leaf Text

This file is the project guide for any coding agent working in this repo. It is the single source of truth; `CLAUDE.md` and `CODEX.md` are symlinks to it.

**This is a guide, not a log file.** Do not add entries describing changes you just made, "known gaps" you closed, or anything else that reads like a changelog. Only edit this file to change standing guidance.

## Scope: this folder only

This repository is self-contained. It may sit inside a larger directory tree that carries its own agent orchestration — parent `CLAUDE.md` / `AGENTS.md` / `CODEX.md` / `GEMINI.md` files, `.agents/` or `.claude/` hooks, skills, checklists, voice rules, memory systems, and the like. **Ignore all of it.** Inside this repo the only agent configuration that applies is the one rooted in this folder: this `AGENTS.md` plus the `.claude/`, `.github/`, and other config directories that live here.

Concretely:
- Do not run, satisfy, or wait on hooks, checklists, or `verify-task` / `gate-*` flows defined in any parent folder. There is no `.tmp/verify-task-checklist.md` step list to follow here.
- Do not apply parent "voice", formatting, or response-style skills. Write plainly.
- Do not read from or write to any parent memory system (`memory/`, `MEMORY.md`). This repo keeps no agent memory.
- Use only the skills, settings, and tooling configured within this folder.

If a parent system's instructions conflict with this file, this file wins inside this repo.

**Git operations - CRITICAL:** 
- NEVER touch git without explicit user instruction in that moment
- Do not commit, push, create tags, bump versions, or use git-release unless the user explicitly tells you to
- Do not infer instruction from past context, ongoing work, or assumed workflow
- Do not ask follow-up questions like "should I commit this?" or "want me to push?" - just don't do it
- Do not engage about git unless the user brings it up
- Do not touch git. Ever. Without being told.
When the user explicitly instructs a git operation, use the `/git-release` skill for version bumps, commits, tag management, and pushes. That skill handles no co-authoring, old tag deletion, lock file sync, and proper tag/push sequencing.

## What Leaf Text is

Leaf Text is a desktop app for reading Markdown: no code editing, just the rendered document. It opens a local Markdown file and shows it in a clean, scrollable reading view with history (Back/Forward), recent files, light/dark themes that follow the system, and English plus Simplified Chinese language modes.

It is a Rust program. The window and the embedded web view come from the `tao` and `wry` crates (a native window hosting a system web view). Markdown is parsed with `pulldown-cmark`, sanitized with `ammonia`, and rendered to HTML that the web view displays. It supports CommonMark, GitHub Flavored Markdown (tables, task lists, strikethrough, autolinks), and GitHub-style extras (syntax highlighting, issue/PR/commit references, emoji, footnotes, alerts, Mermaid diagrams, and math).

## Repo layout

- `src/lib.rs` — the core: `render_markdown_document()` orchestration, document loading, glossary linking, recent files, settings, theme/locale bootstrap scripts, and `app_shell_html()` (which loads the page markup and script from `src/assets/`).
- `src/scripts.rs` — generators for the `window.leaf*(...)` state/navigation JS snippets the host injects (`ScrollAnchor` lives here). Public and re-exported from `lib.rs`.
- `src/pager.rs` — the Previous/Next pager (folder-tree reading order, pager HTML). `pub(crate)` internals with the public entry points re-exported from `lib.rs`.
- `src/minimap.rs` — the document minimap model (`build_minimap_model`, `DocumentMinimap`). `pub(crate)` internals with public model types re-exported from `lib.rs`.
- `src/markdown.rs` — the Markdown pipeline: parsing, GitHub extras, code highlighting, image resolution, HTML sanitizing, title detection, and the `leaf-image://` protocol handler. `pub(crate)` and re-exported from `lib.rs`.
- `src/tei.rs` — the TEI XML renderer (84000-style documents to HTML). Stamps inline `data-src-*` source ranges (via `roxmltree` `Node::range()`) on editable blocks and exposes `tei_block_source_map()` for source-anchored editing. `pub(crate)` and re-exported from `lib.rs`.
- `src/editing.rs` — the source-anchored editing model: `EditableDocument` (Rust owns the authoritative buffer; splice/`toggle_task`/dirty), the block source maps (`block_source_map` for Markdown, `tei_block_source_map` for XML), `task_marker_offsets`, and the code-view source highlighter. `pub(crate)` plus the public editing types re-exported from `lib.rs`.
- `src/assets.rs` — bundled-asset serving (`leaf-asset://` Mermaid/KaTeX runtimes) and SVG icon color normalization. `pub(crate)` (plus public `bundled_asset_response`) and re-exported from `lib.rs`. Distinct from the `src/assets/` directory it embeds.
- `src/theme.rs` — the theme system: semantic token contract, Primer/Dracula token tables, `ThemeSource` types, and the CSS compiler (`compiled_theme_css()`, `reading_mode_css()`). `pub(crate)` and re-exported from `lib.rs`.
- `src/tests.rs` — the crate's unit tests (a `#[cfg(test)] mod tests` file, not inline in `lib.rs`).
- `src/main.rs` — the app shell: window, event loop, file open/close, history, and the per-user data directory.
- `src/indexer.rs` — background SQLite library indexer and full-text search.
- `src/assets/` — fonts, CSS, and the WebView front-end (`app-shell.html`, `app-shell.js`) embedded via `include_str!`.
- `wix/main.wxs` — the Windows installer recipe (used by cargo-wix to build the MSI).
- `scripts/` — `prepare-release.mts` (cut a release), `build-windows-release.ps1`, `build-linux-release.sh`.
- `.github/workflows/` — three release workflows (Windows, macOS, Linux).
- `Justfile` — task runner recipes.
- `Cargo.toml` — package metadata. `version` here is the source of truth for the release version.

## App identity

- App id: `com.ryanallen.leaftext`.
- Windows per-user data (web view cache, recent files) lives under `%LOCALAPPDATA%\ryanallen\leaftext`.
- Installed Windows path: `C:\Program Files\leaftext\bin\leaftext.exe`.

## Everyday commands

Run from the repo root. These need the Rust toolchain (`rustup`), `just`, and `node` installed.

- `just verify` — format check, `cargo check`, and tests. Run this before handing work back.
- `just check` / `just test` / `just format` — the individual steps.

## How a change flows to a release

1. Edit the code. Rendering and parsing live in `src/lib.rs`; window and file handling live in `src/main.rs`.
2. `just verify` to confirm it builds and tests pass.
3. **DO NOT TOUCH GIT.** Wait for explicit instruction to commit or release. Do not assume you should commit work. Do not ask if you should commit. Do not offer to commit. Only commit when told "commit this" or "release v0.x.x". When told to release: use `/git-release` skill to bump version, create tag, and push.

Pushing a tag named `v*` is what starts the builds. The three workflows each build on a GitHub runner and attach the installers to the release for that tag:

- Windows (`release-windows.yml`, `windows-latest`): builds `leaftext.exe` and packages a single MSI installer with cargo-wix.
- macOS (`release-distributions.yml`, `macos-14`): builds both chips, joins them into a universal binary, and makes a single universal DMG.
- Linux (`release-linux.yml`, `ubuntu-latest`): builds and publishes a single bare `x86_64` binary.

Each release also carries GitHub's automatic source archives (zip + tar.gz).

The packaged version must equal the `Cargo.toml` version, or the build scripts stop with an error.

**Never re-push the same version tag.** If a build fails or you need another iteration, bump to the next patch version and start over. Reusing a tag is unreliable — GitHub Actions may not re-trigger, and the old release artifacts create confusion.

## Conventions

- Line endings are LF (see `.gitattributes`). Images and archives are binary.
- Do not commit build output. `dist/`, `target/`, and `.release-tag` are ignored.
- Do not commit large binaries.
- Keep commit history and the repo free of any third-party tool or assistant identity. Author commits as the repo owner only. Never add co-author or assistant trailers to commit messages.

## ABSOLUTE RULE: DO NOT TOUCH GIT

Do not make any git operations without explicit instruction. This includes:
- Do not commit file changes
- Do not push to remote
- Do not create or delete tags
- Do not bump version numbers in Cargo.toml or Cargo.lock
- Do not use git-release or any git command

If you finish a task and there are uncommitted changes, leave them. Do not ask if you should commit. Do not suggest committing. Do not offer to push. Wait for explicit instruction like "commit this" or "release v0.x.x". Only then act.