---
name: git-release
description: Commit and push releases, the only skill allowed to write git. Ships built tickets for testing, sets their stage to Released, and tells the owner to run the done skill afterward. Use only when the user explicitly requests a release or git operation.
disable-model-invocation: true
argument-hint: "[private | version] [message]"
user-invocable: true
---

# Git Release

This is the only skill that commits, tags, pushes, or changes the version. It commits twice: **`just land <message>` first, before anything else**, then `/sync-docs`, `/code-comments` and `/check`, then the release itself. Never add assistant identity to a commit.

**Every commit names its work.** The message is plain words after the command, no quotes needed: `just land Find bar keeps its place across tabs`. It is the ticket being shipped, named the way its README row names it; several tickets name each; work with no ticket says what changed in the same few words a row would. Both commands refuse a blank message, so a history of one repeated title cannot come back. Writing it costs the seconds it takes to say — it is the name of what was just built, never a study of the diff — so naming the work delays the landing by nothing.

### 1. Name and land only this pass's files

**The first act is to name this pass's files, then `just land <message>`.** Read the ticket's written footprint and this session's edits into a JSON array in `LEAFTEXT_RELEASE_PATHS`; include generated files only when this pass wrote them. The landing intersects that list with the dirty tree and builds a private index from `HEAD`, so a staged file, an unstaged file or a new file outside the list belongs to another session and stays exactly where it is. Never take the shared index or the whole dirty tree as the list. A path that was already dirty before this pass touched it is a collision: stop if the two edits cannot be separated, because naming the path would take both. Everything after it takes an hour or more, so this work goes out first and unproven on purpose. A clean owned set lands nothing and is not a failure, however much other work is in the checkout.

### 2. Keep the owned set through the release

**Every run pushes only its own work.** Keep `LEAFTEXT_RELEASE_PATHS` through the second landing or release, adding only the documentation, comment, version and lock files this pass itself wrote. The release reads the dirty tree twice and filters both readings through that same list, so a file another session changes while the checks run never enters this pass's commit. The classification below decides only whether a version and a tag follow.

### 3. Classify what was landed

An app change is one that touches `src/`, `Cargo.toml`, `Cargo.lock`, `build.rs`, `wix/`, `installer/`, `scripts/build-windows-release.ps1`, `site/minimap.js`, `leaf.rc` or a `release-` workflow — the things that change what somebody who installed the app is running. **A release workflow is the one file on that list holding both kinds of change at once, so it is read by which step moved.** Every step up to and including the one that makes the installers is the app change: the checkout, the toolchain, the cache and the build itself each decide what a reader ends up running. Every step after the installers exist — making the release, uploading them, clearing the old ones — is site-only, because how a build already made gets published is a change nobody using the app can meet. **`scripts/build-windows-release.ps1` is on the list by name because it is the body of that build step**, moved to a file: the workflow runs it in one line, and it builds the release binary and packages the MSI and the EXE out of `wix/` and `installer/`, which are on the list already — so a change to it changes the bytes somebody downloads. A second packaging script joins the list the same way, named beside the release step that calls it, so a diff is still classified off the list alone. **`site/minimap.js` is on the list by name because it is the one site file compiled into the binary**: the app includes it and a page somebody exports carries it, so whoever opens that page runs what a change to it made — every other site file is the website and is site-only as it always was. A second site file compiled in joins the list the same way, and joins the version rule in `AGENTS.md` in the same edit. **`src/tests/`, `src/app/tests/`, `src/store/tests.rs` and `installer/src/tests.rs` are off the list by name**, the same exception running the other way: each of the four test trees is declared behind `#[cfg(test)]`, so the compiler drops the whole of them out of every release build and a change to one packages an installer byte for byte identical to the last — nobody who installed the app runs a line of them. A fifth test tree joins them the same way, and joins the version rule in `AGENTS.md` in the same edit. Everything else — the README, the site, `docs/`, `design/`, `themes/`, the skills, the hooks, the checks, every other script under `scripts/`, the plan tree — is site-only. Read that off the diff against the remote rather than off memory of what was edited. Site-only work is finished by the landing and the checks: `just land <message>`, then `/sync-docs`, `/code-comments`, `/check`, then `just land` again for whatever those wrote — that second message names the same work with what followed it, "Docs and comments for <the work>". No tag, no version, no `just release`.

