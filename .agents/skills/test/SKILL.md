---
name: test
description: Run the complete gate once over every ticket that has actually been built. Takes the ticket paths the owner names, or with none reads ../docs/PLAN.md for every row at Dev and keeps the ones with a ticked box. Then /sync-tests across the batch and one `just verify`, with a red fixed and the suite re-run from the top, before ticking the closing check box in every covered ticket. Use when the owner says "/test", "run the tests", "test the built tickets", or "check everything that is done".
---

# Test

The owner's gate over every ticket a build has landed. One suite run for the batch, because one `just verify` proves the whole checkout however many tickets asked for it.

## 🛑 Only the owner starts this

**This skill runs only when the message being answered right now carries `/test` or `$test`.** No build calls it, and no other skill does. [`/dev`](../dev/SKILL.md) stops when its last phase is built and hands back; the gate waits here until the owner asks.

**Never run git** — a green suite is not a license to commit. That needs a `/git-release` in the message.

## Process

### 1. Decide which tickets are in the batch

**Where the owner named ticket paths, those are the batch and nothing is read to second-guess them.**

**With none named, read `../docs/PLAN.md` and take every row whose `Status` cell says `Dev`.** That column is computed from each ticket's dated `Building since` line, so it is the tree's own answer to what has been built rather than a list anybody keeps by hand.

**Then open each of those tickets and drop the ones with no box ticked.** A row can say `Dev` because a build dated it and then stopped before landing anything, and proving a ticket that built nothing proves nothing — the suite would run over a tree that ticket never touched. A ticket with at least one ticked box is in, whether or not it is finished.

Say which tickets are in the batch and which were left out, with the reason, before the suite starts. That list is the only thing the owner cannot read off the running order themselves.

### 2. Tests first

Run [`/sync-tests`](../sync-tests/SKILL.md) once, with no argument, so it works the uncommitted diff — which is every ticket in the batch at once, because they all landed in this one checkout.

Tests come before the suite because the suite runs the tests that exist. A change with no test passes it and proves nothing. That pass is the reading alone — it names what is missing and writes it, and never runs the suites itself.

### 3. `just verify`

```bash
just verify
```

Sixty-eight steps, and every one of them reads the tree rather than a ticket, which is why the batch costs one run.

### 4. A failure is fixed, not narrated

- Fix the cause and run `just verify` again, from the top. Not the one step that failed — a fix breaks its neighbors often enough to matter.
- Never skip a step, never pass a flag that hides one, never hand back with "everything passes except…".
- `cargo fmt` fixes `format-check`. `just bundle-themes` fixes `check-themes`. `just bundle-gallery` fixes `check-gallery`. `just sync-vendor` fixes `check-vendor`. The rest are real problems.
- Repeat until it is green.

**<!-- shared-rule: sessions-in-one-checkout -->Two sessions build in this one checkout, on tickets the running order's `Devs with` column says share no file, and neither of them writes the running order.<!-- /shared-rule -->** A red on a file no ticket in this batch touched is another session's work, and this pass is the one place that is not a reason to wait: the owner asked for the gate over the tree they have, so the generated file is refreshed or the fault is fixed like any other, and the run finishes. What is never done is waiting in silence with nothing left to do — that is the wait this skill was written to end.

### 5. Record the green run in every ticket in the batch

Only after the final `just verify` is green, tick the open `/check` box under `### The build ends the same way` in every ticket in the batch. Append `— the whole suite ran green on 18 August 2026, 9:11pm`, using the current Arizona clock from `Get-Date`; this is the proof the box records, so a tick with no run beside it says nothing.

Tick every covered ticket, including each path the owner named explicitly, in the same pass. Leave a box that is already ticked unchanged. A covered ticket with no open closing `/check` box, or with more than one, is a ticket fault: fix the ticket before handing back rather than letting a green run belong to nowhere.

### 6. Never say what this machine cannot build

The Mac build, the installer and the GitHub workflows do not run here, GitHub builds all three on a tagged release, and **it never goes in a hand-back** — not as a caveat, not as a footnote. Say it only if asked directly.

### 7. Hand back

The whole reply is the owner's message, word for word. The tree stays dirty; that is the correct end state. What each ticket gained, what the suite found and what is left go in the tickets, which is where the owner reads them.

**Anything this pass finds that it is not here to do is a ticket, written before the hand-back** — [`/ticket`](../ticket/SKILL.md), its row in `../docs/README.md`, [`/pm`](../pm/SKILL.md).

**<!-- shared-rule: performance-finding -->Anything the work in front of this pass hints could be faster is a performance finding: file it as a ticket in the same turn, without stopping for a benchmark or fixing it in passing, and never name it in the reply.<!-- /shared-rule -->**

## Reference

- `../docs/PLAN.md` — the running order, whose `Status` column says which tickets are being built.
- [`/check`](../check/SKILL.md) — the gate itself, for one run with no batch reading in front of it.
- [`/sync-tests`](../sync-tests/SKILL.md) — step 2, the reading that names a missing test.
- [`/dev`](../dev/SKILL.md) — builds a ticket and stops before this.
- [`/git-release`](../git-release/SKILL.md) — ships what this proved rather than proving it again, and is the only thing that touches git.
