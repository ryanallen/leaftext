---
name: check
description: The gate before work is handed back or released. Runs /sync-tests so the change has a test, then `just verify` (fmt, cargo check, tests, vendor and theme drift, US spelling, front-end boot, identity, the hooks). A failure is fixed and re-run, never explained past. Says what a check could not reach only when the work is in it — the Mac build, the installer and the GitHub workflows never run here, so that is not news. Never touches git. Use when the user says "check it", "verify", or before handing work back; /git-release calls it before it commits.
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

Ten steps: `format-check`, `cargo check --all-targets`, `cargo test`,
`check-vendor`, `check-themes`, `check-spelling`, `check-shell`, `check-identity`,
`check-hooks`.

### 3. A failure is fixed, not narrated

- Fix the cause and run `just verify` again, from the top. Not the one step that
  failed — a fix breaks its neighbors often enough to matter.
- Never skip a step, never pass a flag that hides one, never hand back with
  "everything passes except…".
- `cargo fmt` fixes `format-check`. `just bundle-themes` fixes `check-themes`.
  `just sync-vendor` fixes `check-vendor`. The rest are real problems.
- Repeat until it is green.

### 4. Say what a check could not reach — only when it applies

Three things cannot run on this machine: the Mac build, the installer, and the
GitHub workflows. That is permanent and the owner knows it, so **do not say it every
time.** Mention it only when the work you just did is *in* one of them — then say
which change is untested and what would prove it.

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
