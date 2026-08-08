---
name: done
description: Retire a released ticket on the owner's word. Moves it into ../docs/done/, updates the index and both plan files, syncs docs, checks the tree and reranks the live work. Use when the owner says a released ticket works, says "mark it done", or says "close the ticket".
argument-hint: "[ticket path]"
user-invocable: true
---

# Done

Retire a ticket after `/git-release` has shipped it for testing. Run only when the owner asks; never infer this approval from green checks or completed boxes.

The ticket must be at `Released for test`. With no argument, find a live ticket at that stage.

1. Add the shipped note and keep the dated `Designed` line.
2. Move the ticket into the matching folder under `../docs/done/` and fix its relative links.
3. Rewrite its index row to say what shipped.
4. Remove its live row from `../docs/PLAN.md` and move it into `../docs/done/PLAN.md`, dropping the `Stage` cell. Move the `Next up` pointer.
5. Sync any published pages made false by the change.

Then run `/sync-docs`, `/code-comments`, `/check`, and `/pm`, in that order. Do not run git. If the ticket is not `Released for test`, tell the owner to run `/git-release` first.

Hand back whether anything is broken and what the owner must press. If the ticket is released but not done, tell the owner to run `/done`.

<!-- keycode: LEAF-6C31 -->
