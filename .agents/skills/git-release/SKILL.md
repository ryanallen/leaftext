---
name: git-release
description: Commit and push releases, the only skill allowed to write git. Ships built tickets for testing, sets their stage to Released, and tells the owner to run the done skill afterward. Use only when the user explicitly requests a release or git operation.
disable-model-invocation: true
argument-hint: "[private | version] [message]"
user-invocable: true
---

# Git Release

This is the only skill that commits, tags, pushes, or changes the version. It commits twice: **`just land` first, before anything else**, then `/sync-docs`, `/code-comments` and `/check`, then the release itself. Never add assistant identity to a commit.

**The first act is `just land`.** It stages what is in the tree by name, commits it and pushes `main` — no gate, no version, no tag, nothing checked. Everything after it takes an hour or more, and every minute of that is a minute the work sits uncommitted in a checkout somebody else may be about to start a build in. So it goes out first and unproven on purpose: another session can pull it and work beside it while the rest of this one runs. A clean tree lands nothing and is not a failure. The gate has not run yet, so a break reaches `main` and the site publishes from that push — the release commit that follows is what carries the fix.

An app change is one that touches `src/`, `Cargo.toml`, `Cargo.lock`, `build.rs`, `wix/`, `installer/`, `leaf.rc` or a `release-` workflow — the things that change what somebody who installed the app is running. Everything else — the README, the site, `docs/`, `design/`, `themes/`, the skills, the hooks, the checks, `scripts/`, the plan tree — is site-only. Read that off the diff against the remote rather than off memory of what was edited. Site-only work is finished by the landing and the checks: `just land`, then `/sync-docs`, `/code-comments`, `/check`, then `just land` again for whatever those wrote. No tag, no version, no `just release`.

**An app change lands, then releases.** `just land` first, then the checks, then bump `Cargo.toml` and run `just release <version>` — which commits whatever the docs, the comments and the version bump added on top of what already went out. The whole gate runs there, so nothing skips it; landing early only moves when the unchecked work becomes visible, never whether it is checked.

**A change nobody using the app can meet is never a release.** The build's own machinery lives in the same checkout as the app, and it used to be read as an app change purely because of where its files sit — so a fix to a check, a hook, a skill or a release script cut a new version, ran the whole suite twice and published an installer identical to the one before it. Land it and stop.

Before releasing, inspect live tickets. **A box struck through is neither open nor ticked** — striking is how this tree retires a box whose work moved elsewhere or changed shape, so it is not work left and it is not evidence, and none of the counts below see it. Count only the boxes with nothing struck at the front of what follows them; a strike part way along a line is a box whose wording changed, and it is still open, as is one that never closes. Each struck box carries the reason after the closing `~~`, which is the only record of where its work went. A ticket with exactly one open box must have that box under `The owner's box`; otherwise stop. **A ticket with no open box at all stops the release too** — the last box in a ticket is the owner's, so a plan machine work ticked to the end has nobody's word on it: either the owner has already given theirs, and it is `/done`'s to close rather than this skill's to ship, or the plan never carried their box and `scripts/check-docs.mjs` refuses it. A struck owner's box is an owner who answered, which is what the ticket skill asks an author to write where nothing is pressed. Every built phase must have its test box ticked, or struck with the reason it cannot be tested here; an open test box stops the release the same way an open work box does. Any test gap found on the way is filed as its own ticket before the release, never carried in the commit. Release the code, then set its live plan row to `Released`. Do not move it into `done/` here.

## The release runs in the checkout it is in

There is no handoff and nothing to submit: the code, the plan tree and the release are all in front of you. Land what is in the tree, run the same checks — `/sync-docs`, `/code-comments`, `/check` — then release from here.

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

**A build that failed because GitHub would not answer costs no number at all.** It is the one failure where nothing needs rebuilding: the installers were made and only the release to hang them on was refused, so it is finished on the tag that is already up with `just publish-release <version>`, however long the outage lasted. A patch bump is for a build that failed on the code. v1.15.6 built both installers, published neither, and the written way forward was a new version and a second hour of checks.

If no run exists at all, the same command starts both release workflows against that tag. Never re-push a tag.

After the release, tell the owner to test it and run the done skill, named with your host's own sign — `/done` in Claude, `$done` in Codex. If any ticket is already `Released`, stop and tell the owner to run it before another release.

<!-- keycode: LEAF-4409 -->
