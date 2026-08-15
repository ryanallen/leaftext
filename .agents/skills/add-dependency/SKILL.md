---
name: add-dependency
description: Weigh a new crate before it ships. Reports what it drags in transitively (`cargo tree`), what the platform already offers instead, whether default features can be off and whether one platform can be gated — then asks, because every crate reaches users and nobody here reviews it. Use when the user wants a library added, asks "what crate should I use", or a change needs something the tree does not have.
argument-hint: "[crate | what it would do]"
user-invocable: true
---

# Add a dependency

Every crate here ships to users and nobody reviews its code. That makes this a security decision, not a convenience one — and it **ends by asking**, never by adding.

## First: is it needed at all?

Three things usually answer yes-you-already-have-this:

1. **The platform.** The web view brings an OS TLS stack; `windows-sys` is already in. Network, clipboard, shell, trash and filesystem work almost always has a free native path — see `src/platform.rs`, which is where that code lives.
2. **A crate already in the tree.** `cargo tree` before reaching outward: `flate2` arrived under `syntect`, so the PNG encoder cost a line rather than a crate.
3. **Twenty lines of ours.** `store/frontmatter.rs` and `store/links.rs` are both parsers nobody needed a crate for, and both outlived the subsystem they were written for.

## Then: what does it really cost?

```bash
cargo tree --depth 99 | wc -l          # before
cargo add <crate> --dry-run            # what it wants
```

Report, in the hand-back:

- **The transitive count**, not the direct one. A crate that pulls 40 others is 41 dependencies and 41 sets of maintainers.
- **What it duplicates** in the tree already.
- **The alternative you considered**, and why it lost. "None" is not an answer.
- **Its last release and its open issues**, if the crate is small or new.

## If it goes in

- `default-features = false` when only part is used, then name the features you want. `arboard` shipped an image decoder this app never asked for; `pulldown-cmark` shipped a command-line argument parser.
- **Target-gate anything one platform needs**: `[target.'cfg(windows)'.dependencies]`. A macOS build should not carry a Windows crate.
- Keep the `Cargo.toml` comment saying what it is for. Every other entry has one.

## Then ask

Say what it costs and what it replaces, and stop. Adding it is the owner's call, and this is the one skill whose job is to end in a question.

## The four that are settled

`ammonia` (stands between hostile HTML and the web view — never hand-roll a sanitizer), `rusqlite`, `syntect`, `wry`/`tao`. These are not up for review.

**Anything this pass finds that it is not here to do is a ticket, written before the hand-back** — with [`/ticket`](../ticket/SKILL.md), its row in `../docs/README.md`, ranked by [`/pm`](../pm/SKILL.md). Naming it in a reply instead is the failure `AGENTS.md` refuses: saying a thing is out of scope proves you found it and handed the filing back to the owner.

## Reference

- `AGENTS.md`, Dependencies — the standing policy.
- `src/platform.rs` — the native code that exists instead of crates.
- `docs/02-development/01-architecture.md` — the crate table, with one line on why each is there.

<!-- keycode: LEAF-3B71 -->
