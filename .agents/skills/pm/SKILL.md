---
name: pm
description: Rank every live ticket into one running order and write it to ../docs/PLAN.md — what to build next, top to bottom, checking each ticket's status against the code rather than trusting it. Wrong today first, then dependencies, then cost; shipped rows live in ../docs/done/PLAN.md, moved there by /done, and refused ones in ../docs/canceled/PLAN.md, which this skill keeps by walking that folder. Use when the user says "what should I build next", "rank the tickets", "make a plan", "priorities", or hands over the plan folder to be brought up to date.
argument-hint: "[optional: a subject to rank within]"
user-invocable: true
---

# Build the running order

[`../docs/PLAN.md`](../../../../docs/PLAN.md) is read to answer one question: what do I pick up now. Every live ticket, ranked, one line of why each row sits where it does. Rewrite it in place — git holds every older ranking, and the date at the top says when it was last ranked.

[`../docs/done/PLAN.md`](../../../../docs/done/PLAN.md) holds the retired rows. Moving one there is [`/done`](../done/SKILL.md)'s job, not this skill's, so a row leaves the live file the day its last box is ticked and the list gets shorter as work ships.

[`../docs/canceled/PLAN.md`](../../../../docs/canceled/PLAN.md) holds the refused ones — the third of the three, and the one nothing else writes. **Canceling is the owner's call and no skill's**, so there is no `/done` for it: a plan is moved into `../docs/canceled/` and this pass is what gives it a row, by walking that folder rather than by being told (step 9).

**Never run git. Never edit a ticket's phases.** A ticket that is wrong is [`/design`](../design/SKILL.md)'s work; here it gets a tier 0 row and a corrected status. Outside the three rankings this pass edits only a ticket's row in [`../docs/README.md`](../../../../docs/README.md), a glossary row (step 6), and a track's step order where this pass proves it wrong (step 5).

## 1. Read first

- [`../docs/README.md`](../../../../docs/README.md) — every ticket, one line, and the source of every ticket path.
- [`../docs/GLOSSARY.md`](../../../../docs/GLOSSARY.md) — the words the ranking is written in.
- **Every ticket under `../docs/features/`, `../docs/refactor/` and `../docs/fixes/`, off the disk.** Those hold subject folders, so walk them rather than one level. A ticket the README missed still gets a row.
- **Every file under `../docs/canceled/`, off the disk too.** That is the only way a refused plan is found: nothing announces one, and a ticket moved there with no row is a decision that exists nowhere anybody reads.
- [`../docs/done/PLAN.md`](../../../../docs/done/PLAN.md) and [`../docs/canceled/PLAN.md`](../../../../docs/canceled/PLAN.md) — rows already closed or refused are rows not to re-rank.

## 2. Re-derive every status

Never trust the cell. `Ready` — no dated [`/design`](../design/SKILL.md) line. `Designed` — that line exists, no box ticked. `In development` — a box is ticked. `Released for test` — shipped, not yet retired. The ticket is the authority; when the README disagrees, fix the README.

Then check in the code, not in the file:

- Does the status match the app? A ticket claiming a feature that ships, or the reverse, poisons every row resting on it.
- Is what it waits on real? Read the ticket doing the waiting — a dependency taken from one ticket's own account of another is how a plan goes circular.
- Do its citations still land?
- Does every phase say how it is proved?

What reading cannot settle is a tier 0 row, not a guess.

## 3. Rank on three things, in this order

1. **Is something wrong today** — a bug, a panic, a vault opening incorrectly, or a rule the work runs under saying something untrue. Incorrect outranks incomplete.
2. **Is it built twice if it goes second** — a piece two or more rows want, and smaller than they are, is built once here or several times below. A root *bigger* than the rows under it saves nothing by going first: that is a subject's order, which is `TRACKS.md`'s, not a tier.
3. **What it costs** — the cheaper of two rows that tie goes first.

The tests pick the tier in that order, then run again inside it, which is what makes a row arguable rather than a matter of taste.

**Cost never moves a row between tiers.** It orders rows inside one. Joining it to test 1 is what once left every expensive fault sitting in the middle of the features.

**Not counted:** absent is not wrong, so missing capability never reaches tier 1; a missing test is a risk, not the app being wrong; a dependency counts only where the waiting ticket names it, and a shipped ticket is not a dependency at all.

**Unrankable, because the cost is unknown.** The ticket stays `Ready` with the reason in its row: it changes the window and has no drawn `What it looks like` section, or its phases carry no test box. Check both over every ticket while walking the folders.

**A gap this pass turns up gets a ticket, not a row** — write it with [`/ticket`](../ticket/SKILL.md), give it its README row, rank it here in the same pass.

## 4. The tiers

| Tier | What is in it |
| --- | --- |
| **0** | Not builds. Somebody reading the code to settle a claim the rest of the list rests on |
| **1** | **Wrong today.** Whatever the app, or a rule the work runs under, does incorrectly — at whatever it costs |
| **2** | **The shared piece.** Two or more rows wait on it and it is smaller than they are, so it is built once here or several times below |
| **3** | The features people would name, cheapest first |
| **4** | Big swings, each absorbing the time all of tiers 1 to 3 take together — and anything sitting behind one, however small |

Tier 0 comes first, because the list is only as good as the statuses under it. **A tier with no rows is deleted, heading and all**, and comes back when it has one. **No estimate anywhere** — no minutes, no hours, no days. A tier is an ordering, and a number beside it reads as a promise about a calendar nobody made.

**No row sits in a tier above its own blocker.** It is the one rule that outranks the three tests: a shared piece behind a big swing goes with the swing, and a one-line row behind one stays behind it, because a row somebody cannot start is worse than a row somebody has to scroll to.

