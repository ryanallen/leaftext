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

# Fail on a test that holds an event-loop handler by reading `event_loop.rs` as a string.
# The loop never returns, so that used to be the only way to reach an arm — and what such
# a test holds is spelling: all ten of them passed with the behavior they named deleted.
# One read is allowed, by the exact assertion it makes: the Windows resize reaches a window
# library call no test can build a window for.
check-loop-not-read-as-text:
    node scripts/check-loop-not-read-as-text.mjs --check

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

# Which live tickets can be built alongside the one named — every row whose build writes none of
# the same files, highest-ranked first, with the total. Named however it is easiest to name: the
# path a running-order row links, one from the top of the pair, or the file name on its own.
devs-with ticket:
    node scripts/plan-footprints.mjs {{ ticket }}

# Write the `Devs with` column into every row of the running order next door — the three
# highest-ranked live tickets each one shares no file with, and the total. Never written by hand:
# it is 153 set comparisons a row, 11,781 in all.
bundle-devs-with:
    node scripts/plan-footprints.mjs --write

# Prove the footprint reader, the pairing and the cell on made-up footprints, before any of the
# three is trusted over the real tree. Every cell of the `Devs with` column is computed through this.
check-footprints:
    node scripts/plan-footprints.mjs --check

# Fail on a running-order Status cell that is not what its ticket's own dated lines say. The
# cell used to be typed in by hand, which made the running order the one shared file every
# build wrote — and the column beside it tells two agents in this checkout that they share no
# file. Now it is derived, so a build writes its stage in its own ticket and nothing shared.
check-plan-stage:
    node scripts/check-plan-stage.mjs --check

# Write every live row's Status cell from its ticket. /pm and /done run it; a build never does,
# because the running order is the one file two builds must not both write.
bundle-plan-status:
    node scripts/check-plan-stage.mjs --write

# Fail on a copy of a skill in the shared workflow article that no longer says what the
# skill says. The article is handed on with an exact copy of every skill it cites, so the
# copy is the reader's evidence — a drifted one is the article teaching a rule that was
# retired, and nothing in the folder tells them which half is current. `--fix` rewrites
# every copy from its source.
check-learn-snapshots:
    node scripts/check-learn-snapshots.mjs --check

# Fail on a rule written out in full in more than one file whose copies have stopped
# agreeing. A handful are repeated on purpose, because a reader of any one of those files
# needs the answer there rather than a pointer — so one marked sentence owns the rule and
# every copy is held to its bytes, while each file keeps its own explanation around it.
# `--fix` rewrites the marked sentences from their owners and touches nothing else.
check-shared-rules:
    node scripts/check-shared-rules.mjs --check

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

# Fail when the publish would move a page onto a picture it does not write, or leave
# one behind that it does. The pictures the site serves are PNG in the tree and WebP
# on the runner, and the rewrite that moves the pages between them is the one part of
# it nothing else can see — the encoder only ever runs at publish, so this reads the
# rewrite alone and needs neither it nor a network.
check-site-images:
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/site-images.mjs --check

# Fail when the other published site is drawing its pages with a different front end.
# Both sites run one front end and only this one has a harness, so a fix written here
# reaches the other only when somebody carries it — its reading column stayed a fixed
# width for hours after this one became the app's own measure. It compares what the
# code does rather than what the bytes are, because the other copy keeps the hard
# comment wraps this tree joined, and it skips with a line saying so when that
# checkout is not on the machine.
check-other-site:
    node scripts/check-other-site.mjs --check

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

# Fail on a source line saying TEMPORARY or FIXME, shouted, in the four folders that
# ship. Measuring code is meant to leave with its answer and nothing made it leave: the
# event-counting probe said TEMPORARY in the first word of its own comment and shipped
# in every copy for four versions. No escape on purpose — a block somebody means to
# keep is one that should not say temporary.
check-temporary-code:
    node scripts/check-temporary-code.mjs

