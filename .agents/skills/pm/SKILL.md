---
name: pm
description: Rank every live ticket into ../docs/PLAN.md and keep the shipped, canceled and on-hold folders true. Wrong today first, then dependencies, then how much a row unblocks; only the owner moves work on or off hold. Use when the user says "what should I build next", "rank the tickets", "make a plan", "priorities", or hands over the plan folder to be brought up to date.
argument-hint: "[optional: a subject to rank within]"
user-invocable: true
---

# Build the running order

[`../docs/PLAN.md`](../../../../docs/PLAN.md) is read to answer one question: what do I pick up now. Every live ticket, ranked, one line of why each row sits where it does. Rewrite it in place — git holds every older ranking, and the last line of the file stamps when this one was ranked, to the minute.

[`../docs/done/PLAN.md`](../../../../docs/done/PLAN.md) holds the retired rows. Moving one there is [`/done`](../done/SKILL.md)'s job, not this skill's, so a row leaves the live file the day its last box is ticked and the list gets shorter as work ships.

[`../docs/canceled/PLAN.md`](../../../../docs/canceled/PLAN.md) holds the refused ones — the third of the three, and the one nothing else writes. **Canceling is the owner's call and no skill's**, so there is no `/done` for it: a plan is moved into `../docs/canceled/` and this pass is what gives it a row, by walking that folder rather than by being told (step 9).

[`../docs/on-hold/PLAN.md`](../../../../docs/on-hold/PLAN.md) holds work the owner has paused. It is outside the running order without being refused: the ticket keeps its stage and track, and its row records the live folder it returns to. **Only the owner's word moves a ticket in or out.** This pass performs that move, fixes every link to the ticket and rebuilds both lists.

**Never run git. Never edit a ticket's phases.** A ticket that is wrong is [`/design`](../design/SKILL.md)'s work; here it gets a tier 0 row and a corrected status. Outside the four rankings this pass edits a ticket only to add or remove its on-hold note on the owner's word; it also edits the ticket's README row, a glossary row, and a track's step order where this pass proves it wrong.

## Ordered pass

### 1. Read every live ticket and index row

Open the README, the four plan files, the tracks, the glossary and every live and held ticket before ranking.

### 2. Re-derive every status

Read dated lines and boxes from each ticket and rebuild the status cells.

### 3. Rank wrong work, dependencies and what a row unblocks

Apply the three tests in order, reading each track's declared waits as the dependency test, and file anything that cannot honestly be ranked.

### 4. Put every row in its tier and sub-band

Use the tier definitions and each row's own `Blocked by` cell; held work is not a tier.

### 5. Rewrite the live table

Write one numbered row per live ticket with its track and one-sentence reason; the two blocker columns and `Devs with` are computed in step 10.

### 6. Keep the glossary and tracks true

Add missing planning words and correct a proved-wrong subject order.

### 7. Recheck the release kind

Hold every ticket folder to the version class the release skill will read.

### 8. Read the shipped plan

Confirm every retired row remains inside the tier table it left.

### 9. Rebuild the canceled and on-hold plans

Walk both folders and write one row for every ticket there.

### 10. Rebuild derived cells and check all six files

Bundle status, the two blocker columns and `Devs with`, in that order, then stamp the ranking and run the plan checks.

### 11. Hand back

The whole reply is the owner's message, word for word.

## 1. Read first

