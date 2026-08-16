set windows-shell := ["cmd.exe", "/C"]

default:
    just --list

check:
    cargo check --all-targets

# Type-check the browser package: `check` above never reaches it, because the workspace's one default member is the app. Every feature end, since the shell's exports sit behind a feature the core does not have and the colors are their own — so a library signature the browser crate no longer matches fails here instead of staying green. No wasm target and no network.
check-web:
    cargo check -p leaftext-web
    cargo check -p leaftext-web --features shell
    cargo check -p leaftext-web --features shell,highlight

# Type-check and test the Windows installer: `check` and `test` above never reach it, because the workspace's one default member is the app. It builds with no app inside it here — the release script is what hands it one — and everything it does is a plan before it is an act, so all of that is provable with nothing installed.
check-installer:
    cargo check -p leaftext-setup --all-targets
    cargo test -p leaftext-setup

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

# Fail on a Markdown file in this repo or the plan tree next door that no role covers —
# a document nothing keeps true. `--list` prints every file and its role.
check-docs:
    node scripts/check-docs.mjs

# Fail on a running order next door that has quietly stopped ranking every live ticket:
# a ticket with no row, a position that skips or repeats, a count at its foot that
# disagrees with the tree, or a row sitting above what it waits on. Nothing judges
# whether a row is ranked well — that is the ranker's and no script's.
check-plan:
    node scripts/check-plan.mjs

# Fail on a copy of a skill in the shared workflow article that no longer says what the
# skill says. The article is handed on with an exact copy of every skill it cites, so the
# copy is the reader's evidence — a drifted one is the article teaching a rule that was
# retired, and nothing in the folder tells them which half is current. `--fix` rewrites
# every copy from its source.
check-learn-snapshots:
    node scripts/check-learn-snapshots.mjs --check

# Fail on a paragraph broken across lines — in Markdown, and in a comment in the code.
# Everything that reads them reflows, so the newline inside a paragraph only costs: it
# re-flows by hand on every edit after it, and a one-word change diffs as the whole
# paragraph. `--fix` joins them. The joining is self-tested before either mode reads a
# file: it rewrites hundreds, and a wrong transform is caught by nobody until somebody
# reads one.
check-wrapping:
    node scripts/check-wrapping.mjs

# Fail on a diagram drawn with box characters. No renderer lines them up, and a
# wireframe in a ticket is what an interface gets approved from — it has to be a
# picture. `scripts/wireframe.mjs` draws one from an HTML sketch.
check-ascii-art:
    node scripts/check-ascii-art.mjs

# Fail on a file the published pages fetch by a path that has nothing at it — a 404
# nobody sees until the page is live — and on what the pages say about a pager button.
# The warning silenced is Node's own: it imports the site's tooltip module, and no
# package.json here declares `.js` to be modules.
check-site:
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-site.mjs

# Boot the code that draws the two published sites against a stand-in page, fetch
# and renderer module — nothing else in the suite ever runs it, so a script that
# throws as it loads reaches a reader as a blank page. Each boot is read for its
# finished page: both entry readers turn a mid-boot fault into a status line, so
# "it did not throw" passes on a page the reader itself gave up on. The warning
# silenced is Node's own, the same one check-site silences: these are `.js`
# modules and no package.json here declares them to be.
check-site-boot:
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-site-boot.mjs

# Fail on a scratch path in the OS temp folder built from a fixed name. Two agents can
# work this checkout at once, and one file with two writers is how the gate started
# failing on a clean tree. A row per path that is fixed on purpose, with the reason.
check-scratch-names:
    node scripts/check-scratch-names.mjs

# Self-test the private workspace helper: two throwaway repositories, two sessions,
# and the four things a shared checkout got wrong — the plan tree, the app source,
# the index and the build folder each belonging to one session. Offline, and it
# never touches the real pair.
check-workspace:
    node scripts/agent-workspace.mjs --check

# Self-test the public release on a fixture that runs nothing: the order it goes in, and
# what a failed gate, a plan tree that will not hold still, a session's copy, a dirty
# tree or a wrong version never reaches. Offline, and it touches no repository.
check-release:
    node --experimental-strip-types scripts/prepare-release.mts --check

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

