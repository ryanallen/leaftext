---
name: pm
description: Rank every live ticket into one running order and write it to ../docs/PLAN.md — what to build next, top to bottom, checking each ticket's status against the code rather than trusting it. Wrong today first, then dependencies, then cost; shipped rows live in ../docs/done/PLAN.md, moved there by /done, not this. Use when the user says "what should I build next", "rank the tickets", "make a plan", "priorities", or hands over the plan folder to be brought up to date.
argument-hint: "[optional: a subject to rank within]"
user-invocable: true
---

# Build the running order

This writes one answer down: every live ticket, ranked, with the reason each row is where it is.

**Two files, and the split is what makes the first one usable.** [`../docs/PLAN.md`](../../../../docs/PLAN.md) holds the **live** rows — the work that is left. [`../docs/done/PLAN.md`](../../../../docs/done/PLAN.md) holds every **retired** row — what shipped, when it closed, and what the build found. Nothing else is edited except a ticket's row in `../docs/README.md` if its status turns out to be wrong.

**Never run git.** **Never edit a ticket's phases.** If a ticket is wrong, that is `/design`; if it is stale about the app, say so in a tier 0 row and fix its status, not its plan.

## Why the shipped rows leave

A ranking is read to answer one question — what do I pick up now. A file where thirteen of eighteen tier 1 rows are struck through answers it thirteen rows late, and it gets longer every time something lands, which is exactly backwards: shipping work should make the list shorter. So a row leaves the live file the day its last box is ticked.

It is **kept**, not deleted, because the row is the only place that says what the build actually found against what the plan expected — the half a later reader cannot get anywhere else. `done/PLAN.md` is where it goes, beside the tickets it points at.

**`PLAN.md` is one file, rewritten in place.** It is not dated per run and there is no folder of snapshots: git holds every earlier version, so an old ranking is a `git log` away. The date at the top says when it was last ranked.

### A row is numbered by position

**The ticket's name is the row's identity.** The live table also shows one global position number, starting at 1 and continuing through every tier. The number belongs to the current ranking, so adding, removing or moving a row renumbers every position below it; the number never follows a ticket.

The number is not the ticket's identity and is not copied into `done/PLAN.md`. A shipped row keeps its name and leaves the live count, so a number written down anywhere else is a pointer that moves under the reader.

### A row moves unchanged

Whatever the row said in the live list is what it says in `done/PLAN.md`: struck through, with the date it closed and what the build found, but without the live position number. **Nothing else is rewritten on the way across** bar the `Status` cell, which becomes the date the row closed — a live status has no meaning once the work is built. So the row a later reader finds is the row somebody actually built against, and moving it is a cut and paste. That is [`/done`](../done/SKILL.md)'s job, not this skill's.

## 1. Read before ranking

- **`../docs/README.md`** — the index, every ticket one line. It is the only thing standing between a ranking and a ticket nobody knew existed.
- **`../docs/GLOSSARY.md`** — the words this tree uses about itself. A ranking is read by somebody who did not write it, so tier, row, seam, track and retired row mean what that file says they mean. A planning word spent here and missing there gets a row there in the same pass.
- **Every ticket in `../docs/features/`, `../docs/refactor/` and `../docs/fixes/`**, off the disk rather than off the index. Those folders hold **subject folders** — `storage/`, `library/`, `reading/`, `editing/`, `filtering/`, `diagrams/`, `big-swings/`, `plugins/`, plus `repo/` — so walk them, never one level. A ticket the index missed still gets a row.
- **`../docs/done/PLAN.md`** — what has already closed, and what those builds found. A row here is a row not to re-rank.

**Every row carries a `Status`, and this skill re-derives it rather than trusting it.** Use `Ready` without the dated [`/design`](../design/SKILL.md) line, `Designed` after that line exists but no implementation box is ticked, `In development` after implementation has started, and `Released for test` when `/git-release` has shipped the code but `/done` has not retired the ticket. The ticket is the authority, and ranking is the pass that reconciles the plan.

Then check three things per ticket, in the code, not in the file:

