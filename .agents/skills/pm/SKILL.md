---
name: pm
description: Rank every live ticket into one running order and write it to ../docs/PLAN.md — what to build next, top to bottom, with the reason each row sits where it does. Reads ../docs/README.md and every ticket in ../docs/features/, ../docs/refactor/ and ../docs/fixes/, checks each one's status against the code rather than trusting it, then ranks on three things in a fixed order: is something wrong today, how many other tickets are waiting on it, and what it costs. The live file is a table, not an essay: four lines above the first table, one or two sentences a cell, no method, no record, no empty tiers — anything longer belongs in the ticket. Shipped rows do not stay in the list — they move to ../docs/done/PLAN.md, so the running order is the length of the work that is left. A row is cited by its ticket's name, never a number. Never touches git. Use when the user says "what should I build next", "rank the tickets", "make a plan", "priorities", or hands over the plan folder to be brought up to date.
argument-hint: "[optional: a subject to rank within]"
user-invocable: true
---

# Build the running order

Ninety-odd tickets is more than anyone holds in their head, so the question "what next" gets answered from whichever file was open. This writes the answer down once: every live ticket, ranked, with the reason each row is where it is.

**Two files, and the split is what makes the first one usable.** [`../docs/PLAN.md`](../../../docs/PLAN.md) holds the **live** rows — the work that is left. [`../docs/done/PLAN.md`](../../../docs/done/PLAN.md) holds every **retired** row — what shipped, when it closed, and what the build found. Nothing else is edited except a ticket's row in `../docs/README.md` if its status turns out to be wrong.

**Never run git.** **Never edit a ticket's phases.** If a ticket is wrong, that is `/design`; if it is stale about the app, say so in a tier 0 row and fix its status, not its plan.

## Why the shipped rows leave

A ranking is read to answer one question — what do I pick up now. A file where thirteen of eighteen tier 1 rows are struck through answers it thirteen rows late, and it gets longer every time something lands, which is exactly backwards: shipping work should make the list shorter. So a row leaves the live file the day its last box is ticked.

It is **kept**, not deleted, because the row is the only place that says what the build actually found against what the plan expected — the half a later reader cannot get anywhere else. `done/PLAN.md` is where it goes, beside the tickets it points at.

**`PLAN.md` is one file, rewritten in place.** It is not dated per run and there is no folder of snapshots: git holds every earlier version, so an old ranking is a `git log` away. The date at the top says when it was last ranked.

### A row is named, not numbered

**The ticket's name is the row's identity**, in both files, in every line of prose, in that ticket's own record and in a commit message from months ago. So a row has nothing to keep in step: adding one is one line, moving one is one line, and a row that ships carries its name across unchanged.

Rows carried numbers until 4 August 2026. They were retired with their rows and never reused, which is what made them useless — five shipped rows left gaps, so the number could not be read as a position, and the name was already doing the job of a name. Anything written before that date citing `#8` or `#38` means the row; look for the ticket.

### A row moves unchanged

Whatever the row said in the live list is what it says in `done/PLAN.md`: struck through, with the date it closed and what the build found. **Nothing is rewritten on the way across**, so the row a later reader finds is the row somebody actually built against, and moving it is a cut and paste. That is [`/pre-release`](../pre-release/SKILL.md)'s job, not this skill's.

## 1. Read before ranking

- **`../docs/README.md`** — the index, every ticket one line. It is the only thing standing between a ranking and a ticket nobody knew existed.
- **`../docs/GLOSSARY.md`** — the words this tree uses about itself. A ranking is read by somebody who did not write it, so tier, row, seam, track and retired row mean what that file says they mean. A planning word spent here and missing there gets a row there in the same pass.
- **Every ticket in `../docs/features/`, `../docs/refactor/` and `../docs/fixes/`**, off the disk rather than off the index. Those folders hold **subject folders** — `storage/`, `library/`, `reading/`, `editing/`, `filtering/`, `diagrams/`, `big-swings/`, `plugins/` — so walk them, never one level. A ticket the index missed still gets a row.
- **`../docs/done/PLAN.md`** — what has already closed, and what those builds found. A row here is a row not to re-rank.