**An app change lands, then releases.** `just land <message>` first, then the checks, then bump `Cargo.toml`; step 6 runs `just release <version> <message>` after the ticket and its derived status are inside the owned set. Its message names the tickets it ships, and it commits whatever the docs, the comments, the ticket transition and the version bump added on top of what already went out. The whole gate runs there, so nothing skips it; landing early only moves when the unchecked work becomes visible, never whether it is checked.

**A change nobody using the app can meet is never a release.** The build's own machinery lives in the same checkout as the app, and it used to be read as an app change purely because of where its files sit — so a fix to a check, a hook, a skill or a release script cut a new version, ran the whole suite twice and published an installer identical to the one before it. Land it, run the checks, land what they wrote, and stop: no version, no tag, and never a tree left unpushed. **The one release script this does not reach is `scripts/build-windows-release.ps1`**, which is why it is named on the list above: a reader runs what it packaged, so it takes a number exactly as the build step that calls it does.

### 4. Check every shipped ticket is ready

Before releasing, inspect live tickets. **A box struck through is neither open nor ticked** — striking is how this tree retires a box whose work moved elsewhere or changed shape, so it is not work left and it is not evidence, and none of the counts below see it. Count only the boxes with nothing struck at the front of what follows them; a strike part way along a line is a box whose wording changed, and it is still open, as is one that never closes. Each struck box carries the reason after the closing `~~`, which is the only record of where its work went. A ticket with exactly one open box must have that box under `The owner's box`; otherwise stop. **A ticket whose owner's box is ticked stops the release** — the owner has already said it works, so it is `/done`'s to close rather than this skill's to ship. A ticket with no owner's box at all stops it too; `scripts/check-docs.mjs` refuses that plan. <!-- shared-rule: struck-owners-box -->A struck owner's box is not the owner's word.<!-- /shared-rule --> So it ships normally: nothing is pressed, nobody has answered, and the ticket stays live until the owner asks for `/done`. Every built phase must have its test box ticked, or struck with the reason it cannot be tested here; an open test box stops the release the same way an open work box does. Any test gap found on the way is filed as its own ticket before the release, never carried in the commit.

### 5. Sync, comment and check

There is no handoff and nothing to submit: the code, the plan tree and the release are all in front of you. Land what is in the tree, run the same checks — `/sync-docs`, `/code-comments`, `/check` — then release from here.

### 6. Mark every shipped ticket Released and finish

Before the final landing or release, write `> **Released 18 August 2026, 9:11pm, v1.21.2.**` under the dated `Designed` line in every ticket it ships; a site-only landing says `no version` in place of the version. Run `just bundle-plan-status`, read each live row back as `Released`, and add the ticket and the derived running order to `LEAFTEXT_RELEASE_PATHS`. **The line goes in the ticket and never in the running order**: that column is computed from each ticket's own dated lines, so a stage typed into the shared file is refused and a ticket left without the line goes on saying a build is under way. Do not move it into `done/` here. Then run the final `just land <message>` for site-only work or `just release <version> <message>` for an app change; neither final push may happen before this read-back succeeds.

## Which number moves

Read it off the folder of the ticket whose row is about to say `Released`. It is a path, not a judgment — the rule this replaced asked whether a reader would notice, and that question came back "patch" five hundred and two times running.

