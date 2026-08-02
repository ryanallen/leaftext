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

# Compile design/colors.md into the token contract in theme.rs, and design/tokens.md
# into src/assets/tokens.css. design/ is the source of a token.
bundle-tokens:
    node scripts/bundle-tokens.mjs

# Compile design/icons.md into src/assets/icons.css: one mask class per icon.
bundle-icons:
    node scripts/bundle-icons.mjs

# Fail if icons.css has drifted from design/icons.md, if a row names a file that is
# not there, or if an SVG under src/assets/ has no row.
check-icons:
    node scripts/bundle-icons.mjs --check

# Build gallery.html — every theme, color, value, icon and component on one page, at
# leaftext.com/gallery.html. Needs a compile: the stylesheet comes from the binary,
# because the theme compiler is Rust.
bundle-gallery:
    node scripts/bundle-gallery.mjs

# Write the published design-system page from design/, so its counts cannot be typed.
bundle-design-docs:
    node scripts/bundle-design-docs.mjs

# Fail if that page has drifted from design/.
check-design-docs:
    node scripts/bundle-design-docs.mjs --check

# Fail if the gallery has drifted from design/, or a component row has no sample to
# draw it with.
check-gallery:
    node scripts/bundle-gallery.mjs --check

# Fail if the generated token files have drifted from design/, if a theme file sets a
# color design/colors.md does not list, or if a component row names a class family
# nothing styles.
check-tokens:
    node scripts/bundle-tokens.mjs --check

# Fail on British spelling in the repo's own writing (US English throughout).
check-spelling:
    node scripts/check-spelling.mjs

# Fail if a check the Justfile defines is not in `just verify` — a rule with no check
# in the suite holds only while someone remembers it.
check-verify:
    node scripts/check-verify.mjs

# Fail on a class in reading.css that design/components.md does not account for — as a
# component with a sample the gallery draws, as something a rendered document brings, or
# as a state. New parts of the interface join the design system or fail here.
check-classes:
    node scripts/check-classes.mjs

# Fail on a hand-written value in reading.css — a color, spacing, size, weight,
# stroke, line height, letter spacing, opacity, duration, shadow or layer. Every one
# comes from design/tokens.md or design/colors.md.
check-literals:
    node scripts/check-literals.mjs

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
squeeze-png source target *flags:
    cargo run --quiet -- --squeeze-png "{{ source }}" "{{ target }}" {{ flags }}

# Which pictures the docs ask for, and which are not there. Not in `verify`: the
# backlog would make it red before anybody touched it. `/sync-docs` runs it.
doc-images:
    node scripts/doc-images.mjs

verify: format-check check test check-vendor check-themes check-tokens check-icons check-gallery check-design-docs check-classes check-literals check-verify check-spelling check-shell check-identity check-hooks

# Cut a release: commit, tag, and push so CI builds all platforms.
release version:
    node --experimental-strip-types scripts/prepare-release.mts "{{ version }}" --no-sign-commit
    git push origin HEAD --follow-tags