**Every row carries a `Designed` box, and this skill re-derives it rather than trusting it.** A ticket with the dated line [`/design`](../design/SKILL.md) signs at its top gets `[x]`; a ticket without one gets `[ ]`. Grep the tickets for that line as you read them and write what you find — the box is a mirror, the ticket is the authority, and a ranking is the one pass that reconciles the two. An `[x]` beside a ticket nobody has read is worse than no column at all.

Then check three things per ticket, in the code, not in the file:

- **Does its status match the app?** A ticket saying "not built" whose feature ships, or the reverse, poisons every row that rests on it.
- **Is what it is waiting on real?** A dependency drawn from one ticket's own words is how a plan ends up circular — two tickets each waiting on the other.
- **Do its citations still land?** A line number drifts on every edit above it. A ticket citing a function that moved is not evidence of anything.

A ticket that cannot be settled by reading gets a **tier 0** row rather than a guess.

## 2. Rank on three things, in this order

1. **Is something wrong today.** A bug, a panic, a real vault opening incorrectly, a broken frame on the published site. The app being *incorrect* outranks the app being *incomplete*.
2. **How many other tickets are waiting on it.** A piece four tickets want is built once here or four times below, badly and differently.
3. **What it costs.** Between two rows that tie on the first two, the cheap one goes first.

That order is the whole method, and it is what makes a row arguable rather than a matter of taste. A ticket that four others ask questions of outranks a bigger feature even when the bigger feature is more interesting.

**Absent is not wrong.** "The app cannot open a `.docx`" is missing capability, not incorrect behavior — it does not lift a row into tier 1 however big its audience. Say that in the row, or the next reader moves it.

## 3. The tiers

| Tier | What is in it | Rough size |
| --- | --- | --- |
| **0** | Not builds. Somebody reading the code to settle a claim the rest of the list rests on | hours |
| **1** | Wrong today, and cheap. The best ratio of "someone notices" to "work done" in the tree | days |
| **2** | The pieces other tickets are waiting on. Nothing here is a feature a reader would name | weeks |
| **3** | The features people would name. Cheaper after tier 2 and more expensive before it | weeks each |
| **4** | Big swings. Each one absorbs the time all of tiers 1 to 3 take together | months |

Tier 0 comes first because the list is only as good as the statuses it rests on. **A tier with no rows is not in the file** — no heading, no note saying where its rows went. It comes back the moment it has one. Tier 0 is usually the empty one, and it sat as a heading over a link to somewhere else until the size rules below said not to.

## 4. The live file is a table, not an essay

**It is read to answer one question: what do I pick up now.** Everything that is not that answer pushes it further down the page, and a reader who has to scroll past four paragraphs of method to reach row one stops reading the file. So the rules here are size rules, and they are the point of the skill rather than a note on it.

**Four lines above the first table. Hard limit.**

```markdown
# What to build next, in order

**Last ranked 3 August 2026.** Live rows only — a row that ships moves to
[what was built](done/PLAN.md). Tickets: [README.md](README.md).
Method, and why a row sits where it does: `/pm`.

**Next up: [ticket-name](path).** Anything that can go beside it, and what waits.

**A row is named, not numbered.** One line saying so, and that both files cite
the ticket's name.

**Designed** — has anybody read the ticket against today's code. Unticked means
the plan is unproven, so `/dev` runs `/design` before it writes anything;
the ticket's own dated line is the authority and this box mirrors it.

## Tier 1 — wrong today, and cheap (days)

| Ticket | Designed | Why here | Cost |
```

That is six lines, and the last two each buy something: one says a row is a name so nobody starts numbering again, and the other buys the column, because a reader deciding what to pick up needs to know an unticked row is a guess.

