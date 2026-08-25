---
name: design
description: Design a ticket before anyone builds it. Watches the fault happen in a running copy before it will name a cause — and where nothing can watch it, files the tooling that would as a ticket in front of this one rather than guessing. Then opens every line it cites against the code, holds the plan against the rules this repo already paid for, fixes what is wrong in place, draws it — a photographed wireframe where it touches the window, a flow where it does not, and never a ticket left with no picture — dates the top of the file, and records what was wrong at the bottom. Never edits app code. Use when the user says "design this ticket", "review this plan", "check this ticket", or hands over a Markdown plan written by /ticket.
argument-hint: "[path to the ticket]"
user-invocable: true
---

# Design a ticket

A ticket is followed months later by somebody with none of the conversation in their head. They will trust the file over the code. So this proves the cause before it solves it, reads the file against the code, decides between the researched options, fixes what is wrong in the plan, draws it, and says at the bottom what was wrong — because the same doubtful part attracts a second reviewer, and they should not have to redo the thinking.

**Nothing is designed on a guess** — step 1a. A cause is watched happening in a running copy, or the ticket carries the smallest earlier phase that makes it watchable. Everything below is a way of being wrong more slowly; this is the way of not solving the wrong problem at all.

**Every ticket comes out of this pass with a picture in it** — step 6a. A plan handed on as prose alone is one where whoever builds it draws it in their own head instead. A supplied screenshot is that picture for the state it shows: keep it inline and do not redraw it.

**Never run git.** **Never edit app code.** A wrong plan is fixed in the plan. If the ticket turns out to describe a shipping bug in its own subject, it stays a box in the ticket — fixing it is a separate job with its own `/check`. Work this pass finds that makes the ticket's own change work belongs in an earlier phase of this ticket — step 5b.

Written for the tickets in `../docs/features/`, `../docs/refactor/` and `../docs/fixes/`, each of which groups its files into subject folders. Read [ticket](../ticket/SKILL.md) first: it is the shape this holds a file to.

**It runs mid-build as well as before one.** [`/dev`](../dev/SKILL.md) calls it when a round of refinement opens a real fork, when a line the plan rests on turns out to be false, or when what the owner asked for reaches past the phases — and it answers the same way it would on a cold ticket: decide from the code and the repo's rules, fix the plan in place, leave the record. A phase already built is not evidence a decision was made; the ticket is.

## 1. Every citation is opened

A ticket earns its keep with the measured table — the claim beside the line it came from. That is also the part that rots.

- Open every `path:line` in the file. The line moves; the claim can stop being true entirely.
- Fix the line number silently. A claim that is now **false** is not a silent fix — it goes in the record at the bottom.
- A claim with no citation is either checked and cited, or cut.
- Names get opened too. A ticket that says a function will be called with a string, when it takes a struct, sends the next person the wrong way.
- **A flow diagram is a measured table drawn sideways, so every node and every edge is opened.** A node is a real thing or it is cut; an edge is a call that exists, or one this ticket is adding and says so. A drawing reads as settled in a way a sentence does not, which is exactly why a wrong one costs more — see step 6b.

Read the repo, do not remember it. A plausible sentence that is false is worse than no sentence.

## 1a. The cause is proved, never inferred

A ticket names a cause, and every part of the file downstream rests on that one sentence — the phases, the drawing, the record. It is also the part reading the code cannot settle on its own. Two true facts side by side are not a mechanism: the path may never run, a guard above it may answer first, something later may already win. **So this pass either watches the fault happen, or says on the file that nobody has.** A fix designed against a guessed cause is worse than no plan, because it ships, passes its own tests, and leaves the symptom exactly where it was.

**Watch it rather than reason to it.** A copy of the app answers questions and takes gestures, so the cause is observed instead of argued: `just ask '{"ask":"state"}'` for what it has open, `log` for what it has printed, `eval` to run a line in the page and read a real value back, `idle` to wait for a render, `doc` for a document's own source and spelling, and `just drive` for what the page never sees — a wheel, a real drag, a native menu, the file dialog. `just drive-web` does the same to the published site. Make the gesture the ticket describes, in its own words, then read back the thing that is wrong. **Never take the owner's focus**: drive a copy this session launched, and against the one they are reading ask with `eval`, which needs none.

