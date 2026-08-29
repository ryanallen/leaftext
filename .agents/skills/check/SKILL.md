---
name: check
description: The one complete gate a ticket pays for, run once at the end of its build. Reads the change with /sync-tests so it has a test, then `just verify`; a failure is fixed and re-run, never explained past. Use when the user says "check it" or "verify", and when /dev has finished its last phase; nothing else calls it automatically.
argument-hint: ""
user-invocable: true
---

# Check

The one complete gate a ticket pays for. [`/dev`](../dev/SKILL.md) runs it once, after its last phase is built; the owner runs it by asking. Nothing else calls it — not a phase, not a subject skill, not the shipping pass, not retirement, and not a pass that wrote no code at all.

**Never run git** — a green check is not a license to commit. That needs a `/git-release` in the message.

## Process

### 1. Tests first

Run [sync-tests](../sync-tests/SKILL.md): `/sync-tests` with no argument, so it works the uncommitted diff.

Tests come before `verify` because `verify` runs the tests that exist. A change with no test passes it and proves nothing. That pass is the reading alone — it names what is missing and writes it, and never runs the test suites itself, because the next step runs both of them seconds later.

### 2. `just verify`

```bash
just verify
```

Sixty-one steps: `format-check`, `check`, `check-web`, `check-installer`, `check-web-commands`, `check-doc-commands`, `check-doc-modules`, `test`, `check-source-not-read-as-text`, `check-rule-not-split-by-hand`, `check-vendor`, `check-themes`, `check-tokens`, `check-icons`, `check-gallery`, `check-design-docs`, `check-classes`, `check-literals`, `check-page-frame`, `check-minimap-breakpoint`, `check-hover-fills`, `check-scratch-names`, `check-temporary-code`, `check-growl-words`, `check-app-formats`, `check-format-prose`, `check-release`, `check-verify`, `check-dev-task-toggle`, `check-justfile-quotes`, `check-build-jobs`, `check-version-rule`, `check-unused-names`, `check-file-sizes`, `check-spelling`, `check-docs`, `check-doc-images`, `check-footprints`, `check-plan`, `check-plan-stage`, `check-giveaway`, `check-learn-snapshots`, `check-shared-rules`, `check-wrapping`, `check-ascii-art`, `check-site`, `check-site-images`, `check-site-boot`, `check-other-site`, `check-export-pictures`, `check-shell`, `check-identity`, `check-hooks`, `check-release-package`, `check-workflow-installs`, `check-workflow-permissions`, `check-mcp`, `check-agent-settings`, `check-driver`, `check-shot-edges`, `check-compose-shots`.

Six of those hold the design system together: a value, a class, a component, an icon or a token that `design/` does not list fails the build. When one fires, the fix is a row in `design/` and a bundler run — see `/design-tokens` — never a loosened check.

Three hold the browser half, which is the same front end under a different host: `check-web` type-checks the browser crate at both feature ends, `check-web-commands` fails on a command the app can send that the browser's own host says nothing about, and `check-shell` boots that host over a stand-in module. When `check-web-commands` fires, the fix is the missing line in `web/preview/host.js` — answered, refused on purpose with the reason, or not yet with the ticket that owns it — and never a row removed to make it quiet. What none of them reach is a break that only appears when the crate is built for `wasm32`; that is a tagged release's, and `just build-web` is the same thing by hand.

### 3. A failure is fixed, not narrated

- Fix the cause and run `just verify` again, from the top. Not the one step that failed — a fix breaks its neighbors often enough to matter.
- Never skip a step, never pass a flag that hides one, never hand back with "everything passes except…".
- `cargo fmt` fixes `format-check`. `just bundle-themes` fixes `check-themes`. `just sync-vendor` fixes `check-vendor`. The rest are real problems.
- Repeat until it is green.

**<!-- shared-rule: sessions-in-one-checkout -->Two sessions build in this one checkout, on tickets the running order's `Devs with` column says share no file, and neither of them writes the running order.<!-- /shared-rule -->** So a red this gate finds is not necessarily this pass's.

**<!-- shared-rule: another-sessions-work -->Another session's work is not this pass's, whatever state it is in.<!-- /shared-rule -->** So this step has two reds to tell apart: a red on work this pass wrote is fixed and re-run from the top; a red only on a file this pass never opened is left byte for byte while this pass waits, retries and finishes after it clears. It is never named in the hand-back.

### 4. Never say what this machine cannot build

The Mac build, the installer and the GitHub workflows do not run here, GitHub builds all three on a tagged release, and **it never goes in a hand-back** — not as a caveat, not as a footnote, not "it ships unproven", and least of all when the change you just made is in one of them. A caveat that is true every single time teaches the reader to skip the line. Say it only if asked directly. This is the rule every other skill points at.

### 5. Hand back

The whole reply is the owner's message, word for word. The tree stays dirty; that is the correct end state.

**Anything this pass finds that it is not here to do is a ticket, written before the hand-back** — [`/ticket`](../ticket/SKILL.md), its row in `../docs/README.md`, [`/pm`](../pm/SKILL.md).

## Reference

- `Justfile` — what `verify` runs, and each step on its own.
- `/sync-tests` — step 1, the reading that names a missing test.
- `/dev` — the one pass that calls this automatically, once, after its last phase is built.
- `/git-release` — ships what this proved rather than proving it again, and is the only thing that touches git.

<!-- keycode: LEAF-5E64 -->
