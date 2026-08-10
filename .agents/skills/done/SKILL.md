---
name: done
description: Retire a ticket on the owner's word, at any status. Moves it into ../docs/done/, updates the README and both plan files, syncs docs, checks the tree and reranks the live work. Use when the owner says a ticket works, says "mark it done", or says "close the ticket".
argument-hint: "[ticket path]"
user-invocable: true
---

# Done

Retire a ticket on the owner's word. **Closing is the owner's call.** Never refuse and never infer it. Any status closes, open boxes and all.

With no argument, take a live ticket at `Released for test`.

1. Add the shipped note and keep the dated `Designed` line.
2. Move the ticket into the matching folder under `../docs/done/` and fix its relative links. Take the links pointing *at* it with it: search both trees for its file name and repoint every one, or `/check` fails naming each.
3. Rewrite its README row to say what shipped.
4. Remove its live row from `../docs/PLAN.md` and move it into `../docs/done/PLAN.md`, its `Status` cell rewritten to the date it closed. Empty a tier that its going leaves with no rows. Keep the live file starting with its first work table; put its title, count line, summary, and other notes after the work tables.
5. Sync any published pages made false by the change — the development pages included, when the work added a test subject file, a check, or changed how a skill works.

Then run `/sync-docs`, `/code-comments`, `/check`, and `/pm`, in that order. Do not run git. Where a box never shipped, strike it with what is missing, so the file does not claim it.

Hand back whether anything is broken and what the owner must press. If the ticket is released but not done, tell the owner to run `/done`.

<!-- keycode: LEAF-6C31 -->
