---
name: refine
description: Review a ticket before anyone builds it. Opens every file the ticket cites and checks the claim is still true, then holds the plan against the rules this repo already paid for — one table of formats, every value in design/, fragment order, no crawl, no second list, no loosened check, nothing new on the startup path. Fixes what is wrong in place and leaves a record of it at the bottom, so a later reading knows what the first one already thought about. Never touches git and never edits app code. Use when the user says "refine", "review this plan", "check this ticket", or hands over a Markdown plan written by /ticket.
argument-hint: "[path to the ticket]"
user-invocable: true
---

# Refine a ticket

A ticket is followed months later by somebody with none of the conversation in
their head. They will trust the file over the code. So this reads the file
against the code, fixes what is wrong, and says at the bottom what was wrong —
because the same doubtful part attracts a second reviewer, and they should not
have to redo the thinking.

**Never run git.** **Never edit app code.** A wrong plan is fixed in the plan.
If the ticket turns out to describe a shipping bug, it stays a box in the
ticket — fixing it is a separate job with its own `/check`.

Written for the tickets in `../docs/features/` and `../docs/refactor/`. Read
[ticket](../ticket/SKILL.md) first: it is the shape this holds a file to.

## 1. Every citation is opened

A ticket earns its keep with the measured table — the claim beside the line it
came from. That is also the part that rots.

- Open every `path:line` in the file. The line moves; the claim can stop being
  true entirely.
- Fix the line number silently. A claim that is now **false** is not a silent
  fix — it goes in the record at the bottom.
- A claim with no citation is either checked and cited, or cut.
- Names get opened too. A ticket that says a function will be called with a
  string, when it takes a struct, sends the next person the wrong way.

Read the repo, do not remember it. A plausible sentence that is false is worse
than no sentence.

## 2. The plan is held against the rules

Each of these cost a version number, and a ticket that walks into one will be
built before anyone notices. `AGENTS.md` is the list; these are the ones plans
get wrong.

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

Where a rule applies, the ticket should name it rather than merely avoid it —
the next person needs to know the constraint was seen.

## 3. It stays fast

Slow is the failure nobody reports; they just stop opening files with it.

- **Nothing new on the way to first paint.** Work at startup, per open, or per
  keystroke needs a number in the ticket, not an adjective.
- **The page script has a real ceiling** — the fragments reach the web view as
  one string, near 2 MB. A ticket that grows it says by how much. A vendored
  file served over `leaf-asset://` does not pay that, so do not spend the
  constraint where it does not apply.
- **`just verify` is the gate everyone runs.** Anything a ticket adds to it has
  to stay offline and stay quick. Work that needs the network or a big corpus
  gets its own target, run on demand.
- **A cost with no measurement is not a finding.** Say you do not know.

## 4. No hacked-in shortcuts

The tell is a plan that gets green without the thing being true.

- A check loosened, skipped or flagged past instead of a cause fixed.
- A test that passes by doing nothing — the corpus was missing, the case was
  filtered out — with no line saying so where someone will see it. `cargo test`
  hides output on a passing test.
- A known-failure list keyed loosely enough to swallow the next real bug.
- A second copy of something that already has one source.
- A crash or a hang tested in the same process as everything else: a panic
  fails one test, a stack overflow ends the run.
- "Phase 4 will handle it" where phase 4 has no box for it.

## 5. The phases hold

- Each phase ships alone and is worth having alone.
- The italic line says why it is in that position, and is true — phase 2 must
  really need what phase 1 proved.
- A box has an obvious done. "Make it fast" does not.
- Tests have their own boxes, in the phase that needs them.
- Every phase ends with `/check`, and with the bundler line if it touched
  `design/`.
- Nothing open-ended survives: no TBD, no "decide later", no question left in
  the file. Something genuinely unknowable until code exists is **phase 0** —
  one grep, one measurement, spelled out as a box.

If a fix changes what gets built rather than how it is described, ask before
writing it. One round, the question tool, and the answer goes in the file as a
decision with its reason.

## 6. Leave the record

Fix the file. Then, at the bottom, say what was wrong. Keep the section even
when the list is short — the file's own history of being doubted is what stops
the second reviewer spending an afternoon on a part the first one settled.

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

Three headings, in that order. **Checked and left alone** is the one that pays
off — it is where a reviewer's second guess gets answered before they spend a
day on it. **Still open** is not a TBD smuggled back in: it is work outside this
ticket, named so it is not mistaken for covered.

Fix the small stuff in place without a line in the record — a stale line
number, a renamed function, a typo. The record is for things a reader could
reasonably still believe.

## 7. Hand back

Say what changed in the plan, in plain words. The ticket is a file in
`../docs/`; nothing in the app moved, so there is nothing to verify and nothing
to bundle. The tree stays dirty.

## Reference

- `/ticket` — the shape this holds a file to.
- `AGENTS.md` — the rules each paid for in version numbers.
- `/design-tokens` — where a value lives, for anything the ticket styles.
- `/add-dependency` — what a ticket owes before it names a crate.
- `../docs/refactor/conformance-suites.md` — a refined ticket, with the record
  section at the bottom.

<!-- keycode: LEAF-BE23 -->