- **The ticket index, all four files of it** — [`../docs/README.md`](../../../../docs/README.md) is the live rows and [`../docs/done/README.md`](../../../../docs/done/README.md), [`../docs/on-hold/README.md`](../../../../docs/on-hold/README.md) and [`../docs/canceled/README.md`](../../../../docs/canceled/README.md) are the archive, one line per ticket and the source of every ticket path. Walking for a ticket with no row means reading all four, because a row is written in the index of the folder the ticket sits in.
- [`../docs/GLOSSARY.md`](../../../../docs/GLOSSARY.md) — the words the ranking is written in.
- [`../docs/TRACKS.md`](../../../../docs/TRACKS.md) — the map and the index of the subject orders, one row per track; each order itself is a file under [`../docs/tracks/`](../../../../docs/tracks/), named by the track's anchor. They are the source of every `Track` cell this pass writes, so read them before ranking, not after: a row is placed knowing which subject it belongs to, and a ticket whose subject has no track yet needs one written in this same pass.
- **Every ticket under `../docs/features/`, `../docs/refactor/` and `../docs/fixes/`, off the disk.** Those hold subject folders, so walk them rather than one level. A ticket the README missed still gets a row.
- **Every file under `../docs/canceled/`, off the disk too.** That is the only way a refused plan is found: nothing announces one, and a ticket moved there with no row is a decision that exists nowhere anybody reads.
- **Every file under `../docs/on-hold/`, off the disk too.** A held ticket stays out of the live ranking until the owner restores it, and the row here keeps the live folder it returns to.
- [`../docs/done/PLAN.md`](../../../../docs/done/PLAN.md), [`../docs/canceled/PLAN.md`](../../../../docs/canceled/PLAN.md) and [`../docs/on-hold/PLAN.md`](../../../../docs/on-hold/PLAN.md) — rows already closed, refused or parked are rows not to re-rank.

## 2. Re-derive every status

**The cell is computed, so this pass runs `just bundle-plan-status` and writes no status by hand.** The ticket is the authority for how far it has itself got, and it says so in its own dated lines: `Ready` for a plan with none, `Designed` for one carrying [`/design`](../design/SKILL.md)'s line, `Dev` for one carrying the `Building since` line [`/dev`](../dev/SKILL.md) writes when it opens a phase or the one legacy `Built work confirmed` line, `Released` for one shipped and not yet retired. `scripts/check-plan-stage.mjs` refuses a cell that is not what those lines give, and names the row. When the README disagrees with the ticket, fix the README.

**There is no higher of two reports to keep any more, and the window that rule existed for is closed.** A build used to look exactly like an untouched plan for the minutes between starting and ticking its first box, so a pass deriving the cell from the file alone wrote `Dev` back down to `Designed` and the owner read a build under way as one nobody had started. The `Building since` line is written before anything else is touched, so that window has a dated line in it and the derivation needs nothing retained.

**A stage is read off the ticket and never written ahead of it.** `Designed`, `Dev` and `Released` each rest on the ticket's own dated `Designed` line, so a row claiming one without it is the running order telling the owner a build is happening off a plan nobody has read against the code. A ticket with a box ticked and no design line is `Ready` with a tier 0 row saying so, never `Dev`: the cell is a report, and reporting a stage to make the row look further along is the one lie the whole tree is written to prevent.

**This pass and [`/done`](../done/SKILL.md) are the running order's only writers, and neither runs beside a build.** It is one ranked list — two rewrites of it are not something any merge can settle — and it is the one file the `Devs with` column cannot promise a pair is safe over, since the column is what says a pair *is* safe. Two sessions build in this checkout at once; ranking is not building, and it waits for both of them.

Then check in the code, not in the file:

- Does the status match the app? A ticket claiming a feature that ships, or the reverse, poisons every row resting on it.
- Does it preserve the owner’s prompts and supplied images inline where they are evidence? A supplied screenshot is its visual record for that state, not a missing wireframe.
- Is what it waits on real? Read the ticket doing the waiting — a dependency taken from one ticket's own account of another is how a plan goes circular.
- Do its citations still land?
- Does every phase say how it is proved?

What reading cannot settle is a tier 0 row, not a guess.

## 3. Rank on three things, in this order

1. **Is something wrong today** — a bug, a panic, a vault opening incorrectly, or a rule the work runs under saying something untrue. Incorrect outranks incomplete.
2. **Is it built twice if it goes second** — a piece two or more rows want is built once here or several times below.

**The dependency test reads the declared waits and nothing else.** A step's [`Waits on`](../../../../docs/GLOSSARY.md#waits-on) cell under [`../docs/tracks/`](../../../../docs/tracks/) is the one place a wait is written down, so a row waits on exactly what its steps' cells name and on nothing a track merely lists above it. A step writing `—` is a preference the track never claims, and its row is placed on the two tests either side of this one. Read them before placing a row: they are what `Blocked by` is computed from, and no row sits above what its cell names.
3. **How much it unblocks** — of two rows that tie, the one more live rows are stuck behind goes first, read off its `Blocks` cell.

