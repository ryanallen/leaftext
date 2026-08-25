---
name: pm
description: Rank every live ticket into one running order and write it to ../docs/PLAN.md — what to build next, top to bottom, checking each ticket's status against the code rather than trusting it. Wrong today first, then dependencies, then cost; shipped rows live in ../docs/done/PLAN.md, moved there by /done, and refused ones in ../docs/canceled/PLAN.md, which this skill keeps by walking that folder. Use when the user says "what should I build next", "rank the tickets", "make a plan", "priorities", or hands over the plan folder to be brought up to date.
argument-hint: "[optional: a subject to rank within]"
user-invocable: true
---

# Build the running order

[`../docs/PLAN.md`](../../../../docs/PLAN.md) is read to answer one question: what do I pick up now. Every live ticket, ranked, one line of why each row sits where it does. Rewrite it in place — git holds every older ranking, and the last line of the file stamps when this one was ranked, to the minute.

[`../docs/done/PLAN.md`](../../../../docs/done/PLAN.md) holds the retired rows. Moving one there is [`/done`](../done/SKILL.md)'s job, not this skill's, so a row leaves the live file the day its last box is ticked and the list gets shorter as work ships.

[`../docs/canceled/PLAN.md`](../../../../docs/canceled/PLAN.md) holds the refused ones — the third of the three, and the one nothing else writes. **Canceling is the owner's call and no skill's**, so there is no `/done` for it: a plan is moved into `../docs/canceled/` and this pass is what gives it a row, by walking that folder rather than by being told (step 9).

**Never run git. Never edit a ticket's phases.** A ticket that is wrong is [`/design`](../design/SKILL.md)'s work; here it gets a tier 0 row and a corrected status. Outside the three rankings this pass edits only a ticket's row in [`../docs/README.md`](../../../../docs/README.md), a glossary row (step 6), and a track's step order where this pass proves it wrong (step 5). A ticket this pass finds unrankable or carrying two jobs is handed to [`/ticket`](../ticket/SKILL.md) to write or split (step 3), which is how a new file reaches the tree without this skill writing phases.

## Ordered pass

### 1. Read every live ticket and index row

Open the README, the three plan files, the tracks, the glossary and every live ticket before ranking.

### 2. Re-derive every status

Read dated lines and boxes from each ticket and rebuild the status cells.

### 3. Rank wrong work, dependencies and cost

Apply the three tests in order and file anything that cannot honestly be ranked.

### 4. Put every row in its tier and sub-band

Use the tier definitions and the phase count, with Hold changed only on the owner's word.

### 5. Rewrite the live table

Write one numbered row per live ticket with its blocks, track and one-sentence reason.

### 6. Keep the glossary and tracks true

Add missing planning words and correct a proved-wrong subject order.

### 7. Recheck the release kind

Hold every ticket folder to the version class the release skill will read.

### 8. Read the shipped plan

Confirm every retired row remains inside the tier table it left.

### 9. Rebuild the canceled plan

Walk the canceled folder and write one refused row for every ticket there.

### 10. Rebuild derived cells and check all five files

Bundle status and `Devs with`, stamp the ranking and run the plan checks.

### 11. Hand back the next skill

Name only the host command that should run next and the fault it prevents.

## 1. Read first

- [`../docs/README.md`](../../../../docs/README.md) — every ticket, one line, and the source of every ticket path.
- [`../docs/GLOSSARY.md`](../../../../docs/GLOSSARY.md) — the words the ranking is written in.
- [`../docs/TRACKS.md`](../../../../docs/TRACKS.md) — every subject order, and the source of every `Track` cell this pass writes. Read it before ranking, not after: a row is placed knowing which subject it belongs to, and a ticket whose subject has no track yet needs one written here in this same pass.
- **Every ticket under `../docs/features/`, `../docs/refactor/` and `../docs/fixes/`, off the disk.** Those hold subject folders, so walk them rather than one level. A ticket the README missed still gets a row.
- **Every file under `../docs/canceled/`, off the disk too.** That is the only way a refused plan is found: nothing announces one, and a ticket moved there with no row is a decision that exists nowhere anybody reads.
- [`../docs/done/PLAN.md`](../../../../docs/done/PLAN.md) and [`../docs/canceled/PLAN.md`](../../../../docs/canceled/PLAN.md) — rows already closed or refused are rows not to re-rank.

