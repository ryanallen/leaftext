---
name: check
description: The gate before work is handed back or released. Runs /sync-tests so the change has a test, then `just verify`; a failure is fixed and re-run, never explained past. Use when the user says "check it", "verify", or before handing work back; /git-release calls it before it commits.
argument-hint: ""
user-invocable: true
---

# Check

The last thing before work goes back, and the last thing before it ships.

**Never run git** — a green check is not a license to commit. That needs a `/git-release` in the message.

## Process

### 1. Tests first

Run [sync-tests](../sync-tests/SKILL.md): `/sync-tests` with no argument, so it works the uncommitted diff.

Tests come before `verify` because `verify` runs the tests that exist. A change with no test passes it and proves nothing.

### 2. `just verify`

```bash
just verify
```

Forty steps: `format-check`, `cargo check --all-targets`, `check-web`, `check-installer`, `check-web-commands`, `cargo test`, `check-vendor`, `check-themes`, `check-tokens`, `check-icons`, `check-gallery`, `check-design-docs`, `check-classes`, `check-literals`, `check-page-frame`, `check-hover-fills`, `check-scratch-names`, `check-release`, `check-verify`, `check-justfile-quotes`, `check-build-jobs`, `check-spelling`, `check-docs`, `check-doc-images`, `check-plan`, `check-learn-snapshots`, `check-wrapping`, `check-ascii-art`, `check-site`, `check-site-boot`, `check-shell`, `check-identity`, `check-hooks`, `check-release-package`, `check-workflow-installs`, `check-mcp`, `check-agent-settings`, `check-driver`, `check-shot-edges`, `check-compose-shots`.

Six of those hold the design system together: a value, a class, a component, an icon or a token that `design/` does not list fails the build. When one fires, the fix is a row in `design/` and a bundler run — see `/design-tokens` — never a loosened check.

Three hold the browser half, which is the same front end under a different host: `check-web` type-checks the browser crate at both feature ends, `check-web-commands` fails on a command the app can send that the browser's own host says nothing about, and `check-shell` boots that host over a stand-in module. When `check-web-commands` fires, the fix is the missing line in `web/preview/host.js` — answered, refused on purpose with the reason, or not yet with the ticket that owns it — and never a row removed to make it quiet. What none of them reach is a break that only appears when the crate is built for `wasm32`; that is a tagged release's, and `just build-web` is the same thing by hand.

### 3. A failure is fixed, not narrated

- Fix the cause and run `just verify` again, from the top. Not the one step that failed — a fix breaks its neighbors often enough to matter.
- Never skip a step, never pass a flag that hides one, never hand back with "everything passes except…".
- `cargo fmt` fixes `format-check`. `just bundle-themes` fixes `check-themes`. `just sync-vendor` fixes `check-vendor`. The rest are real problems.
- Repeat until it is green.

**<!-- shared-rule: sessions-in-one-checkout -->Two sessions build in this one checkout, on tickets the running order's `Devs with` column says share no file, and neither of them writes the running order.<!-- /shared-rule -->** So a red this gate finds is not necessarily this pass's.

**<!-- shared-rule: another-sessions-work -->Another session's work is not this pass's, whatever state it is in.<!-- /shared-rule -->** So this step has two reds to tell apart: a red on work this pass wrote is fixed and re-run from the top, and a red only on a file this pass never opened is left byte for byte, named in the hand-back as another session's, and stopped at — the one case where this pass's own work is judged by everything else being green, rather than the 'everything passes except…' the line above refuses.

### 4. Never say what this machine cannot build

The Mac build, the installer and the GitHub workflows do not run here, GitHub builds all three on a tagged release, and **it never goes in a hand-back** — not as a caveat, not as a footnote, not "it ships unproven", and least of all when the change you just made is in one of them. A caveat that is true every single time teaches the reader to skip the line. Say it only if asked directly. This is the rule every other skill points at.

### 5. Hand back

Say what changed and that `just verify` is green, in plain words: what the app does differently, not which constant moved. The tree stays dirty; that is the correct end state.

**Anything this pass finds that it is not here to do is a ticket, written before the hand-back** — with [`/ticket`](../ticket/SKILL.md), its row in `../docs/README.md`, ranked by [`/pm`](../pm/SKILL.md). Naming it in a reply instead is the failure `AGENTS.md` refuses: saying a thing is out of scope proves you found it and handed the filing back to the owner.

## Reference

- `Justfile` — what `verify` runs, and each step on its own.
- `/sync-tests` — step 1.
- `/git-release` — calls this before it commits, and is the only thing that touches git.

<!-- keycode: LEAF-5E64 -->