The tests pick the tier in that order, then run again inside it, which is what makes a row arguable rather than a matter of taste.

**How many phases a ticket has plays no part in the ranking at all.** Not a tier, not a heading, not the order of two rows that tie. It used to be the third test and the cut a long band was made on, and it was answering a question nobody reading the running order asks: they are asking what to pick up now, and a cheap row nobody can start is a worse answer than a dear one they can. Nothing here counts a `### Phase` heading, and `scripts/check-plan.mjs` counts none either.

**Not counted:** absent is not wrong, so missing capability never reaches tier 1; a missing test is a risk, not the app being wrong; a dependency counts only where the waiting ticket names it, and a shipped ticket is not a dependency at all.

**Unrankable, because nobody can say what the work is.** The ticket stays `Ready` with the reason in its row: it changes the window and has no drawn `What it looks like` section, or its phases carry no test box. Check both over every ticket while walking the folders.

**A ticket carrying two jobs is split before it is ranked.** This is the only pass that reads every live ticket in one sitting, so it is the one that can see a file has become two — its summary sentence needs an *and* to stay true, or its phases answer more than one question. Split it at the seam with [`/ticket`](../ticket/SKILL.md): each half keeps a name of its own, a README row and a row here, and each names the other. Size alone is not the test — a big swing is a tier, not a split.

**Build upkeep is held, not ranked, and this pass is what enforces it.** A plan whose written footprint is entirely `app/scripts/`, `app/.agents/`, `app/Justfile`, `AGENTS.md` or the plan tree changes how the work gets done rather than what the app does, and the owner holds every one of them on a standing word — the ranking is for the app, and a list of the machinery's own faults crowds out the work somebody using Leaftext would notice. So a live one found at `Ready` or `Designed` is moved to `../docs/on-hold/` in this pass by the rule below, and one already at `Dev` or `Released` is left alone, because holding a build somebody is in the middle of loses it. **A picked row is left alone too, at any stage**: the owner has already said this one goes first, and a standing word cannot overrule the word they just gave. The only thing filed live off that footprint is a bug in the app itself, where the machinery is merely how it was found.

**Anything this pass turns up that is not a row gets a ticket** — a gap nothing covers, a fault nobody has filed, a rule the tree is running under that is untrue. Write it with [`/ticket`](../ticket/SKILL.md), give it its README row, rank it here in the same pass. Never a sentence in the hand-back: reading eighty tickets against the code is the pass most likely to find something, and a finding with no file is one nobody sees again.

**<!-- shared-rule: performance-finding -->Anything the work in front of this pass hints could be faster is a performance finding: file it as a ticket in the same turn, without stopping for a benchmark or fixing it in passing, and never name it in the reply.<!-- /shared-rule -->** Reading every ticket together can expose repeated planning work, a broader read than the decision needs or a wait in the workflow; the marked finding is written first, then this pass ranks it by the rule below.

**Every ticket carrying `> **Performance finding.**` belongs to the Performance track and tier 0.** `nothing-files-a-performance-finding` is the one unmarked step in that track because it builds the filing route; keep the bootstrap row in the position the owner chose rather than lifting it into tier 0.

## 4. The tiers

| Tier | What is in it |
| --- | --- |
| **0** | Somebody reading the code to settle a claim the rest of the list rests on, or a ticket carrying `> **Performance finding.**`. Marked findings are ordered inside tier 0 and never compared against features below it |
| **1** | **Wrong today.** Whatever the app, or a rule the work runs under, does incorrectly, however long it takes to put right |
| **2** | **The shared piece.** Two or more rows wait on it, so it is built once here or several times below |
| **3** | The features people would name, most-unblocking first — and the work behind them nobody would name: how the repo is built, and the published pages, where neither is wrong today, a shared piece, nor a big swing |
| **4** | Big swings, each absorbing the time all of tiers 1 to 3 take together. **On its own account** — a row behind one is put here by the blocker rule below, not by this definition |