## 2. Re-derive every status

**The cell is computed, so this pass runs `just bundle-plan-status` and writes no status by hand.** The ticket is the authority for how far it has itself got, and it says so in its own dated lines: `Ready` for a plan with none, `Designed` for one carrying [`/design`](../design/SKILL.md)'s line, `Dev` for one carrying the `Building since` line [`/dev`](../dev/SKILL.md) writes when it opens a phase or with a box ticked, `Released` for one shipped and not yet retired. `scripts/check-plan-stage.mjs` refuses a cell that is not what those lines give, and names the row. When the README disagrees with the ticket, fix the README.

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
2. **Is it built twice if it goes second** — a piece two or more rows want, and smaller than they are, is built once here or several times below. A root *bigger* than the rows under it saves nothing by going first: that is a subject's order, which is `TRACKS.md`'s, not a tier.
3. **What it costs** — the cheaper of two rows that tie goes first.

The tests pick the tier in that order, then run again inside it, which is what makes a row arguable rather than a matter of taste.

**Cost never moves a row between tiers.** It orders rows inside one. Joining it to test 1 is what once left every expensive fault sitting in the middle of the features.

**Not counted:** absent is not wrong, so missing capability never reaches tier 1; a missing test is a risk, not the app being wrong; a dependency counts only where the waiting ticket names it, and a shipped ticket is not a dependency at all.

**Unrankable, because the cost is unknown.** The ticket stays `Ready` with the reason in its row: it changes the window and has no drawn `What it looks like` section, or its phases carry no test box. Check both over every ticket while walking the folders.

**A ticket carrying two jobs is split before it is ranked.** This is the only pass that reads every live ticket in one sitting, so it is the one that can see a file has become two — its summary sentence needs an *and* to stay true, its phases answer more than one question, or its cost is two costs, which is what makes it unrankable rather than merely large. Split it at the seam with [`/ticket`](../ticket/SKILL.md): each half keeps a name of its own, a README row and a row here, and each names the other. Size alone is not the test — a big swing is a tier, not a split.

**Anything this pass turns up that is not a row gets a ticket** — a gap nothing covers, a fault nobody has filed, a rule the tree is running under that is untrue. Write it with [`/ticket`](../ticket/SKILL.md), give it its README row, rank it here in the same pass. Never a sentence in the hand-back: reading eighty tickets against the code is the pass most likely to find something, and a finding with no file is one nobody sees again.

## 4. The tiers

| Tier | What is in it |
| --- | --- |
| **0** | Not builds. Somebody reading the code to settle a claim the rest of the list rests on |
| **1** | **Wrong today.** Whatever the app, or a rule the work runs under, does incorrectly — at whatever it costs |
| **2** | **The shared piece.** Two or more rows wait on it and it is smaller than they are, so it is built once here or several times below |
| **3** | The features people would name, cheapest first — and the work behind them nobody would name: how the repo is built, and the published pages, where neither is wrong today, a shared piece, nor a big swing |
| **4** | Big swings, each absorbing the time all of tiers 1 to 3 take together. **On its own size** — a small row behind one is put here by the blocker rule below, not by this definition |
| **Hold** | **Parked by the owner.** Rows the owner has decided not to spend on yet, kept ranked with status and order intact — always the last band in the file, written `## Hold — parked by the owner` |

Tier 0 comes first, because the list is only as good as the statuses under it. **Hold is the owner's, not this pass's**: a row moves in or out only on the owner's word, the pass keeps a parked row's status and order current where it sits, and a `fixes/` row there keeps its claim without being lifted back to tier 1 — `scripts/check-plan.mjs` allows exactly that and refuses it in any other band above 1. **A tier with no rows is deleted, heading and all**, and comes back when it has one. **No estimate anywhere** — no minutes, no hours, no days. A tier is an ordering, and a number beside it reads as a promise about a calendar nobody made.

**No row sits in a tier above its own blocker.** It is the one rule that outranks the three tests: a shared piece behind a big swing goes with the swing, and a one-line row behind one stays behind it, because a row somebody cannot start is worse than a row somebody has to scroll to.