**Then attack it.** One candidate that agrees with itself is a guess with citations under it. Spend a step trying to make it false — take away the piece it blames and watch the fault go, or find the case where the same path does the right thing and say what is different there. A cause that survives that is a cause; one that was never pushed on is a hypothesis the ticket is about to call a finding.

**Whether a pass may go on unwatched turns on one question: did the code decide the cause, or did this pass choose it?** A guard whose condition provably differs, an arm that provably renders one thing, a value a test in the tree already pins — reading settles those, the pass goes on, and the line at the top says `cause inferred, not watched` with the measured row saying what makes it certain. Anything where two explanations both fit the evidence — an ordering, a timing, a state nobody has printed, a fault reported out of the window rather than found in the code — is not settled by more reading, however much of it. Watch that one or stop; a long enough argument for the wrong cause is the exact thing this step exists to catch, and it always reads as thorough.

**The proof is a row in `## What was measured`, written as what was seen.** The table's other rows are readings of the code; this one is a reading of the app, and it says which it is — the gesture, and the value that came back. Without it a reader cannot tell the sentence that was observed from the four that were deduced.

**Where nothing here can see it, the tooling is the work and it goes first.** A fault inside the host with no ask that answers for it, a state the page cannot be asked to show, a gesture the driver has no verb for: none of those is a reason to design on a guess. Put the smallest tooling needed to observe this ticket in its earlier phase — the verb, the step, and the reading it has to give back — then design the phase it makes watchable. **Do not add a `Blocked by` or `Blocks` entry, rerank the ticket, or place it in Hold: only the owner may place work in Hold.**

**Launch your own copy and watch the fault in that one.** `just probe-copy <document>` puts a copy up beside the one the owner is reading, under an account name and profile folders of its own, and every ask and every tool lands on it until `just probe-close`. So a change that has not shipped is watched in a build of it rather than reasoned about: the copy the owner is running is whatever was last installed, and the change being designed is not in it. On a Mac there is no launcher yet — [`a-mac-cannot-launch-a-copy-beside-the-owners`](../../../../docs/refactor/workflow/a-mac-cannot-launch-a-copy-beside-the-owners.md) — and there a ticket needing a real window says so rather than guessing.

**The honest answer is an earlier phase.** Tooling that has to exist before anybody can see the fault is phase 0 or phase 1 in this ticket, spelled out as boxes. A single reading that only makes sense once the code is open is phase 0 too. Anything else is a guess, and a guess that cannot be removed either way is marked as one, in that measured row and in `### Still open`, with the phases held to what the evidence actually carries.

## 2. The plan is held against the rules

Each of these cost a version number, and a ticket that walks into one will be built before anyone notices. `AGENTS.md` is the list; these are the ones plans get wrong.

| The rule | A ticket breaks it by |
| --- | --- |
| `format.rs` is the only table of formats | keeping a second list of extensions anywhere |
| `design/` is the source of a value | a color, size or duration written into a rule; a per-theme palette; an edit to a generated file |
| Every class is in `design/components.md` | new interface with no row, so `just check-classes` fails after the work is done |
| `src/assets/shell/` is one scope in order | a fragment that is not a whole program, or state in `state.js` only one fragment touches |
| Never crawl the disk | anything that walks a tree the user did not point at |
| Paths are a contract | moving where user data lives |
| A crate is a security boundary | a dependency added without the transitive cost and the platform alternative |
| Only `/git-release` writes git | a phase that commits, tags or pushes |
| Windows and macOS only | a Linux path coming back |
| Raw HTML is a security boundary | hostile input reaching the web view around `rawhtml.rs` |

Where a rule applies, the ticket should name it rather than merely avoid it — the next person needs to know the constraint was seen.

## 3. It stays fast

Slow is the failure nobody reports; they just stop opening files with it.

