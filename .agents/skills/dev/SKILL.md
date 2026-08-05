---
name: dev
description: >-
  Build a ticket, and stop where a machine's word runs out. Takes one thing — a path to a ticket under ../docs/features/, ../docs/refactor/ or ../docs/fixes/ — and works out the rest: it runs /design itself when nothing has dated the top of the file, holds the ticket against its row in ../docs/PLAN.md, builds the phases in order, ticks each box in the same edit as the code with the test that covers it, strikes through and explains any box that changed shape, and runs /check at the end of every phase. Where the ticket changes anything a person points at, presses or looks at, it then runs the app and drives it — the ask pipe for anything the page handles, the gesture driver for a real wheel or drag — reports what it saw with a picture, and hands over only the gestures it could not reach. A passing check is not a working app, so it ends at the owner's own box, unticked, and closes nothing: the shipped note, the move into ../docs/done/, the index row and the running-order row are /pre-release's, run once the owner has said it works. Never touches git. Use when the user says "build this", "dev this", "work that ticket", "do the plan", or hands over a ticket path to be built rather than scoped.
argument-hint: "[path to the ticket]"
user-invocable: true
---

# Dev a ticket

A ticket is a plan somebody already wrote. This builds it, and leaves the plan tree saying what actually happened — because the next person reads the tree, not this conversation.

One argument: the ticket. Everything else is worked out from the folders.

**Never run git.** A finished ticket is not a release; that needs a `/git-release` in the message. A dirty tree is the correct end state.

## 1. Read before building

Four files, in this order, and no code before all four are read.

- **The ticket.** Every phase, every box, and its record section at the bottom.
- **`../docs/README.md`** — its row in the index, and its neighbors' rows. A ticket that shares plumbing with another is one you can build twice.
- **`../docs/PLAN.md`** — the running order. This ticket's row, and what other rows say is waiting on it. The plan is the order; the ticket is the work. Its `Designed` box is a mirror, not the authority — **check the ticket's own dated line**, and if the two disagree the ticket wins and the box gets corrected.
- **`../docs/GLOSSARY.md`** — the words all three of those are written in. Skim it once, and write the record and the rows in those words rather than inventing a second name for a phase or a tier. A planning word this build genuinely needed and that file does not have gets a row there, in the closing pass below.

### Design it first if nobody has

A designed ticket says so at the top, with the date it was checked:

```markdown
> **Designed 3 August 2026.** Citations opened; plan held against `AGENTS.md`.
```

**No line like that, and [design](../design/SKILL.md) runs now**, in full, before a line of code is written — a ticket with no design line has never had its citations opened, and building off a stale line number is how a plan costs double. It is not a separate errand and it does not need asking about: design it, say in one sentence what the plan had wrong, and carry straight on into phase 1.

The design pass can put one question to the owner, when a fix changes *what gets built* rather than how it is described. If it does, answer that before building — that is the one thing here worth stopping for.

A line with a date months older than the code is worth re-reading too, but that is a judgment call, not a rule: if the ticket's citations still land where it says they do, the date is only a date.

If the plan's row and the ticket disagree — the row says open and the ticket says shipped, or the row describes work the ticket dropped — settle it by reading the code, and fix the row. Do not build against a disagreement.

## 2. Build one phase at a time

Phases ship alone. Build them in the ticket's order and finish each one before starting the next.

- **A box is done when the code is in and its test passes.** Tick it in the same edit — `- [x]` — with the name of the test that covers it on the line.
- **A box that changed shape is struck through with the reason**, not silently rewritten: `- [x] ~~what it said~~ — cut, because …`. Two things earn this: the plan asked for something the code already does for free, and the plan's box had no obvious done. Both go in the record section too.
- **A box that moves to a later phase says so where it was**, and appears in the phase that got it. A box that quietly vanishes reads as built.
- **Nothing open-ended is left behind.** If building turns up a real question the ticket never answered, ask it — one round, the question tool, with a recommendation — and write the answer into the ticket as a decision with its reason before carrying on.
- **Every line written is one line.** Never hard-wrap — not a box, not a paragraph, and not a comment in the code. A comment too long for one line is *shortened*, never wrapped: the length is the thing to fix. `just check-wrapping` fails on one and `--fix` joins it — **except under `src/assets/`, which it skips entirely**, so the front-end fragments and `reading.css` are the one place a wrapped comment passes every check. That is most of what a build touches, so write those on one line by hand and do not wait to be told.
- **The comment bar is [code-comments](../code-comments/SKILL.md)'s, and a build meets it as it writes** rather than leaving a pass to clean up after. Why the code is the way it is, never how it got that way; match the density of the file already there; no assistant voice — no "I changed", no "as requested", no note about what this session did. A comment naming an identifier is a claim, so grep it before writing it.
- **A comment in a `src/assets/shell/*.js` fragment can break a test that never mentions it.** `src/tests/app_shell_*.rs` assert on exact substrings of the assembled script, and some of those substrings are comments. Grep the comment text in `src/tests/` before editing one.
- **Every phase ends with [check](../check/SKILL.md)**, and with the bundler line when it touched `design/`. A failing check is fixed, not explained past.

