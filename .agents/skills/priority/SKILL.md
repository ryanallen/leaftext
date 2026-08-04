---
name: priority
description: Rank every live ticket into one running order and write it to ../docs/plans/MM-DD-YYYY.md — what to build next, top to bottom, with the reason each row sits where it does. Reads ../docs/README.md and every file in ../docs/features/ and ../docs/refactor/, checks each ticket's own status against the code rather than trusting it, then ranks on three things in a fixed order: is something wrong today, how many other tickets are waiting on it, and what it costs. Tiers, numbered rows straight through, a written-out order for any subject that spans tiers, and a record at the bottom of what an earlier draft got wrong. Dated because it is a snapshot: a new run writes a new file and never rewrites an old one. Never touches git. Use when the user says "what should I build next", "rank the tickets", "make a plan", "priorities", or hands over the plan folder to be brought up to date.
argument-hint: "[optional: a subject to rank within, or a date to write as]"
user-invocable: true
---

# Build the running order

Ninety-odd tickets is more than anyone holds in their head, so the question "what next" gets answered from whichever file was open. This writes the answer down once: every live ticket, ranked, with the reason each row is where it is.

**The output is one file:** `../docs/plans/MM-DD-YYYY.md`, today's date. Nothing else is edited except the row in `../docs/README.md` if a ticket's status turns out to be wrong.

**Never run git.** **Never edit a ticket's phases.** If a ticket is wrong, that is `/refine`; if it is stale about the app, say so in a tier 0 row and fix its status, not its plan.

## Why it is dated, and never rewritten

A ranking is a snapshot of what was true and what was known on one day. The date is the point: read next to the commits around it, an old file says why something was built in the order it was. So a new run **writes a new file** and leaves every older one alone. Today's file is fair game all day — that is still the same snapshot.

The newest file in the folder is the live one. Nothing needs to say so; the name sorts.

## 1. Read before ranking

- **`../docs/README.md`** — the index, every ticket one line. It is the only thing standing between a ranking and a ticket nobody knew existed.
- **`../docs/GLOSSARY.md`** — the words this tree uses about itself. A ranking is read by somebody who did not write it, so tier, row, seam and track mean what that file says they mean. A planning word spent here and missing there gets a row there in the same pass.
- **Every file in `../docs/features/` and `../docs/refactor/`**, off the disk rather than off the index. A ticket the index missed still gets a row.
- **The newest existing file in `../docs/plans/`**, if there is one. What it ranked, what has shipped since, and which of its rows were wrong.

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

Tier 0 comes first because the list is only as good as the statuses under it. It empties as it is answered, and its rows stay struck through with what they found — a settled question is worth more written down than deleted.

## 4. The shape of the file

```markdown
# What to build next, in order — 3 August 2026

Every live ticket in `features/` and `refactor/`, ranked. One list, top to bottom: start at the top, and a row is only ready when the rows it names above it are done.

Ranked on three things, in this order: **is something wrong today**, **how many other tickets are waiting on it**, and **what it costs**.

**Where this stands.** What has shipped since this was written, and the row that is next.

Rows are numbered straight through the tiers, and the sections below the tables point at them by number — so adding a row means fixing those references in the same edit.

## Tier 1 — wrong today, and cheap (days)

| # | Ticket | Status | What is wrong | Cost |
```

Then, after the tables:

- **A subject that spans tiers gets its own section**, with its order written out step by step. A ranking puts the four table tickets in four tiers, which is right for a ranking and useless as an order — so the order is written once, and it is where a conflict between two tickets gets decided rather than warned about twice.
- **Anything deliberately off the list says so**, with what would have to be answered to schedule it. Off the ranking beats bottom of it: bottom reads as "someday", off with a reason reads as a question somebody can answer.
- **What this ordering is buying** — three or four lines on what the top of the list adds up to. It is the part somebody reads instead of the tables.
- **The record**, the same three headings `/refine` uses: what an earlier draft got wrong, checked and left alone, still open.

### Rules the tables hold to

- **Numbers run straight through every tier**, and the prose cites rows by number. Adding a row means fixing every reference to the numbers after it, in the same edit.
- **Every row says why it is *there*, not what the ticket is.** The index already says what a ticket is. A row that only restates it is a row nobody can argue with.
- **A shipped row is struck through and says what the build found** — what the plan had wrong, and what changed shape. That is the half a later reader cannot get anywhere else.
- **A claim cites the repo or the ticket.** A cost, a dependency, a "this already ships" — the same bar as a ticket's measured table.
- **Never re-plan.** A row points at a ticket. Deciding a phase in the ranking puts the decision where nobody building the ticket will look.
- **A row that has to say "phases 1–2 only" is a ticket that wants splitting.** Ranking half a file in one tier and the rest four tiers down is the ranking admitting the file holds two jobs; the annotation keeps the list honest but leaves a ticket nobody can finish. Say so in the row, and name the split as the work — `/refine` on that file does it, and then each row points at a file that can be closed.

## 5. When something ships

That is [build](../build/SKILL.md)'s last step, not this skill's: it strikes the row through, writes what the build found, and moves the "where this stands" pointer on. Run this again when enough has moved that the *order* is wrong rather than one row — a new day, a new file.

## 6. Hand back

Say what moved and why, in plain words: which rows changed tier, what tier 0 turned up, and what the top of the list now is. The file is in `../docs/`, so nothing in the app moved and there is nothing to bundle. The tree stays dirty.

## Reference

- `../docs/plans/08-03-2026.md` — the first one, with all five tiers, the table track, and the record at the bottom.
- `../docs/README.md` — every ticket, one line each. Read first.
- `../docs/GLOSSARY.md` — tier, row, seam, track, the record: what each one means here.
- `/ticket` — writes the tickets this ranks.
- `/refine` — fixes a ticket this finds wrong. A tier 0 row is often "run `/refine` on that file".
- `/build` — builds the top row, and keeps this file true as it goes.

<!-- keycode: LEAF-7A15 -->
