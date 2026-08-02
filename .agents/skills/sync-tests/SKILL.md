---
name: sync-tests
description: Make the tests match the code, the way sync-docs makes the docs match the app. Names the test that covers each change, writes the ones that are missing, and says what cannot be tested when the change is in something this machine cannot run (Mac-only code, the installer, the GitHub workflows). With no argument it works the uncommitted diff; pass a path to audit a file or folder whether or not it changed, or a git ref to work everything since it. Runs `cargo test` and `just check-shell` and never touches git. Use when the user says "sync the tests", "what test covers this", "is this tested", or before a release.
argument-hint: "[path | since-ref]"
user-invocable: true
---

# Sync Tests

`just verify` runs the tests that exist. Nothing asks whether the change made one
necessary. This skill is that question.

Two things it rules out: shipping a fix with no test that would have caught it, and
calling a change verified when the only thing proved is that the old tests still
pass.

**Never run git beyond reading** — no commit, no stash, no checkout. Releasing is
`/git-release`.

## When to run

- Before handing work back, and before a release. `/check` calls it, so a release
  gets it without being asked.
- On a file that feels under-covered, whether or not it changed:
  `/sync-tests src/editing.rs`.

## Inputs

1. **Path** (optional): a file or folder to audit as it stands.
2. **Since-ref** (optional): a git ref to diff against (e.g. `v0.1.440`).
3. **Neither**: the uncommitted diff plus the last few commits.

```bash
git status --porcelain              # uncommitted
git diff --name-only HEAD~5..HEAD   # recent
```

## Where a test goes

| changed | test |
| --- | --- |
| `src/**.rs` (library) | `src/tests/`, one file per subject — add the `mod` line in `src/tests/mod.rs` if the subject is new |
| `src/app/**.rs` (binary) | `src/app/tests.rs` |
| `src/assets/shell/*.js` | `scripts/check-shell.mjs` |
| `src/assets/reading.css`, `src/theme.rs`, `themes/` | `src/tests/reading_css.rs`, `src/tests/theme_registry.rs`, and `just check-themes` |
| a new `scripts/*.mjs` | its own `--check` mode, and a line in `just verify` |
| `wix/`, `.github/workflows/` | **cannot be run here** — say so instead of pretending |

The subject files today: `app_shell_chrome` `app_shell_library` `app_shell_reader`
`app_shell_scripts` `code_intel` `data_xml` `doc_graph` `editing` `eml` `encoding`
`folder_tree` `git` `glossary` `images` `indexer_pager` `markdown_code`
`markdown_github` `markdown_rawhtml` `markdown_render` `minimap` `png`
`reading_css` `settings_paths` `theme_registry` `updater` `vault_corpus`. Shared
helpers are in `src/tests/mod.rs` — use them rather than writing a second
`assert_contains`.

## Process

### 1. Find what changed

The diff, per file. For each changed function, ask what a caller would get wrong if
this code were wrong.

### 2. Name the test that covers it

Search the suite for it before writing anything:

```bash
grep -rn "<function or behavior>" src/tests/ src/app/tests.rs scripts/check-shell.mjs
```

Report one row per change: the change, the test that covers it, or **missing**.
A test that only proves the code runs is missing.

### 3. Write the missing ones

- **One test, one claim**, named as a sentence about behavior:
  `a_staged_update_installs_itself_at_launch_but_only_once`,
  `the_vaults_text_is_patched_for_every_format_the_watcher_reports`. Not
  `test_updater`.
- **Test the rule, not the implementation.** A test that mirrors the code line for
  line fails on a rewrite that changed nothing a user sees.
- **Cover what it cost.** A bug fixed in a version gets a test named after what
  went wrong, so the same regression cannot ship twice.
- Put it in the subject's file, beside its neighbors, and match their style. A new
  subject file needs its `mod` line in `src/tests/mod.rs`.
- Front-end behavior goes in `scripts/check-shell.mjs`, which boots the fragments
  in order against a stand-in page — a fragment that throws as it loads fails there
  rather than opening a blank window.

### 4. Run them

```bash
cargo test
node scripts/check-shell.mjs
```

Both, every time — a Rust change can break the front-end check through
`app_shell_html()`.

### 5. Say what cannot be tested — about this change, not in general

If the change you audited is in one of these, say so and say which part is unproven:

- Mac-only code: it does not compile on Windows, so its tests do not run here.
- The installer recipe under `wix/`: no local runner, so it ships unproven.
- The GitHub workflows: they only run on GitHub.
- Anything needing a real window, live selected text, or a held pointer.

If the change is in none of them, say nothing about them. A list repeated on every
hand-back is a list nobody reads.

### 6. Hand back

Leave the tests uncommitted. Say which files gained a test, which changes are
covered by an existing one, and what is left untestable here.

## Reference

- `src/tests/mod.rs` — the module list and the shared helpers.
- `src/app/tests.rs` — the binary's tests: tabs, history, watching, link routing,
  file actions.
- `scripts/check-shell.mjs` — the front-end's boot and edit-offset checks.
- `/check` — runs this, then `just verify`.
- `/git-release` — the only thing that touches git.