## When a phase cannot be built

A phase whose work waits on another ticket is not a reason to stop with the job half done — it is a ticket that was written wrong, and fixing it is part of building.

- **Split the file at the seam.** The phases that shipped keep the file; the blocked ones move into a new ticket in the same folder, renumbered from 1, with a first line saying what it rides on and which ticket it came out of. Both files cross-reference each other.
- **Then finish the shipped half properly** — every one of the five edits below, so the tree stops describing it as a plan.
- **Say it in the record**, on both files: what was split, and what the blocked half is waiting for.
- The one thing worth stopping for is a phase blocked on something the *owner* has to decide, not on code. Ask that, with a recommendation, and carry on.

## 3. Notes worth writing down

The ticket's value after it ships is what it says about the ground. As each phase lands, add to the record section at the bottom:

- **What the plan had wrong**, if reading the code corrected it.
- **What building it changed** — a decision the plan made that turned out to be the wrong shape, and what it is now. This is the section a later reader needs most, because the ticked boxes only say what happened, not why it differs from the plan they are reading above it.
- **Still open** — work the build touched and deliberately did not do, named so nobody reads it as covered. A piece of scaffolding another ticket should absorb goes here.
- **Follow-up work gets a ticket before hand-back.** If building exposes a real fix, design pass, or build that this ticket will not do, run [ticket](../ticket/SKILL.md), put the new file in the right live folder, add its index and running-order rows, and link it from `Still open`; do not leave discoverable work as a loose note.

## 4. Drive it yourself, then the owner confirms

**A passing check is not a working app.** `deleting` had every box ticked and every check green while the thing it was written to fix was still broken in the window: it had read "a selection can already cross blocks" off Ctrl+A and never asked whether a *drag* could. Nothing in `just verify` could have caught that, because nothing in it uses the app.

Most of that is reachable from here. So when the ticket changes anything a person does with a pointer, a key, a drag or their eyes:

- **Run it.** `cargo run`, in the background, on a document that exercises the change.
- **Drive every gesture you can reach**, and read back where it landed rather than assuming. `just ask '{"ask":"state","reader":true}'` says where the reader is, which panels are up, what is selected; `{"ask":"idle"}` waits for the render instead of sleeping; `just drive shot.png <steps>` does the real ones. See AGENTS.md, "Driving the running app".
- **Know which surface a gesture is on**, or a faked event gets reported as a pass. Anything the page handles goes through `eval` — every keyboard shortcut, every click on an element, every command the page sends. Anything the web view handles needs the driver — the wheel, a real drag, a native menu, the file dialog. A dispatched `WheelEvent` moves nothing at all, and setting `scrollTop` is a different gesture from a wheel.
- **Report what you saw, with the picture.** What you drove, what came back, and the shot.
- **Hand over only what you could not reach** — in the owner's words, "drag across two paragraphs and press Delete", not "verify the cross-block selection path". One line each, and it should be a short list now rather than the whole thing.
- **Stop there.** The last box is the owner saying it works — a machine agreeing with itself is not evidence, which is why `deleting` is in the tree. Until that comes back the ticket does not move, and [pre-release](../pre-release/SKILL.md) has not started.
- **That confirmation is a real box**, unticked, at the foot of the phases: `- [ ] The owner says it works in the window: …`. `check-docs` fails a ticket whose every box is ticked and is still filed as live work, so without it the last phase cannot end green.
- **A gesture no check can reach is named in the ticket**, in `Still open`, so the next reader knows what was proved by machine and what by hand.

A ticket that touches nothing anyone points at — a rename, a test, a doc pass, a build script — skips this and goes straight on.

## 5. Stop. Closing the ticket is not this skill's

**The ticket stays where it is** — in `fixes/`, `features/` or `refactor/` — its row stays in the running order, and the not-built note stays at the top. Nothing is moved, renamed or rewritten.

That is [pre-release](../pre-release/SKILL.md)'s job, and it runs when the owner has said it works, not when the boxes are ticked. The split is deliberate: this skill has been wrong before with every box ticked and every check green, so the tree is not allowed to say a thing shipped on a machine's word alone. `deleting` is in `done/` because that rule did not exist.

So hand back three things and stop: what the app does differently, what the build found that the plan had wrong, and the gestures the owner has to make for the last box.

## Reference

- `/run` — the app, launched, for section 4.
- `/ticket` — the shape of the file being built.
- `/design` — run first, automatically, when the top of the ticket is undated.
- `/check` — the end of every phase, and the end of the job.
- `/pre-release` — what runs after the owner says it works: the shipped note, the move into `done/`, both rows, the published pages.
- `../docs/README.md` — every ticket, one line each.
- `../docs/GLOSSARY.md` — the words a ticket, an index row and a ranking row are written in.
- `../docs/PLAN.md` — the running order over the live tickets, written by `/pm`.
- `../docs/done/PLAN.md` — where a row goes when its ticket ships, unchanged.

<!-- keycode: LEAF-2F4B -->