- **Nothing new on the way to first paint.** Work at startup, per open, or per keystroke needs a number in the ticket, not an adjective.
- **The page script has a real ceiling** — the fragments reach the web view as one string, near 2 MB. A ticket that grows it says by how much. A vendored file served over `leaf-asset://` does not pay that, so do not spend the constraint where it does not apply.
- **`just verify` is the gate everyone runs.** Anything a ticket adds to it has to stay offline and stay quick. Work that needs the network or a big corpus gets its own target, run on demand.
- **A cost with no measurement is not a finding.** Say you do not know.

## 4. No hacked-in shortcuts

The tell is a plan that gets green without the thing being true.

- A check loosened, skipped or flagged past instead of a cause fixed.
- A test that passes by doing nothing — the corpus was missing, the case was filtered out — with no line saying so where someone will see it. `cargo test` hides output on a passing test.
- A known-failure list keyed loosely enough to swallow the next real bug.
- A second copy of something that already has one source.
- A crash or a hang tested in the same process as everything else: a panic fails one test, a stack overflow ends the run.
- "Phase 4 will handle it" where phase 4 has no box for it.

## 5. The phases hold

- **Every phase is buildable off this repo plus the phases above it.** Read what each phase needs, and ask which of it exists. Where the current change needs setup that does not exist, add that setup as an earlier phase in this ticket. Split only when the owner has asked for independent work to be planned separately.
- **A file keeps its coupled work together.** This pass asks whether each phase is needed for the ticket's outcome; if it is, it stays in the file as an earlier or later phase. Split only independent work the owner has asked to separate.
- **A phase that cannot be watched working begins with the tooling that watches it.** Step 1a's seam is the same seam: where the app cannot be asked whether the phase did what it says, the ask or the driver step that would answer is an earlier phase in this ticket. Only the owner may place work in Hold. A phase proved only by the code compiling is a phase nobody has seen run.
- Each phase ships alone and is worth having alone.
- The italic line says why it is in that position, and is true — phase 2 must really need what phase 1 proved.
- A box has an obvious done. "Make it fast" does not.
- Tests have their own boxes, in the phase that needs them — step 5a is the pass that checks it.
- Every phase ends with `/check`, and with the bundler line if it touched `design/`.
- Nothing open-ended survives: no TBD, no "decide later", no question left in the file. Something genuinely unknowable until code exists is **phase 0** — one grep, one measurement, spelled out as a box.

If a fix changes what gets built rather than how it is described, choose among the ticket's researched options from the code and the repo rules, then record the decision and its reason. Ask the owner only when the ticket's intent cannot be established from the request or the evidence; do not send a build choice back to the ticket author.

## 5a. Every phase says how it is proved, and this pass checks it against the suite

**A phase with no test box is a phase this pass writes one for.** [ticket](../ticket/SKILL.md) holds the shape; adding a missing test box is describing the same work more honestly, not changing it, so it does not wait on a question. `just verify` runs the tests that exist and nothing else asks whether the change made one necessary — which is why a plan is the cheapest place to catch it.

**Search the suite before writing the box.** The same reading this skill already does, aimed at the tests:

```bash
grep -rn "<the behavior>" src/tests/ src/app/tests.rs src/store/tests.rs scripts/check-shell/
```

- Where a test already covers the claim, **the box says so and names it** rather than asking for a second one. A phase that writes a test the suite already has is work done twice, and the second copy is the one that rots.
- **A box naming a test that does not exist is struck**, with the reason, and rewritten as the test that is actually missing. That belongs in the record: a reader trusts a named test the way they trust a citation.
- The box names the file it goes in — `src/tests/` per subject, `src/app/tests.rs` for the binary, `scripts/check-shell/` per subject for `src/assets/shell/`. A phase whose only work is a row in `design/` asks for no test; the design checks already refuse what is not listed.
- **What genuinely cannot be tested here gets its line in the phase** — a real window, live selected text, a held pointer. Never the Mac build, the installer or the workflows; [`/check`](../check/SKILL.md) step 4 holds that rule.

**A test gap this reading turns up that proves this ticket's change is a box in this ticket.**