# Fail on a host-side success growl that builds a value into its own sentence, and on the
# page's success call written anywhere but the one file that owns it. A path composed into
# the words reaches the reader as words, where the same path handed over on its own is a
# press that opens the file just written — which is the difference the diagram export
# shipped for as long as it existed, in the same box the saved page draws as a press.
check-growl-words:
    node scripts/check-growl-words.mjs --check

# Prove the one reader of src/format.rs on made-up tables: that it answers a well-formed one
# with every variant and every spelling, and that a shape it does not recognize is a refusal
# naming what it could not find rather than a shorter list nobody notices. A reader held only
# against the file it reads passes on the day that file moves, so the tables here are made up.
check-app-formats:
    node scripts/app-formats.mjs --check

# Fail on a format list that moved without the prose describing it being read, and on the
# page's copy of the diagram export list drifting from the host's. It reads no comments —
# nothing can — so it holds a written-down copy of the rows and, when they change, names
# the files whose comments describe them. Adding a format is two edits: the table, and the
# recorded rows that hand over the reading list.
check-format-prose:
    node scripts/check-format-prose.mjs --check

# Self-test the public release on a fixture that runs nothing: the order it goes in, and
# what a failed gate, a plan tree that will not hold still, a clean tree or a wrong
# version never reaches. Offline, and it touches no repository.
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

# Fail when the two stylesheets that decide whether the published minimap rail is on
# the page stop naming one width. The site hides it at a number and under, the exported
# page draws it from one pixel above, and a reader meets a gap between them as a rail
# standing on one page and gone from the other at the same window width.
check-minimap-breakpoint:
    node scripts/check-minimap-breakpoint.mjs --check

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

# Self-test the five hooks in .claude/settings.json: that Rule 1 is still findable
# in AGENTS.md and written once, that a git write is refused without a license, that
# a reply over Rule 1's ceiling, or opening with praise, is refused, that every
# keyed file has a keycode of its own, and that a skill's own steps are readable.
check-hooks:
    node scripts/gate-rules.mjs --check
    node scripts/gate-git.mjs --check
    node scripts/gate-voice.mjs --check
    node scripts/gate-keycode.mjs --check
    node scripts/gate-checklist.mjs --check
    node scripts/gate-sample.mjs --check
    node scripts/gate-design.mjs --check

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

# Fail on a command in the app's one typed list with no row in the published table
# on the architecture page, and on a row there naming no command. That table is the
# only published list of what the page may ask the app for, and a contributor reads
# it to learn what exists. The reader comes off check-web-commands, never a copy.
check-doc-commands:
    node scripts/check-doc-commands.mjs

# Fail on a module under src/ the file map does not name — not in a bold entry of its
# own and not inside the entry for its directory. That list is what AGENTS.md sends a
# session to the moment work reaches a source file, so a module missing from it reads
# as a module that does not exist. The three test trees are skipped, and a directory
# with no entry at all is reported once rather than per module under it.
check-doc-modules:
    node scripts/check-doc-modules.mjs

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

# Launch a copy of the app beside the one the owner is reading and leave it up, so
# a change can be watched in a real window without taking their place, their tabs
# or whatever they were mid-way through. It runs under an account name and a
# profile of its own, so it opens its own window and hears its own quit.
#   just probe-copy README.md
#   just probe-copy README.md --work startup
# --work names the profile: the same name twice starts from the settings the last
# launch left, which is how a saved window size is watched coming back, and two
# names are two copies up at once.
probe-copy *args:
    node scripts/probe.mjs open {{ args }}

# Ask that copy to close and wait for it to go. Asked, never killed: a kill throws
# away the window size, place and maximized state that only a real close saves.
probe-close *args:
    node scripts/probe.mjs close {{ args }}

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

# Fail if a validate workflow could touch a release: every `validate-*` workflow
# holds `contents: read`, grants no write, and runs no release command, so a
# failure in one can only ever be a message.
check-workflow-permissions:
    node scripts/check-workflow-permissions.mjs

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
# folder beside this repo; pass another. Not in `verify` and it cannot be: it
# needs the WebAssembly module, which the gate never builds. `check-export-pictures`
# is the half a gate can hold, and this is the run that proves the whole of it.
export-web folder="":
    node scripts/export-web.mjs {{ folder }}