- **The `Designed` box is second, right after the ticket.** `[x]` or `[ ]`, nothing else in the cell — no date, no who. The date is on the ticket, and a date here would be a second copy to go stale. It sits before the reasoning because it is the first thing that decides whether to trust the rest of the row.
- **A cell is one or two sentences.** Not a paragraph. Not a citation — a `path:line` belongs in the ticket's measured table, where somebody building it will look, and a cost belongs in the ticket's phases. The cell says *why this row is above the next one*, and nothing else.
- **No tier preamble.** The heading and its rough size say what the tier is. A paragraph under it restates the heading.
- **An empty tier is deleted, heading and all.** It comes back when it has a row. A heading over nothing is a line to scroll past, and tier 0 sat empty over a link to somewhere else for exactly one edit before this rule existed.
- **No method in the file.** How rows are ranked is this skill; the file links to it. Copying the three criteria into the file means two copies that drift.
- **No record in the file.** What an earlier ranking got wrong goes in `done/PLAN.md`, beside the rows it is about. Anything that belongs to one ticket rather than to the ordering goes on that ticket, in its own record — that is what a ticket's record section is for.
- **No summary of what the list adds up to.** The tables are the list. A paragraph reading them back is the file arguing with itself.

Then, after the tables, only these:

- **A subject that spans tiers gets its own short section**, with its order as numbered steps. A ranking puts the four table tickets in four tiers, which is right for a ranking and useless as an order — so the order is written once, and it is where a conflict between two tickets is decided rather than warned about twice. One line of why, then the steps.
- **Anything deliberately off the list**, in a sentence or two, with what would have to be answered to schedule it. Off the ranking beats bottom of it: bottom reads as "someday", off with a reason reads as a question somebody can answer.

**If a row needs more than two sentences, the ticket is what needs the words.** Put them there and cut the cell. A ranking that grows every time something is learned is a ranking nobody opens.

## 5. The shape of the shipped file

`../docs/done/PLAN.md` is the retired rows and nothing else. Its top says what it is, that a row is cited by its ticket's name in both files, and that a row arrives unchanged. Then one table per tier the rows were retired from, in tier order, keeping the live file's own column headings so a row can be moved without touching a cell.

It ends with two things the live file is kept clear of. **What the retired rows add up to** — what that work closed, and which rows cost more than the plan said and why: the paragraph somebody reads before trusting the next cost estimate. Then **what earlier rankings got wrong**, the three headings `/design` uses, sitting beside the rows it is about rather than on top of the work that is left. Anything belonging to one ticket rather than to the ordering goes on that ticket instead.

### Rules both tables hold to

- **The prose cites a row by its ticket's name**, never by a number and never by "the row above". A name still points at the right thing after the list is reordered.
- **Every row says why it is *there*, not what the ticket is.** The index already says what a ticket is. A row that only restates it is a row nobody can argue with.
- **A retired row is struck through and says what the build found** — what the plan had wrong, and what changed shape. That is the half a later reader cannot get anywhere else, and it is why the row is kept rather than deleted.
- **A claim cites the repo or the ticket.** A cost, a dependency, a "this already ships" — the same bar as a ticket's measured table.
- **Never re-plan.** A row points at a ticket. Deciding a phase in the ranking puts the decision where nobody building the ticket will look.
- **A row that has to say "phases 1–2 only" is a ticket that wants splitting.** Ranking half a file in one tier and the rest four tiers down is the ranking admitting the file holds two jobs; the annotation keeps the list honest but leaves a ticket nobody can finish. Say so in the row, and name the split as the work — `/design` on that file does it, and then each row points at a file that can be closed.

## 6. When something ships

That is [pre-release](../pre-release/SKILL.md)'s job, not this skill's: it moves the row into `done/PLAN.md` unchanged, marks the date, says what the build found, and moves the "where this stands" pointer on in the live file. Run this again when enough has moved that the *order* is wrong rather than one row.

## 7. Hand back

Say what moved and why, in plain words: which rows changed tier, what tier 0 turned up, and what the top of the list now is. Both files are in `../docs/`, so nothing in the app moved and there is nothing to bundle. The tree stays dirty.

## Reference

- `../docs/PLAN.md` — the live list. Read it for how short a row is allowed to be.
- `../docs/done/PLAN.md` — the retired rows, with what each build found.
- `../docs/README.md` — every ticket, one line each. Read first.
- `../docs/GLOSSARY.md` — tier, row, seam, track, retired row, subject folder: what each one means here.
- `/ticket` — writes the tickets this ranks.
- `/design` — fixes a ticket this finds wrong. A tier 0 row is often "run `/design` on that file".
- `/dev` — builds the top row. `/pre-release` is what retires its row once the owner says it works.

<!-- keycode: LEAF-7A15 -->