**A ticket with no `### The owner's box` is one this pass writes it into**, on the same reasoning as a missing test box: it is describing the same work more honestly, so it does not wait on a question. It is the last box in the file, under its own heading, unticked, holding the gesture the owner makes to see the thing in what they will look at — [ticket](../ticket/SKILL.md) holds the shape, and a subject with genuinely nothing to press gets the box struck with that reason. Without it the plan goes fully ticked on machine work alone, which is a machine agreeing with itself.

## 5b. What this pass finds beside the work is its own ticket

**This is the reading most likely to turn up something nobody was looking for**, because every citation is opened and every node in every drawing is chased into the code. A fault beside the one being planned, a rule nothing enforces, a check that would have caught it, a second copy of something that already has one source: add it to this ticket when building the current change needs it. A plan that grows a fix with no connection to the current change is one the owner cannot read against what they asked for.

[ticket](../ticket/SKILL.md) holds the rule and the test — a find the current change needs becomes a box in this file. Two things are this skill's own end of it:

- **Name it in this ticket's Still open** only when it does not help this ticket work, so a later reader cannot mistake it for covered.
- **Keep the phase honest.** This skill does not edit app code, so every added box must name how it makes the ticket's own outcome work.

## 6. The six parts are there, and the summary earns its keep

[ticket](../ticket/SKILL.md) holds the six parts and their order; this holds the file to them. A file missing one, or carrying its own invented heading, is one a reader has to search rather than skim.

**The summary sentence is checked hardest, because it is the only part most readers finish**, and the piece that goes missing is always the fourth — the evidence it will work. A summary that stops at the change is a wish: add the reason out of the measured table, or say plainly that nothing measured backs it yet.

Then check the three middle headings answer one question each and stop. A paragraph that could sit under two of them belongs under neither — cut it.

**Anything the running order should not be carrying belongs here.** A row in `../docs/PLAN.md` is two sentences; if this ticket's row has grown past that, move the words into this file and shorten the row in the same pass.

## 6a. Every ticket leaves this pass with a picture in it, and the owner says yes to a drawn interface

**No ticket this skill touches ends without a picture.** A supplied screenshot stays inline and is used as the visual record for its state; never draw an equivalent wireframe. Otherwise, where the phases touch the window, photograph a wireframe under `## What it looks like`; where they touch nothing a reader sees, draw the flow in step 6b — a Mermaid block in `## How it is built`. A ticket carrying a picture still has it opened against the code here rather than taken on trust.

**A ticket whose phases touch the window and has neither a supplied screenshot nor `## What it looks like` is one this pass draws.** Sketch it as HTML under `../docs/imgs/wireframes/` and photograph it with `node scripts/wireframe.mjs`, with the markup and the `design/components.md` row each new control will take. Never box characters — `just check-ascii-art` fails on one anywhere in the tree. See [ticket](../ticket/SKILL.md) for the command and the shape of a sketch.

**Every position in the drawing is traced, never invented.** Before a line of the sketch is written, read where each control actually sits — the markup in `src/assets/app-shell.html`, the zones in `reading.css`, and, when a copy is up, `leaftext_eval` for the real rectangles. Then draw at those numbers and say on the picture that they are measured. A drawing that puts an existing control somewhere it does not live is worse than no drawing: it reads as a decision somebody made, so the next person builds the move as if it were the fix. A sketch drawn from memory of what the bar "looks like" is the same fault with a nicer excuse.

**A fix is the mechanism that is already there.** Where a ticket is a bug, the drawing shows the app's own behavior reaching one more case — the same controls, in the same places, with whatever will not fit going into the container that already holds spillover. Rearranging the window is not a candidate answer to a bug and is never drawn as one. If the sketch has moved something the bug did not move, the sketch is wrong.

**Then ask whether there is a question at all.** Two drawn options are for a real fork — two things the code could genuinely do, both worth having. Where the answer falls out of the order the code already folds, sorts or lays out in, there is no fork: draw the one outcome and say what makes it the only one. Inventing a second option to have something to ask about is how a bug turns into a layout review, and it puts a bad idea in front of the owner with a number next to it.

