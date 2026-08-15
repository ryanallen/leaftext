---
name: dev
description: Build a ticket from its path under ../docs/features/, ../docs/refactor/ or ../docs/fixes/. Designs it when needed, works its phases in order, checks each phase, drives what it can reach, and stops at the owner's box. Use when the user says "build this", "dev this", "work that ticket", or "do the plan".
argument-hint: "[path to the ticket]"
user-invocable: true
---

# Dev

Read the ticket, its README row, `../docs/PLAN.md`, and `../docs/GLOSSARY.md` before building. If the ticket has no dated `Designed` line, run `/design` before writing code.

When implementation starts, set its live plan stage to `In development`. Keep the stage synchronized with the ticket: `Ready`, `Designed`, `In development`, or `Released for test`.

Work phases in order. Tick each box in the same edit as its code and test. Run `/check` after each phase and at the end. Drive what the running app can reach; name anything that needs the owner's gesture in the ticket.

Build the phase's test box with its code, and write the test's name on the box. Where the ticket asks for a test but does not say where it goes, design it — [`/sync-tests`](../sync-tests/SKILL.md) holds the table and the naming rule — and record the choice in the ticket as a decision. Where a phase has no test box at all, write one and build it rather than shipping the code bare; only a real window, live selected text or a held pointer excuses one, and that is struck on the box with the reason.

**A phase that adds or changes a command writes its browser line in the same edit as the code**, the way it ticks a box in the same edit. The app and a published site are one front end with two hosts under it, so a new command is two pieces of work and only one of them is obvious: the line goes in `web/preview/host.js`'s table, saying the browser answers it, will not and why, or not yet and which ticket owns it. `just check-web-commands` refuses the build without it, and the answer is decided while the code is in front of you rather than by whoever finds the dead control months later. A command whose browser answer turns out to be real work is that work's own ticket, not this phase's.

## What building turns up beside the work is its own ticket

**The failure this section exists to stop is a sentence, not a missing file.** Saying "that needs a ticket", "that is out of scope", "that is a different feature", or "that would be its own work" in a hand-back is the whole fault: you found it, you named it, and you handed the filing back to the owner, who now has to ask for the thing you were already looking at. **Write the file first and let the reply name it.** That holds when the finding answers a question the owner asked, when it is one line, when it is obviously going to be refused, and when the current phase is not finished — a refused ticket is a decision recorded and an unfiled one is a decision nobody can find. It also holds for a thing the app simply cannot do yet: absent is a ticket exactly as broken is.

**Anything found while building that no phase in this ticket would have to build anyway is a second file, written in the same pass** — with [`/ticket`](../ticket/SKILL.md), its row in `../docs/README.md`, ranked by [`/pm`](../pm/SKILL.md), and named in this ticket's record so nobody reads it as covered. Never fixed in passing, never left in the hand-back. [`/ticket`](../ticket/SKILL.md) holds the rule; this is the pass that hits it hardest, because building is where the code is actually opened.

- **A bug beside the one being fixed**, a test gap, a check that would have caught it, a rule nothing enforces: all the same answer. The test is scope, not size — a one-line fix out of this ticket's work is still a ticket.
- **The temptation here is the fix, not the box.** The code is open and the change is small, so it goes in and the ticket silently grows work the owner never read. A ticket about the find bar carrying a pager fix is one nobody can review.
- **A round that grows past the ticket is the same thing.** Where what the owner asked for is a second job rather than a refinement of this one, it is its own file — see the rounds below.
- **A ticket that turns out to be two jobs is split**, each half keeping its own name and row. That is [`/design`](../design/SKILL.md)'s call, run from here.

## Refining what was built goes in the ticket, every round, unasked

**The rounds after the first hand-back are where the ticket is actually decided, and they are the ones most often lost.** The owner looks at the built thing, sends a picture and says what is wrong; that picture and that call are evidence the plan never had, and leaving them in the transcript means the next reader gets a file describing something nobody shipped. Filing them is part of the round, not a thing to be asked for.

- **A round's asks become boxes before any of them is built.** Split what the owner said into one box per thing they will look for — every clause is its own box, including the ones that sound like an aside — and write them into the phase they belong to, under a bold line naming the round, before writing a line of code. Then work them in order and tick each in the same edit as its code, so what is built is read against what was asked rather than against what was remembered. A round taken from memory loses whichever ask came last in the sentence, every time.
- **Every picture the owner sends is saved and embedded, in the same edit as the fix.** [`/ticket`](../ticket/SKILL.md)'s rule holds here unchanged — `../docs/imgs/`, named after the ticket with `-2`, `-3` for the later ones, embedded under the line it is evidence for with alt text saying what is in the frame. A picture of something wrong goes beside the paragraph saying it was wrong.
- **A change the owner asked for is written into the phase it belongs to**, on the box, in the present tense, saying what the file now does and that the plan said otherwise — and the box stays ticked. A phase whose boxes still describe the refused version is a phase that will be built again that way.
- **Each phase ends with its record**, under a bold line: what changed while building, what the owner turned down, and what was found by looking at the built thing. Say what was tried and failed where a later reader would otherwise try it again; do not say who said it or when the session ran.
- **A refinement that moves the interface owes the drawing too.** Where the shipped thing no longer matches `## What it looks like`, say so under that section rather than redrawing it — the picture is the plan as approved, and the record below the boxes is what happened to it.

**A change to a skill, a hook or a check gets its own ticket, written in the same pass** — `../docs/refactor/workflow/`, its README row, ranked by [`/pm`](../pm/SKILL.md); [`/ticket`](../ticket/SKILL.md) holds the shape and the reason.

**Ask the other skills rather than doing their job badly.** [`/design`](../design/SKILL.md) when a round opens a real fork, when the ticket's own words turn out to be false, or when a change reaches past what the phases cover — it decides and records, and this skill does not. [`/ticket`](../ticket/SKILL.md) when a round turns up work that is not this ticket's: a second file and a row in the README, ranked by [`/pm`](../pm/SKILL.md) in the same pass. Neither needs the owner's permission to be run; needing one and not running it is what the owner has to ask for twice.

Stop at the owner's box. Do not run `/done` or `/git-release` yourself. Hand back whether anything is broken and the gestures needed for the owner's box. If the work is complete but not shipped, say to run `/git-release` next.

<!-- keycode: LEAF-2F4B -->
