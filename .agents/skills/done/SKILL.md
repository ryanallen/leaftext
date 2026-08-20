---
name: done
description: Retire a ticket on the owner's word, at any status. Moves it into ../docs/done/, updates the README and both plan files, syncs docs, checks the tree and reranks the live work. Use when the owner says a ticket works, says "mark it done", or says "close the ticket".
argument-hint: "[ticket path]"
user-invocable: true
---

# Done

Retire a ticket on the owner's word. **Closing is the owner's call.** Never refuse and never infer it. Any status closes, open boxes and all.

**<!-- shared-rule: struck-owners-box -->A struck owner's box is not the owner's word.<!-- /shared-rule -->** It says the subject has nothing to press; it does not say the owner has seen what was built. So [`/dev`](../dev/SKILL.md) never runs this skill, a plan carrying one stays live until the owner asks, and `/check` leaves it alone.

With no argument, take a live ticket at `Released`.

1. Add the shipped note — `> **Shipped 18 August 2026, 9:11pm, v1.21.2.**` — and keep the dated `Designed` line.
2. Move the ticket into the matching folder under `../docs/done/` and fix its relative links. Take the links pointing *at* it with it: search both trees for its file name and repoint every one, or `/check` fails naming each.
3. Rewrite its README row to say what shipped, and **move it out of the live half into the `## Shipped` table for its subject** — the index is navigated by heading, so a row left where it was reads as work that is waiting however its words are rewritten. Seven sat that way at once. `scripts/check-plan.mjs` refuses one now, naming the heading it belongs under.
4. Remove its live row from `../docs/PLAN.md` and move it into `../docs/done/PLAN.md`, its `Status` cell rewritten to the date and time it closed. **It lands inside the `## Retired from tier N` table for the tier its live row sat in**, in that table's own closing order and with a cell for every column that table's header names — a tier with no table there yet gets one. Never above the file's title: that file is read by the tier a row was retired from, and a row dropped at the top belongs to no tier and sits under no header, which is how 30 of them once came to open it. Empty a tier that its going leaves with no rows. Keep the live file starting with its title, `# Leaftext Plan Log`, and its first work table the first thing under it; put its count line, summary, and other notes after the work tables.
5. Sync any published pages made false by the change — the development pages included, when the work added a test subject file, a check, or changed how a skill works.

**Every date this pass writes carries the time beside it** — the shipped note, the README row, the `Status` cell of the retired row — read off this machine's clock (`Get-Date`) as it is written. Several tickets close in one afternoon, and a day is the same six words on all of them, so nothing says which shipped first or how long ago the last one did. `AGENTS.md` holds the rule; `just check-docs` refuses a date written from `2026-08-19` on with no time after it.

Then run `/sync-docs`, `/code-comments`, `/check`, and `/pm`, in that order. Do not run git. Where a box never shipped, strike it with what is missing, so the file does not claim it.

Hand back whether anything is broken and what the owner must press. If the ticket is released but not done, tell the owner to run `/done`.

**Anything this pass finds that it is not here to do is a ticket, written before the hand-back** — with [`/ticket`](../ticket/SKILL.md), its row in `../docs/README.md`, ranked by [`/pm`](../pm/SKILL.md). Naming it in a reply instead is the failure `AGENTS.md` refuses: saying a thing is out of scope proves you found it and handed the filing back to the owner.

<!-- keycode: LEAF-6C31 -->