Where there **is** a fork, **choose among the researched drawings**: two or three options, one marked the pick with the reason. That decision is what goes in the file. Ask the owner only where the ticket's intent is not certain — what the owner meant by the symptom, or which reading of the request is real — rather than asking them to make the design choice.

Then hold every phase to the approved drawing: **a box that draws a control the section does not show is struck**, with the reason. That is what would have caught v0.1.479's second search box, its `?` button and its popup panel — three controls no line of the plan asked for, all three taken back out.

And check the drawing for the thing it most often gets wrong: **new interface where the existing control would do**. A second input, a second button, a second panel. The ticket has to say why the one already there could not carry it; without that sentence, the answer is the one already there.

## 6b. The flow diagram is held to the code and to the phases

**Where a ticket explains a mechanism in prose that a picture would carry, this pass draws it** — a Mermaid block in `## How it is built`, on [ticket](../ticket/SKILL.md)'s test for when one earns its place. It is a block in the file, not a photographed sketch: the wireframe rule above is for layouts, and a flow costs no file at all.

Then two readings nothing else in this repo does:

- **The diagram against the code.** Every node named as the code names it, every edge a call that exists, and the files cited under the block. Where the ticket is adding a piece, its node says so — an undated drawing that mixes what ships with what is planned is one a builder reads as all shipping.
- **The diagram against the phase list.** A node nothing in the phases builds is either a node to cut or a box nobody wrote, and a hop the phases build that the picture does not show means the picture is out of date. This is the one check that turns the drawing from decoration into the thing that makes a plan followable, and it takes one pass.

A diagram answering more than one question gets split; a diagram of two boxes and an arrow is cut back to the sentence it was — unless it is the ticket's only picture, in which case draw the thing the ticket actually turns on: what the code does today beside what it will do, or the shape of the file the work leaves behind. Step 6a asks every ticket for a picture, and "there was nothing worth drawing" is the answer that gets a ticket built off four paragraphs.

## 7. The file itself has to read well

A plan is read as a file, so how it sits on the page is part of whether it is followed.

- **A paragraph is one line.** Join what is wrapped — `just check-wrapping --fix` does the whole tree — leaving a break only where it is doing work: verse, a quoted line, two trailing spaces.
- **It uses the tree's own words for the tree's own parts.** `../docs/GLOSSARY.md` defines them — ticket, phase, box, tier, seam, the record. A ticket calling a phase a "stage" or a box a "task" reads as a different process to somebody who has only read the glossary, so the word is corrected here. A planning word the ticket genuinely needs and the glossary does not have gets a row **there**, in this pass — that is the one edit this skill makes outside the ticket.
- **No open question, no TBD, no "decide later"** — step 5's rule, and the one most often left in.
- **Every phase's boxes are boxes**, not prose with a dash in front.

## 8. Sign the top

**Say on the file that this ran, and when.** One short line, directly under the `> **Not built.**` note:

```markdown
> **Designed 3 August 2026, 4:12pm.** Cause watched in a running copy; citations opened; plan held against `AGENTS.md`; the interface drawn and approved.
```

The first clause is step 1a's proof, and it is the one clause that may not be softened: `cause watched in a running copy` where the app was driven and read back, `cause inferred, not watched` where it could not be and the file says why. A ticket that could not be watched at all does not reach this line — it is stopped at step 1a behind the tooling ticket that would let somebody watch it. The last clause is the drawing step 6a asked for, named so a reader can see at the top that there is one — `the mechanism drawn` where the picture is a flow rather than a wireframe. A dated line that claims neither is a ticket with no picture in it, which is the thing this pass exists to stop shipping. That is the whole line. It is a date and a scope, not a summary — what the reading *found* is the record at the bottom, and a paragraph here is a paragraph between the reader and the ticket.

It goes at the top because that is where somebody decides whether to trust the file, and it carries a date because a plan designed in March against code that moved in August is a plan nobody has read. Designing it again replaces the line rather than stacking another one.

