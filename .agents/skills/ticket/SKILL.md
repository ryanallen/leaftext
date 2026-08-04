---
name: ticket
description: Write a ticket — a Markdown plan with phases and a checkbox per piece of work, so the job can be picked up cold, done in order, and ticked off as it lands. Says why, says what, and cites the repo for every claim it makes. A new capability goes in ../docs/features/, restructuring what already exists goes in ../docs/refactor/. Reads ../docs/README.md first so it never re-plans what the tree already shipped or turned down, and updates that index in the same edit. Nothing open-ended survives the file: anything undecided is asked before writing, never left in as a question. Never touches git. Use when the user says "write a ticket", "make a plan for", "spec this out", hands over work to be scoped rather than built, or asks what plans already exist.
argument-hint: "[what the ticket is for]"
user-invocable: true
---

# Write a ticket

A ticket is the plan somebody follows months later with none of this conversation in their head. It says **why**, it says **what**, and it breaks the work into phases with a box per piece so progress shows on the page.

**Never run git.** Writing a ticket is not a release.

## Where it goes

The ticket tree is `leaftext/docs/`, the folder beside the app — not `app/docs/`, which is the published site.

| folder | what belongs there |
| --- | --- |
| `../docs/README.md` | one line per ticket in the whole tree. Read it first; update it last |
| `../docs/features/` | the app cannot do this yet |
| `../docs/refactor/` | the app already does it; this changes how |
| `../docs/done/` | shipped. Move it here when the last box is ticked |
| `../docs/canceled/` | decided against. Keep the reasoning |

Not sure which of the first two? It is a feature if a user would notice it appear. It is a refactor if only the code changes.

The file name is kebab-case and names the thing, not the change: `highlight-annotate.md`, `search.md`, `update-system.md`.

## The index — read it first, then keep it

`../docs/README.md` is one line per ticket in the tree, grouped by subject, saying what shipped, what is planned and what was turned down. **Read it before writing a word.** Ninety-odd plans is more than anyone holds in their head, and the two ways that costs are both expensive: planning a thing this tree already turned down, or planning around plumbing that already has a ticket. The index is where a ticket finds its neighbors — the vault tickets ride on one piece of plumbing, the filter tickets share one syntax, and a plan that ignores that gets built twice.

**Then keep it.** Adding, renaming, or moving a ticket is not finished until the index matches, in the same edit:

- A new ticket gets a row in the group it belongs to — or a new group if it starts one. The row says what the ticket is in the owner's words, not the file name again.
- A ticket moved to `done/` or `canceled/` moves rows too, and the row changes from what it plans to **what it shipped, or why not**. A canceled row that does not say why is the row someone re-plans against.
- A ticket that replaces another says so in both rows, so nobody builds the old one.

The index carries no change log. Git holds when a ticket moved; the outcomes worth keeping go in `AGENTS.md`, under the rules each paid for.

**When the index and a ticket disagree, do not quietly fix it.** A ticket in `done/` whose own status line says nothing is built is a claim about the app, and only reading the code settles it. It goes in the index's **Needs a second look** table with both halves of the disagreement stated.

## Before writing: read, then ask

**Read the repo, do not remember it.** Every claim in a ticket is checked against the code, and it carries the line it came from — `src/format.rs:41`, not "the format table". A plausible claim that is false sends the next person down a dead end, and they will trust the file over the code.

**Then ask about anything still open.** A ticket with a question in it is not finished. Use the question tool, one round, before writing a word:

- Two ways to build it, and the choice changes the phases
- Something the app has no precedent for
- Scope that could reasonably stop at half

The answers go in the file as decisions, with the reason. There is no "decisions still open" section, no TBD, no "confirm this before building". If a thing genuinely cannot be known until code is written, that is not a question — it is **phase 0**: one grep, one measurement, spelled out as a box.

## The shape of the file

```markdown
# What it does, in the owner's words

> **Not built.** A plan.

Two or three sentences: what a person will be able to do, or what stops
being a problem.

## Why

The cost of leaving it alone. Numbers if there are numbers.

## What was measured

| | |
|---|---|
| the claim | `src/file.rs:203` — what is actually there |

## How it is built

Where the code goes and what each piece touches.

## Phases
```

