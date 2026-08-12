---
name: git-release
description: Commit and push releases, the only skill allowed to write git. Ships built tickets for testing, sets their stage to Released for test, and tells the owner to run $done afterward. Use only when the user explicitly requests a release or git operation.
disable-model-invocation: true
argument-hint: "[version] [message]"
user-invocable: true
---

# Git Release

This is the only skill that commits, tags, pushes, or changes the version. Run `$sync-docs`, `$code-comments`, and `$check` before committing. App changes bump the version and tag the release; site-only changes push without a version bump. Never add assistant identity to a commit.

An app change is one that touches `src/`, `Cargo.toml`, `Cargo.lock`, `build.rs`, `wix/`, `leaf.rc`, `scripts/` or a `release-` workflow. Everything else — the README, the site, `docs/`, `design/`, `themes/`, the skills, the plan tree — is site-only: commit and push `main`, make no tag, and leave the version alone. Read that off the diff against the remote rather than off memory of what was edited.

Before releasing, inspect live tickets. A ticket with exactly one open box must have that box under `The owner's box`; otherwise stop. Every built phase must have its test box ticked, or struck with the reason it cannot be tested here; an open test box stops the release the same way an open work box does. Any test gap found on the way is filed as its own ticket before the release, never carried in the commit. Release the code, then set its live plan row to `Released for test`. Do not move it into `done/` here.

## Which number moves

Read it off the folder of the ticket whose row is about to say `Released for test`. It is a path, not a judgment — the rule this replaced asked whether a reader would notice, and that question came back "patch" five hundred and two times running.

| What the release carries | What the version becomes |
| --- | --- |
| it takes something away from a copy already installed — a settings, recents or vault-registry path moves, a migration drops what the user made rather than what the app cached, or a file an older copy wrote stops being readable | the first number goes up and the other two to zero: `1.0.0` |
| at least one ticket out of `features/` | the middle number goes up and the last to zero: `0.2.0` |
| only tickets out of `refactor/` or `fixes/`, or no ticket at all | the last number goes up by one: `0.2.1` |

The first row that applies wins. Size never moves a number on its own: the first number is the only one that means this release can cost you something, and spending it on a big feature leaves nobody a way to tell. Going from `0` to `1` because the app feels finished is the owner's word — ask, never derive it. Moving the middle number is safe; the updater compares each part as a number, and a test pins `0.2.0` above `0.1.999`.

## One tag exists at a time

**Delete every other tag, here and on GitHub, before making the new one.** Tags are pruned by the build itself: after it publishes, it deletes every older release along with its tag, so a tag left here comes back the moment anything is pushed with `--tags`. Let four pile up and the next push carries four, and **GitHub creates no push event at all for a push carrying more than three tags** — so no build starts, no installer is published, and the tag sits on GitHub looking shipped. That is how v0.1.502 went out with nothing to download.

So the order is: delete the old tags, make the new one, push `main`, then push the tag on its own.

## Confirm the build started

The push is the last write, but it is not the end. Read the workflow list once and confirm a run exists for the tag just pushed. Nothing here waits on a build, polls it, or re-runs it on failure — a broken build costs a patch bump. This is only the check that a build was *started*, because the failure this catches is silent: the tag is on GitHub and no run was ever created.

If none exists, start the two release workflows by hand against that tag rather than pushing the tag again. Never re-push a tag.

After the release, tell the owner to test it and run `$done`. If any ticket is already `Released for test`, stop and tell the owner to run `$done` before another release.

<!-- keycode: LEAF-4409 -->