# Fail when the export stops reading the pictures a document asks for off its own
# render: a published folder used to arrive with every local picture drawn as the
# app's own broken mark. Offline, because the whole export needs the module above.
check-export-pictures:
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-export-pictures.mjs

# The same export, served locally so it can be looked at — a page cannot fetch
# its neighbors off file://. It serves the exported folder and nothing else.
preview-web folder="":
    node scripts/serve-web.mjs {{ folder }}

# leaftext.com itself — the two pages a visitor opens, not a folder of exported
# documents. Needs the module: run `build-web` first or it says so and stops.
# The front page is served baked, which is the first paint a real visitor gets;
# `--unbaked` serves the empty holder the tree keeps, the branch a local
# checkout takes. Nothing it does is written down.
preview-site *flags:
    node scripts/serve-site.mjs {{ flags }}

# Press things in the exported site and read the page back — the browser half of
# `just drive`. A check that passes is not a button that works.
#   just drive-web http://127.0.0.1:8123/#README.md click:.docs-pager-next shot:out.png
# A `size:1280,900` step lays the page out at that width, as often in one run as
# it is given, so anything written to grow with the window can be read at two of them.
drive-web url *steps:
    node scripts/drive-web.mjs {{ url }} {{ steps }}

# Fail on quoted interpolations: cmd.exe passes quotes through as argument characters.
check-justfile-quotes:
    node scripts/check-justfile-quotes.mjs

# Fail if the compile share is gone, malformed or raised: every compile here is a Cargo command, so one missing setting is a machine nobody can use while the gate runs.
check-build-jobs:
    node scripts/check-build-jobs.mjs --check

# Fail when the repo guide’s version rule and the release skill’s app-change list name different scripts: a path on one list only is a diff that releases or does not depending which file was read first.
check-version-rule:
    node scripts/check-version-rule.mjs --check

verify: format-check check check-web check-installer check-web-commands check-doc-commands check-doc-modules test check-loop-not-read-as-text check-vendor check-themes check-tokens check-icons check-gallery check-design-docs check-classes check-literals check-page-frame check-minimap-breakpoint check-hover-fills check-scratch-names check-temporary-code check-growl-words check-app-formats check-format-prose check-release check-verify check-justfile-quotes check-build-jobs check-version-rule check-spelling check-docs check-doc-images check-footprints check-plan check-plan-stage check-learn-snapshots check-shared-rules check-wrapping check-ascii-art check-site check-site-images check-site-boot check-other-site check-export-pictures check-shell check-identity check-hooks check-release-package check-workflow-installs check-workflow-permissions check-mcp check-agent-settings check-driver check-shot-edges check-compose-shots

# Put the work in this checkout on main right now: staged by name, committed, pushed. No
# gate, no version, no tag. It is the first thing a release does, so the work stops sitting
# in a shared tree for the hour the docs, the comments and the whole suite take. The message
# is the commit's title — the ticket name in plain words — and a blank one is refused.
land *message:
    node --experimental-strip-types scripts/prepare-release.mts --land --no-sign-commit {{ message }}

# Cut a release: one command from the gate to the push, all of it inside one still copy of
# the plan tree. It was two — check and tag, then push after that process had exited — and
# the push had no copy behind it at all. The message names the work the release ships and
# lands in the commit after the version; a blank one is refused.
release version *message:
    node --experimental-strip-types scripts/prepare-release.mts {{ version }} --no-sign-commit {{ message }}

# Finish a release on the tag it already has: start both release builds against v<version>. It makes no tag, moves none, writes no version and commits nothing — the tag is already up, so an outage is finished here rather than with a new number. The tag lookup is first, so a version with no tag on GitHub stops it before either build starts.
publish-release version:
    @echo Finishing v{{ version }} on the tag already on GitHub. If the next line fails there is no such tag, so this is a release to cut rather than one to finish.
    git ls-remote --exit-code --tags origin refs/tags/v{{ version }}
    gh workflow run release-windows.yml --ref main -f tag_name=v{{ version }}
    gh workflow run release-distributions.yml --ref main -f tag_name=v{{ version }}
