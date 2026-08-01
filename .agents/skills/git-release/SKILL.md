---
name: git-release
description: Commit and push releases. Always runs the sync-docs skill first to keep the docs truthful, then proceeds. App (Rust) changes bump the version, tag, and trigger CI builds; site-only changes (README/index.html/site/imgs) just push — no version bump. Always cleans up GitHub Pages deployments to keep only the newest. Never co-authors commits. Use only when user instructs git operations like "bump and push", "release version X", or "release the site". Use when user says bump, release, push with tag, commit and push.
disable-model-invocation: true
argument-hint: "[version] [message]"
user-invocable: true
---

# Git Release

Handles all git operations for releases. Two kinds:

- **App release** — any Rust/build code changed. Bump the version, update the lock file, tag, push, delete old tags. The `v*` tag triggers the CI builds (Windows MSI, macOS DMG).
- **Site-only release** — only the static site / docs changed (no Rust). **Do not bump the version** (there's no app to rebuild). Just commit and push `main`; GitHub Pages redeploys automatically from the branch.

Both kinds **prune old GitHub Pages deployments just before the push**, keeping the currently active one. Pruning before the push means the cleanup never touches the deployment the push is about to create, so it can't race the in-flight build (which is what made deploys intermittently fail with "try again later"). Never co-authors commits. Only runs when explicitly instructed.

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

### Pre-step: Trim verbose code comments (always, before committing)

Before step 0 commits anything, review the comments **you** added or changed in this session's code edits and condense any that are too long. Fresh comments tend to over-explain — a 4-line block where 1–2 lines carry the point.

1. See the uncommitted diff: `git diff -- 'src/*'` (add other code globs as needed). **Scope is the file, not the author.** Every comment in a file this release touches is in scope; files it doesn't touch are not, so a release never sprawls into an unrelated comment refactor. Who wrote a comment, and when, says nothing about whether it is still true — and "only tidy your own" is a ratchet that lets wrong ones pile up.
2. For each comment you introduced, apply the bar:
   - **Keep the *why*, cut the *what*.** The code shows what it does; the comment explains why it's needed or what breaks without it.
   - **Match the surrounding density.** A new comment should be no longer than nearby existing ones for similar code. If the block next door explains itself in one line, yours should too.
   - **One line if it fits.** Collapse multi-line blocks that restate the same idea, drop incidental specifics (exact pixel values, obvious mechanics) unless load-bearing, and cut hedging.
   - **Cut the history, keep the rule.** A comment narrating how the code got here is a changelog entry, and git already holds it: *"an earlier version divided by …"*, *"this used to …"*, *"two attempts read zero"*, *"we removed X"*, *"the first draft did Y"*, *"this replaced Z"*. Delete the narration outright. Where it exists to stop a mistake recurring, keep the standing rule and drop the story — **"don't do X, it breaks Y" earns its line; "we used to do X" does not.** A comment naming a function, field, file, or behavior that no longer exists is deleted or corrected, never left.

     **Shipped history is not drafting history.** A version number is evidence the rule is real and costly, and those comments stay as they are: *"v0.1.365 shipped without a Start Menu entry and was unreachable"*, *"v0.1.423 shipped near-black boxes"*, *"unlocking a 50,000-block glossary took 148 SECONDS that way"*. That is the repo's memory of what it paid for (see AGENTS.md, *Rules each paid for in version numbers*). What gets cut is the account of this feature being built — attempts, rewrites, and what an earlier draft of the same function did.
3. Edit them down in place. This makes the working tree dirty (or dirtier) — that's expected; step 0 commits the condensed versions.

This is a quality gate, not a git operation — never commit, tag, or push here.

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

If **site-only**, skip steps 2–6 and go straight to **step 7 (deployment cleanup)** then **step 8 (push)**. Do **not** touch `Cargo.toml`/`Cargo.lock` and do **not** create a tag.

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

### 7. Clean up GitHub Pages deployments (before the push — keep the active one)

Every push redeploys the site, so old `github-pages` deployments pile up. Prune them **before** the push, not after. Pruning first means the newest deployment in the list is the one **currently serving the site** — you keep it and delete every older one. Crucially, the deployment the push is about to create does not exist yet, so the prune can never race or cancel it (running the prune right after a push is what made deploys intermittently fail with "Deployment failed, try again later").

Older deployments are already inactive (they were superseded), so a plain `DELETE` removes them. Force `inactive` first anyway — it's harmless and covers the rare case where one is still marked active.

```bash
# Keep the NEWEST github-pages deployment (the one currently serving the site);
# delete every older one. For each: POST state=inactive, then DELETE.
ids=$(gh api "repos/ryanallen/leaftext/deployments?environment=github-pages&per_page=100" --jq '.[].id')
keep=$(echo "$ids" | head -1)
echo "keeping active: $keep"
echo "$ids" | tail -n +2 | while read -r old; do
  [ -z "$old" ] && continue
  gh api -X POST "repos/ryanallen/leaftext/deployments/$old/statuses" -f state=inactive >/dev/null 2>&1
  gh api -X DELETE "repos/ryanallen/leaftext/deployments/$old" >/dev/null 2>&1 \
    && echo "deleted $old" || echo "FAILED to delete $old"
done
echo "remaining before push:"; gh api "repos/ryanallen/leaftext/deployments?environment=github-pages" --jq '.[].id'
```

After this the list holds just the active deployment; the push in step 8 then adds one new deployment, so you briefly have two. That is expected and correct — the still-serving old one keeps the site up until the new build flips over, and the **next** release's pre-push prune removes it. Never try to delete the active deployment to force the count to one: with no new deployment created yet, that would leave the site with nothing serving until the next build finishes.

### 8. Push

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

**The push is the last action.** Never wait on or poll a build — no `gh run watch`/`view`/`list`, no validation branch, no sleeping until something is "proven". A failed build costs a patch bump, not a blocked release. End the turn with one line: "Released v<version>." (or "Site updated.")

## Examples

**User says:** "Release the site" (only `README.md` and `site/` changed).

**Actions:**
1. Run `/sync-docs` first; let it finish (any doc edits stay uncommitted).
2. Commit changes with a short message.
3. Detect site-only (no app paths in the diff) → **no version bump, no tag**.
4. Prune old github-pages deployments, keeping the currently active one.
5. `git push origin main` (Pages redeploys; don't wait for the build).

**Result:** site updated; version unchanged; the old pile is gone, leaving the active deployment plus the new one.

**User says:** "Bump to 0.1.104 and push" (Rust changed).

**Actions:**
1. Run `/sync-docs` first; let it finish (any doc edits stay uncommitted).
2. Commit changes.
3. Detect app release.
4. `Cargo.toml` + `Cargo.lock` → `0.1.104`; commit `Release v0.1.104`.
5. Delete old local tags; `git tag v0.1.104`.
6. Prune github-pages deployments, keeping the currently active one.
7. `git push origin main && git push origin v0.1.104`; delete old remote tags.

**Result:** v0.1.104 released; GitHub shows only the latest tag; CI builds trigger; the old deployment pile is gone.

## Troubleshooting

**Site change accidentally bumped the version.**
Cause: a Rust/build path slipped into the commit. Re-check step 1's diff; if it really is site-only, revert the `Cargo.toml`/`Cargo.lock`/tag changes.

**Cargo.lock version mismatch / "cannot update the lock file because --locked was passed".**
Cause: `Cargo.lock` wasn't updated to match `Cargo.toml`. Solution: set the `[[package]] name = "leaftext"` version in `Cargo.lock` to match.

**Old tags still show on GitHub.**
Cause: remote tags weren't deleted. Solution: `git push origin --delete v<old-version> ...`.

**Deployments keep piling up.**
Cause: the prune (step 7) was skipped. Re-run it any time — safe standalone, outside a release.

## Reference

- [AGENTS.md](../AGENTS.md) — Release flow and version strategy
- `Cargo.toml`: source of truth for the app version (app releases only)
- `Cargo.lock`: must match `Cargo.toml` for CI builds
- GitHub Pages deploys from `main` (branch builder); `.nojekyll` keeps it serving files raw
