# Releasing

> Bump `Cargo.toml`, leave it in the working tree, then run `just release <version> <message>` to verify, commit, tag, and push. CI automatically builds the Windows MSI and the macOS DMG.

Leaftext releases are managed with a single `just release <version> <message>` command — but it does **not** bump the version for you. You edit `version` in `Cargo.toml` to the new value and leave it uncommitted; `just release` then verifies that `Cargo.toml` already matches the version you pass, runs the whole check suite against a still copy of the plan tree, retires the older tags, and commits the work sitting in the tree, tags it and pushes. CI takes over from there to build all platform artifacts and attach them to the GitHub Release.

**The tree is dirty on purpose.** A release commits the work written in this checkout and not yet committed, so a clean tree is nothing to release and is refused before the suite runs. `just land <message>` is the separate command that puts the tree on `main` immediately with no gate, no version and no tag, so work stops sitting uncommitted while the checks run; the release then commits whatever the docs, the comments and the version bump add on top.

**Every commit names its work.** The message is the plain words after the command — no quotes needed, `just` passes them through — and it should name the ticket the work belongs to. Both commands refuse a blank message, so the history never fills up with one repeated title; the release commit comes out as `Release v<version>: <message>`.

## Release command

```sh
just release <version> <message>
```

Example:

```sh
just release 0.2.0 Vault search ships
```

This executes one step as defined in the `Justfile`:

```text
release version *message:
    node --experimental-strip-types scripts/prepare-release.mts {{ version }} --no-sign-commit {{ message }}
```

**`prepare-release.mts`** — A TypeScript script (run directly by Node.js via `--experimental-strip-types`) that guards and finalizes the release, from the check suite to the last push. It reads `Cargo.toml` and throws if the version does not already equal the one you passed, requires the tree to have work in it at all, and requires the tag not to exist yet. It then takes a still copy of the plan tree next door, runs `just verify` against that copy, and — only if the suite passed — reads the work in the tree again, deletes every older tag here and on the remote, stages that second list of paths by name, creates the release commit and an annotated tag, pushes `main`, and pushes the tag on its own. The copy is removed whichever way the release ends.

**The list of paths to commit is read twice on purpose.** The first read is what refuses a release with a clean tree, before an hour of checks rather than after; the second decides what is staged, and it has to come after the suite because the suite compiles and a compile rewrites `Cargo.lock` with the package's own version in it. Staging the earlier list committed a version bump with a lockfile still naming the version before it, and both release builds pass `--locked`, so they refused to update one and died on their first command with the tag already on GitHub and no installer under it.

**What is staged is what is dirty, less whatever another session has edited.** A hook fires on every edit and writes the file down under the session that made it, in the operating system's temp folder, and both git writes subtract that record from the paths they were about to stage — so a release carries its own work and leaves somebody else's half-built code sitting in the tree for them. It never stops or waits: a rule that halted while another session was typing would halt on the ordinary state of this checkout. It subtracts the other session's paths rather than keeping only its own, because the lockfile the suite rewrote, the generated stylesheets, the gallery and the discovery files are written by commands rather than edits, so no record claims them and they stay with the release that produced them. A file two sessions both edited is left out on purpose and named out loud with the session that owns it; the next landing takes it. Where no session can be identified, everything dirty is staged, which is what the release did before. Two releases went out without it: one carried eighty-five lines of another session's measuring code, and one carried a second session's whole ticket under a commit message naming a different one.

It was two commands, the second of which pushed after the first had exited. Two things came out of that: a plan edit landing mid-check stopped a release the release had not caused, and the push ran with no checked plan state behind it at all. It never edits `Cargo.toml` — the version bump is yours to make, and it is one of the paths the release commits.

The plan copy exists because the owner writes the plan tree next door while a release runs. Six of the suite's checks read it, and they ask one resolver where it is; during a release that resolver answers the copy, so all six read the same complete state whatever else is being written at the time. A tree that changes while it is being copied is copied again, and a tree that will not settle stops the release before any tag is touched.

So the full flow is: `just land <message>` → edit `Cargo.toml` → `just release <version> <message>`.

## What CI builds

After the tag push, the CI pipeline produces release artifacts for all supported platforms:

| Platform | Artifact             |
| -------- | -------------------- |
| Windows  | 64-bit MSI installer |
| Windows  | 64-bit EXE installer, for a machine whose policy blocks Windows Installer packages |
| macOS    | Universal DMG (Apple Silicon + Intel) |

