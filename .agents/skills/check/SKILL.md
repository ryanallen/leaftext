---
name: check
description: The gate before work is handed back or released. Runs /sync-tests so the change has a test, then `just verify` — sixteen steps: formatting, compile, tests, no hand-written value in the stylesheet, every class and token and icon and component listed in `design/`, the gallery and the published design page in step with it, US spelling, the front-end boots, no assistant identity in the repo, the two hooks, and that every check is in the suite. A failure is fixed and re-run, never explained past. Never mentions that the Mac build, the installer or the GitHub workflows do not run here — that is true every time and GitHub builds them on a tagged release. Never touches git. Use when the user says "check it", "verify", or before handing work back; /git-release calls it before it commits.
argument-hint: ""
user-invocable: true
---

# Check

The last thing before work goes back, and the last thing before it ships.

**Never run git** — a green check is not a license to commit. That needs a
`/git-release` in the message.

## Process

### 1. Tests first

Run [sync-tests](../sync-tests/SKILL.md): `/sync-tests` with no argument, so it
works the uncommitted diff.

Tests come before `verify` because `verify` runs the tests that exist. A change
with no test passes it and proves nothing.

### 2. `just verify`

```bash
just verify
```

Sixteen steps: `format-check`, `cargo check --all-targets`, `cargo test`,
`check-vendor`, `check-themes`, `check-tokens`, `check-icons`, `check-gallery`,
`check-design-docs`, `check-classes`, `check-literals`, `check-spelling`,
`check-shell`, `check-identity`, `check-hooks`, `check-verify`.

Six of those hold the design system together: a value, a class, a component, an
icon or a token that `design/` does not list fails the build. When one fires, the
fix is a row in `design/` and a bundler run — see `/design-tokens` — never a
loosened check.

### 3. A failure is fixed, not narrated

- Fix the cause and run `just verify` again, from the top. Not the one step that
  failed — a fix breaks its neighbors often enough to matter.
- Never skip a step, never pass a flag that hides one, never hand back with
  "everything passes except…".
- `cargo fmt` fixes `format-check`. `just bundle-themes` fixes `check-themes`.
  `just sync-vendor` fixes `check-vendor`. The rest are real problems.
- Repeat until it is green.

### 4. Never say what this machine cannot build

The Mac build, the installer and the GitHub workflows do not run here. That is
permanent, the owner has always known it, and **it never goes in a hand-back** —
not as a caveat, not as a footnote, not "it ships unproven", and not when the
change you just made is in one of them. That is when it is most obvious.

GitHub builds the Mac app and the installer on a tagged release, so a break shows
up there. Say it only if you are asked about it directly.

A caveat that is true on every hand-back teaches the reader to skip the whole line.

### 5. Hand back

Say what changed and that `just verify` is green, in plain words: what the app does
differently, not which constant moved. The tree stays dirty; that is the correct end
state.

## Reference

- `Justfile` — what `verify` runs, and each step on its own.
- `/sync-tests` — step 1.
- `/git-release` — calls this before it commits, and is the only thing that
  touches git.