- **Does its status match the app?** A ticket saying "not built" whose feature ships, or the reverse, poisons every row that rests on it.
- **Is what it is waiting on real?** A dependency drawn from one ticket's own words is how a plan ends up circular — two tickets each waiting on the other.
- **Do its citations still land?** A line number drifts on every edit above it. A ticket citing a function that moved is not evidence of anything.
- **Does every phase say how it is proved?** A test box per phase, naming where the test goes. Missing them changes the row — see below.

A ticket that cannot be settled by reading gets a **tier 0** row rather than a guess.

**Every ticket named in `PLAN.md` is a link to that ticket.** This includes dependency cells and tier prose. Track steps belong in `TRACKS.md`, not in the ranking. Use the path from `README.md` and link the ticket's displayed name, for example `[home-screen](refactor/library/home-screen.md)`. A bare ticket name, a name in backticks, or a name linked only in the same row is a failed ranking. Ordinary words that are not ticket names stay plain.

## 2. Rank on three things, in this order

1. **Is something wrong today.** A bug, a panic, a real vault opening incorrectly, a broken frame on the published site. The app being *incorrect* outranks the app being *incomplete*.
2. **How many other tickets are waiting on it.** A piece four tickets want is built once here or four times below, badly and differently.
3. **What it costs.** Between two rows that tie on the first two, the cheap one goes first.

That order is the whole method, and it is what makes a row arguable rather than a matter of taste. A ticket that four others ask questions of outranks a bigger feature even when the bigger feature is more interesting.

**The three tests pick the tier, then run again inside it.** Test one puts a row in tier 1 or leaves it out; test two puts what is left in tier 2 or leaves it out; test three separates tier 3 from tier 4 and settles every remaining pair. A claim the rest of the list rests on that reading has not settled is tier 0 and comes above all of them. Applied in that order the tier table below is an outcome rather than a second judgment, which is why no row is ever placed by taste.

### What the tests do not count

**Absent is not wrong.** "The app cannot open a `.docx`" is missing capability, not incorrect behavior — it does not lift a row into tier 1 however big its audience. Say that in the row, or the next reader moves it.