# Fail on a rule in the app's stylesheet that would take a published page's frame:
# an overflow, position or touch-action on a bare html, body or :root. The same
# file is what leaftext.com and empty.guru are handed, and one of these left both
# of them unscrollable on every device from v1.5.0.
check-page-frame:
    node scripts/check-page-frame.mjs --check

# Fail on a rule painting a background behind a note's field values under the pointer.
# A document being edited is still a document, so the caret is the cue and a band is
# the app drawing a form over somebody's words.
check-hover-fills:
    node scripts/check-hover-fills.mjs

# Fail on an assistant or third-party identity anywhere in the repo or its history:
# a co-author trailer, a generated-by credit, an assistant as a commit author.
check-identity:
    node scripts/check-identity.mjs

# Self-test the four hooks in .claude/settings.json: that Rule 1 is still findable
# in AGENTS.md and written once, that a git write is refused without a license, that
# a reply over Rule 1's ceiling, or opening with praise, is refused, and that every
# keyed file has a keycode of its own.
check-hooks:
    node scripts/gate-rules.mjs --check
    node scripts/gate-git.mjs --check
    node scripts/gate-voice.mjs --check
    node scripts/gate-keycode.mjs --check
    node scripts/gate-checklist.mjs --check
    node scripts/gate-workspace.mjs --check

# Run the WebView front-end against a fake page: that it parses, that it boots
# (the fragments are one script, so their order is load-bearing), and that the
# code view's edit arithmetic is right — it decides what gets written to a file.
check-shell:
    node scripts/check-shell.mjs

# Fail on a command in the app's one typed list that the browser host says nothing
# about — answered, refused on purpose with the reason, or not yet with the ticket.
# The names come off IpcCommand, never off the front end. It also fails on a stale
# row, and on a literal command the front end sends that no arm exists for.
check-web-commands:
    node scripts/check-web-commands.mjs

# Rebuild the vendored Monaco bundle (the code view's editor). Manual, like the
# other vendored assets — first: npm i --no-save monaco-editor@0.52.2 esbuild@0.24.0
bundle-monaco:
    node scripts/bundle-monaco.mjs

# A screenshot BMP in, the smallest PNG out — the same encoder the flowchart
# export uses (src/png.rs), so documentation images and diagrams cannot drift
# onto two implementations. Used by scripts/capture-screenshot.ps1.
squeeze-png source target *flags:
    cargo run --quiet -- --squeeze-png {{ source }} {{ target }} {{ flags }}

# Ask a running copy of the app something over its pipe. A developer tool, never
# shipped: one MSI and one DMG is the rule. `just mcp` is the same program
# speaking MCP on stdin/stdout, which is how an AI gets at it.
ask request:
    node scripts/mcp-leaftext.mjs --ask {{ request }}

mcp:
    node scripts/mcp-leaftext.mjs

# Drive the copy that is already open — real clicks, drags, wheel notches and key
# presses — and photograph it. Steps are separated by spaces:
#   just drive shot.png scroll:500,400,-8 click:120,300
# An out ending .png goes through the app's own encoder, so it can be read back.
# `just ask` is the other half, for anything the page handles itself.
drive out *steps:
    node scripts/drive.mjs {{ out }} {{ steps }}

# Prove a motion drew rather than that its classes ran: sample one element's
# computed value every frame while a trigger runs, print time and value per
# frame, and fail when the first frame is already at the resting value.
#   just probe-motion .lt-bottom-sheet window.leafOpenSheet()
# --property picks what to watch (transform), --for how long to sample (1000ms).
probe-motion selector *trigger:
    node scripts/probe-motion.mjs {{ selector }} {{ trigger }}

# Fail if the provers cannot read their own arguments back: a driver verb that no
# longer parses, an unknown one accepted, an attached run accepting a flag that
# would write over the owner's settings, or the motion probe taking a run with an
# argument missing. Offline: none of those halves needs an app or a window.
check-driver:
    node scripts/check-driver.mjs