**The date carries the time beside it**, read off this machine's clock (`Get-Date`) at the moment the line is written. A ticket designed at nine in the morning and one designed at nine at night read the same when only the day is written, and this tree builds several tickets between them — so the day alone cannot say which reading is the newer one, or whether the code has moved since. `AGENTS.md` holds the rule for every date the workflow writes; `just check-docs` refuses one written from `2026-08-19` on with no time after it.

It is also the flag [dev](../dev/SKILL.md) tests for: no line, and it runs this skill before it writes a single piece of code.

**Then set the ticket's status in the running order, in the same pass.** [`../docs/PLAN.md`](../../../../docs/PLAN.md) carries a `Status` column, and this ticket's row becomes `Designed`. That is the only edit this skill makes to that file — never the tier, never the reasoning, never the order. The status mirrors the ticket's dated line, so writing one without the other is how the two start disagreeing. **The line comes first and the row second**, never the other way about: a row reading `Designed` over a ticket with no line is the running order promising a reading that has not happened, and it is what lets a build start on a plan nobody opened against the code. `scripts/check-plan-stage.mjs` refuses that row and `scripts/gate-design.mjs` refuses the build.

A ticket with no row there yet is a ticket [`/ticket`](../ticket/SKILL.md) did not finish — add the row, unticked, then tick it.

## 9. Leave the record

Fix the file. Then, at the bottom, say what was wrong. Keep the section even when the list is short — the file's own history of being doubted is what stops the second reviewer spending an afternoon on a part the first one settled.

```markdown
## What an earlier draft got wrong

Kept here on purpose. A second reading that lands on one of these can stop
sooner, and a reading that disagrees knows what the first one thought.

**The one-line version of the mistake.** Why it was wrong, and what it is now.

### Checked and left alone

- The thing that looks wrong and is not, with the reason it holds.

### Still open

- What nobody has decided, and who or what would decide it.
```

Three headings, in that order. **Checked and left alone** is the one that pays off — it is where a reviewer's second guess gets answered before they spend a day on it. **Still open** is not a TBD smuggled back in: it is work outside this ticket, named so it is not mistaken for covered.

**A cause that was reasoned to and then watched failing goes in the first section**, because it is the most expensive mistake this pass can make and the one a second reader is most likely to make again: say what the file used to blame, what the app actually showed, and how it was seen. Anything about the cause that is still an inference goes in **Still open** with what would settle it.

Fix the small stuff in place without a line in the record — a stale line number, a renamed function, a typo. The record is for things a reader could reasonably still believe.

## 10. Hand back

Say what changed in the plan, in plain words. The ticket is a file in `../docs/`; nothing in the app moved, so there is nothing to verify and nothing to bundle. The tree stays dirty.

Four things have to be on the file when this ends: the dated line at the top, a watched cause in the measured table, a picture in the body — a photographed wireframe or a Mermaid flow — and the record at the bottom. Missing the first or the last, nothing downstream can tell a checked plan from an unchecked one; missing the picture, the plan is four paragraphs somebody has to hold in their head, and what they build instead is whatever they pictured; missing the cause, the whole file is a confident answer to a question nobody asked the app.

**A pass stopped at step 1a hands back differently**: no dated line, the ticket's status untouched, and the reply says the cause could not be watched, names the tooling ticket now in front of it, and stops. That is a finished pass, not a failed one — it is the pass finding that the next piece of work is the ability to see.

## Reference

- `/ticket` — the shape this holds a file to.
- `/dev` — what runs next, once the plan is true.
- `/pm` — the running order these tickets are ranked into, and what it refuses to rank.
- `/sync-tests` — where a test goes and how it is named, for the boxes step 5a writes.
- `AGENTS.md` — the rules each paid for in version numbers.
- `../docs/GLOSSARY.md` — the words a ticket is held to, and the one file outside the ticket this skill may edit.
- `../docs/PLAN.md` — how short a row is allowed to be. Words cut from a row land in the ticket.
- `/design-tokens` — where a value lives, for anything the ticket styles.
- `/add-dependency` — what a ticket owes before it names a crate.
- `../docs/done/repo/conformance-suites.md` — a designed ticket, with the record section at the bottom.

<!-- keycode: LEAF-BE23 -->
