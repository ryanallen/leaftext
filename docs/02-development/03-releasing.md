# Releasing

> Bump `Cargo.toml` and commit it first, then run `just release <version>` to verify, tag, and push. CI automatically builds Windows MSI, macOS DMG, and Linux artifacts.

leaftext releases are managed with a single `just release <version>` command — but it does **not** bump the version for you. You edit `version` in `Cargo.toml` to the new value and commit it first; `just release <version>` then verifies that `Cargo.toml` already matches the version you pass, tags the release, and pushes. CI takes over from there to build all platform artifacts and attach them to the GitHub Release.

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
| macOS    | Universal DMG (Apple Silicon + Intel) |
| Linux    | `.tar.gz` archive    |

All artifacts are automatically attached to the GitHub Release at [github.com/ryanallen/leaftext/releases](https://github.com/ryanallen/leaftext/releases).

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
version = "0.1.300"
edition = "2021"
```

You edit this field and commit it before running `just release`; the release script then verifies it matches, and commits and tags. The packaged version must equal the `Cargo.toml` version or the platform build scripts stop with an error, and a version tag is never re-pushed — a failed build means bumping to the next patch and starting over.

> [!NOTE]
> The release script uses `--no-sign-commit`, so no GPG key is required to cut a release. Tags are pushed by `--follow-tags`, which pushes all local annotated tags that are reachable from the pushed commits — so only the new release tag travels with the push, not any older unrelated tags.