**Inside tier 1, what stops somebody using the app comes before what looks wrong.** A machine that cannot install it outranks a shadow drawn the wrong way however the two compare on cost.

**A tier holding most of the list is the tier definitions failing, not the tree.** Three of these emptied once by asking for two things at once or for something no row could satisfy, and the file went on calling itself ranked on three tests while sorting on one.

## 5. The live file is a table

It opens with the first work table. Title, counts and anything off the list go after every table.

```markdown
## Tier 1 — wrong today

| # | Ticket | Status | Depends on | Why here |
```

- **The number is the position**, not the ticket's identity: moving a row renumbers everything under it, and the number is never copied anywhere else. The name is what every line of prose cites.
- **One sentence a cell**, and it says why this row is above the next one. Two only when the second one earns it.
- **Nothing that belongs to the ticket** — no citation, no phase count, no box count, no cost breakdown, no date of who asked for it, no restating what the README already says the ticket is.
- **No preamble under a heading, no method, no record, no picture.** How rows are ranked is this skill; what an earlier ranking got wrong is `done/PLAN.md`'s.
- **Every ticket name is a link**, in every cell and every line of prose, using the path from the README. A bare name is a ranking error.
- **`Depends on` holds live blockers only**, linked, or `—`. A ticket that has shipped does not block anything, so naming one there reads as a wait that is over.
- **A track is `TRACKS.md`'s.** A row says which step it is and nothing more, and the ranking does not import the track's order — most steps are a preference the track says so about, and only a real block moves a row. Where this pass proves a block the other way round, the steps are swapped there in the same edit, because a track saying build this first while the ranking says it cannot be built yet is how somebody starts the blocked one. **Two live tickets on one subject is a track**, so a subject the ranking is carrying in three separate cells gets one written instead.
- **Off the list** — a sentence, with what would put it back. Off with a reason beats bottom of the list.

If a cell needs more words, the ticket is what needs them.

## 6. Every word this file spends has a glossary row

[`../docs/GLOSSARY.md`](../../../../docs/GLOSSARY.md) is what makes the ranking readable by somebody who did not write it, so a planning word spent here and missing there gets a row in this pass. That covers the ones easiest to miss: **each column heading**, **each status value**, tier, row, position, track, step, and anything off the list.

**A row is one or two sentences saying what the word means today**, with a link to whatever owns it. No history, no dates, no counts of how many files carry it — that is a log, and it belongs in a ticket. A word nothing uses any more loses its row.

## 7. Which folder a ticket sits in is the version it ships under

`features/` takes the middle number up and the last back to zero; `refactor/` and `fixes/` take the last number up one. [`/git-release`](../git-release/SKILL.md) reads the folder and does what it says, so a ticket filed wrong ships under the wrong number — and this is the only pass that walks all three folders. `features/` is the app not doing something yet, `refactor/` is doing it differently, `fixes/` is doing it wrong today. Move it, fix its README row, say so in the hand-back. **No version number goes in `PLAN.md`.**

## 8. The shipped file

`../docs/done/PLAN.md` is retired rows and nothing else: one table per tier, the live file's own columns, each row struck through with the date it closed and what the build found. That is the half a later reader cannot get anywhere else. It ends with what the retired rows add up to, and what earlier rankings got wrong. A row is cited by its ticket's name in both files.

## 9. The canceled file

`../docs/canceled/PLAN.md` is every plan decided against, grouped the way that folder's own subject folders are, each row struck through with the date it was dropped and the reason. **It exists because a refused answer that is only deleted comes back** — somebody reads the same fault six months later, reaches the same idea, and rebuilds the thing that was already thrown out. So a row says what it was, what killed it, and what came out of it that is still worth having.

- **Walk the folder, do not wait to be told.** A file there with no row gets one in this pass. A row here whose file is gone loses its row.
- **A canceled ticket is not a canceled fault.** Where the thing it was aimed at is still wrong, the row names the live ticket that holds it, so nobody reads the cancellation as the fault being closed.
- **The ticket keeps every word it had.** It gains a note at the top saying who canceled it and when — a canceled plan is not trimmed, and this file never becomes the only copy of the reasoning.
- **A date it never recorded is a `—`**, not a guess.

## 10. The five files know each other

The tree is read from whichever file somebody opens first, so each one names the rest: [the README](../../../../docs/README.md) says what every plan is, [`PLAN.md`](../../../../docs/PLAN.md) what is left, [`done/PLAN.md`](../../../../docs/done/PLAN.md) what shipped, [`canceled/PLAN.md`](../../../../docs/canceled/PLAN.md) what was refused, and [`TRACKS.md`](../../../../docs/TRACKS.md) the subject orders cutting across the tiers — with [`GLOSSARY.md`](../../../../docs/GLOSSARY.md) holding the words all five are written in. Check the links each way in this pass: a ranking nobody can get to from the file they opened is one they plan against without.

## 11. Hand back

Say which rows moved and why, what tier 0 turned up, what is at the top now, and which number the next release moves. Nothing in the app moved; the tree stays dirty.

## Reference

- `../docs/PLAN.md` — the live list. Read it for how short a row is allowed to be.
- `../docs/done/PLAN.md` — the retired rows, with what each build found.
- `../docs/canceled/PLAN.md` — the refused ones, with what killed each and what survived it.
- `../docs/README.md` — every ticket, one line each. Read first.
- `../docs/GLOSSARY.md` — the words the ranking is written in.
- `/ticket` writes them, `/design` fixes one this finds wrong, `/dev` builds the top row, `/git-release` ships it, `/done` retires its row.

<!-- keycode: LEAF-7A15 -->
