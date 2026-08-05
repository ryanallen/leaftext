---
name: pre-release
description: Close a ticket the owner has said works, and leave the tree ready for a release. Ticks the owner's last box, writes the shipped note, moves the file into the matching subject folder under ../docs/done/, rewrites its row in ../docs/README.md to say what shipped, cuts its row out of ../docs/PLAN.md and pastes it into ../docs/done/PLAN.md unchanged bar the Designed cell, moves the "next up" pointer on, fixes any published page the work made untrue, then runs /sync-docs, /code-comments, /check and /pm. Never touches git — a dirty tree is the correct end state, and /git-release is the only thing that writes. Use when the owner says a built ticket works, says "mark it done", "close the ticket", or "get ready for release".
argument-hint: "[ticket path]"
user-invocable: true
---

# Pre-release

The step between "the owner says it works" and a release. [dev](../dev/SKILL.md) does everything up to that sentence; this does everything after it.

**Never run git.** A closed ticket is not a release. That needs a `/git-release` in the message the owner is sending right now, and `scripts/gate-git.mjs` refuses the write without one. A dirty tree is the correct end state — say what changed and stop.

One argument: the ticket. With none, find the one whose every box is ticked and is still filed under `../docs/features/`, `../docs/refactor/` or `../docs/fixes/` — `node scripts/check-docs.mjs` fails on exactly that, so it names the file for you.

## What has to be true before anything moves

**The owner has to have said it works, in words, in this conversation.** Not a passing check, not a green `just verify`, not a driven gesture — those are [dev](../dev/SKILL.md)'s evidence and they are not the same thing. `deleting` had every box ticked and every check green while the thing it was written to fix was still broken in the window. If that sentence has not been said, stop and say which box is waiting on it.

**Then tick it**, the real unticked box at the foot of the phases, in the same pass as everything below.

## The five edits, all in one pass

Skipping any one of them is how the tree starts lying about the app.

1. **The shipped note** replaces `> **Not built.** A plan.` at the top: what shipped, where the code is, the numbers if there are any, and the date. One line, like every other paragraph. Leave the dated `Designed` line under it alone — it says who read the plan and when, which is still true.

2. **Move the file** into the subject folder under `../docs/done/` that says what *kind* of thing shipped — `app/` what a reader got, `repo/` how the repo is built, `release/` publishing, `reference/` a document that was never a plan. This is the one move that re-files a ticket's subject: the live folders group by the part of the app, `done/` by what kind of thing it was. **Then check the ticket's own relative links still resolve** — a file that was two folders deep and is now two folders deep is fine, one that changed depth is not, and `just check-docs` does not read a ticket's links.

3. **`../docs/README.md`** — the row leaves its live-plans group for the shipped table, and is **rewritten to say what shipped** rather than what was planned. A row still describing a plan is the index lying.

4. **The two plan files.** Strike the row through in `../docs/PLAN.md`, mark it `Done <date>`, and say **what the build found** — what the plan had wrong, and what changed shape. Then cut it out of that file and paste it into `../docs/done/PLAN.md` under the tier it was retired from, **dropping the `Designed` cell on the way across**: whether a plan can be trusted has no meaning once the work is built. Back in the live file, move the **"Next up"** line on if it named this ticket, and fix any reference below the tables that did — a row is cited by its ticket's name, so a search for that name finds every one.

5. **`docs/` — the published pages.** Anything the change just made untrue is now a false statement on leaftext.com. Behavior a person can see gets a section or a line where a reader would look for it, and the summary table at the top of that page gets its row.

## Then the four skills, in this order

Order is the point: docs before comments before check, and the ranking last because it reads the tree the first three leave behind.

1. **[sync-docs](../sync-docs/SKILL.md)** — the published pages, the whole-set lint, and `node scripts/seo-gen.mjs` so the discovery files match. Run it rather than hand-editing when the change is wide; make the edits directly when it is one or two lines.
2. **[code-comments](../code-comments/SKILL.md)** — the comment bar over every file the work touched. **`just check-wrapping` skips `src/assets/`**, so a wrapped comment in a front-end fragment or in `reading.css` passes every check in the suite and is found only by reading. Read them.
3. **[check](../check/SKILL.md)** — `sync-tests`, then `just verify`. A failure is fixed and re-run, never explained past. If it touched `design/`, the bundlers first; `reading.css` is embedded in `gallery.html`, so **any** edit to the stylesheet drifts the gallery and `just bundle-gallery` is part of the pass.
4. **[pm](../pm/SKILL.md)** — re-rank what is left. Run it because the list just got shorter and the order above the gap may be wrong, not to move the row: **`/pm` does not move a shipped row out**, it only ranks the live ones and corrects an index row whose status is wrong. Edit 4 above is what moves it, and if that was skipped the ranking will happily re-rank a ticket that already shipped.

## What this skill is not

- **Not a release.** Nothing here bumps a version, writes a tag, or pushes. [git-release](../git-release/SKILL.md) does that, only on `/git-release`, and it runs `sync-docs`, `code-comments` and `check` again itself.
- **Not a build.** If boxes are still unticked, the work is not finished and [dev](../dev/SKILL.md) is the skill. This one closes; it does not write app code.
- **Not a second opinion on whether it works.** That sentence is the owner's and this skill takes it at face value.

## Say at the end

What the app does differently, in the owner's words. What the build found that the plan had wrong. Where the ticket went. What is next up now.

## Reference

- `/dev` — everything before the owner's sentence.
- `/check`, `/sync-docs`, `/code-comments`, `/pm` — the four this runs, in that order.
- `/git-release` — the release itself, and the only thing that writes to git.
- `../docs/GLOSSARY.md` — shipped note, retired row, subject folder, designed box: what each one means here.

<!-- keycode: LEAF-6C31 -->