| What the release carries | What the version becomes |
| --- | --- |
| it takes something away from a copy already installed — a settings, recents or vault-registry path moves, a migration drops what the user made rather than what the app cached, or a file an older copy wrote stops being readable | the first number goes up and the other two to zero: `1.0.0` |
| at least one ticket out of `features/` | the middle number goes up and the last to zero: `0.2.0` |
| only tickets out of `refactor/` or `fixes/`, or no ticket at all | the last number goes up by one: `0.2.1` |

The first row that applies wins. Size never moves a number on its own: the first number is the only one that means this release can cost you something, and spending it on a big feature leaves nobody a way to tell. Going from `0` to `1` because the app feels finished is the owner's word — ask, never derive it. Moving the middle number is safe; the updater compares each part as a number, and a test pins `0.2.0` above `0.1.999`.

## Two tags exist at a time

**Keep the new tag and the tag of the release people are downloading; delete every other one, here and on GitHub, before making the new one.** The new release does not exist until its build publishes, and every download address and the updater resolve through the latest release — so the published tag has to stand through the whole build, and through a build that fails and never publishes at all. Which tag that is comes from GitHub rather than from version order: a failed build leaves a higher tag with no release under it, and sorting would keep that one and delete the complete release underneath. `just release` asks once, before it deletes anything, and stops without touching a tag if GitHub cannot say. Tags are otherwise pruned by the build itself: after it publishes, it deletes every release older than those two along with its tag, so a tag left here comes back the moment anything is pushed with `--tags`. Let four pile up and the next push carries four, and **GitHub creates no push event at all for a push carrying more than three tags** — so no build starts, no installer is published, and the tag sits on GitHub looking shipped. That is how v0.1.502 went out with nothing to download.

So the order is: check, retire every tag but those two, commit, make the new one, push `main`, then push the tag on its own — and all of it is one command, `just release <version>`, which holds one still copy of the plan tree from the check to the last push. **The check comes before the cleanup on purpose.** The plan tree is shared, so another session can write a ticket, a row or a skill copy while the check runs; the release reads a copy taken before it started, and a check that stops anyway leaves the last released tag exactly where it was. When it was two commands with the cleanup first, a stopped check took the last tag with it and left nothing shipped-looking to fall back on. A failure *after* the cleanup is a release that failed — say that, and never call it a plan race. **<!-- shared-rule: sessions-in-one-checkout -->Two sessions build in this one checkout, on tickets the running order's `Devs with` column says share no file, and neither of them writes the running order.<!-- /shared-rule -->** A release is the one step still taken alone: it stages the tree in front of it, so the other session's work would ride out with this one's.

**Alone means one at a time, never one that stops.** Find the other session mid-release: wait, re-read the version and the tree, release. Never hand it back and ask the owner to say it twice.

**<!-- shared-rule: another-sessions-work -->Another session's work is not this pass's, whatever state it is in.<!-- /shared-rule -->** It is never staged, committed, pushed, explained, attributed or asked about in the hand-back. A file that appears while the checks run is outside this pass's path list unless this pass itself wrote it.

### 7. Confirm the build started

The push is the last write, but it is not the end. Read the workflow list once and confirm a run exists for the tag just pushed. Nothing here waits on a build, polls it, or re-runs it on failure — a broken build costs a patch bump. This is only the check that a build was *started*, because the failure this catches is silent: the tag is on GitHub and no run was ever created.

**A build that failed because GitHub would not answer costs no number at all.** It is the one failure where nothing needs rebuilding: the installers were made and only the release to hang them on was refused, so it is finished on the tag that is already up with `just publish-release <version>`, however long the outage lasted. A patch bump is for a build that failed on the code. v1.15.6 built both installers, published neither, and the written way forward was a new version and a second hour of checks.

If no run exists at all, the same command starts both release workflows against that tag. Never re-push a tag.

After the release, the whole reply is the owner's message, word for word. A ticket already `Released` stops the pass before it starts, and that refusal is said plainly, because it is a reason nothing happened rather than a report of what did.

<!-- keycode: LEAF-4409 -->
