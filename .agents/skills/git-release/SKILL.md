---
name: git-release
description: Commit and push releases. Always runs the sync-docs skill first to keep the docs truthful, then proceeds. App (Rust) changes bump the version, tag, and trigger CI builds; site-only changes (README/index.html/site/imgs) just push — no version bump. Always cleans up GitHub Pages deployments to keep only the newest. Never co-authors commits. Use only when user instructs git operations like "bump and push", "release version X", or "release the site". Use when user says bump, release, push with tag, commit and push.
disable-model-invocation: true
argument-hint: "[version] [message]"
user-invocable: true
---

# Git Release

Handles all git operations for releases. Two kinds:

- **App release** — any Rust/build code changed. Bump the version, update the lock file, tag, push, delete old tags. The `v*` tag triggers the CI builds (Windows MSI, macOS DMG, Linux).
- **Site-only release** — only the static site / docs changed (no Rust). **Do not bump the version** (there's no app to rebuild). Just commit and push `main`; GitHub Pages redeploys automatically from the branch.

Both kinds finish by **cleaning up GitHub Pages deployments**, keeping only the newest. Never co-authors commits. Only runs when explicitly instructed.

Repo: `ryanallen/leaftext`.

## Inputs

1. **Version** (optional, app releases only): Semantic version to bump to (e.g. `0.1.104`). If omitted/invalid, auto-derive it from `Cargo.toml` (patch + 1). Never ask the user for the version; figure it out. Ignored for site-only releases.
2. **Message** (optional): Commit message. Defaults to `Release v<version>` (app) or a short summary of the changes (site-only).

## Process

### Pre-step: Sync the docs first (always)

Before doing anything else — for **both** app and site-only releases — run the [sync-docs](../sync-docs/SKILL.md) skill so the published documentation describes what is about to ship:

1. Invoke `/sync-docs` (no argument; it inspects the working tree and recent commits to find what changed).
2. Let it finish completely. It edits Markdown under `docs/` (and, if pages were added/removed, `docs/docs.js` NAV and the README list) and **leaves the changes uncommitted** — it never touches git.
3. Only once sync-docs has fully completed do you begin the git-release process below. Any doc edits it produced are uncommitted working-tree changes, so step 0 will pick them up and commit them along with everything else.

Do not skip this even for app releases: a code change is exactly when the docs most often drift.

### 0. Commit any uncommitted changes

```bash
git status
git add -A
git commit -m "[short description of changes]"
```

**Critical:**
- Never add `Co-Authored-By` or any assistant identity to commit messages. Authored by the repo owner only.
- Use a brief, descriptive message summarizing the actual changes.
- Only proceed once all changes are committed.

### 1. Decide: app release or site-only?

Look at what this push will actually contain (committed but not yet on the remote) and check whether any **app/build** path changed:

```bash
git fetch origin main -q
changed=$(git diff --name-only origin/main..HEAD)
echo "$changed"
echo "$changed" | grep -Eq '^(src/|Cargo\.toml|Cargo\.lock|build\.rs|wix/|leaf\.rc|scripts/|\.github/workflows/release-)' \
  && echo "=> APP RELEASE (bump version)" \
  || echo "=> SITE-ONLY (no version bump)"
```

- **App paths** (any of these → app release): `src/`, `Cargo.toml`, `Cargo.lock`, `build.rs`, `wix/`, `leaf.rc`, `scripts/`, `.github/workflows/release-*`.
- **Everything else is site-only**: `README.md`, `index.html`, `site/`, `imgs/`, `.nojekyll`, other docs/config.

If **site-only**, skip steps 2–6 and go straight to **step 7 (push)** then **step 8 (deployment cleanup)**. Do **not** touch `Cargo.toml`/`Cargo.lock` and do **not** create a tag.

If **app release**, do steps 2–8.

### 2. Auto-derive the version (app release)

```bash
cur=$(grep -m1 '^version = ' Cargo.toml | sed -E 's/version = "(.*)"/\1/')
next=$(echo "$cur" | awk -F. '{printf "%d.%d.%d", $1, $2, $3+1}')
echo "$cur -> $next"
```

Confirm the tag is free (`git tag | grep -x "v$next"`); if taken, bump the patch again until free. Use `$next` as `<version>` below.

### 3. Bump version (app release)

- Edit `Cargo.toml`: set `version` to the new version.
- Edit `Cargo.lock`: update the `[[package]] name = "leaftext"` section to match.

### 4. Stage and commit (app release)

```bash
git add Cargo.toml Cargo.lock
git commit -m "Release v<version>"
```

**Critical:** Never add `Co-Authored-By` or any assistant identity.

### 5. Delete old local tags (app release)

```bash
git tag | grep "^v" | grep -v "v<new-version>" | xargs -r git tag -d
```

### 6. Create the tag (app release)

```bash
git tag v<version>
```

### 7. Push

```bash
# app release:
git push origin main && git push origin v<version>
# site-only:
git push origin main
```

For app releases, also delete old remote tags so GitHub shows only the latest:

```bash
git push origin --delete <old-tag-1> <old-tag-2> ...
```

### 8. Clean up GitHub Pages deployments (always — keep only the newest)

Every push redeploys the site, leaving a pile of old `github-pages` deployments. **Do not wait for the new deployment to finish** — Pages always deploys fine here, and waiting just stalls the release. Run the prune immediately after the push: delete every deployment except the newest, ending with **exactly one**.

GitHub refuses (HTTP 422) to `DELETE` a deployment while it is **active** — that is why a plain delete leaves the previous deploy behind (right after a push it is often still the active one, because the new build hasn't flipped over yet). The fix is to **mark each old deployment `inactive` first, then delete it**. That is GitHub's supported way to remove a deployment and needs no waiting: force it inactive, delete it, done.

```bash
# Keep only the NEWEST github-pages deployment; delete every older one outright.
# For each: POST state=inactive (so GitHub will allow the delete even if it is
# currently active), then DELETE. No wait loop, no 422 skip — the old one goes.
ids=$(gh api "repos/ryanallen/leaftext/deployments?environment=github-pages&per_page=100" --jq '.[].id')
keep=$(echo "$ids" | head -1)
echo "keeping newest: $keep"
echo "$ids" | tail -n +2 | while read -r old; do
  [ -z "$old" ] && continue
  gh api -X POST "repos/ryanallen/leaftext/deployments/$old/statuses" -f state=inactive >/dev/null 2>&1
  gh api -X DELETE "repos/ryanallen/leaftext/deployments/$old" >/dev/null 2>&1 \
    && echo "deleted $old" || echo "FAILED to delete $old"
done

# Confirm exactly one deployment remains, and the site is still up.
echo "remaining:"; gh api "repos/ryanallen/leaftext/deployments?environment=github-pages" --jq '.[].id'
curl -s -o /dev/null -w "leaftext.com -> HTTP %{http_code}\n" -L http://leaftext.com/
```

The list is newest-first, so `head -1` is the deploy to keep. Every older deployment is forced inactive and deleted, so the list ends with **one** entry — the active site. If the very newest build hasn't registered its deployment yet at prune time, you simply keep the current one and there is nothing older to remove; you never end with two.

## Examples

**User says:** "Release the site" (only `README.md` and `site/` changed).

**Actions:**
1. Run `/sync-docs` first; let it finish (any doc edits stay uncommitted).
2. Commit changes with a short message.
3. Detect site-only (no app paths in the diff) → **no version bump, no tag**.
4. `git push origin main` (Pages redeploys).
5. Immediately delete all older github-pages deployments, keep the newest (do not wait for the build).

**Result:** site updated; version unchanged; deployments list shows one entry.

**User says:** "Bump to 0.1.104 and push" (Rust changed).

**Actions:**
1. Run `/sync-docs` first; let it finish (any doc edits stay uncommitted).
2. Commit changes.
3. Detect app release.
4. `Cargo.toml` + `Cargo.lock` → `0.1.104`; commit `Release v0.1.104`.
5. Delete old local tags; `git tag v0.1.104`.
6. `git push origin main && git push origin v0.1.104`; delete old remote tags.
7. Clean up github-pages deployments to the newest one.

**Result:** v0.1.104 released; GitHub shows only the latest tag; CI builds trigger; deployments list shows one entry.

## Troubleshooting

**Site change accidentally bumped the version.**
Cause: a Rust/build path slipped into the commit. Re-check step 1's diff; if it really is site-only, revert the `Cargo.toml`/`Cargo.lock`/tag changes.

**Cargo.lock version mismatch / "cannot update the lock file because --locked was passed".**
Cause: `Cargo.lock` wasn't updated to match `Cargo.toml`. Solution: set the `[[package]] name = "leaftext"` version in `Cargo.lock` to match.

**Old tags still show on GitHub.**
Cause: remote tags weren't deleted. Solution: `git push origin --delete v<old-version> ...`.

**Deployments keep piling up / an old one is left behind.**
Cause: a plain `DELETE` was used and hit HTTP 422 because the old deployment was still active, so it was skipped. Re-run step 8 — it marks each old deployment `inactive` first, then deletes it, so the list collapses to exactly the newest with no waiting.

## Reference

- [AGENTS.md](../AGENTS.md) — Release flow and version strategy
- `Cargo.toml`: source of truth for the app version (app releases only)
- `Cargo.lock`: must match `Cargo.toml` for CI builds
- GitHub Pages deploys from `main` (branch builder); `.nojekyll` keeps it serving files raw
