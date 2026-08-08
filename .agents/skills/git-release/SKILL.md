---
name: git-release
description: Commit and push releases, the only skill allowed to write git. Ships built tickets for testing, sets their stage to Released for test, and tells the owner to run /done afterward. Use only when the user explicitly requests a release or git operation.
disable-model-invocation: true
argument-hint: "[version] [message]"
user-invocable: true
---

# Git Release

This is the only skill that commits, tags, pushes, or changes the version. Run `/sync-docs`, `/code-comments`, and `/check` before committing. App changes bump the version and tag the release; site-only changes push without a version bump. Never add assistant identity to a commit.

Before releasing, inspect live tickets. A ticket with exactly one open box must have that box under `The owner's box`; otherwise stop. Release the code, then set its live plan row to `Released for test`. Do not move it into `done/` here.

After the release, tell the owner to test it and run `/done`. If any ticket is already `Released for test`, stop and tell the owner to run `/done` before another release.

<!-- keycode: LEAF-4409 -->