**A missing test is not the app being wrong.** [Absent is not wrong](../../../../docs/GLOSSARY.md#absent-is-not-wrong) covers this too: a subject nothing covers is a risk, not a bug, so a test-coverage ticket ranks on what it unblocks and what it costs, not in tier 1 — unless something ships wrong today, which is then the row's real reason. Say that in the cell, or the next reader moves it.

**A dependency counts only where the ticket names what it needs.** Test two counts tickets waiting on this one, and a count drawn from one ticket's own account of another is how a plan ends up circular. Read the ticket doing the waiting.

### What cannot be ranked at all

**Two things stop a ticket getting a position, and both are the same fault: the work cannot be costed.** Test three has nothing to weigh, so the row would be placed on a guess. Each leaves the ticket at `Ready` with the reason in its row, and each is checked over every ticket while walking the folders, not only over the ones being re-ranked.

- **It changes the window and has not drawn it in the file.** The row says "owes a drawn `What it looks like` section", because the cost of a screen nobody has drawn is unknown and the thing that gets built is whatever the builder invents. [ticket](../ticket/SKILL.md) holds the shape of that section; [design](../design/SKILL.md) is what fails a ticket without one.
- **Its phases do not say how they are proved.** Every phase owes a test box naming where the test goes; a file with none is `Ready` with "owes test boxes" in its row, however finished the rest of it reads. A phase that has not counted its tests is a phase costed at half, and the row is what somebody picks up work from.

**A gap this pass turns up gets a ticket, not a row.** Ranking is the only pass that walks the three live folders off the disk and reads the code behind them, so it finds subjects nothing covers. A row cannot hold work no ticket describes: write the file with [`/ticket`](../ticket/SKILL.md), give it its index row, and rank it here in the same pass.

## 3. The tiers

| Tier | What is in it |
| --- | --- |
| **0** | Not builds. Somebody reading the code to settle a claim the rest of the list rests on |
| **1** | Wrong today, and cheap. The best ratio of "someone notices" to "work done" in the tree |
| **2** | The pieces other tickets are waiting on. Nothing here is a feature a reader would name |
| **3** | The features people would name. Cheaper after tier 2 and more expensive before it |
| **4** | Big swings. Each one absorbs the time all of tiers 1 to 3 take together |

**No estimate anywhere.** Not in a tier heading, not in a cost cell: no minutes, no hours, no days. A tier is an ordering, and a number beside it reads as a promise about a calendar nobody made. What a row costs is said in what the work *is* — two columns and a check condition — which is a size a reader can argue with.

Tier 0 comes first because the list is only as good as the statuses it rests on. **A tier with no rows is not in the file** — no heading, no note saying where its rows went. It comes back the moment it has one. Tier 0 is usually the empty one, and it sat as a heading over a link to somewhere else until the size rules below said not to.

## 4. The live file is a table, not an essay

**It is read to answer one question: what do I pick up now.** Everything that is not that answer pushes it further down the page, and a reader who has to scroll past four paragraphs of method to reach row one stops reading the file. So the rules here are size rules, and they are the point of the skill rather than a note on it.

**The live file starts with its first work table.** Put the title, count line, summary, and any other notes after all work tables. The work stays first; context goes at the bottom.

```markdown
## Tier 1 — wrong today, and cheap

| # | Ticket | Status | Why here | Cost |
```

The number column shows position; the ticket name remains the stable reference. Put the compact count line at the bottom after the work tables, tracks, and off-list notes.

- **The `Status` cell is third, after the position and ticket name.** Use only `Ready`, `Designed`, `In development`, or `Released for test` — no date, no who. It sits before the reasoning because it tells the reader what can happen next.
- **A cell is one or two sentences.** Not a paragraph. Not a citation — a `path:line` belongs in the ticket's measured table, where somebody building it will look, and a cost belongs in the ticket's phases. The cell says *why this row is above the next one*, and nothing else.
- **No tier preamble.** The heading says what the tier is. A paragraph under it restates the heading.
- **An empty tier is deleted, heading and all.** It comes back when it has a row. A heading over nothing is a line to scroll past, and tier 0 sat empty over a link to somewhere else for exactly one edit before this rule existed.
- **No method in the file.** How rows are ranked is this skill; the file links to it. Copying the three criteria into the file means two copies that drift.
- **No record in the file.** What an earlier ranking got wrong goes in `done/PLAN.md`, beside the rows it is about. Anything that belongs to one ticket rather than to the ordering goes on that ticket, in its own record — that is what a ticket's record section is for.
- **Context goes at the bottom.** The tables are the list. Put counts, ranking notes, and other context after all work tables, tracks, and off-list notes, or omit them.
- **No picture, and no diagram.** A wireframe and a flow diagram both belong to one ticket, where somebody building it will look; drawn in the ranking they push row one down the page and go stale the moment that ticket is designed. A [track](../../../docs/GLOSSARY.md#track) is numbered steps for the same reason — an order reads faster as a short list than as a graph.

Then, after the tables, only these:

- **A subject spanning more than one ticket gets a track** — its own short section, with the order as numbered steps. **Two tickets is the threshold.** A ranking splits a subject across tiers, which is right for a ranking and useless as an order, and a dependency written into two rows is a dependency that drifts; so the order is written once, and it is where a conflict between two tickets is decided rather than warned about twice. One line of why, then the steps. A row belonging to a track says which step it is instead of restating what it waits on. **One ticket is never a track**, however many tiers its own phases land in — a file already holds its phases in order.
- **Anything deliberately off the list**, in a sentence or two, with what would have to be answered to schedule it. Off the ranking beats bottom of it: bottom reads as "someday", off with a reason reads as a question somebody can answer.

**If a row needs more than two sentences, the ticket is what needs the words.** Put them there and cut the cell. A ranking that grows every time something is learned is a ranking nobody opens.

## 5. The shape of the shipped file

`../docs/done/PLAN.md` is the retired rows and nothing else. Its top says what it is, that a row is cited by its ticket's name in both files, and that a row arrives unchanged. Then one table per tier the rows were retired from, in tier order, keeping the live file's own column headings so a row can be moved without touching a cell.

It ends with two things the live file is kept clear of. **What the retired rows add up to** — what that work closed, and which rows cost more than the plan said and why: the paragraph somebody reads before trusting the next cost estimate. Then **what earlier rankings got wrong**, the three headings `/design` uses, sitting beside the rows it is about rather than on top of the work that is left. Anything belonging to one ticket rather than to the ordering goes on that ticket instead.

### Rules both tables hold to

- **The prose cites a row by its ticket's name**, never by its position number and never by "the row above". A name still points at the right thing after the list is reordered.
- **Every row says why it is *there*, not what the ticket is.** The index already says what a ticket is. A row that only restates it is a row nobody can argue with.
- **A retired row is struck through and says what the build found** — what the plan had wrong, and what changed shape. That is the half a later reader cannot get anywhere else, and it is why the row is kept rather than deleted.
- **A claim cites the repo or the ticket.** A cost, a dependency, a "this already ships" — the same bar as a ticket's measured table.
- **Never re-plan.** A row points at a ticket. Deciding a phase in the ranking puts the decision where nobody building the ticket will look.
- **A row that has to say "phases 1–2 only" is a ticket that wants splitting.** Ranking half a file in one tier and the rest four tiers down is the ranking admitting the file holds two jobs; the annotation keeps the list honest but leaves a ticket nobody can finish. Say so in the row, and name the split as the work — `/design` on that file does it, and then each row points at a file that can be closed.

## 6. Filing a ticket sets the number it will ship under

**Which folder a ticket sits in is decided here, and that decision is the version.** A ticket out of `features/` takes the middle number up and the last back to zero; anything out of `refactor/` or `fixes/` takes the last number up one. [`/git-release`](../git-release/SKILL.md) does not weigh that up — it reads the folder off the path and does what it says. So a ticket filed in the wrong place ships under the wrong number, and this is the pass that catches it, because this is the only pass that walks all three folders off the disk.

So check the filing as part of checking the status. `features/` is the app not being able to do something yet, `refactor/` is it doing that thing differently, `fixes/` is it doing something wrong today — and a ticket in the wrong one of those is a wrong row *and* a wrong version. Move it, fix its row in `../docs/README.md`, and say so in the hand-back.

**No version number goes in `PLAN.md`.** A number written into a row is wrong the moment the row moves, and the file is a running order rather than a schedule. Say it in the hand-back instead, in one clause on the top row — the reader gets to see a feature at the top of the list mean the middle number, which is the whole reason the rule is a folder and not a judgment.

## 7. When something ships

**A ticket mention without a link is a ranking error.** Before handing back, compare every live and shipped ticket name in `PLAN.md` with the paths in `README.md`; check the next-up note, every tier cell and every track paragraph and step. Fix the link in the same edit. Do not make a second list of ticket names in the skill — `README.md` is the source of paths.

That is [done](../done/SKILL.md)'s job, not this skill's: it moves the row into `done/PLAN.md` unchanged, marks the date, says what the build found, and moves the "where this stands" pointer on in the live file. Run this again when enough has moved that the *order* is wrong rather than one row.

## 8. Hand back

Say what moved and why, in plain words: which rows changed tier, what tier 0 turned up, what the top of the list now is, and which number the next release moves. Both files are in `../docs/`, so nothing in the app moved and there is nothing to bundle. The tree stays dirty.

## Reference

- `../docs/PLAN.md` — the live list. Read it for how short a row is allowed to be.
- `../docs/done/PLAN.md` — the retired rows, with what each build found.
- `../docs/README.md` — every ticket, one line each. Read first.
- `../docs/GLOSSARY.md` — tier, row, seam, track, retired row, subject folder: what each one means here.
- `/ticket` — writes the tickets this ranks.
- `/design` — fixes a ticket this finds wrong. A tier 0 row is often "run `/design` on that file".
- `/dev` — builds the top row. `/git-release` ships it for testing. `/done` retires its row after that release when the owner says it works.
- `/git-release` — holds which number a release moves. The folder of the ticket at the top of this list is what decides it.

<!-- keycode: LEAF-7A15 -->