**Above every tier sits `## Picked by the owner`, the mirror of Hold.** Hold is the owner saying not yet; this is the owner saying now. **Only the owner's word puts a row in it or takes one out** — no pass picks work because it looks urgent, and none unpicks work because it looks big. Its rows are in the order the owner named them, each carrying a `Picked` column with the day and the time of the pick, and [positions](../../../../docs/GLOSSARY.md#position) run straight through the band the way they run through a sub-band. A picked row is outside the tier definitions the way a held one is: a feature can sit there, and so can a plan whose whole footprint is build upkeep. What it costs the file is real and it is the owner's to spend: a picked row outranks *wrong today*, so one can sit above a fault somebody is meeting right now. A pick ends when its ticket retires, which is [`/done`](../done/SKILL.md)'s to clear. `scripts/check-plan.mjs` refuses the band below tier 1, a pick with no time on its date, and a picked row naming work that is not live.

Tier 0 comes first, because the list is only as good as the statuses under it and performance findings accumulate before planned features. Readings keep the claim they must settle; marked performance findings are ordered inside tier 0 and never against a lower-tier feature. **Held work has no tier or position**: move it to `../docs/on-hold/<subject>/`, move its README row under `## On hold`, keep its track step linked to the new path, and record its stage, return folder and the owner's reason in `../docs/on-hold/PLAN.md`. On restoration, reverse those moves and rank it from the rules rather than from its old position. **A tier with no rows is deleted, heading and all**, and comes back when it has one. **No estimate anywhere** — no minutes, no hours, no days.

**No row sits in a tier above its own blocker.** It is the one rule that outranks the three tests: a shared piece behind a big swing goes with the swing, and a one-line row behind one stays behind it, because a row somebody cannot start is worse than a row somebody has to scroll to.

**A long band is cut into two sub-bands on the reader's own question — can I start this.** The heading is read off the row's own `Blocked by` cell, so it is computed rather than judged and it cannot say anything untrue about the row under it.

| Sub-band | What is under it |
| --- | --- |
| `### Nothing is in front of these` | `Blocked by` is `—`: start any one of them today |
| `### Each of these waits on a row above` | `Blocked by` names a live row, and that row is above |

