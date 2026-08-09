---
name: dev
description: Build a ticket from its path under ../docs/features/, ../docs/refactor/ or ../docs/fixes/. Designs it when needed, works its phases in order, checks each phase, drives what it can reach, and stops at the owner's box. Use when the user says "build this", "dev this", "work that ticket", or "do the plan".
argument-hint: "[path to the ticket]"
user-invocable: true
---

# Dev

Read the ticket, its index row, `../docs/PLAN.md`, and `../docs/GLOSSARY.md` before building. If the ticket has no dated `Designed` line, run `/design` before writing code.

When implementation starts, set its live plan stage to `In development`. Keep the stage synchronized with the ticket: `Ready`, `Designed`, `In development`, or `Released for test`.

Work phases in order. Tick each box in the same edit as its code and test. Run `/check` after each phase and at the end. Drive what the running app can reach; name anything that needs the owner's gesture in the ticket.

Build the phase's test box with its code, and write the test's name on the box. Where the ticket asks for a test but does not say where it goes, design it — [`/sync-tests`](../sync-tests/SKILL.md) holds the table and the naming rule — and record the choice in the ticket as a decision. Where a phase has no test box at all, write one and build it rather than shipping the code bare; only a real window, live selected text or a held pointer excuses one, and that is struck on the box with the reason.

A test gap outside this ticket is its own ticket, written with [`/ticket`](../ticket/SKILL.md) and ranked by [`/pm`](../pm/SKILL.md) in the same pass. Never fix it in passing and never leave it in the hand-back: a diff that grows tests for code this ticket did not touch is one nobody can review, and it is always a ticket.

## Refining what was built goes in the ticket, every round, unasked

**The rounds after the first hand-back are where the ticket is actually decided, and they are the ones most often lost.** The owner looks at the built thing, sends a picture and says what is wrong; that picture and that call are evidence the plan never had, and leaving them in the transcript means the next reader gets a file describing something nobody shipped. Filing them is part of the round, not a thing to be asked for.

- **Every picture the owner sends is saved and embedded, in the same edit as the fix.** [`/ticket`](../ticket/SKILL.md)'s rule holds here unchanged — `../docs/imgs/`, named after the ticket with `-2`, `-3` for the later ones, embedded under the line it is evidence for with alt text saying what is in the frame. A picture of something wrong goes beside the paragraph saying it was wrong.
- **A change the owner asked for is written into the phase it belongs to**, on the box, in the present tense, saying what the file now does and that the plan said otherwise — and the box stays ticked. A phase whose boxes still describe the refused version is a phase that will be built again that way.
- **Each phase ends with its record**, under a bold line: what changed while building, what the owner turned down, and what was found by looking at the built thing. Say what was tried and failed where a later reader would otherwise try it again; do not say who said it or when the session ran.
- **A refinement that moves the interface owes the drawing too.** Where the shipped thing no longer matches `## What it looks like`, say so under that section rather than redrawing it — the picture is the plan as approved, and the record below the boxes is what happened to it.

**Ask the other skills rather than doing their job badly.** [`/design`](../design/SKILL.md) when a round opens a real fork, when the ticket's own words turn out to be false, or when a change reaches past what the phases cover — it decides and records, and this skill does not. [`/ticket`](../ticket/SKILL.md) when a round turns up work that is not this ticket's: a second file and a row in the index, ranked by [`/pm`](../pm/SKILL.md) in the same pass. Neither needs the owner's permission to be run; needing one and not running it is what the owner has to ask for twice.

Stop at the owner's box. Do not run `/done` or `/git-release` yourself. Hand back whether anything is broken and the gestures needed for the owner's box. If the work is complete but not shipped, say to run `/git-release` next.

<!-- keycode: LEAF-2F4B -->
