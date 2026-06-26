# Releasing

> leaftext uses a `just release` command to bump the version, tag, and push. CI automatically builds Windows MSI, macOS DMG, and Linux artifacts.

leaftext releases are managed with a single `just release <version>` command. It bumps the version in `Cargo.toml`, creates a git tag, and pushes to the remote — CI takes over from there to build all platform artifacts and attach them to the GitHub Release.

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

1. **`prepare-release.mts`** — A TypeScript script (run directly by Node.js via `--experimental-strip-types`) that updates the version in `Cargo.toml`, commits the change, and creates an annotated git tag for the release.
2. **`git push origin HEAD --follow-tags`** — Pushes the commit and all reachable annotated tags to the remote. The tag push triggers CI.

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

This runs `cargo fmt --check`, `cargo check --all-targets`, and `cargo test` in sequence. A clean `just verify` is required before invoking `just release`.

## Version format

Use [semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. The current version is tracked in the `[package]` section of `Cargo.toml`:

```toml
[package]
name = "leaftext"
version = "0.1.205"
edition = "2021"
```

The release script updates this field, commits, and tags — no manual edits to `Cargo.toml` are needed.

> [!NOTE]
> The release script uses `--no-sign-commit`, so no GPG key is required to cut a release. Tags are pushed by `--follow-tags`, which pushes all local annotated tags that are reachable from the pushed commits — so only the new release tag travels with the push, not any older unrelated tags.