# Fail if the release workflows can no longer find the app's binary in the
# workspace — the browser package sorts first, and taking the first member cost
# v0.1.484's Mac build after it had compiled both chips.
check-release-package:
    node scripts/check-release-package.mjs

# Fail if a workflow caches a directory `cargo install` writes to and installs
# into it unguarded — the cache hands the binary back and the install refuses it,
# which took the site off the air for a release.
check-workflow-installs:
    node scripts/check-workflow-installs.mjs

# Fail if the MCP wrapper and src/pipe.rs disagree about what can be asked, or
# about where to ask it. Offline: the wrapper itself needs the app running, this
# reads two files.
check-mcp:
    node scripts/check-mcp.mjs

# Fail if .agents/settings.json has stopped enabling a plugin every agent opening
# this checkout needs — today the Rust analyzer. Reads one file.
check-agent-settings:
    node scripts/check-agent-settings.mjs

# Download the published conformance suites into target/conformance. On demand, not
# in `verify`: the corpora are 15 MB and fetching them needs the network. Without
# them every conformance test prints one line and returns.
conformance *flags:
    node scripts/fetch-conformance.mjs {{ flags }}
    cargo test conformance -- --nocapture

# Which pictures the docs ask for, and which are not there. The list, for a pass
# that is about to take one; `check-doc-images` is the gate.
doc-images:
    node scripts/doc-images.mjs

# Fail on a page naming a picture nobody took — a broken frame under a heading at
# leaftext.com, which no other check reads and no reader of this repo ever meets.
check-doc-images:
    node scripts/doc-images.mjs --check

# Fail on a picture carrying a black strip nobody drew — the window's invisible
# resize border, photographed. Twenty-four of them shipped to leaftext.com.
check-shot-edges:
    node scripts/check-shot-edges.mjs --check

# Join same-sized PNG screenshot sources with a vertical or diagonal seam, or tile
# previews into a grid. The checked helper is the source of every composed picture.
compose-shots mode out *args:
    node scripts/compose-shots.mjs {{ mode }} {{ out }} {{ args }}

check-compose-shots:
    node scripts/check-compose-shots.mjs

# The two browser modules, and what a page pays for each. Not in `verify`: it needs
# the wasm32 target installed, and a machine without one would go red having done
# nothing wrong. It asserts the core's own ceiling, which is the whole reason the
# highlighter is a second module rather than part of the first.
build-web:
    node scripts/build-web.mjs

# A folder of documents as a static Leaftext site: no server, nothing to run at
# the far end. Drop the result on any static host. Defaults to the Emptyguru
# folder beside this repo; pass another.
export-web folder="":
    node scripts/export-web.mjs {{ folder }}

# The same export, served locally so it can be looked at — a page cannot fetch
# its neighbors off file://. It serves the exported folder and nothing else.
preview-web folder="":
    node scripts/serve-web.mjs {{ folder }}

# Press things in the exported site and read the page back — the browser half of
# `just drive`. A check that passes is not a button that works.
#   just drive-web http://localhost:8123/#README.md click:.docs-pager-next shot:out.png
drive-web url *steps:
    node scripts/drive-web.mjs {{ url }} {{ steps }}

# Fail on quoted interpolations: cmd.exe passes quotes through as argument characters.
check-justfile-quotes:
    node scripts/check-justfile-quotes.mjs

verify: format-check check check-web check-installer check-web-commands test check-vendor check-themes check-tokens check-icons check-gallery check-design-docs check-classes check-literals check-page-frame check-hover-fills check-scratch-names check-workspace check-release check-verify check-justfile-quotes check-spelling check-docs check-doc-images check-plan check-learn-snapshots check-wrapping check-ascii-art check-site check-site-boot check-shell check-identity check-hooks check-release-package check-workflow-installs check-mcp check-agent-settings check-driver check-shot-edges check-compose-shots

# Cut a release: one command from the gate to the push, all of it inside one still copy of
# the plan tree. It was two — check and tag, then push after that process had exited — and
# the push had no copy behind it at all.
release version:
    node --experimental-strip-types scripts/prepare-release.mts {{ version }} --no-sign-commit
