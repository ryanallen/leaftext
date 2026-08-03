---
name: build
description: Build a ticket, and leave the plan tree telling the truth about it. Takes one thing — a path to a ticket in ../docs/features/ or ../docs/refactor/ — and works out the rest: it runs /refine itself when nothing has dated the top of the file, holds the ticket against today's plan in ../docs/plans/, builds the phases in order, ticks each box in the same edit as the code with the test that covers it, strikes through and explains any box that changed shape, and runs /check at the end of every phase. When the last box is ticked it writes the shipped note, moves the file to ../docs/done/, rewrites its row in ../docs/README.md to say what shipped, strikes its row in the plan with what the build found and moves the "next up" line on, and fixes any page under docs/ the change just made untrue. Never touches git. Use when the user says "build this", "work that ticket", "do the plan", or hands over a ticket path to be built rather than scoped.
argument-hint: "[path to the ticket]"
user-invocable: true
---

# Build a ticket

A ticket is a plan somebody already wrote. This builds it, and leaves the plan
tree saying what actually happened — because the next person reads the tree, not
this conversation.

One argument: the ticket. Everything else is worked out from the folders.

**Never run git.** A finished ticket is not a release; that needs a
`/git-release` in the message. A dirty tree is the correct end state.

## 1. Read before building

Three files, in this order, and no code before all three are read.

- **The ticket.** Every phase, every box, and its record section at the bottom.
- **`../docs/README.md`** — its row in the index, and its neighbors' rows. A
  ticket that shares plumbing with another is one you can build twice.
- **The newest file in `../docs/plans/`** (they are named `MM-DD-YYYY.md`) — its
  row, and what that row says is waiting on it. The plan is the running order;
  the ticket is the work.

### Refine it first if nobody has

A refined ticket says so at the top, with the date it was checked:

```markdown
> **Refined 3 August 2026.** Every `path:line` opened and checked against the
> code; the plan held against `AGENTS.md`. See the record at the bottom.
```

**No line like that, and [refine](../refine/SKILL.md) runs now**, in full, before
a line of code is written — an unrefined ticket's citations have never been
opened, and building off a stale line number is how a plan costs double. It is
not a separate errand and it does not need asking about: refine it, say in one
sentence what the plan had wrong, and carry straight on into phase 1.

Refine can put one question to the owner, when a fix changes *what gets built*
rather than how it is described. If it does, answer that before building — that
is the one thing here worth stopping for.

A line with a date months older than the code is worth re-reading too, but that
is a judgment call, not a rule: if the ticket's citations still land where it
says they do, the date is only a date.

If the plan's row and the ticket disagree — the row says open and the ticket says
shipped, or the row describes work the ticket dropped — settle it by reading the
code, and fix the row. Do not build against a disagreement.

## 2. Build one phase at a time

Phases ship alone. Build them in the ticket's order and finish each one before
starting the next.

- **A box is done when the code is in and its test passes.** Tick it in the same
  edit — `- [x]` — with the name of the test that covers it on the line.
- **A box that changed shape is struck through with the reason**, not silently
  rewritten: `- [x] ~~what it said~~ — cut, because …`. Two things earn this: the
  plan asked for something the code already does for free, and the plan's box had
  no obvious done. Both go in the record section too.
- **A box that moves to a later phase says so where it was**, and appears in the
  phase that got it. A box that quietly vanishes reads as built.
- **Nothing open-ended is left behind.** If building turns up a real question the
  ticket never answered, ask it — one round, the question tool, with a
  recommendation — and write the answer into the ticket as a decision with its
  reason before carrying on.
- **Every phase ends with [check](../check/SKILL.md)**, and with the bundler line
  when it touched `design/`. A failing check is fixed, not explained past.

## 3. Notes worth writing down

The ticket's value after it ships is what it says about the ground. As each phase
lands, add to the record section at the bottom:

- **What the plan had wrong**, if reading the code corrected it.
- **What building it changed** — a decision the plan made that turned out to be
  the wrong shape, and what it is now. This is the section a later reader needs
  most, because the ticked boxes only say what happened, not why it differs from
  the plan they are reading above it.
- **Still open** — work the build touched and deliberately did not do, named so
  nobody reads it as covered. A piece of scaffolding another ticket should absorb
  goes here.

## 4. When the last box is ticked

Five edits, all in one pass. Skipping any one of them is how the tree starts
lying about the app.

1. **The shipped note** replaces `> **Not built.** A plan.` at the top of the
   ticket: what shipped, where the code is, and the date.

   ```markdown
   > **Done and shipped.** Kept for the reasoning, not as work. All four phases.
   > `store/frontmatter.rs` reads the field, `vault_corpus.rs` holds it.
   > Checked 3 August 2026.
   ```

2. **Move the file** to `../docs/done/`.

3. **`../docs/README.md`**: the row moves out of its live-plans group and into the
   shipped table, and is **rewritten to say what shipped** rather than what was
   planned. A row still describing a plan is how the index starts lying.

4. **The plan in `../docs/plans/`**: strike the row through, mark it
   `Done <date>`, and say what the build found — what the plan had wrong, and
   what changed shape. Then move the **"Where this stands"** paragraph and its
   "next up" pointer on to the next open row. Rows are numbered and the sections
   below the tables cite them by number, so fix any reference that named this one.

5. **`docs/` — the published pages.** Anything the change just made untrue is now
   a false statement on leaftext.com. Behavior a person can see gets a section or
   a line where a reader would look for it; the summary table at the top of that
   page gets its row. Then `node scripts/seo-gen.mjs` so the discovery files
   match. This is [sync-docs](../sync-docs/SKILL.md)'s job — run it if the change
   is wide, or make the edits directly if it is one or two lines.

Then `/check` once more over the whole thing, and hand back: what the app does
differently, what the build found that the plan had wrong, and where the ticket
went.

## Reference

- `/ticket` — the shape of the file being built.
- `/refine` — run first, automatically, when the top of the ticket is undated.
- `/check` — the end of every phase, and the end of the job.
- `/sync-docs` — step 5, when the change is wide.
- `../docs/README.md` — every ticket, one line each.
- `../docs/plans/` — the running order. The newest file is the live one.

<!-- keycode: LEAF-2F4B -->
