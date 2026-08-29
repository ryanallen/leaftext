---
name: sync-tests
description: Make the tests match the code. Names the test that covers each change, writes the ones that are missing, and says what cannot be tested. With no argument it works the uncommitted diff; pass a path to audit a file or folder, or a git ref to work everything since it. Use when the user says "sync the tests", "what test covers this", "is this tested", or before a release.
argument-hint: "[path | since-ref]"
user-invocable: true
---

# Sync Tests

`just verify` runs the tests that exist. Nothing asks whether the change made one necessary. This skill is that question.

Two things it rules out: shipping a fix with no test that would have caught it, and calling a change verified when the only thing proved is that the old tests still pass.

**Never run git beyond reading** — no commit, no stash, no checkout. Releasing is `/git-release`.

## When to run

- At the end of a build, as the first half of [`/check`](../check/SKILL.md) — the reading that asks whether the change made a test necessary, before the gate runs the tests that exist.
- On a file that feels under-covered, whether or not it changed: `/sync-tests src/editing.rs`.

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
| `src/app/**.rs` (binary) | `src/app/tests/`, one file per subject |
| `src/platform.rs`, `journal.rs`, `pipe.rs`, `single_instance.rs` | `src/app/tests/` as well — these sit beside the library's files and belong to the binary, so nothing in `src/tests/` can see them. `main.rs`'s `mod` lines are what settle which crate a top-level file is in, not the folder it sits in |
| `src/store/**.rs` | `src/store/tests.rs` |
| `installer/**.rs` — the Windows EXE installer | `installer/src/tests.rs`, run by `just check-installer`. It installs nothing: the plan is data, and the one test that writes drives a scratch folder and a scratch registry key and removes both |
| `src/assets/shell/*.js` | `scripts/check-shell/`, one file per subject — the file for the part that changed, and a new one where the subject is new. `scripts/check-shell.mjs` beside it is imports, the calls in order and the report |
| A test that holds the page by a line of it | `assert_in(&html, opener, needle)` rather than `assert_contains`, wherever the page carries that line in more than one place — the opener is the line that opens the block the line has to be inside, brace or bracket and all, since an anonymous listener has no name and two menus can hold one row. `just check-shell` counts every pinned line against the page and refuses one it holds twice, or nowhere at all |
| A test that holds one rule of the stylesheet | `rule_body(css, selector)`, never a `find` or a `split` of your own. The selector is the head of the line the rule opens on, indent and all: a match counts only where it begins a line, so a rule merely *ending* with the one asked for is refused rather than answered, and a selector the stylesheet opens twice is refused naming each rule's first declaration — which is what a caller carries to say which. `rule_at` is the same find where a test is weighing two rules' places in the file rather than reading one |
| `site/*.js`, `docs/docs.js` — what draws the published pages | `scripts/check-site-boot.mjs`, which boots both entry readers and everything they import against a stand-in page, fetch and renderer module. It reads the finished page, never the absence of a throw: both readers catch a mid-boot fault into a status line |
| `src/assets/reading/`, `src/theme.rs`, `themes/` | the `src/tests/reading_css_*` subjects, `src/tests/theme_registry.rs`, and `just check-themes` |
| a new class, component, token or icon | no test to write — `just check-classes`, `check-tokens`, `check-icons` and `check-gallery` already refuse anything `design/` does not list. Run them and add the row |
| a new `scripts/*.mjs` | a self-test on made-up input at the top of its own run, and a line in `just verify`. A `check-*` gate never puts that proof behind a flag: the gate would pass it and a matcher that quietly stopped matching would pass everything |
| a test that writes outside the repo | anywhere above, under a name carrying the run's own process id. Two runs at once share every fixed one, and `just check-scratch-names` refuses it |
| `wix/`, `.github/workflows/` | **cannot be run here** — say so instead of pretending |

The subject files today: `app_shell_chrome_bar` `app_shell_chrome_boot` `app_shell_chrome_export` `app_shell_chrome_icons` `app_shell_chrome_sheets` `app_shell_chrome_tabs` `app_shell_library_graph` `app_shell_library_pane` `app_shell_library_vaults` `app_shell_reader_document` `app_shell_reader_editing` `app_shell_reader_minimap` `app_shell_scripts` `code_intel` `data_xml` `doc_graph` `editing` `eml` `encoding` `folder_tree` `git` `glossary` `images` `indexer_pager` `known_folders` `markdown_code` `markdown_github` `markdown_rawhtml` `markdown_render` `minimap` `png` `query` `reading_css_code_view` `reading_css_document` `reading_css_grain` `reading_css_layout` `reading_css_motion` `reading_css_parts` `reading_css_reader` `reading_css_tokens` `remote` `settings_paths` `theme_registry` `updater` `vault_corpus` `web_core`. Shared helpers are in `src/tests/mod.rs` — use them rather than writing a second `assert_contains`.