**Every published file is an installer somebody can run.** Each is both the hand-install download and what the [in-app updater](../01-features/05-settings.md#updates) installs. Nothing is published for the updater alone and no checksum files are published: a digest served from the same host as the download adds nothing over the advertised byte count and TLS, and every extra file on a release page is one a visitor has to ask about. If a release publishes no installer for a platform, that platform falls back to notify-only — the button opens the release page instead of downloading.

Windows has two of them because a managed machine can be set to refuse Windows Installer packages outright, and no certificate changes that — the refusal is about the kind of file. The EXE is built here from `installer/`, carries the same app binary the MSI carries, and produces the same install: same folder, same registry values, same single Start Menu entry, same file associations. Which one a copy updates through is written when it is installed rather than chosen by a reader, so nobody is handed a file their machine refuses. The Windows job publishes both or fails; a release missing one looks exactly like a release that never had it.

Adding an artifact means someone will ask what it is. That is the bar it has to clear.

Every artifact is automatically attached to the GitHub Release at [github.com/ryanallen/leaftext/releases](https://github.com/ryanallen/leaftext/releases), alongside the source archives GitHub attaches itself and which cannot be turned off.

**Only the newest release is kept.** Each platform job deletes every older release and its tag once its own upload succeeds, so the releases page holds exactly one version — the current one. That cleanup runs after publishing and can never fail the build: both jobs race to do it, so whichever finishes second routinely finds the release, or its tag, already gone.

**Each job asks GitHub again when it will not publish.** Making the release and uploading the installers to it are retried together, six attempts over about five minutes in widening steps, because either half can be the one refused and an upload to a release nobody made is refused every time. Whichever job gets there first makes the release and the other uploads to it, which is what happens on every release. A job that runs out of attempts fails, before its cleanup step, so the last download stays where it is — and it says the tag is still up and names the command below, since nothing about the build needs doing again.

## Finishing a release GitHub refused

Everything but the last step survives an outage: the suite ran, the commit is on `main`, the tag is on GitHub and both installers built. Only asking for a release to hang them on failed. That is finished on the tag that is already up, however long the outage lasted:

```sh
just publish-release <version>
```

It starts both release builds against `v<version>` and refuses a version whose tag is not on GitHub. It makes no tag, moves none, touches no version and commits nothing, so it is neither a re-push nor a second release — the builds check out the tag they are handed, which is what their by-hand trigger is for. It needs GitHub's own `gh` command, which is the one tool here that can start a build. It is a release even though it writes nothing, so the gate asks for the same explicit release a commit needs — and `gh` itself is refused off a short list of reads for the same reason, since starting a build and creating, uploading to or deleting a release are all one command away. A tag left stranded needs no cleaning up by hand either: the next release deletes every tag but its own.

**A new version number is for a build that failed on the code.** Cutting one for a refused publish spends the whole suite again and produces an identical installer, and it is what the written path used to say: v1.15.6 built both installers, published neither, and left v1.15.5 as the newest thing anybody could download.

A third workflow runs on the same tag and **publishes nothing**: it installs the `wasm32` target and runs `just build-web`, so a break that only appears when the renderer is built for a browser is caught by the release rather than by whoever next builds it by hand. It holds read-only permissions and is deliberately not a step inside either job above — both of those can write and delete releases, and a tag can never be re-pushed, so a failure there would cost a version number instead of a message. That is the same shape as the installer check, which compiles the MSI on a branch push and inspects it without publishing.

**The Mac half is compiled before any tag exists**, by a workflow on every push to `main`: a macOS runner runs the gate's own `cargo check --all-targets`, tests included, holding read-only permissions and publishing nothing. Every line behind `#[cfg(target_os = "macos")]` is unread on the machine that gates the work, so its first reader used to be the release build itself — v1.28.0 failed there on an unused import, publishing the Windows installers and not the Mac one, after the tag was already spent. `just release` reads that check's newest completed answer on `main` before it makes a tag and refuses on a failure, naming the run; it never waits on a run still going, so a quiet GitHub or a check not yet finished stops nothing. A check named `validate-` is held to that read-only shape by `just check-workflow-permissions`.

**The website publishes on a push to `main` rather than on a tag**, through a fourth workflow that is nothing to do with a release. It builds the renderer, writes it beside the pages under `assets/leaftext/`, and deploys — so a compiled module never enters the tree, and the site and the app cannot drift apart. It refuses to deploy a build that produced no working module, and GitHub Pages keeps serving the last successful deployment, so a failure means the site stops updating rather than going dark.

## Before releasing

Always run the full verification suite before cutting a release to confirm formatting, type-checking, and tests all pass:

```sh
just verify
```

That is the whole suite — formatting, `cargo check --all-targets`, the browser build, the tests, and every `check-` recipe the `Justfile` defines, each of them listed in [Building](02-building.md#individual-tasks). A clean `just verify` is required before invoking `just release` — and `just release` runs it again itself, so a failing check will stop the release.

## Version format

Use [semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. The current version is tracked in the `[package]` section of `Cargo.toml`:

```toml
[package]
name = "leaftext"
version = "1.15.6"
edition = "2021"
```

You edit this field and leave it in the working tree before running `just release`; the release script then verifies it matches, and commits and tags. The packaged version must equal the `Cargo.toml` version or the platform build scripts stop with an error, and a version tag is never re-pushed — a build that failed on the code means bumping to the next patch and starting over, while one GitHub refused to publish is finished on the tag it already has, as above.

> [!NOTE]
> The release script uses `--no-sign-commit`, so no GPG key is required to cut a release. `main` and the tag are pushed as two separate commands, with the tag going last and on its own: GitHub creates no push event at all for a push carrying more than three tags, so a push carrying several starts no build and publishes nothing while the tag sits there looking shipped. That is also why the older tags are deleted before the new one is made.
