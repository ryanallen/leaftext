set windows-shell := ["cmd.exe", "/C"]

default:
    just --list

check:
    cargo check --all-targets

test:
    cargo test

format:
    cargo fmt

format-check:
    cargo fmt --check

# Copy the vendored assets (mermaid, KaTeX, Noto) from src/assets into the static
# site. src/assets is the source of truth (it's what the binary embeds).
sync-vendor:
    node scripts/sync-vendor.mjs

# Fail if the site's vendored assets have drifted from src/assets.
check-vendor:
    node scripts/sync-vendor.mjs --check

# Compile the per-family Markdown files under themes/ into src/assets/themes.md,
# the bundle the binary embeds. themes/ is also served at leaftext.com/themes.
bundle-themes:
    node scripts/bundle-themes.mjs

# Fail if src/assets/themes.md has drifted from the themes/ source files.
check-themes:
    node scripts/bundle-themes.mjs --check

# Fail on British spelling in the repo's own writing (US English throughout).
check-spelling:
    node scripts/check-spelling.mjs

# Fail on an assistant or third-party identity anywhere in the repo or its history:
# a co-author trailer, a generated-by credit, an assistant as a commit author.
check-identity:
    node scripts/check-identity.mjs

# Self-test the two hooks in .claude/settings.json: that Rule 1 is still findable
# in AGENTS.md and written once, and that a git write is refused without a license.
check-hooks:
    node scripts/gate-rules.mjs --check
    node scripts/gate-git.mjs --check

# Run the WebView front-end against a fake page: that it parses, that it boots
# (the fragments are one script, so their order is load-bearing), and that the
# code view's edit arithmetic is right — it decides what gets written to a file.
check-shell:
    node scripts/check-shell.mjs

# Rebuild the vendored Monaco bundle (the code view's editor). Manual, like the
# other vendored assets — first: npm i --no-save monaco-editor@0.52.2 esbuild@0.24.0
bundle-monaco:
    node scripts/bundle-monaco.mjs

# A screenshot BMP in, the smallest PNG out — the same encoder the flowchart
# export uses (src/png.rs), so documentation images and diagrams cannot drift
# onto two implementations. Used by scripts/capture-screenshot.ps1.
squeeze-png source target:
    cargo run --quiet -- --squeeze-png "{{ source }}" "{{ target }}"

verify: format-check check test check-vendor check-themes check-spelling check-shell check-identity check-hooks

# Cut a release: commit, tag, and push so CI builds all platforms.
release version:
    node --experimental-strip-types scripts/prepare-release.mts "{{ version }}" --no-sign-commit
    git push origin HEAD --follow-tags
