---
name: done
description: Retire a ticket on the owner's word, at any status. Moves it into ../docs/done/, updates the README and both plan files, syncs docs, checks the tree and reranks the live work. Use when the owner says a ticket works, says "mark it done", or says "close the ticket".
argument-hint: "[ticket path]"
user-invocable: true
---

# Done

Retire a ticket on the owner's word. **Closing is the owner's call.** Never refuse and never infer it. Any status closes, open boxes and all.

With no argument, take a live ticket at `Released`.

1. Add the shipped note and keep the dated `Designed` line.
2. Move the ticket into the matching folder under `../docs/done/` and fix its relative links. Take the links pointing *at* it with it: search both trees for its file name and repoint every one, or `/check` fails naming each.
3. Rewrite its README row to say what shipped.
4. Remove its live row from `../docs/PLAN.md` and move it into `../docs/done/PLAN.md`, its `Status` cell rewritten to the date it closed. **It lands inside the `## Retired from tier N` table for the tier its live row sat in**, in that table's own closing order and with a cell for every column that table's header names — a tier with no table there yet gets one. Never above the file's title: that file is read by the tier a row was retired from, and a row dropped at the top belongs to no tier and sits under no header, which is how 30 of them once came to open it. Empty a tier that its going leaves with no rows. Keep the live file starting with its title, `# Leaftext Plan Log`, and its first work table the first thing under it; put its count line, summary, and other notes after the work tables.
5. Sync any published pages made false by the change — the development pages included, when the work added a test subject file, a check, or changed how a skill works.

Then run `/sync-docs`, `/code-comments`, `/check`, and `/pm`, in that order. Do not run git. Where a box never shipped, strike it with what is missing, so the file does not claim it.

Hand back whether anything is broken and what the owner must press. If the ticket is released but not done, tell the owner to run `/done`.

**Anything this pass finds that it is not here to do is a ticket, written before the hand-back** — with [`/ticket`](../ticket/SKILL.md), its row in `../docs/README.md`, ranked by [`/pm`](../pm/SKILL.md). Naming it in a reply instead is the failure `AGENTS.md` refuses: saying a thing is out of scope proves you found it and handed the filing back to the owner.

<!-- keycode: LEAF-6C31 -->
