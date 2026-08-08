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

Stop at the owner's box. Do not run `/done` or `/git-release` yourself. Hand back whether anything is broken and the gestures needed for the owner's box. If the work is complete but not shipped, say to run `/git-release` next.

<!-- keycode: LEAF-2F4B -->