- **A family splits across the two, and that is the honest shape.** The trunk sits in the first and its dependents in the second; every dependent's `Blocked by` cell names the trunk and the trunk is guaranteed above it, so the chain is still readable and the two rows go on answering different questions for somebody choosing what to start.
- **A `###` heading, never a numbered band.** The number on a band says which of the three tests placed the row, and this cut moves nothing between tiers. Each sub-band gets its own table; [positions](../../../../docs/GLOSSARY.md#position) run straight through, because a sub-band holds none of its own.
- **A sub-band with no rows is not written**, the way a tier with no rows is deleted heading and all — so a band whose rows all answer the question the same way carries no heading at all.
- **Inside a sub-band, most-unblocking first as everywhere else**, except that a row never precedes what it waits on.
- **A band over half the file, holding rows on both sides of that question, must be cut.** `scripts/check-plan.mjs` reads the cells itself: it refuses a band that should be cut and is not, a row left above the first heading, and a row under the heading its own cell does not name.

**Inside tier 1, what stops somebody using the app comes before what looks wrong.** A machine that cannot install it outranks a shadow drawn the wrong way, whatever either of them takes to build.

**Size is not a test.** A tier holding most of the list is what a tree of mostly-features looks like, and no count makes a definition wrong. What makes one wrong is **asking for two unrelated things at once**, or **asking for something no row can satisfy** — three tiers emptied that way once, and the file went on calling itself ranked on three tests while sorting on one. Read the words of a definition, never the count under it.

## 5. The live file is a table

It opens with its title, `# Leaftext Plan Log`, and the first work table is the first thing under it. Counts and anything off the list go after every table.

```markdown
# Leaftext Plan Log

## Tier 1 — wrong today

| # | Ticket | Status | Blocks | Blocked by | Track | Devs with | Why |

## Tier 3 — the features people would name, most-unblocking first

### Nothing is in front of these

| # | Ticket | Status | Blocks | Blocked by | Track | Devs with | Why |

### Each of these waits on a row above

| # | Ticket | Status | Blocks | Blocked by | Track | Devs with | Why |
```

- **The number is the position**, not the ticket's identity: moving a row renumbers everything under it, and the number is never copied anywhere else. The name is what every line of prose cites.
- **`Why` is the problem and what answers it** — what the app does wrong, or cannot do yet, in the words of somebody using it, and where it helps, the thing that puts it right. It is the ticket's own `## Why` in one sentence. **Never why the row sits where it does**: the heading above it has already said which of the three tests placed it, and a placement is worth no words at all. One sentence a cell, 200 characters at the outside; `scripts/check-plan.mjs` counts every one and refuses a longer one.
- **Never a neighbor.** No `behind the row above`, no `ahead of everything under it`, no `top of the band`, no `last of the tier`, no position, and no argument for the tier the row landed in. A cell written about where a row sits is made untrue by the next reorder and nobody comes back to rewrite a hundred of them — which is how this column grew to two thirds of the file, 153 cells averaging 352 characters with the longest at 956. The check refuses those words.
- **Never a date.** When it was found, asked for or designed is the ticket's own record, and a second copy here goes stale the moment the ticket moves on. The check refuses one.
- **Nothing that belongs to the ticket** — no citation, no phase count, no box count, no account of how long it takes, no account of what it will build, no restating what the README already says the ticket is.
- **No preamble under a heading, no method, no record, no picture.** How rows are ranked is this skill; what an earlier ranking got wrong is `done/PLAN.md`'s.
- **Every ticket name is a link**, in every cell and every line of prose, using the path from the README. A bare name is a ranking error.
- **Both blocker columns are computed, never authored.** `Blocked by` is the live tickets this row's steps declare a wait on, linked, or `—`; `Blocks` is that read the other way — the three highest-ranked live rows whose `Blocked by` names this one, then the total in brackets where there are more, the way `Devs with` is bounded, because the Progress trunk blocks eighteen tickets and eighteen links is not a cell anybody reads. Both come out of the `Waits on` cells under `../docs/tracks/`, so a wait is corrected there and never here: `just bundle-waits` writes both columns and `scripts/check-plan.mjs` refuses a cell the writer would not have written. Hand-written, these were the fault — 93 rows all saying `—` while a family's trunk sat twelve rows below its own dependents, with the rule that would have refused it fed nothing.
- **`Blocked by` holds live blockers only.** A ticket that has shipped or is on hold does not block anything, so the writer drops it — which is what lets a track keep its own shipped steps in the same table the ranking reads.
- **`Track` names the subject order a row sits in** — the track's own file under [`../docs/tracks/`](../../../../docs/tracks/), linked as `tracks/<anchor>.md`, with the step or steps the ticket is there as. **Every live row carries one, and `—` is not an answer**: a subject with one ticket is a track with one step, so a ticket with nowhere to sit means the track has not been written yet, never that the cell is empty. Write it in this pass — a new file under `../docs/tracks/` named by the subject's anchor, opening with the subject as its title, one line saying what the subject is, and the step — then its row in [`TRACKS.md`](../../../../docs/TRACKS.md)'s index and its node and `click` line in the map at the top of that file. **A step table never goes in the index**: `check-plan` refuses one and names the track. The step numbers are read out of that file in this pass, never remembered or copied from an older row, and the `Why` cell does not repeat them: a track named in one cell is one cell to fix when its steps renumber.
- **A row with no track is how a subject climbs the tiers unnoticed.** Twice now a run of build-machinery rows has been ranked with an empty cell, read as loose faults on their own words, and walked up one pass at a time until they sat above the app's own work. `scripts/check-plan.mjs` refuses an empty cell, a track no heading in that file spells, and a track the ticket is not a step of — the last being the one a reader cannot see, since the link opens a real table their ticket is nowhere in. So the pass that writes a row writes its track in the same edit.
- **`Devs with` is computed, never written.** It names the three highest-ranked live rows this one shares no file with, then the total in brackets where there are more, and `—` where there are none — read off each ticket's own [`## What it writes`](../../../../docs/GLOSSARY.md#footprint) section. **This pass does not derive it the way it derives `Blocks`**: a wait is a handful of rows across the whole tree and this is 153 set comparisons a row, 11,781 in all, which is not a pass anybody makes carefully twice. So the pass runs `just bundle-devs-with` after the rows are in their final order and reads the result rather than composing it, and `scripts/check-plan.mjs` refuses a cell the bundler would not have written, one naming a ticket that is not live, and one naming a row whose footprint it shares a file with.
- **The order the three run in is the order they are written in.** Rank, then `just bundle-waits`, then `just bundle-devs-with`, then read the file back. Both bundlers order their cells by position, so running either before the rows are settled writes every cell against the old numbering — and the waits come first because the pairing drops a pair where one waits on the other, which it can only see once `Blocked by` is filled.
- **A track is its own file's, and its declared waits are what the ranking imports.** The `Track` cell says which step a row is and nothing more. A step's [`Waits on`](../../../../docs/GLOSSARY.md#waits-on) cell is the one place a wait is written down, so a step naming one is a real block and moves the row, and a step writing `—` is a preference the track never claims and moves nothing — which is why importing the whole track order was refused: 69 of the 83 out-of-order pairs in the Progress family are order nobody declared, and reading them as waits would be the ranking inventing them. So the dependency test in step 3 is the declared wait, and the two columns it feeds are computed by `just bundle-waits` rather than written here. Where this pass proves a block the other way round, the steps are swapped there in the same edit, because a track saying build this first while the ranking says it cannot be built yet is how somebody starts the blocked one. **Two live tickets on one subject is one track, not two**, so a subject the ranking is carrying in three separate cells gets one written instead — and a ticket is a step of exactly one track, named in one cell, however many other tracks mention it in their prose.
- **Every parked workflow ticket is a step of [`Process upkeep`](../../../../docs/tracks/process-upkeep.md), under `on-hold/workflow/`, and belongs nowhere else.** None returns to the live list because a pass found one urgent — only the owner restores one. A held plan about a check or the gate that already sits on a track of its own keeps it, under `on-hold/repo/`.
- **Off the list** — a sentence, with what would put it back. Off with a reason beats bottom of the list.
- **The last line stamps the pass with the date and the time** — `**Last ranked 16 August 2026, 8:49pm.**`, then the three counts. The file is rewritten in place, so that stamp is the only thing telling a reader which pass they are holding, and a date alone cannot answer it on the one day it matters: rank twice in an afternoon and both stamps read the same. Take both off this machine's clock and write them as they come — it keeps Mountain Standard Time, which is what Arizona keeps all year, so there is no daylight saving to correct for and no zone to convert. `scripts/check-plan.mjs` refuses a stamp with no time on it. **Every other date this pass writes carries a time the same way** — a retired row's `Status` cell, a refused row's date — because a day is not an answer to when in a tree that fills one; `AGENTS.md` holds the rule and `just check-docs` refuses a date written from `2026-08-19` on with no time after it.

If a cell needs more words, the ticket is what needs them.

## 6. Every word this file spends has a glossary row

[`../docs/GLOSSARY.md`](../../../../docs/GLOSSARY.md) is what makes the ranking readable by somebody who did not write it, so a planning word spent here and missing there gets a row in this pass. That covers the ones easiest to miss: **each column heading whose meaning is not its own name**, **each status value**, tier, row, position, track, step, and anything off the list. `Why` needs none: the heading is the definition.

**A row is one or two sentences saying what the word means today**, with a link to whatever owns it. No history, no dates, no counts of how many files carry it — that is a log, and it belongs in a ticket. A word nothing uses any more loses its row.

## 7. Which folder a ticket sits in is the version it ships under

`features/` takes the middle number up and the last back to zero; `refactor/` and `fixes/` take the last number up one. [`/git-release`](../git-release/SKILL.md) reads the folder and does what it says, so a ticket filed wrong ships under the wrong number — and this is the only pass that walks all three folders. `features/` is the app not doing something yet, `refactor/` is doing it differently, `fixes/` is doing it wrong today. Move it, fix its README row, and write the move into its row. **No version number goes in `PLAN.md`.**

## 8. The shipped file

`../docs/done/PLAN.md` is retired rows and nothing else: one table per tier, each row struck through with the date and time it closed and what the build found. That is the half a later reader cannot get anywhere else. It ends with what the retired rows add up to, and what earlier rankings got wrong. A row is cited by its ticket's name in both files.

**The columns are its own, not the live file's.** Tiers 1 to 3 carry `Ticket`, `Status`, what was wrong and what landed, and `Cost`; tier 0 carries `Work`, `Status` and `Why first, and what it found`. The live file's seven columns do not travel: a position is dropped on the way across, a track stays readable in its own file, and `Blocks` and `Blocked by` are questions about work that is left.

**Every row sits inside one of those tables**, under the heading for the tier it was retired from. Nothing goes above the file's title — a row there belongs to no tier and sits under no header row, so the file opens as a headerless table and nothing retired can be found by where it was ranked. [`/done`](../done/SKILL.md) is what places a row; `scripts/check-plan.mjs` refuses one left outside a table or short of its header's cells.

## 9. The canceled file

`../docs/canceled/PLAN.md` is every plan decided against, grouped the way that folder's own subject folders are, each row struck through with the date and time it was dropped and the reason. **It exists because a refused answer that is only deleted comes back** — somebody reads the same fault six months later, reaches the same idea, and rebuilds the thing that was already thrown out. So a row says what it was, what killed it, and what came out of it that is still worth having.

- **Walk the folder, do not wait to be told.** A file there with no row gets one in this pass. A row here whose file is gone loses its row.
- **A canceled ticket is not a canceled fault.** Where the thing it was aimed at is still wrong, the row names the live ticket that holds it, so nobody reads the cancellation as the fault being closed.
- **The ticket keeps every word it had.** It gains a note at the top saying who canceled it and when — a canceled plan is not trimmed, and this file never becomes the only copy of the reasoning.
- **A date it never recorded is a `—`**, not a guess.

## The on-hold file

`../docs/on-hold/PLAN.md` is every plan the owner paused, grouped by subject. Its row keeps the stage already reached, the live folder it returns to, when the owner paused it and why. A held ticket is neither live nor refused, so it has no position and no tier.

- **Only the owner moves one.** A ranking pass never parks work because it looks costly or restores it because it looks urgent. Build upkeep is the one standing instruction: the owner has already said every such plan is held, so this pass performs that move without asking again — and no pass ever restores one.
- **Move the file and every link.** The ticket goes to the matching subject folder under `on-hold/`; its track step stays in place and points at the new path.
- **Keep the return kind.** The row records `features`, `refactor` or `fixes`, so restoring it does not guess which release class it had.
- **A date the earlier Hold band never recorded is `—`.** The migration date is not the date the owner made the decision.

## 10. The six files know each other

The tree is read from whichever file somebody opens first, so each one names the rest: [the live index](../../../../docs/README.md) says what every live plan is and names the three archive indexes beside it, [`PLAN.md`](../../../../docs/PLAN.md) what is left, [`on-hold/PLAN.md`](../../../../docs/on-hold/PLAN.md) what is paused, [`done/PLAN.md`](../../../../docs/done/PLAN.md) what shipped, [`canceled/PLAN.md`](../../../../docs/canceled/PLAN.md) what was refused, and [`TRACKS.md`](../../../../docs/TRACKS.md) the index of the subject orders cutting across them, each one a file under [`tracks/`](../../../../docs/tracks/) — with [`GLOSSARY.md`](../../../../docs/GLOSSARY.md) holding the words all six are written in. Check the links each way in this pass.

## 11. Hand back

The whole reply is the owner's message, word for word. Which rows moved and why, what tier 0 turned up and what is at the top now are all written into the list itself, which is where the owner reads them. Nothing in the app moved; the tree stays dirty.

## Reference

- `../docs/PLAN.md` — the live list. Read it for how short a row is allowed to be.
- `../docs/done/PLAN.md` — the retired rows, with what each build found.
- `../docs/canceled/PLAN.md` — the refused ones, with what killed each and what survived it.
- `../docs/on-hold/PLAN.md` — the parked ones, with their stage, reason and return folder.
- `../docs/README.md`, `../docs/done/README.md`, `../docs/on-hold/README.md`, `../docs/canceled/README.md` — the ticket index, one file per status, one line per ticket. Read first.
- `../docs/GLOSSARY.md` — the words the ranking is written in.
- `/ticket` writes them, `/design` fixes one this finds wrong, `/dev` builds the top row, `/git-release` ships it, `/done` retires its row.