**A long band is cut into sub-bands on cost**, because the band is already ordered cheapest first and the reader's question is how big the run under a heading is. A row's cost is the number of `### Phase` headings in its ticket — the slices it ships in — or, where the `Ticket` cell ranks a named run (`**phases 1–4**`, `**phase 1**`), the length of that run.

| Sub-band | Phases |
| --- | --- |
| `### One or two phases` | 1–2 |
| `### Three or four phases` | 3–4 |
| `### Five phases or more` | 5 and up |

- **A blocked row sits in its blocker's sub-band where that is the dearer of the two.** The blocker rule, one level down: a one-phase row behind an eight-phase one is not something anybody picks up cheaply.
- **A `###` heading, never a numbered band.** The number on a band says which of the three tests placed the row, and cost is the test that never moves a row between bands. Each sub-band gets its own table; [positions](../../../../docs/GLOSSARY.md#position) run straight through, because a sub-band holds none of its own.
- **A sub-band with no rows is not written**, the way a tier with no rows is deleted heading and all.
- **Inside a sub-band, cheapest first as everywhere else**, except that a row never precedes what it waits on.
- **A band over half the file, holding rows of more than one size, must be cut.** `scripts/check-plan.mjs` counts the phases itself: it refuses a band that should be cut and is not, a row left above the first heading, and a row under a heading its count does not name.

**Inside tier 1, what stops somebody using the app comes before what looks wrong.** A machine that cannot install it outranks a shadow drawn the wrong way however the two compare on cost.

**Size is not a test.** A tier holding most of the list is what a tree of mostly-features looks like, and no count makes a definition wrong. What makes one wrong is **asking for two unrelated things at once**, or **asking for something no row can satisfy** — three tiers emptied that way once, and the file went on calling itself ranked on three tests while sorting on one. Read the words of a definition, never the count under it.

## 5. The live file is a table

It opens with its title, `# Leaftext Plan Log`, and the first work table is the first thing under it. Counts and anything off the list go after every table.

```markdown
# Leaftext Plan Log

## Tier 1 — wrong today

| # | Ticket | Status | Blocks | Blocked by | Track | Devs with | Why here |

## Tier 3 — the features people would name, cheapest first

### One or two phases

| # | Ticket | Status | Blocks | Blocked by | Track | Devs with | Why here |

### Three or four phases

| # | Ticket | Status | Blocks | Blocked by | Track | Devs with | Why here |
```

- **The number is the position**, not the ticket's identity: moving a row renumbers everything under it, and the number is never copied anywhere else. The name is what every line of prose cites.
- **One sentence a cell, 200 characters at the outside** — what a reader of the app meets, or what it cannot do yet, in their own words. `scripts/check-plan.mjs` counts every cell and refuses a longer one. The heading a row sits under has already said which of the three tests placed it; the cell says what the row is, and the ticket says the rest.
- **Never a neighbor.** No `behind the row above`, no `ahead of everything under it`, no `top of the band`, no `last of the tier`, no position. A cell written about where a row sits is made untrue by the next reorder and nobody comes back to rewrite a hundred of them — which is how this column grew to two thirds of the file, 153 cells averaging 352 characters with the longest at 956. The check refuses those words.
- **Never a date.** When it was found, asked for or designed is the ticket's own record, and a second copy here goes stale the moment the ticket moves on. The check refuses one.
- **A row standing above what the three tests allow says so in four words** — `Here on the owner's word.` That is a fact about the row rather than about its neighbors, so a reorder leaves it true, and it is the one placement a reader cannot work out from the heading.
- **Nothing that belongs to the ticket** — no citation, no phase count, no box count, no cost breakdown, no account of what it will build, no restating what the README already says the ticket is.
- **No preamble under a heading, no method, no record, no picture.** How rows are ranked is this skill; what an earlier ranking got wrong is `done/PLAN.md`'s.
- **Every ticket name is a link**, in every cell and every line of prose, using the path from the README. A bare name is a ranking error.
- **`Blocks` is `Blocked by` read the other way** — every live row whose `Blocked by` names this one, linked, or `—`. It carries no claim of its own: the waiting ticket's cell is the source, and this one exists so a row being weighed says what sits behind it without reading the whole file. `scripts/check-plan.mjs` holds the two columns to each other.
- **`Blocked by` holds live blockers only**, linked, or `—`. A ticket that has shipped does not block anything, so naming one there reads as a wait that is over.
- **`Track` names the subject order a row sits in** — the track in [`TRACKS.md`](../../../../docs/TRACKS.md), linked to its heading, with the step or steps the ticket is there as. **Every live row carries one, and `—` is not an answer**: a subject with one ticket is a track with one step, so a ticket with nowhere to sit means the track has not been written yet, never that the cell is empty. Write it in this pass — heading, one line saying what the subject is, and the step — and add its node and its `click` line to the map at the top of that file. The step numbers are read out of that file in this pass, never remembered or copied from an older row, and the `Why here` cell does not repeat them: a track named in one cell is one cell to fix when its steps renumber.
- **A row with no track is how a subject climbs the tiers unnoticed.** Twice now a run of build-machinery rows has been ranked with an empty cell, read as loose faults on their own words, and walked up one pass at a time until they sat above the app's own work. `scripts/check-plan.mjs` refuses an empty cell, a track no heading in that file spells, and a track the ticket is not a step of — the last being the one a reader cannot see, since the link opens a real table their ticket is nowhere in. So the pass that writes a row writes its track in the same edit.
- **`Devs with` is computed, never written.** It names the three highest-ranked live rows this one shares no file with, then the total in brackets where there are more, and `—` where there are none — read off each ticket's own [`## What it writes`](../../../../docs/GLOSSARY.md#footprint) section. **This pass does not derive it the way it derives `Blocks`**: a wait is a handful of rows across the whole tree and this is 153 set comparisons a row, 11,781 in all, which is not a pass anybody makes carefully twice. So the pass runs `just bundle-devs-with` after the rows are in their final order and reads the result rather than composing it, and `scripts/check-plan.mjs` refuses a cell the bundler would not have written, one naming a ticket that is not live, and one naming a row whose footprint it shares a file with.
- **The order the two run in is the order they are written in.** The bundler orders every cell by position, so running it before the rows are settled writes 153 cells against the old numbering. Rank, then bundle, then read the file back.
- **A track is `TRACKS.md`'s.** The `Track` cell says which step a row is and nothing more, and the ranking does not import the track's order — most steps are a preference the track says so about, and only a real block moves a row. Where this pass proves a block the other way round, the steps are swapped there in the same edit, because a track saying build this first while the ranking says it cannot be built yet is how somebody starts the blocked one. **Two live tickets on one subject is one track, not two**, so a subject the ranking is carrying in three separate cells gets one written instead — and a ticket is a step of exactly one track, named in one cell, however many other tracks mention it in their prose.
- **Every ticket under `refactor/workflow/` is a step of [`Process upkeep`](../../../../docs/TRACKS.md#process-upkeep), parked in the Hold band, and belongs nowhere else.** None of them changes what a reader of the app can meet, so none of them is ever tier 1 however wrong it is, or tier 2 or 3 however cheap: a workflow fault is not a fault in the app, and a build gate going quiet is not a document opening at the wrong line. They do not leave that band because a pass found one urgent — only the owner moves a row in or out of Hold. Filing one in a tier is the failure the owner has now named twice.
- **Off the list** — a sentence, with what would put it back. Off with a reason beats bottom of the list.
- **The last line stamps the pass with the date and the time** — `**Last ranked 16 August 2026, 8:49pm.**`, then the three counts. The file is rewritten in place, so that stamp is the only thing telling a reader which pass they are holding, and a date alone cannot answer it on the one day it matters: rank twice in an afternoon and both stamps read the same. Take both off this machine's clock and write them as they come — it keeps Mountain Standard Time, which is what Arizona keeps all year, so there is no daylight saving to correct for and no zone to convert. `scripts/check-plan.mjs` refuses a stamp with no time on it. **Every other date this pass writes carries a time the same way** — a retired row's `Status` cell, a refused row's date — because a day is not an answer to when in a tree that fills one; `AGENTS.md` holds the rule and `just check-docs` refuses a date written from `2026-08-19` on with no time after it.

If a cell needs more words, the ticket is what needs them.

## 6. Every word this file spends has a glossary row

[`../docs/GLOSSARY.md`](../../../../docs/GLOSSARY.md) is what makes the ranking readable by somebody who did not write it, so a planning word spent here and missing there gets a row in this pass. That covers the ones easiest to miss: **each column heading**, **each status value**, tier, row, position, track, step, and anything off the list.

**A row is one or two sentences saying what the word means today**, with a link to whatever owns it. No history, no dates, no counts of how many files carry it — that is a log, and it belongs in a ticket. A word nothing uses any more loses its row.

## 7. Which folder a ticket sits in is the version it ships under

`features/` takes the middle number up and the last back to zero; `refactor/` and `fixes/` take the last number up one. [`/git-release`](../git-release/SKILL.md) reads the folder and does what it says, so a ticket filed wrong ships under the wrong number — and this is the only pass that walks all three folders. `features/` is the app not doing something yet, `refactor/` is doing it differently, `fixes/` is doing it wrong today. Move it, fix its README row, say so in the hand-back. **No version number goes in `PLAN.md`.**

## 8. The shipped file

`../docs/done/PLAN.md` is retired rows and nothing else: one table per tier, each row struck through with the date and time it closed and what the build found. That is the half a later reader cannot get anywhere else. It ends with what the retired rows add up to, and what earlier rankings got wrong. A row is cited by its ticket's name in both files.

**The columns are its own, not the live file's.** Tiers 1 to 3 carry `Ticket`, `Status`, what was wrong and what landed, and `Cost`; tier 0 carries `Work`, `Status` and `Why first, and what it found`. The live file's seven columns do not travel: a position is dropped on the way across, a track stays readable in `TRACKS.md`, and `Blocks` and `Blocked by` are questions about work that is left.

**Every row sits inside one of those tables**, under the heading for the tier it was retired from. Nothing goes above the file's title — a row there belongs to no tier and sits under no header row, so the file opens as a headerless table and nothing retired can be found by where it was ranked. [`/done`](../done/SKILL.md) is what places a row; `scripts/check-plan.mjs` refuses one left outside a table or short of its header's cells.

## 9. The canceled file

`../docs/canceled/PLAN.md` is every plan decided against, grouped the way that folder's own subject folders are, each row struck through with the date and time it was dropped and the reason. **It exists because a refused answer that is only deleted comes back** — somebody reads the same fault six months later, reaches the same idea, and rebuilds the thing that was already thrown out. So a row says what it was, what killed it, and what came out of it that is still worth having.

- **Walk the folder, do not wait to be told.** A file there with no row gets one in this pass. A row here whose file is gone loses its row.
- **A canceled ticket is not a canceled fault.** Where the thing it was aimed at is still wrong, the row names the live ticket that holds it, so nobody reads the cancellation as the fault being closed.
- **The ticket keeps every word it had.** It gains a note at the top saying who canceled it and when — a canceled plan is not trimmed, and this file never becomes the only copy of the reasoning.
- **A date it never recorded is a `—`**, not a guess.

## 10. The five files know each other

The tree is read from whichever file somebody opens first, so each one names the rest: [the README](../../../../docs/README.md) says what every plan is, [`PLAN.md`](../../../../docs/PLAN.md) what is left, [`done/PLAN.md`](../../../../docs/done/PLAN.md) what shipped, [`canceled/PLAN.md`](../../../../docs/canceled/PLAN.md) what was refused, and [`TRACKS.md`](../../../../docs/TRACKS.md) the subject orders cutting across the tiers — with [`GLOSSARY.md`](../../../../docs/GLOSSARY.md) holding the words all five are written in. Check the links each way in this pass: a ranking nobody can get to from the file they opened is one they plan against without.

## 11. Hand back

Say which rows moved and why, what tier 0 turned up, what is at the top now, and which number the next release moves. Nothing in the app moved; the tree stays dirty.

## Reference

- `../docs/PLAN.md` — the live list. Read it for how short a row is allowed to be.
- `../docs/done/PLAN.md` — the retired rows, with what each build found.
- `../docs/canceled/PLAN.md` — the refused ones, with what killed each and what survived it.
- `../docs/README.md` — every ticket, one line each. Read first.
- `../docs/GLOSSARY.md` — the words the ranking is written in.
- `/ticket` writes them, `/design` fixes one this finds wrong, `/dev` builds the top row, `/git-release` ships it, `/done` retires its row.

<!-- keycode: LEAF-7A15 -->
