---
name: git-release
description: Commit and push releases, the only skill allowed to write git. Ships built tickets for testing, sets their stage to Released, and tells the owner to run the done skill afterward. In a private copy of the app it hands the code over on a session branch instead. Use only when the user explicitly requests a release or git operation.
disable-model-invocation: true
argument-hint: "[private | version] [message]"
user-invocable: true
---

# Git Release

This is the only skill that commits, tags, pushes, or changes the version. Run `/sync-docs`, `/code-comments`, and `/check` before committing. App changes bump the version and tag the release; site-only changes push without a version bump. Never add assistant identity to a commit.

An app change is one that touches `src/`, `Cargo.toml`, `Cargo.lock`, `build.rs`, `wix/`, `installer/`, `leaf.rc` or a `release-` workflow — the things that change what somebody who installed the app is running. Everything else — the README, the site, `docs/`, `design/`, `themes/`, the skills, the hooks, the checks, `scripts/`, the plan tree — is site-only: commit and push `main`, make no tag, and leave the version alone. Read that off the diff against the remote rather than off memory of what was edited.

**Site-only work is committed and pushed first, not last.** It goes in and out in one move, the moment it passes, before anything else in the turn — every hour it sits in the tree is an hour another session can collide with it, and a session that meets it has to work out whose it is before it can do anything at all. No batching it up with later work, no leaving it for the end of a chain.

**A change nobody using the app can meet is never a release.** The build's own machinery lives in the same checkout as the app, and it used to be read as an app change purely because of where its files sit — so a fix to a check, a hook, a skill or a release script cut a new version, ran the whole suite twice and published an installer identical to the one before it. Push it and stop.

Before releasing, inspect live tickets. A ticket with exactly one open box must have that box under `The owner's box`; otherwise stop. Every built phase must have its test box ticked, or struck with the reason it cannot be tested here; an open test box stops the release the same way an open work box does. Any test gap found on the way is filed as its own ticket before the release, never carried in the commit. Release the code, then set its live plan row to `Released`. Do not move it into `done/` here. **Write that row under the claim** — `node scripts/agent-workspace.mjs plan-open` hands back a copy of the running order to edit, `plan-close` writes it back under the claim, and a copy taken before another session's row is refused rather than written over it — kept where it is, so the row is redone from it; [`/pm`](../pm/SKILL.md) holds the reason.

## The code is in this session's own copy, so the release is a chain

A hook puts every session in a private copy of the app before the message is read, and the code is there rather than in the copy the owner reads. **The plan tree is already the owner's**, so the ticket, its row and its status need no handoff at all and are committed straight from the primary Studio checkout. **The owner types nothing; you run all three steps.** Run the same checks first — `/sync-docs`, `/code-comments`, `/check` — from inside the copy, then, from that copy:

    node scripts/agent-workspace.mjs private

It commits the checked app change as one commit on this session's own branch, on top of the revision the copy was cut from. If a cleared conversation left the checked build in another session, run `node scripts/agent-workspace.mjs list` from the new managed copy, then name that session deliberately:

    node scripts/agent-workspace.mjs private --session <session>

The named handoff says whose work it takes. **It never pushes, never tags, never moves a version, and never speaks to any remote.** Then, from the app copy the owner reads:

    node scripts/agent-workspace.mjs submit <session>

That takes the primary reservation, reads the base and the changed paths off that branch, refuses a handoff written on an older revision or overlapping work already sitting there, and applies its diff through a recovery journal — leaving the primary app copy dirty. Read what arrived, then make the public release below **from there**. `scripts/prepare-release.mts` refuses outright from a copy, so the public path cannot be taken from the wrong one by mistake.

Where another session released while this work was being finished, that base refusal is the one you meet, and its answer is never a fresh copy — one is cut at the revision the primary is on now and carries none of the finished work. From the primary copy:

    node scripts/agent-workspace.mjs rebase <session>

It replays that session's one handoff commit onto the current revision, keeping the work and its single commit, and the submit above then passes. A conflict stops in that session's own copy with its paths named and its branch untouched: settle each file there and run the same command again, which carries on from where it stopped. Then submit and release as normal.

The change travels as a diff off a branch nobody publishes because a worktree shares the primary's git directory: the commit is readable from the copy the owner reads the moment it exists, with no remote in between. The workspace skill, named with your host's own sign — `/workspace` in Claude, `$workspace` in Codex — is where the copy, the handoff and the submit are written down.

## Which number moves

Read it off the folder of the ticket whose row is about to say `Released`. It is a path, not a judgment — the rule this replaced asked whether a reader would notice, and that question came back "patch" five hundred and two times running.

| What the release carries | What the version becomes |
| --- | --- |
| it takes something away from a copy already installed — a settings, recents or vault-registry path moves, a migration drops what the user made rather than what the app cached, or a file an older copy wrote stops being readable | the first number goes up and the other two to zero: `1.0.0` |
| at least one ticket out of `features/` | the middle number goes up and the last to zero: `0.2.0` |
| only tickets out of `refactor/` or `fixes/`, or no ticket at all | the last number goes up by one: `0.2.1` |

The first row that applies wins. Size never moves a number on its own: the first number is the only one that means this release can cost you something, and spending it on a big feature leaves nobody a way to tell. Going from `0` to `1` because the app feels finished is the owner's word — ask, never derive it. Moving the middle number is safe; the updater compares each part as a number, and a test pins `0.2.0` above `0.1.999`.

## One tag exists at a time

**Delete every other tag, here and on GitHub, before making the new one.** Tags are pruned by the build itself: after it publishes, it deletes every older release along with its tag, so a tag left here comes back the moment anything is pushed with `--tags`. Let four pile up and the next push carries four, and **GitHub creates no push event at all for a push carrying more than three tags** — so no build starts, no installer is published, and the tag sits on GitHub looking shipped. That is how v0.1.502 went out with nothing to download.

So the order is: check, delete the old tags, commit, make the new one, push `main`, then push the tag on its own — and all of it is one command, `just release <version>`, which holds one still copy of the plan tree from the check to the last push. **The check comes before the cleanup on purpose.** The plan tree is shared, so another session can write a ticket, a row or a skill copy while the check runs; the release reads a copy taken before it started, and a check that stops anyway leaves the last released tag exactly where it was. When it was two commands with the cleanup first, a stopped check took the last tag with it and left nothing shipped-looking to fall back on. A failure *after* the cleanup is a release that failed — say that, and never call it a plan race.

## Confirm the build started

The push is the last write, but it is not the end. Read the workflow list once and confirm a run exists for the tag just pushed. Nothing here waits on a build, polls it, or re-runs it on failure — a broken build costs a patch bump. This is only the check that a build was *started*, because the failure this catches is silent: the tag is on GitHub and no run was ever created.

If none exists, start the two release workflows by hand against that tag rather than pushing the tag again. Never re-push a tag.

After the release, tell the owner to test it and run the done skill, named with your host's own sign — `/done` in Claude, `$done` in Codex. If any ticket is already `Released`, stop and tell the owner to run it before another release.

<!-- keycode: LEAF-4409 -->
