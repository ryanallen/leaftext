# Releasing

> Bump `Cargo.toml` and commit it first, then run `just release <version>` to verify, tag, and push. CI automatically builds the Windows MSI and the macOS DMG.

Leaftext releases are managed with a single `just release <version>` command — but it does **not** bump the version for you. You edit `version` in `Cargo.toml` to the new value and commit it first; `just release <version>` then verifies that `Cargo.toml` already matches the version you pass, tags the release, and pushes. CI takes over from there to build all platform artifacts and attach them to the GitHub Release.

## Release command

```sh
just release <version>
```

Example:

```sh
just release 0.2.0
```

This executes the following two steps as defined in the `Justfile`:

```text
release version:
    node --experimental-strip-types scripts/prepare-release.mts "{{ version }}" --no-sign-commit
    git push origin HEAD --follow-tags
```

1. **`prepare-release.mts`** — A TypeScript script (run directly by Node.js via `--experimental-strip-types`) that guards and finalizes the release. It reads `Cargo.toml` and throws if the version does not already equal the one you passed, requires a clean working tree, requires the tag not to exist yet, runs `just verify`, then creates a `Release v<version> [release-prep]` commit and an annotated git tag. It never edits `Cargo.toml` — the version bump is a manual, already-committed step.
2. **`git push origin HEAD --follow-tags`** — Pushes the commit and all reachable annotated tags to the remote. The tag push triggers CI.

So the full flow is: edit `Cargo.toml` → commit → `just release <version>`.

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

A third workflow runs on the same tag and **publishes nothing**: it installs the `wasm32` target and runs `just build-web`, so a break that only appears when the renderer is built for a browser is caught by the release rather than by whoever next builds it by hand. It holds read-only permissions and is deliberately not a step inside either job above — both of those can write and delete releases, and a tag can never be re-pushed, so a failure there would cost a version number instead of a message. That is the same shape as the installer check, which compiles the MSI on a branch push and inspects it without publishing.

**The website publishes on a push to `main` rather than on a tag**, through a fourth workflow that is nothing to do with a release. It builds the renderer, writes it beside the pages under `assets/leaftext/`, and deploys — so a compiled module never enters the tree, and the site and the app cannot drift apart. It refuses to deploy a build that produced no working module, and GitHub Pages keeps serving the last successful deployment, so a failure means the site stops updating rather than going dark.

## Before releasing

Always run the full verification suite before cutting a release to confirm formatting, type-checking, and tests all pass:

```sh
just verify
```

This runs `cargo fmt --check`, `cargo check --all-targets`, `cargo test`, and a vendored-asset drift check (`just check-vendor`) in sequence. A clean `just verify` is required before invoking `just release` — and `just release` runs it again itself, so a dirty tree or a failing check will stop the release.

## Version format

Use [semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. The current version is tracked in the `[package]` section of `Cargo.toml`:

```toml
[package]
name = "leaftext"
version = "1.1.1"
edition = "2021"
```

You edit this field and commit it before running `just release`; the release script then verifies it matches, and commits and tags. The packaged version must equal the `Cargo.toml` version or the platform build scripts stop with an error, and a version tag is never re-pushed — a failed build means bumping to the next patch and starting over.

> [!NOTE]
> The release script uses `--no-sign-commit`, so no GPG key is required to cut a release. Tags are pushed by `--follow-tags`, which pushes all local annotated tags that are reachable from the pushed commits — so only the new release tag travels with the push, not any older unrelated tags.
