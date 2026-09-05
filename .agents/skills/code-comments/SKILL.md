---
name: code-comments
description: The comment bar for this repo, in one place. Why not what, match the density next door, one line if it fits, cut the drafting history, keep the version-numbered or measured history. A quality pass over comments only; it changes no logic. Use when the user says "trim the comments", "the comments are too long", or before committing; /git-release calls it.
argument-hint: "[path]"
user-invocable: true
---

# Code Comments

A comment explains why the code is the way it is, not how it got that way. Git already holds how it got that way.

The bar, from AGENTS.md Rule 1: **one short line, only where the code can't say it.**

And **one line means one line** — never wrap a comment across two. `just check-wrapping` joins them and fails on one left behind, in a `//` run and in a `/* */` block alike, so the front-end fragments and the stylesheet are held to it too. A comment body with an indent of its own is left alone, because there the shape is the content: a command, a table, a list — and in a block, "its own indent" means deeper than the block's other lines, which are all aligned under the opener. So a comment that is too long is *shortened*, never wrapped — the length is the thing to fix.

This is a quality pass, not a git operation — never commit, tag, or push, and never change what the code does.

**Nothing here is a bulk edit.** A pattern match finds candidates; it never decides. Every verdict is reached by reading the comment *and the code under it*.

## Ordered pass

### 1. Find comments in the touched files

List the comments in scope and leave untouched files out.

### 2. Read each comment with its code

Give every candidate a cut, rewrite, shorten, keep or fix verdict from the code under it.

### 3. Edit only the comments that fail the bar

Keep rationale and measured history, cut drafting history, and verify every replacement claim.

### 4. Run the proof the file needs

Build Rust documentation after Rust comment edits — `cargo doc --no-deps --lib`, the only thing that catches a dead intra-doc link and the one proof this pass owes. Never the complete suite: the build that called this pays for that once, at its end, and this pass runs inside it.

### 5. Hand back the comment pass

The whole reply is the owner's message, word for word. The tree stays dirty.

## Scope

**The file, not the author.** Every comment in a file this work touches is in scope; a file the work does not touch is not, so a pass never sprawls into an unrelated refactor. Who wrote a comment, and when, says nothing about whether it is still true — and "only tidy your own" is a ratchet that lets wrong ones pile up.

```bash
git diff -- 'src/*'   # what this session touched; add other globs as needed
```

With a path argument, audit that file or folder as it stands.

Out of scope: behavior changes; comments that are already fine; `docs/`, `README.md` and shipped Markdown (that is `/sync-docs`); `src/assets/vendor/`, which is vendored and never edited. **UI copy, test names and `assert!` messages are code, not comments** — leave them, and note them.

## Verdicts

`cut` · `rewrite` · `shorten` · `keep` · `fix` (it names something gone).

### cut — drafting history, the account of the code being written

*"an earlier version divided by (√2 − 1)"* · *"this used to re-read its own output"* · *"the first draft made the sideways handles produce a sibling"* · *"this replaced our own drawing"* · *"we removed X"* · *"no longer does Y"* · *"before it landed"*.

### fix — anything naming what is gone

A function, field, file, constant or behavior that no longer exists. Correct it if the point still stands, delete it if not. **Grep the identifier before keeping a comment that names one.**

### keep — shipped history

A version number or a measured cost is the evidence a rule is real and was paid for. Do not touch these:

- *"v0.1.365 shipped without a Start Menu entry and was unreachable"*
- *"v0.1.423 shipped near-black boxes with near-black labels"*
- *"unlocking a 50,000-block glossary took 148 SECONDS that way"*
- *"141 ms per character on a 4 MB source"*, *"~890ms a frame"*, *"1.5px over on a 76,000-line document"*

Same reason AGENTS.md keeps *Rules each paid for in version numbers*.

### keep — rationale

Constraints, security boundaries, ordering requirements, platform facts, and anything explaining a non-obvious choice.

### The borderline case

Narration that exists to stop a mistake recurring: keep the standing rule, drop the story.

| shape | verdict |
| --- | --- |
| "don't do X, it breaks Y" | earns its line |
| "we used to do X" | does not |
| "X used to break Y" | **rewrite to the present**: "X breaks Y" |

The third row is the common one and it is a judgment call every time. The test is whether the sentence still warns after the tense changes. If it does, it was a rule wearing a story. If it does not, it was only ever a story.

### shorten — house style

A comment that survives but rambles: match the density next door, one line if it fits, drop incidental specifics unless load-bearing, cut hedging. This is the verdict a long one earns — wrapping it across lines is not a fix, it is the same comment costing a re-flow on every edit. **Length alone is never a reason to cut.** No assistant voice — no "I changed", no "as requested", no note about what a session did.

## Every rewrite has to be checked

A rewrite makes a claim about the code. Two ways it goes wrong:

1. **Over-claiming.** "the library re-renders on every watcher tick" — it only re-renders when the change touched the folder on screen. The tense was fixed and a new falsehood introduced.
2. **A dead reference in the fix.** An intra-doc link to a private item does not resolve, and `cargo check` does not catch it.

So, per rewrite: grep every identifier the replacement names and confirm it is reachable from where the comment sits; confirm the *strength* of the claim, because "every" and "always" have to be true; prefer plain backticks to intra-doc links unless the path is public.

`just verify` is necessary and not sufficient — it proves the code compiles and the tests pass, not that a sentence is true.

**Run `cargo doc --no-deps --lib` once per Rust pass.** It is the only thing that catches a dead intra-doc link, it is not in `just verify`, and the 2026-08-01 sweep found five already in the tree. Touch `src/lib.rs` first or a cached build says nothing.

## The trap: tests assert on comment text

`src/tests/app_shell_*.rs` assert against exact substrings of the generated shell script, and some of those substrings **include comments**. Editing a comment in a `src/assets/shell/*.js` fragment can break a test that never mentions it. `just verify` catches it, but grep the comment text in `src/tests/` first.

## Process

1. List the comments in the touched files. Candidate grep: `used to · no longer · any more · is gone · was · were`.
2. Read each with the code under it and give it a verdict.
3. Edit in place, checking every rewrite as above.
4. Run `cargo doc --no-deps --lib` if any Rust changed. Not the complete suite — the build this runs inside pays for that once, after this pass.
5. Say how many comments were cut, rewritten or shortened, in which files, and anything left alone as out of scope.

**Anything this pass finds that it is not here to do is a ticket, written before the hand-back** — [`/ticket`](../ticket/SKILL.md), its row in the live index `../docs/README.md`, [`/pm`](../pm/SKILL.md).

## Reference

- `../../../docs/done/repo/code-comments.md` — the completed 2026-08-01 sweep: 8,789 comment lines over 136 files, one verdict per file, and what it found (twelve dead references to a deleted indexer, four doc comments attached to the wrong item, five dead intra-doc links). Read it before a large pass; it is where the judgment calls are already settled.
- `AGENTS.md` — Rule 1, and *Rules each paid for in version numbers*.
- `/check` — the tests-and-verify gate. This pass is about prose, that one about proof.