**A paragraph is one line.** Never hard-wrap the file — `just check-wrapping` fails on one, and every reader of a ticket reflows it anyway.

The measured table is the part that makes a ticket worth having. It is also the part that goes stale — so cite, and never write a row you did not open.

## Phases

Each phase ships on its own and is worth having on its own. Each opens with one italic line saying **why it is in that position** — what it proves, or what the next phase would otherwise be guessing at. Wrong order is the usual way a plan costs double.

```markdown
### Phase 1 — copy, on a locked page

*Why first: it is the only one of the three that writes nothing. Every later
phase rides on the same plumbing.*

- [ ] Move the lock check off the early return and onto the buttons
- [ ] Copy uses the clipboard path `decorate.js:1176` already ships
- [ ] Test: the bar appears on a locked document; bold and headings do not
```

A box is one piece of work with an obvious done. "Make search fast" is not a box. Tests get their own boxes, in the phase that needs them.

End the phase list with the block that closes every phase:

```markdown
### Every phase ends the same way

- [ ] `just bundle-tokens`, `bundle-icons`, `bundle-gallery` for anything that touched `design/`
- [ ] `/check`
```

Drop the bundler line when the work is nowhere near `design/`.

## Two files finish the job, every time

A ticket nobody can find is a ticket nobody builds. So writing the plan is two-thirds of the work, and neither of the other files is optional — do both in the same pass, before handing back.

**1. The index row.** `../docs/README.md`, in the group the ticket belongs to, saying what it is in the owner's words. The rules for a row are up under [the index](#the-index--read-it-first-then-keep-it): a ticket moved between folders moves its row, a ticket that replaces another says so in both, and a row that only restates the file name is a row nobody can argue with.

**2. The running order.** The newest file in `../docs/plans/` is what somebody reads to pick up work, so a ticket missing from it is invisible however good the plan is. Put it in:

- **Written today, and today's ranking exists** — add the row to that file. It is the same snapshot, so it is fair game all day.
- **The newest ranking is from an earlier day** — run [priority](../priority/SKILL.md) and let it write today's. Never edit an old one; a ranking is dated because it is a snapshot.

A row is placed by the same three things `/priority` ranks on, in that order: is something wrong today, how many other tickets are waiting on it, then cost. **Absent is not wrong** — a capability the app never had does not reach tier 1 however big its audience. And the numbers run straight through every tier, so inserting a row means fixing every reference to the numbers below it — the tables, the prose, the tier summaries and any subject section — in the same edit. Then say in the file's own numbering note that the row was added and what moved.

Two things to check before handing back: the ticket has a row in the index, and it has a numbered row in the newest ranking. Missing either, the work is not findable.

## Working a ticket later

That is [build](../build/SKILL.md)'s job — it takes the finished ticket and does everything below, plus the index row, the running order in `../docs/plans/`, and any published page the work made untrue. What it holds itself to:

Tick the box — `- [x]` — as each piece lands, in the same edit as the code. A box that will not be done is struck through with the reason beside it.

When the last one is ticked, move the file to `../docs/done/` and put a note at the top saying it shipped and where the code is:

```markdown
> **Done and shipped.** Kept for the reasoning, not as work. `lib.rs:139` joins
> the fragments and serves them as `app.js`. Checked 2 August 2026.
```

Move its index row in the same edit, and rewrite it to say what shipped. A row still describing a plan is how `../docs/README.md` starts lying about the app.

## Reference

- `/priority` — ranks every ticket in the tree into one running order.
- `/refine` — checks a written ticket against the code before anyone builds it.
- `/build` — builds one, and moves it to `done/` when the last box is ticked.
- `../docs/README.md` — every ticket, one line each. Read first, updated last.
- `../docs/features/highlight-annotate.md` — measured table, phases, a phase 0.
- `../docs/refactor/inline-link.md` — short, and shows the shipped note.
- `../docs/refactor/update-system.md` — how several tickets share a phase order.

<!-- keycode: LEAF-6C9B -->