## Process

### 1. Find what changed

The diff, per file. For each changed function, ask what a caller would get wrong if this code were wrong.

### 2. Name the test that covers it

Search the suite for it before writing anything:

```bash
grep -rn "<function or behavior>" src/tests/ src/app/tests/ scripts/check-shell/
```

Report one row per change: the change, the test that covers it, or **missing**. A test that only proves the code runs is missing.

### 3. Write the missing ones

- **One test, one claim**, named as a sentence about behavior: `a_staged_update_installs_itself_at_launch_but_only_once`, `the_vaults_text_is_patched_for_every_format_the_watcher_reports`. Not `test_updater`.
- **Test the rule, not the implementation.** A test that mirrors the code line for line fails on a rewrite that changed nothing a user sees.
- **Cover what it cost.** A bug fixed in a version gets a test named after what went wrong, so the same regression cannot ship twice.
- Put it in the subject's file, beside its neighbors, and match their style. A new subject file needs its `mod` line in `src/tests/mod.rs`.
- Front-end behavior goes in the `scripts/check-shell/` file for its subject, which the entry beside them boots the fragments in order for against a stand-in page — a fragment that throws as it loads fails there rather than opening a blank window. A subject file reads the collector, the fake page and the shared stands out of `shared.mjs` and never out of another subject file, so anything a second subject starts using moves into `shared.mjs` rather than being imported across.

### 3a. A gap wider than the change is a ticket

This pass writes the tests **this change** needed. Walking the suite to do that is also how a subject with no coverage at all gets noticed, and that finding is real work — it is not this pass's.

- **File it, do not fix it.** [`/ticket`](../ticket/SKILL.md) under `../docs/refactor/` in the subject folder the gap is in, with its row in the README and [`/pm`](../pm/SKILL.md) run once. Tests written for code the change never touched make a diff nobody can review and a release nobody can read back.
- **Never leave it in the hand-back only.** A sentence in a reply dies with the session; a ticket is the one place a finding survives, and it is always a ticket.
- Where a phase in the ticket being built asked for a test and the suite already has it, say which one covers it rather than writing a second.

### 4. Leave the running to the gate

**This pass writes tests; it does not run the suites.** [`/check`](../check/SKILL.md) calls this first and then runs `just verify`, which runs the Rust tests and the front-end boot seconds later — so running either here is the same work paid for twice, and it was the largest of the repeated passes in the whole workflow.

Run one test by name while writing it, where that is how you get it right — `cargo test <name>`. What this step forbids is the whole of `cargo test` or `node scripts/check-shell.mjs` on the way out.

Where this pass is run on its own, with no gate behind it, say in the hand-back that the tests are written and unproven rather than running the suites to make it moot.

### 5. Say what cannot be tested — about this change, not in general

Only one thing is worth saying here: a change that needs a **real window, live selected text, or a held pointer** has no test, and it is worth naming which part. Never the Mac build, the installer or the workflows — [`/check`](../check/SKILL.md) step 4 holds that rule.

### 6. Hand back

Leave the tests uncommitted. The whole reply is the owner's message, word for word; what gained a test, what an existing one already covers and what cannot be tested here all go in the ticket.

**Anything this pass finds that it is not here to do is a ticket, written before the hand-back** — [`/ticket`](../ticket/SKILL.md), its row in `../docs/README.md`, [`/pm`](../pm/SKILL.md).

## Reference

- `src/tests/mod.rs` — the module list and the shared helpers.
- `src/app/tests/` — the binary's tests, one file per subject with the shared helpers in its own `mod.rs`: tabs, history, watching, link routing, file actions.
- `scripts/check-shell/` — the front-end's checks, one file per subject, with `shared.mjs` holding the collector, the fake page and what more than one of them reaches for.
- `scripts/check-shell.mjs` — what runs them, in order, and prints the report.
- `/check` — runs this, then `just verify`.
- `/git-release` — the only thing that touches git.

<!-- keycode: LEAF-D3A6 -->
