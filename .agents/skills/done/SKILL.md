---
name: done
description: Retire a ticket on the owner's word, at any status. Moves it into ../docs/done/, moves its row from the live index into that folder's own README, updates both plan files, syncs any page the change made false, reranks the live work and reads the running order back. Use when the owner says a ticket works, says "mark it done", or says "close the ticket".
argument-hint: "[ticket path]"
user-invocable: true
---

# Done

Retire a ticket on the owner's word. **Closing is the owner's call.** Never refuse and never infer it. Any status closes, open boxes and all.

**<!-- shared-rule: struck-owners-box -->A struck owner's box is not the owner's word.<!-- /shared-rule -->** It says the subject has nothing to press; it does not say the owner has seen what was built. So [`/dev`](../dev/SKILL.md) never runs this skill, a plan carrying one stays live until the owner asks, and `/check` leaves it alone.

**<!-- shared-rule: sessions-in-one-checkout -->Two sessions build in this one checkout, on tickets the running order's `Devs with` column says share no file, and neither of them writes the running order.<!-- /shared-rule -->** This pass is one of the two that do write it, which is why it never runs beside a build.

**<!-- shared-rule: another-sessions-work -->Another session's work is not this pass's, whatever state it is in.<!-- /shared-rule -->** A ticket this pass was not pointed at is not stale, not repaired, not re-filed and not retired alongside the one it was — however its boxes read, and however finished it looks — because the session holding it is already its record and a second hand on it writes over the first.

With no argument, take a live ticket at `Released`.

### 1. Add the shipped note

Add `> **Shipped 18 August 2026, 9:11pm, v1.21.2.**` and keep the dated `Designed` line.

### 2. Move the ticket

Move the ticket into the matching folder under `../docs/done/` and fix its relative links. Take the links pointing *at* it with it: search both trees for its file name and repoint every one, or `/check` fails naming each.

### 3. Move the README row into the index of the folder the ticket lands in

The index is four files, one per status, each in the folder it describes. Rewrite the row to say what shipped, cut it out of the live index `../docs/README.md`, and write it into [`../docs/done/README.md`](../../../../docs/done/README.md) under the `## Shipped` table for its subject — or into `../docs/canceled/README.md` or `../docs/on-hold/README.md` where the ticket went there instead. **The links are spelled from the file's own folder**, so `done/reading/x.md` becomes `reading/x.md` and a live ticket the row names becomes `../refactor/…`. A row left in the live index reads as work that is waiting however its words are rewritten; seven sat that way at once. `scripts/check-plan.mjs` refuses one now, naming the file it belongs in.

### 4. Remove the live row

Remove its live row from `../docs/PLAN.md` and move it into `../docs/done/PLAN.md`, its `Status` cell rewritten to the date and time it closed. **This pass and [`/pm`](../pm/SKILL.md) are the live running order's only writers, and neither runs beside a build** — it is one ranked list, two rewrites of it are not something any merge can settle, and it is the one file the `Devs with` column cannot promise a pair is safe over. A live cell is otherwise computed, so nothing here types a stage in by hand. **It lands inside the `## Retired from tier N` table for the tier its live row sat in**, in that table's own closing order and with a cell for every column that table's header names — a tier with no table there yet gets one. Never above the file's title: that file is read by the tier a row was retired from, and a row dropped at the top belongs to no tier and sits under no header, which is how 30 of them once came to open it. Empty a tier that its going leaves with no rows. Keep the live file starting with its title, `# Leaftext Plan Log`, and its first work table the first thing under it; put its count line, summary, and other notes after the work tables.

### 5. Sync any page this retirement made false

Sync any published page made false by the change — the development pages included, when the work added a test subject file, a check, or changed how a skill works. Run `/sync-docs`, and `/code-comments` where this pass touched a comment.

**This pass runs no complete gate.** The ticket being retired here already shipped, and its code was proved at the end of its build — so the suite would prove the same bytes a third time. What this pass writes is pages and plan rows, and step 7 reads the plan back.

### 6. Rerank with /pm

Run `/pm` after the retirement edits and checks. Its `Devs with` bundler removes the retired ticket from every remaining cell, and its authored rewrite puts every remaining row back in order.

### 7. Read the running order back

Read both plan files after `/pm`. Stop if the retired ticket still appears in `../docs/PLAN.md`, is absent from `../docs/done/PLAN.md`, any remaining position is stale, or the live plan's `Last ranked` stamp is older than the shipped note.

**This is two files read against each other, and it is never a report.** Nothing it finds reaches the owner: a disagreement stops the pass and is fixed here, and the reply is the owner's own message, word for word, exactly as it would be with nothing found at all.

**Every date this pass writes carries the time beside it** — the shipped note, the README row, the `Status` cell of the retired row — read off this machine's clock (`Get-Date`) as it is written. Several tickets close in one afternoon, and a day is the same six words on all of them, so nothing says which shipped first or how long ago the last one did. `AGENTS.md` holds the rule; `just check-docs` refuses a date written from `2026-08-19` on with no time after it.

Do not run git. Where a box never shipped, strike it with what is missing, so the file does not claim it.

The whole reply is the owner's message, word for word.

**Anything this pass finds that it is not here to do is a ticket, written before the hand-back** — [`/ticket`](../ticket/SKILL.md), its row in the live index `../docs/README.md`, [`/pm`](../pm/SKILL.md).

**<!-- shared-rule: performance-finding -->Anything the work in front of this pass hints could be faster is a performance finding: file it as a ticket in the same turn, without stopping for a benchmark or fixing it in passing, and never name it in the reply.<!-- /shared-rule -->** Retirement sees the plan-tree rewrites together, so repeated work, an unnecessarily broad read or a wait is enough to file while this pass finishes the owner's close.
