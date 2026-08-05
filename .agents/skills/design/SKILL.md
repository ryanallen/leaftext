---
name: design
description: Design a ticket before anyone builds it. Opens every file the ticket cites and checks the claim is still true, then holds the plan against the rules this repo already paid for — one table of formats, every value in design/, fragment order, no crawl, no second list, no loosened check, nothing new on the startup path. Fixes what is wrong in place, signs the top of the file with the date it was checked, and leaves a record of what was wrong at the bottom, so a later reading knows what the first one already thought about and whether anyone has read it against this month's code. Never touches git and never edits app code. Use when the user says "design this ticket", "review this plan", "check this ticket", or hands over a Markdown plan written by /ticket. A running-order row is cited by its ticket's name, never a number.
argument-hint: "[path to the ticket]"
user-invocable: true
---

# Design a ticket

A ticket is followed months later by somebody with none of the conversation in their head. They will trust the file over the code. So this reads the file against the code, fixes what is wrong, and says at the bottom what was wrong — because the same doubtful part attracts a second reviewer, and they should not have to redo the thinking.

**Never run git.** **Never edit app code.** A wrong plan is fixed in the plan. If the ticket turns out to describe a shipping bug, it stays a box in the ticket — fixing it is a separate job with its own `/check`.

Written for the tickets in `../docs/features/`, `../docs/refactor/` and `../docs/fixes/`, each of which groups its files into subject folders. Read [ticket](../ticket/SKILL.md) first: it is the shape this holds a file to.

## 1. Every citation is opened

A ticket earns its keep with the measured table — the claim beside the line it came from. That is also the part that rots.

- Open every `path:line` in the file. The line moves; the claim can stop being true entirely.
- Fix the line number silently. A claim that is now **false** is not a silent fix — it goes in the record at the bottom.
- A claim with no citation is either checked and cited, or cut.
- Names get opened too. A ticket that says a function will be called with a string, when it takes a struct, sends the next person the wrong way.

Read the repo, do not remember it. A plausible sentence that is false is worse than no sentence.

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

- **Every phase is buildable off this repo plus the phases above it.** A phase waiting on another ticket's work is the one fault that makes a file impossible to finish, so it is the first thing to check: read what each phase needs, and ask which of it exists. Where a file's later phases sit behind another ticket, **split the file at that seam** — the buildable phases keep the file and its name, the blocked ones become a new ticket saying what it rides on, and both rows in `../docs/README.md` are written in the same pass. Splitting is not "changing what gets built", so it does not wait on a question; renumbering the phases and re-pointing the running order is part of it.
- Each phase ships alone and is worth having alone.
- The italic line says why it is in that position, and is true — phase 2 must really need what phase 1 proved.
- A box has an obvious done. "Make it fast" does not.
- Tests have their own boxes, in the phase that needs them.
- Every phase ends with `/check`, and with the bundler line if it touched `design/`.
- Nothing open-ended survives: no TBD, no "decide later", no question left in the file. Something genuinely unknowable until code exists is **phase 0** — one grep, one measurement, spelled out as a box.

If a fix changes what gets built rather than how it is described, ask before writing it. One round, the question tool, and the answer goes in the file as a decision with its reason.

## 6. The six parts are there, and the summary earns its keep

A ticket has the same six parts in the same order — title and one-sentence summary, `## Why`, `## What was measured`, `## How it is built`, `## Phases`, `## What an earlier draft got wrong`. A file missing one, or carrying its own invented heading, is one a reader has to search rather than skim. [ticket](../ticket/SKILL.md) holds the shape; this holds the file to it.

**The summary sentence is checked hardest, because it is the only part most readers finish.** It has four pieces — who it is for, what they will be able to do, the change that does it, and the evidence it will work — and the fourth is the one that goes missing. A summary that stops at the change is a wish: add the reason out of the measured table, or say plainly that nothing measured backs it yet.

Then check the three middle headings answer one question each and stop. `## Why` is the cost of doing nothing and does not describe the build; `## What was measured` is claims with citations and nothing else; `## How it is built` is where the code goes and what was decided, not the why again. A paragraph that could sit under two of them belongs under neither — cut it.

**Anything the running order should not be carrying belongs here.** A row in `../docs/PLAN.md` is two sentences; if this ticket's row has grown past that, move the words into this file and shorten the row in the same pass.

## 7. The file itself has to read well

A plan is read as a file, so how it sits on the page is part of whether it is followed.

- **A paragraph is one line.** A ticket hard-wrapped at some column is one nobody can edit without re-flowing it by hand, and a one-word change diffs as the whole paragraph. Join them — `just check-wrapping --fix` does the whole tree — and leave a break only where it is doing work: verse, a quoted line, two trailing spaces.
- **It uses the tree's own words for the tree's own parts.** `../docs/GLOSSARY.md` defines them — ticket, phase, box, tier, seam, the record. A ticket calling a phase a "stage" or a box a "task" reads as a different process to somebody who has only read the glossary, so the word is corrected here. A planning word the ticket genuinely needs and the glossary does not have gets a row **there**, in this pass — that is the one edit this skill makes outside the ticket.
- **No open question, no TBD, no "decide later"** — step 5's rule, and the one most often left in.
- **Every phase's boxes are boxes**, not prose with a dash in front.

## 8. Sign the top

**Say on the file that this ran, and when.** One short line, directly under the `> **Not built.**` note:

```markdown
> **Designed 3 August 2026.** Citations opened; plan held against `AGENTS.md`.
```

That is the whole line. It is a date and a scope, not a summary — what the reading *found* is the record at the bottom, and a paragraph here is a paragraph between the reader and the ticket.

It goes at the top because that is where somebody decides whether to trust the file, and it carries a date because a plan designed in March against code that moved in August is a plan nobody has read. Designing it again replaces the line rather than stacking another one.

It is also the flag [build](../build/SKILL.md) tests for: no line, and it runs this skill before it writes a single piece of code.

**Then tick the box in the running order, in the same pass.** [`../docs/PLAN.md`](../../../docs/PLAN.md) carries a `Designed` column, and this ticket's row goes from `[ ]` to `[x]`. That is the only edit this skill makes to that file — never the tier, never the reasoning, never the order. The box mirrors the line, so writing one without the other is how the two start disagreeing, and the box is the half somebody scanning the list actually sees.

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

Fix the small stuff in place without a line in the record — a stale line number, a renamed function, a typo. The record is for things a reader could reasonably still believe.

## 10. Hand back

Say what changed in the plan, in plain words. The ticket is a file in `../docs/`; nothing in the app moved, so there is nothing to verify and nothing to bundle. The tree stays dirty.

Two things have to be on the file when this ends: the dated line at the top, and the record at the bottom. Missing either one, nothing downstream can tell a checked plan from an unchecked one.

## Reference

- `/ticket` — the shape this holds a file to.
- `/build` — what runs next, once the plan is true.
- `/priority` — the running order these tickets are ranked into.
- `AGENTS.md` — the rules each paid for in version numbers.
- `../docs/GLOSSARY.md` — the words a ticket is held to, and the one file outside the ticket this skill may edit.
- `../docs/PLAN.md` — how short a row is allowed to be. Words cut from a row land in the ticket.
- `/design-tokens` — where a value lives, for anything the ticket styles.
- `/add-dependency` — what a ticket owes before it names a crate.
- `../docs/done/repo/conformance-suites.md` — a designed ticket, with the record section at the bottom.

<!-- keycode: LEAF-BE23 -->
