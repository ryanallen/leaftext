---
name: ticket
description: Write a ticket — a Markdown plan with phases and a checkbox per piece of work, so the job can be picked up cold, done in order, and ticked off as it lands. Says why, says what, and cites the repo for every claim it makes. A new capability goes in ../docs/features/, restructuring what already exists goes in ../docs/refactor/. Nothing open-ended survives the file: anything undecided is asked before writing, never left in as a question. Never touches git. Use when the user says "write a ticket", "make a plan for", "spec this out", or hands over work to be scoped rather than built.
argument-hint: "[what the ticket is for]"
user-invocable: true
---

# Write a ticket

A ticket is the plan somebody follows months later with none of this
conversation in their head. It says **why**, it says **what**, and it breaks the
work into phases with a box per piece so progress shows on the page.

**Never run git.** Writing a ticket is not a release.

## Where it goes

The ticket tree is `leaftext/docs/`, the folder beside the app — not `app/docs/`,
which is the published site.

| folder | what belongs there |
| --- | --- |
| `../docs/features/` | the app cannot do this yet |
| `../docs/refactor/` | the app already does it; this changes how |
| `../docs/done/` | shipped. Move it here when the last box is ticked |
| `../docs/canceled/` | decided against. Keep the reasoning |

Not sure which of the first two? It is a feature if a user would notice it
appear. It is a refactor if only the code changes.

The file name is kebab-case and names the thing, not the change:
`highlight-annotate.md`, `search.md`, `update-system.md`.

## Before writing: read, then ask

**Read the repo, do not remember it.** Every claim in a ticket is checked against
the code, and it carries the line it came from — `src/format.rs:41`, not "the
format table". A plausible claim that is false sends the next person down a dead
end, and they will trust the file over the code.

**Then ask about anything still open.** A ticket with a question in it is not
finished. Use the question tool, one round, before writing a word:

- Two ways to build it, and the choice changes the phases
- Something the app has no precedent for
- Scope that could reasonably stop at half

The answers go in the file as decisions, with the reason. There is no "decisions
still open" section, no TBD, no "confirm this before building". If a thing genuinely
cannot be known until code is written, that is not a question — it is **phase 0**:
one grep, one measurement, spelled out as a box.

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

The measured table is the part that makes a ticket worth having. It is also the
part that goes stale — so cite, and never write a row you did not open.

## Phases

Each phase ships on its own and is worth having on its own. Each opens with one
italic line saying **why it is in that position** — what it proves, or what the
next phase would otherwise be guessing at. Wrong order is the usual way a plan
costs double.

```markdown
### Phase 1 — copy, on a locked page

*Why first: it is the only one of the three that writes nothing. Every later
phase rides on the same plumbing.*

- [ ] Move the lock check off the early return and onto the buttons
- [ ] Copy uses the clipboard path `decorate.js:1176` already ships
- [ ] Test: the bar appears on a locked document; bold and headings do not
```

A box is one piece of work with an obvious done. "Make search fast" is not a box.
Tests get their own boxes, in the phase that needs them.

End the phase list with the block that closes every phase:

```markdown
### Every phase ends the same way

- [ ] `just bundle-tokens`, `bundle-icons`, `bundle-gallery` for anything that touched `design/`
- [ ] `/check`
```

Drop the bundler line when the work is nowhere near `design/`.

## Working a ticket later

Tick the box — `- [x]` — as each piece lands, in the same edit as the code. A box
that will not be done is struck through with the reason beside it.

When the last one is ticked, move the file to `../docs/done/` and put a note at
the top saying it shipped and where the code is:

```markdown
> **Done and shipped.** Kept for the reasoning, not as work. `lib.rs:139` joins
> the fragments and serves them as `app.js`. Checked 2 August 2026.
```

## Reference

- `../docs/features/highlight-annotate.md` — measured table, phases, a phase 0.
- `../docs/refactor/inline-link.md` — short, and shows the shipped note.
- `../docs/refactor/update-system.md` — how several tickets share a phase order.

<!-- keycode: LEAF-6C9B -->
